import {
  safeReadFile, safeReadJson, getDocPath, getChaptersDir, getConfigPath,
  resolveLimit, takeTailChars, parseChapterNumber,
  readDocParts, readChapterDoc, listCharacterDocs, selectCharacterDocs, parseScenes,
  clipDocParts, selectForeshadowReminders,
} from "../utils.js"
import type {
  NovelConfig, DocPart, ForeshadowReminder,
} from "../utils.js"
import { DEFAULTS, CHAPTER_WORD_TOLERANCE } from "../constants.js"
import {
  buildSummaryContext, splitForeshadowEntries, readCharacterStateRecord, readForeshadowRecord,
  readTextRecord, describeBrokenRecord,
} from "../records.js"
import {
  isUntouchedTemplate, REALITY_SOURCE_TEMPLATE,
  WUXIA_SECTS_TEMPLATE, WUXIA_MARTIAL_ARTS_TEMPLATE, WUXIA_WEAPONS_TEMPLATE,
} from "../templates.js"
import type { LimitKey } from "../constants.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

interface ContextArgs {
  chapterNumber: number
  sceneId?: string
  includePrompts?: boolean
}

export async function novelContextExecute(
  args: ContextArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const chapterNum = args.chapterNumber
  const includePrompts = args.includePrompts !== false

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))

  /**
   * 複数の文書に枠を配分して切り出す。
   * 連結してから先頭から切ると、前に置いた文書が長いだけで後ろが丸ごと落ちる。
   */
  const clipParts = (parts: DocPart[], key: LimitKey): string =>
    clipDocParts(parts, resolveLimit(config, key))

  let context = `📝 執筆用の資料 — 第${chapterNum}章\n${"=".repeat(50)}\n\n`

  if (config) {
    const targetWords = config.targetWords ?? DEFAULTS.targetWords
    const chapterCount = config.chapterCount ?? DEFAULTS.chapterCount
    context += `## 📖 作品情報\n`
    context += `タイトル: ${config.title}\n`
    context += `ジャンル: ${config.genre}\n`
    if (config.theme) context += `テーマ: ${config.theme}\n`
    context += `視点: ${config.narrativePerspective ?? DEFAULTS.narrativePerspective}\n`
    context += `目標文字数: ${targetWords.toLocaleString("ja-JP")}文字（全${chapterCount}章）\n`
    context += `この章の目安: ${Math.round(targetWords / chapterCount).toLocaleString("ja-JP")}文字 ±${Math.round(CHAPTER_WORD_TOLERANCE * 100)}%\n\n`
  }

  // --- この章のプロット（P0） ---
  // 章ごとに分割された outline/chapter-NNN.md を優先し、
  // 無ければ統合ファイル outline-detailed.md から該当章を抜き出す。
  let chapterOutline = await readChapterDoc(dir, "outline", chapterNum)
  if (!chapterOutline) {
    const outline = await safeReadFile(getDocPath(dir, "outline-detailed"))
    if (outline) chapterOutline = extractChapterSection(outline, chapterNum)
  }
  if (chapterOutline) {
    context += `## 📋 この章のプロット (P0 — 必ず従う)\n${chapterOutline.trim()}\n\n`
  }

  // --- この章のシーン（P0） ---
  // scenes/chapter-NNN.md を優先し、無ければ scenes.md から該当章のシーンを抜き出す。
  const sceneSource =
    (await readChapterDoc(dir, "scenes", chapterNum)) ??
    (await safeReadFile(getDocPath(dir, "scenes")))
  const sceneParts = sceneSource ? extractChapterScenes(sceneSource, chapterNum, args.sceneId) : []
  if (sceneParts.length > 0) {
    context += `## 🎬 この章のシーン (P0 — 執筆の手引き)\n`
    if (args.sceneId) context += `今回書くシーン: ${args.sceneId}\n\n`
    context += clipParts(sceneParts, "scenes") + "\n\n"
  }

  // 人物の絞り込みに使う手がかり（この章のプロットとシーン）。
  // 枠で切る前の全文を使う（切られた部分に出る人物を取りこぼさないため）
  const chapterText = [chapterOutline ?? "", ...sceneParts.map((p) => p.content)].join("\n")

  // --- 登場人物（P1） ---
  // 一覧（profiles.md）と、この章に出る人物の個別ファイルを合わせる。
  const profileParts = (await readDocParts(dir, "characters/profiles.md", null)).map((p) => ({
    ...p,
    label: "一覧（profiles.md）",
  }))
  const allCharacterDocs = await listCharacterDocs(dir)
  const relevantDocs = selectCharacterDocs(allCharacterDocs, chapterText)
  const characterParts = [...profileParts, ...relevantDocs]
  if (characterParts.length > 0) {
    context += `## 👤 登場人物 (P1 — 重要)\n`
    if (allCharacterDocs.length > 0 && relevantDocs.length < allCharacterDocs.length) {
      const names = relevantDocs.map((d) => d.label).join("、")
      context += `（この章に関わる人物の設定を載せています: ${names}）\n`
    }
    context += clipParts(characterParts, "characterProfiles") + "\n\n"
  }

  // 記録が壊れているときは「記録が無い」と区別して知らせる（黙って省くと、
  // 状態を知らないまま書き進め、更新もできないことに気づけない）
  const charState = await readCharacterStateRecord(getDocPath(dir, "character-state"))
  if (charState.kind === "broken") {
    context += `## 🔄 登場人物の現在の状態 (P1 — 重要)\n`
    context += `⚠️ ${describeBrokenRecord(".novel/characters/state.json", charState)}。直すまで人物の状態は載せられず、更新もできません\n\n`
  } else if (charState.kind === "ok" && charState.value.characters.length > 0) {
    context += `## 🔄 登場人物の現在の状態 (P1 — 重要)\n`
    for (const c of charState.value.characters) {
      context += `**${c.name}**（${c.role ?? "役割未設定"}）: ${c.mentalState ?? "平常"}\n`
      if (c.physicalState) context += `  体調: ${c.physicalState}\n`
      if (c.items && c.items.length > 0) context += `  所持品: ${c.items.join("、")}\n`
      if (c.abilities && c.abilities.length > 0) context += `  できること: ${c.abilities.join("、")}\n`
    }
    context += "\n"
  }

  if (chapterNum > 1) {
    const summary = await readTextRecord(getDocPath(dir, "summary"))
    const summaryText =
      summary.kind === "broken"
        ? `⚠️ ${describeBrokenRecord(".novel/summary.md", summary)}。直すまであらすじは載せられず、更新もできません`
        : summary.kind === "ok"
          ? buildSummaryContext(summary.value, chapterNum, resolveLimit(config, "summary"))
          : ""
    if (summaryText) {
      context += `## 📚 これまでのあらすじ (P2 — 参考)\n${summaryText}\n\n`
    }

    const prevPadded = String(chapterNum - 1).padStart(3, "0")
    const prevChapterPath = join(getChaptersDir(dir), `chapter-${prevPadded}.md`)
    const prevChapter = await safeReadFile(prevChapterPath)
    if (prevChapter) {
      const limit = resolveLimit(config, "previousChapterTail")
      const tail = takeTailChars(prevChapter, limit)
      context += `## 📖 前章の末尾${limit.toLocaleString("ja-JP")}文字 (P1 — つなぎ)\n${tail}\n\n`
    }
  }

  const foreshadowRecord = await readForeshadowRecord(getDocPath(dir, "foreshadow"))
  if (foreshadowRecord.kind === "broken") {
    context += `## 🎯 伏線の確認 (P2 — 参考)\n`
    context += `⚠️ ${describeBrokenRecord(".novel/foreshadow.json", foreshadowRecord)}。直すまで伏線は確かめられず、更新もできません\n\n`
  }
  const foreshadow = foreshadowRecord.kind === "ok" ? foreshadowRecord.value : null
  if (foreshadow) {
    // 形の崩れた記録（日本語の status など）は急ぎぐあいを判定できない。
    // 回収済みのものを「未回収」と知らせないよう、別に並べて直すよう促す
    const { valid, invalid } = splitForeshadowEntries(foreshadow.items)
    // 回収済みと取り下げ済みは知らせない（selectForeshadowReminders が除く）
    const reminders = selectForeshadowReminders(valid, chapterNum)
    if (reminders.length > 0 || invalid.length > 0) {
      context += `## 🎯 伏線の確認 (P2 — 参考)\n`
      for (const r of reminders) {
        context += `${foreshadowIcon(r)} [${r.item.id}] ${r.item.title}: ${r.item.content}\n`
        context += `   ${foreshadowNote(r, chapterNum)}\n`
      }
      for (const x of invalid) {
        const raw = foreshadow.items.find((f) => (f as { id?: unknown })?.id === x.id) as Record<string, unknown> | undefined
        const text = raw ? String(raw.title ?? raw.detail ?? raw.content ?? "") : ""
        context += `❓ [${x.id}] ${text}\n`
        context += `   記録の形が崩れていて状態を判定できません（${x.problems.join("、")}）。本文と照らして novel_update で直してください\n`
      }
      context += "\n"
    }
  }

  // --- 流派・武芸設定（分割保存に対応） ---
  // 雛形のまま手を付けていない統合ファイルは載せない（分割ファイルは書き手が作ったものなので残す）
  const withoutTemplate = (parts: DocPart[], file: string, template: string): DocPart[] =>
    parts.filter((p) => !(p.label === file && isUntouchedTemplate(p.content, template)))

  const martialArts = withoutTemplate(
    await readDocParts(dir, "wuxia/martial-arts.md", "wuxia/martial-arts"),
    "wuxia/martial-arts.md",
    WUXIA_MARTIAL_ARTS_TEMPLATE,
  )
  if (martialArts.length > 0) {
    context += `## ⚔️ 剣術・技 (P1 — 流派・武芸設定)\n`
    context += clipParts(martialArts, "martialArts") + "\n\n"
  }

  const sects = withoutTemplate(
    await readDocParts(dir, "wuxia/sects.md", "wuxia/sects"),
    "wuxia/sects.md",
    WUXIA_SECTS_TEMPLATE,
  )
  if (sects.length > 0) {
    context += `## 🏯 流派・勢力 (P1 — 流派・武芸設定)\n`
    context += clipParts(sects, "sects") + "\n\n"
  }

  const weapons = withoutTemplate(
    await readDocParts(dir, "wuxia/weapons.md", "wuxia/weapons"),
    "wuxia/weapons.md",
    WUXIA_WEAPONS_TEMPLATE,
  )
  if (weapons.length > 0) {
    context += `## 🗡️ 刀剣 (P2 — 流派・武芸設定)\n`
    context += clipParts(weapons, "weapons") + "\n\n"
  }

  // --- 取材メモ（reality/ 配下の分割保存に対応） ---
  const realitySource = withoutTemplate(
    await readDocParts(dir, "reality-source.md", "reality"),
    "reality-source.md",
    REALITY_SOURCE_TEMPLATE,
  )
  if (realitySource.length > 0) {
    context += `## 🌍 取材メモ (P1 — 題材の手がかり)\n`
    context += clipParts(realitySource, "realitySource") + "\n\n"
  }

  if (includePrompts) {
    const { getPromptTemplate, fillPrompt } = await import("../prompts.js")
    const templateKey = chapterNum === 1 ? "chapter-write" : "chapter-continue"
    const template = getPromptTemplate(templateKey)
    if (template && config) {
      const targetWords = config.targetWords ?? DEFAULTS.targetWords
      const chapterCount = config.chapterCount ?? DEFAULTS.chapterCount
      const prompt = fillPrompt(template, {
        projectTitle: config.title,
        genre: config.genre,
        chapterNumber: String(chapterNum),
        chapterTitle: `第${chapterNum}章`,
        targetWordCount: String(Math.round(targetWords / chapterCount)),
        narrativePerspective: config.narrativePerspective ?? DEFAULTS.narrativePerspective,
        chapterOutline: "［上の「この章のプロット」から書き写してください］",
        charactersInfo: "［上の「登場人物」から該当者を抜き出してください］",
        previousContext: chapterNum > 1 ? "［上の「これまでのあらすじ」を参照］" : "",
        foreshadowReminders: "［上の「伏線の確認」を参照］",
        globalSummary: "［上の「これまでのあらすじ」を参照］",
        previousChapterSummary: chapterNum > 1 ? "［あらすじから前章の要点を抜き出してください］" : "",
        previousChapterTail: chapterNum > 1 ? "［上の「前章の末尾」を参照］" : "",
      })
      context += `## ✍️ 執筆プロンプト\n\`\`\`\n${prompt}\n\`\`\`\n`
    }
  }

  return context
}

