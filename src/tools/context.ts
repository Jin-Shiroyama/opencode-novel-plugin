import {
  safeReadFile, safeReadJson, getDocPath, getChaptersDir, getConfigPath,
  resolveLimit, truncateChars, takeTailChars, parseChapterNumber,
  readDocParts, readChapterDoc, listCharacterDocs, selectCharacterDocs, parseScenes,
} from "../utils.js"
import type { ForeshadowEntry, CharacterState, NovelConfig, DocPart } from "../utils.js"
import { DEFAULTS, CHAPTER_WORD_TOLERANCE } from "../constants.js"
import type { LimitKey } from "../constants.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

interface ContextArgs {
  chapterNumber: number
  sceneId?: string
  includePrompts?: boolean
}

/** 複数のファイルから集めた文書を、どこ由来かが分かる形に連ねる */
function joinParts(parts: DocPart[]): string {
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0].content.trim()
  return parts.map((p) => `### ${p.label}\n${p.content.trim()}`).join("\n\n")
}

export async function novelContextExecute(
  args: ContextArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const chapterNum = args.chapterNumber
  const includePrompts = args.includePrompts !== false

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))

  /** config.json の limits を反映して資料を切り出す */
  const clip = (text: string, key: LimitKey): string => {
    const [body, truncated] = truncateChars(text, resolveLimit(config, key))
    return truncated ? `${body}\n…（以下省略。全文は該当ファイルを直接参照してください）` : body
  }

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
  let chapterScenes: string | null = null
  if (sceneSource) {
    chapterScenes = extractChapterScenes(sceneSource, chapterNum, args.sceneId)
  }
  if (chapterScenes) {
    context += `## 🎬 この章のシーン (P0 — 執筆の手引き)\n`
    if (args.sceneId) context += `今回書くシーン: ${args.sceneId}\n\n`
    context += clip(chapterScenes, "scenes") + "\n\n"
  }

  // 人物の絞り込みに使う手がかり（この章のプロットとシーン）
  const chapterText = [chapterOutline ?? "", chapterScenes ?? ""].join("\n")

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
    context += clip(joinParts(characterParts), "characterProfiles") + "\n\n"
  }

  const charState = await safeReadJson<{ characters: CharacterState[] }>(getDocPath(dir, "character-state"))
  if (charState && charState.characters.length > 0) {
    context += `## 🔄 登場人物の現在の状態 (P1 — 重要)\n`
    for (const c of charState.characters) {
      context += `**${c.name}**（${c.role}）: ${c.mentalState ?? "平常"}\n`
      if (c.physicalState) context += `  体調: ${c.physicalState}\n`
      if (c.items && c.items.length > 0) context += `  所持品: ${c.items.join("、")}\n`
      if (c.abilities && c.abilities.length > 0) context += `  できること: ${c.abilities.join("、")}\n`
    }
    context += "\n"
  }

  if (chapterNum > 1) {
    const summary = await safeReadFile(getDocPath(dir, "summary"))
    if (summary) {
      context += `## 📚 これまでのあらすじ (P2 — 参考)\n${clip(summary, "summary")}\n\n`
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

  const foreshadow = await safeReadJson<{ items: ForeshadowEntry[] }>(getDocPath(dir, "foreshadow"))
  if (foreshadow && foreshadow.items.length > 0) {
    const relevant = foreshadow.items.filter(
      (f) => f.status === "planted" || (f.targetChapter && f.targetChapter <= chapterNum + 3)
    )
    if (relevant.length > 0) {
      context += `## 🎯 伏線の確認 (P2 — 参考)\n`
      for (const f of relevant) {
        const icon = f.status === "planted" ? "🌱" : "⏰"
        context += `${icon} [${f.id}] ${f.title}: ${f.content}\n`
        if (f.targetChapter) {
          const when = f.targetChapter === chapterNum ? "← この章で回収" : `第${f.targetChapter}章で回収予定`
          context += `   ${when}\n`
        }
      }
      context += "\n"
    }
  }

  // --- 流派・武芸設定（分割保存に対応） ---
  const martialArts = await readDocParts(dir, "wuxia/martial-arts.md", "wuxia/martial-arts")
  if (martialArts.length > 0) {
    context += `## ⚔️ 剣術・技 (P1 — 流派・武芸設定)\n`
    context += clip(joinParts(martialArts), "martialArts") + "\n\n"
  }

  const sects = await readDocParts(dir, "wuxia/sects.md", "wuxia/sects")
  if (sects.length > 0) {
    context += `## 🏯 流派・勢力 (P1 — 流派・武芸設定)\n`
    context += clip(joinParts(sects), "sects") + "\n\n"
  }

  const weapons = await readDocParts(dir, "wuxia/weapons.md", "wuxia/weapons")
  if (weapons.length > 0) {
    context += `## 🗡️ 刀剣 (P2 — 流派・武芸設定)\n`
    context += clip(joinParts(weapons), "weapons") + "\n\n"
  }

  // --- 取材メモ（reality/ 配下の分割保存に対応） ---
  const realitySource = await readDocParts(dir, "reality-source.md", "reality")
  if (realitySource.length > 0) {
    context += `## 🌍 取材メモ (P1 — 題材の手がかり)\n`
    context += clip(joinParts(realitySource), "realitySource") + "\n\n"
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
function extractChapterScenes(source: string, chapterNum: number, sceneId?: string): string | null {
  const scenes = parseScenes(source)
  if (scenes.length === 0) {
    return source.trim().length > 0 ? source : null
  }

  const prefix = `${chapterNum}.`
  const mine = scenes.filter((s) => s.id === String(chapterNum) || s.id.startsWith(prefix))
  if (mine.length === 0) return null

  const blocks = mine.map((s) => {
    const raw = s.raw.replace(/\s+$/, "")
    if (sceneId && s.id === sceneId) {
      // 見出しの行に印を付ける（どのシーンを書くのかを一目で分かるように）
      const lines = raw.split("\n")
      lines[0] = `${lines[0]}　← 今回書くシーン`
      return lines.join("\n")
    }
    return raw
  })

  return blocks.join("\n\n")
}