/**
 * 章別プロットから該当章の記述を抜き出す。
 *
 * 見出しの章番号は算用数字・全角数字・漢数字のいずれでも読み取る
 * （「## 第一章」と書かれていても拾えるようにするため）。
 */
function extractChapterSection(outline: string, chapterNum: number): string | null {
  const lines = outline.split("\n")
  let collecting = false
  const collected: string[] = []

  for (const line of lines) {
    const chapterHeader = line.match(/^##\s+第\s*([0-9０-９〇零一二三四五六七八九十百千]+)\s*章/)
    if (chapterHeader) {
      if (collecting) break
      const num = parseChapterNumber(chapterHeader[1])
      if (num === chapterNum) {
        collecting = true
      }
    }
    if (collecting) collected.push(line)
  }

  return collected.length > 0 ? collected.join("\n") : null
}

/**
 * シーン一覧から該当章のシーンを抜き出す。
 *
 * シーンIDは「章番号.連番」の形（1.1、2.3）なので、先頭が指定の章番号の
 * ものを採る。sceneId が渡されていれば、そのシーンの見出しに印を付けて
 * どれを書くのかが分かるようにする。
 *
 * 章ごとに分割されたファイルでも同じ処理を通す。見出しの形が想定と違って
 * 1件も拾えなかったときは、ファイルの内容をそのまま返す（取りこぼさない）。
 */
function extractChapterScenes(source: string, chapterNum: number, sceneId?: string): DocPart[] {
  const scenes = parseScenes(source)
  if (scenes.length === 0) {
    // 見出しの形が想定と違って1件も拾えなかったときは、内容をそのまま渡す
    return source.trim().length > 0 ? [{ label: "シーン一覧", content: source }] : []
  }

  const prefix = `${chapterNum}.`
  const mine = scenes.filter((s) => s.id === String(chapterNum) || s.id.startsWith(prefix))
  if (mine.length === 0) return []

  return mine.map((s) => {
    const raw = s.raw.replace(/\s+$/, "")
    const isTarget = Boolean(sceneId) && s.id === sceneId
    if (isTarget) {
      // 見出しの行に印を付ける（どのシーンを書くのかを一目で分かるように）
      const lines = raw.split("\n")
      lines[0] = `${lines[0]}　← 今回書くシーン`
      // 指定されたシーンは枠を先に確保する（他のシーンが長くても落ちないように）
      return { label: `シーン ${s.id}`, content: lines.join("\n"), priority: true }
    }
    return { label: `シーン ${s.id}`, content: raw }
  })
}

/** 急ぎぐあいを示す印 */
function foreshadowIcon(r: ForeshadowReminder): string {
  switch (r.timing) {
    case "overdue":
      return "⚠️"
    case "due":
      return "🎯"
    case "upcoming":
      return "⏰"
    case "undated":
      return "🌱"
  }
}

/**
 * 伏線1件の添え書き。
 *
 * 張ってあるかどうかと、回収の予定がどうなっているかを一行で示す。
 * 予定を過ぎたものを「第N章で回収予定」と書くと、まだ先のことのように
 * 読めてしまうため、過ぎたことがはっきり分かる書き方にする。
 */
function foreshadowNote(r: ForeshadowReminder, chapterNum: number): string {
  const planted = r.item.status === "planted" ? "張り済み" : "まだ張っていません"
  const target = r.item.targetChapter
  switch (r.timing) {
    case "overdue":
      return `${planted}／回収予定の第${target}章を過ぎています（現在は第${chapterNum}章）`
    case "due":
      return `${planted}／← この章で回収`
    case "upcoming":
      return `${planted}／第${target}章で回収予定`
    case "undated":
      return `${planted}／回収の章は未定`
  }
}
