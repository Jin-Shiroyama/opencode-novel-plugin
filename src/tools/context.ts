import {
  safeReadFile, safeReadJson, getDocPath, getConfigPath,
  resolveLimit, takeTailChars, parseChapterNumber, truncateChars, toKanjiNumber,
  readDocParts, readChapterDoc, listCharacterDocs, selectCharacterDocs, parseScenes,
  clipDocParts, selectForeshadowReminders, extractSpeechProfile, isShortForm, isSerial, styleLabel,
} from "../utils.js"
import type {
  NovelConfig, DocPart, ForeshadowReminder, CharacterDoc, SpeechProfile,
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
import {
  sectionFromArgs, sectionLabel, sectionFileName, parseSectionLabel, readSectionDoc, listManuscriptFiles,
  previousManuscriptFile, recordChapterOf, sameSection, parseParts, partOfChapter, partName, partRange,
  lastChapterForRecords, lastWrittenChapter,
} from "../sections.js"
import type { ManuscriptSection, SectionKind } from "../sections.js"
import { statesBefore, lastRecordedBefore, stateKeyNames, formatStateKeyNames } from "../character-state.js"
import type { ResolvedCharacter } from "../character-state.js"
import type { LimitKey } from "../constants.js"
import type { ToolContext } from "../index.js"

interface ContextArgs {
  /** 章（既定）・プロローグ・幕間・エピローグ（sections.ts） */
  section?: SectionKind
  /** 章番号。幕間では、幕間を置く位置（直前の章の番号） */
  chapterNumber?: number
  interludeIndex?: number
  sceneId?: string
  includePrompts?: boolean
}

export async function novelContextExecute(
  args: ContextArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const resolved = sectionFromArgs(args)
  if ("error" in resolved) return `❌ ${resolved.error}。`
  const section = resolved.section
  let label = sectionLabel(section)
  const includePrompts = args.includePrompts !== false

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const chapterCount = config?.chapterCount ?? DEFAULTS.chapterCount
  const manuscriptFiles = await listManuscriptFiles(dir)
  const lastWritten = lastWrittenChapter(manuscriptFiles)
  // 伏線の期限や記録に使う章番号（プロローグは 0、幕間は直前の章、エピローグは本文のある最後の章）
  const chapterNum = recordChapterOf(section, lastChapterForRecords(manuscriptFiles, chapterCount))
  // 短編で章を分けない作品では、第1章が本文そのもの
  const short = isShortForm(config)
  const singleBody = short && chapterCount === 1 && section.kind === "chapter" && section.chapter === 1
  if (singleBody) label = "本文"

  /**
   * 複数の文書に枠を配分して切り出す。
   * 連結してから先頭から切ると、前に置いた文書が長いだけで後ろが丸ごと落ちる。
   */
  const clipParts = (parts: DocPart[], key: LimitKey): string =>
    clipDocParts(parts, resolveLimit(config, key))

  let context = `📝 執筆用の資料 — ${label}\n${"=".repeat(50)}\n\n`

  if (config) {
    const targetWords = config.targetWords ?? DEFAULTS.targetWords
    context += `## 📖 作品情報\n`
    context += `タイトル: ${config.title}\n`
    context += `ジャンル: ${config.genre}\n`
    if (config.theme) context += `テーマ: ${config.theme}\n`
    context += `視点: ${config.narrativePerspective ?? DEFAULTS.narrativePerspective}\n`
    // 部に分けた作品では、この章がどの部の何章目かを示す（幕間は直前の章の部）
    const parts = parseParts(config.parts)
    if (parts && "parts" in parts && (section.kind === "chapter" || section.kind === "interlude")) {
      const part = partOfChapter(parts.parts, section.chapter)
      if (part) {
        const nth = section.kind === "chapter" ? `の${section.chapter - part.fromChapter + 1}章目` : ""
        context += `部: ${partName(part, "kanji", toKanjiNumber)}「${part.title}」（${partRange(part, Math.max(chapterCount, lastWritten))}）${nth}\n`
      }
    } else if (parts && "error" in parts) {
      context += `⚠️ ${parts.error}\n`
    }
    context += singleBody
      ? `形: 短編（章なし）\n`
      : isSerial(config)
        ? `目標文字数: ${targetWords.toLocaleString("ja-JP")}文字（${short ? "短編・" : ""}連載。章数の目安 全${chapterCount}章${lastWritten > 0 ? `、本文は第${lastWritten}章まで` : ""}）\n`
        : `目標文字数: ${targetWords.toLocaleString("ja-JP")}文字（${short ? "短編・" : ""}全${chapterCount}章）\n`
    const perChapter = Math.round(targetWords / chapterCount).toLocaleString("ja-JP")
    context += singleBody
      ? `本文の目安: ${perChapter}文字 ±${Math.round(CHAPTER_WORD_TOLERANCE * 100)}%\n\n`
      : section.kind === "chapter"
        ? `この章の目安: ${perChapter}文字 ±${Math.round(CHAPTER_WORD_TOLERANCE * 100)}%\n\n`
        : `分量の目安: プロットに従う（章の目安は ${perChapter}文字。${label}は章の数に入りません）\n\n`
  }

  // --- この章のプロット（P0） ---
  // 章ごとに分割された outline/chapter-NNN.md（節なら outline/prologue.md など）を優先し、
  // 無ければ統合ファイル outline-detailed.md から該当する節を抜き出す。
  let chapterOutline = await readSectionDoc(dir, "outline", section)
  if (!chapterOutline) {
    const outline = await safeReadFile(getDocPath(dir, "outline-detailed"))
    if (outline) chapterOutline = extractOutlineSection(outline, section)
  }
  if (chapterOutline) {
    context += `## 📋 この${section.kind === "chapter" ? "章" : "節"}のプロット (P0 — 必ず従う)\n${chapterOutline.trim()}\n\n`
  }
  // 短編は章別プロットを作らないので、プロット概要（序破急）を載せる
  let shortBrief: string | null = null
  if (!chapterOutline && short && section.kind === "chapter") {
    shortBrief = await safeReadFile(getDocPath(dir, "outline-brief"))
    if (shortBrief && shortBrief.trim()) {
      const [brief, truncated] = truncateChars(shortBrief.trim(), resolveLimit(config, "outlineBrief"))
      context += `## 📋 作品のプロット（序破急） (P0 — 必ず従う)\n`
      if (!singleBody) context += `（第${section.chapter}章が序・破・急のどこに当たるかを確かめてから書きます）\n`
      context += brief
      if (truncated) context += `\n…（以下省略。limits.outlineBrief で枠を広げられます）`
      context += "\n\n"
    }
  }
  // 章のプロットが無いとき。連載では章別プロットを章ごとに足していくので、足りない章を書く前に気づけるようにする
  if (!chapterOutline && section.kind === "chapter" && isSerial(config) && !(shortBrief && shortBrief.trim())) {
    context += `## 📋 この章のプロット (P0 — 必ず従う)\n`
    context += `⚠️ 第${section.chapter}章のプロットが見つかりません。連載では、書く前に \`/novel-outline\` でこの章の章別プロット（outline/${sectionFileName(section)}）を足します\n\n`
  }
  if (!chapterOutline && section.kind !== "chapter") {
    context += `## 📋 この節のプロット (P0 — 必ず従う)\n`
    context += `⚠️ ${label}のプロットが見つかりません。outline-detailed.md に「## ${label}」の節を書くか、outline/${sectionFileName(section)} を作ってください\n\n`
  }

  // --- この章のシーン（P0） ---
  // scenes/chapter-NNN.md を優先し、無ければ scenes.md から該当章のシーンを抜き出す。
  // 章以外の節にはシーンIDを振らない（流れはプロットに書く）
  const sceneSource =
    section.kind !== "chapter"
      ? null
      : ((await readChapterDoc(dir, "scenes", section.chapter)) ?? (await safeReadFile(getDocPath(dir, "scenes"))))
  const sceneParts =
    sceneSource && section.kind === "chapter" ? extractChapterScenes(sceneSource, section.chapter, args.sceneId) : []
  if (sceneParts.length > 0) {
    context += `## 🎬 この章のシーン (P0 — 執筆の手引き)\n`
    if (args.sceneId) context += `今回書くシーン: ${args.sceneId}\n\n`
    context += clipParts(sceneParts, "scenes") + "\n\n"
  }

  // 人物の絞り込みに使う手がかり（この章のプロットとシーン）。
  // 枠で切る前の全文を使う（切られた部分に出る人物を取りこぼさないため）
  const chapterText = [chapterOutline ?? "", shortBrief ?? "", ...sceneParts.map((p) => p.content)].join("\n")

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

  const charState = await readCharacterStateRecord(getDocPath(dir, "character-state"))
  // 書く章・節より前の記録だけを重ねる（前の章を書き直すときに、先の章の変化を混ぜない）
  const states = charState.kind === "ok" ? statesBefore(charState.value, section) : []

  // --- ことばづかい（P1） ---
  // 人物設定の全文は上の枠で切られることがあるため、一人称・二人称・呼び方だけを
  // 別に抜き出して載せる。物語の途中で変わったもの（state.json）を上に重ねる。
  const speech = buildSpeechContext(
    allCharacterDocs,
    relevantDocs,
    states,
    chapterText,
  )
  if (speech) {
    const limit = resolveLimit(config, "speech")
    const [body, truncated] = truncateChars(speech, limit)
    context += `## 🗣️ ことばづかい (P1 — 重要)\n`
    context += `台詞と、一人称の語りなら地の文も、このとおりに書きます。変えるときは理由になる出来事を本文に置き、novel_update(character-state) の speech（firstPerson / addressTerms）を更新します。\n`
    context += body
    if (truncated) context += `\n…（以下省略。limits.speech で枠を広げられます）`
    context += "\n\n"
  }

  // 記録が壊れているときは「記録が無い」と区別して知らせる（黙って省くと、
  // 状態を知らないまま書き進め、更新もできないことに気づけない）
  if (charState.kind === "broken") {
    context += `## 🔄 登場人物の現在の状態 (P1 — 重要)\n`
    context += `⚠️ ${describeBrokenRecord(".novel/characters/state.json", charState)}。直すまで人物の状態は載せられず、更新もできません\n\n`
  } else if (states.length > 0 && charState.kind === "ok") {
    const asOf = lastRecordedBefore(charState.value, section)
    context += `## 🔄 登場人物の現在の状態（${asOf ? `${sectionLabel(asOf)}の終わり時点` : "記録より"}） (P1 — 重要)\n`
    context += buildCharacterStateContext(states, relevantDocs, chapterText, resolveLimit(config, "characterState"))
    context += "\n\n"
  }
  // 記録の項目名（作品ごとに決めたもの）。書き終えて novel_update するときに同じ名前を使えるように
  const keyNames = charState.kind === "ok" ? formatStateKeyNames(stateKeyNames(charState.value)) : ""
  if (keyNames) {
    context += `📌 人物の状態の記録で使っている項目名: ${keyNames}（novel_update(character-state) では同じものをこの名前で書きます）\n\n`
  }

  // あらすじは、読む順番でこの章・節より前のものを載せる（プロローグには載せない）
  let summaryText = ""
  if (section.kind !== "prologue" && !(section.kind === "chapter" && section.chapter === 1 && !manuscriptFiles.some((f) => f.section.kind === "prologue"))) {
    const summary = await readTextRecord(getDocPath(dir, "summary"))
    summaryText =
      summary.kind === "broken"
        ? `⚠️ ${describeBrokenRecord(".novel/summary.md", summary)}。直すまであらすじは載せられず、更新もできません`
        : summary.kind === "ok"
          ? buildSummaryContext(summary.value, section, resolveLimit(config, "summary"), lastWritten)
          : ""
    if (summaryText) {
      context += `## 📚 これまでのあらすじ (P2 — 参考)\n${summaryText}\n\n`
    }
  }

  // 前の本文の末尾。読む順番ですぐ前の本文（幕間をはさむなら幕間、第1章ならプロローグ）
  const prev = previousManuscriptFile(manuscriptFiles, section)
  const prevText = prev ? await safeReadFile(prev.path) : null
  if (prev && prevText) {
    const limit = resolveLimit(config, "previousChapterTail")
    const tail = takeTailChars(prevText, limit)
    const prevName = prev.section.kind === "chapter" ? "前章" : `前の${sectionLabel(prev.section)}`
    context += `## 📖 ${prevName}の末尾${limit.toLocaleString("ja-JP")}文字 (P1 — つなぎ)\n${tail}\n\n`
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
        context += `   ${foreshadowNote(r, label)}\n`
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

  // 書くときの条件。資料は上に載せてあるので、プロンプトの全文を写し直さない
  // （以前は chapter-write / chapter-continue の全文に「上から書き写してください」と差し込んで載せていたため、
  //  同じ資料を二度読ませ、表記規約と言い回しの一覧も skill と重ねていた）
  if (includePrompts && config) {
    const targetWords = config.targetWords ?? DEFAULTS.targetWords
    // 物語の最初に来る本文（プロローグ、プロローグの無い作品の第1章）は書き出し
    const isOpening = prev === null && (section.kind === "prologue" || (section.kind === "chapter" && section.chapter === 1))
    const perChapter = Math.round(targetWords / chapterCount).toLocaleString("ja-JP")
    const tolerance = Math.round(CHAPTER_WORD_TOLERANCE * 100)
    context += `## ✍️ 書くときの条件\n`
    context += `- 書くもの: ${label}（${isOpening ? "物語の書き出し。前置きなしに、場面か動作から始める" : "続き。前の本文の末尾から自然につなぐ"}）\n`
    context += section.kind === "chapter"
      ? `- 分量: ${perChapter}文字 ±${tolerance}%\n`
      : `- 分量: プロットに従う（章の目安は ${perChapter}文字）\n`
    context += `- 視点: ${config.narrativePerspective ?? DEFAULTS.narrativePerspective}（同じ場面の中で視点人物を入れ替えない。替えるなら区切りを置いて場面を分ける）\n`
    context += `- 文体: ${styleLabel(config)}（novel-writing skill の表記規約のうち、${styleLabel(config)}の項に従う）\n`
    context += `- 上のプロット（P0）から外れず、人物の設定と「ことばづかい」を保つ\n`
    context += `- 表記と言い回しは novel-writing skill に従う（表記規約と、AI くさい言い回しの一覧）\n`
    context += `- 本文だけを書き、章見出しの行を付けずに novel_save_chapter に渡す\n`
  }

  return context
}

/** 人物設定の文書がその名前の人物のものか（フルネーム・呼称・姓での記録に合わせる） */
function docMatchesName(doc: CharacterDoc, name: string): boolean {
  return doc.label === name || doc.aliases.includes(name) || doc.label.startsWith(name)
}

const STATUS_LABELS: Record<string, string> = { deceased: "死亡", missing: "行方不明", retired: "退場" }
/** 出来事を載せる件数（この章に関わる人物だけ。直近から） */
const RECENT_EVENTS = 5

/**
 * 書く章より前の記録を重ねた人物の状態を、資料の形にする。
 *
 * この章のプロットかシーンに出る人物（selectCharacterDocs で選んだ人物設定に当たるか、名前が出るもの）を
 * 上に詳しく、ほかの人物を下に1行ずつ並べる。群像劇で人数が増えても、この章に要る人物が枠に収まるように。
 * 死亡・行方不明・退場は名前のすぐ横に、変わった節とともに示す（亡くなった人物を書き戻さないため）。
 * 枠（limits.characterState）を超えたら、上から順に入るところまでを載せ、省いた人物の名前を示す。
 */
function buildCharacterStateContext(
  states: ResolvedCharacter[],
  relevantDocs: CharacterDoc[],
  chapterText: string,
  limit: number,
): string {
  const hasClues = chapterText.trim().length > 0
  const relevant = (c: ResolvedCharacter) =>
    !hasClues || relevantDocs.some((d) => docMatchesName(d, c.name)) || chapterText.includes(c.name)
  const statusMark = (c: ResolvedCharacter) => {
    if (c.status === "active") return ""
    const at = c.changedAt.status
    return `【${STATUS_LABELS[c.status] ?? c.status}${at ? `（${sectionLabel(at)}）` : ""}】`
  }
  const pairs = (map: Record<string, string>, sep: string) =>
    Object.entries(map).map(([k, v]) => `${k}${sep}${v}`).join(" ／ ")

  const main = states.filter(relevant)
  const others = states.filter((c) => !relevant(c))
  const blocks: Array<{ name: string; text: string }> = []
  for (const c of main) {
    const lines = [`**${c.name}**${statusMark(c)}`]
    if (c.mentalState) lines.push(`  心: ${c.mentalState}`)
    if (c.physicalState) lines.push(`  体: ${c.physicalState}`)
    if (Object.keys(c.attributes).length > 0) lines.push(`  ${pairs(c.attributes, ": ")}`)
    for (const [name, values] of Object.entries(c.lists)) lines.push(`  ${name}: ${values.join("、")}`)
    if (Object.keys(c.relationships).length > 0) lines.push(`  関係: ${pairs(c.relationships, " → ")}`)
    const recent = c.events.slice(-RECENT_EVENTS)
    if (recent.length > 0) {
      const omitted = c.events.length - recent.length
      lines.push(`  これまでの出来事${omitted > 0 ? `（直近${recent.length}件）` : ""}:`)
      for (const e of recent) lines.push(`    - [${sectionLabel(e.at)}] ${e.text}`)
    }
    blocks.push({ name: c.name, text: lines.join("\n") })
  }
  if (others.length > 0) {
    const heading = main.length > 0 ? "\n### ほかの人物（この章のプロット・シーンに名前が無い）" : ""
    others.forEach((c, i) => {
      const summary = [c.mentalState, c.attributes["現在地"]].filter(Boolean).join(" ／ ")
      const line = `- **${c.name}**${statusMark(c)}${summary ? `: ${summary}` : ""}`
      blocks.push({ name: c.name, text: i === 0 && heading ? `${heading}\n${line}` : line })
    })
  }

  let out = main.length > 0 && others.length > 0 ? "### この章に関わる人物\n" : ""
  const dropped: string[] = []
  let placed = 0
  for (const b of blocks) {
    const next = out.length === 0 || out.endsWith("\n") ? b.text : `\n${b.text}`
    if (dropped.length === 0 && out.length + next.length <= limit) {
      out += next
      placed++
    } else if (placed === 0) {
      // 最初の人物だけで枠を超えるときは、その人物を切って載せる（誰も載らないよりよい）
      out += truncateChars(next, Math.max(0, limit - out.length))[0]
      placed++
    } else {
      dropped.push(b.name)
    }
  }
  if (dropped.length > 0) out += `\n…（枠が足りず省略: ${dropped.join("、")}。limits.characterState で枠を広げられます）`
  return out
}

/**
 * ことばづかいの一覧を作る。載せる人物が無ければ空文字。
 *
 * 人物設定（初めの設定）に、書く章より前の記録で変わった firstPerson / addressTerms を重ねる。
 * 載せるのはこの章に出る人物（selectCharacterDocs で選んだもの）と、人物設定の文書は無いが
 * 記録に値があり、この章のプロットかシーンに名前が出る人物。
 */
function buildSpeechContext(
  allDocs: CharacterDoc[],
  relevantDocs: CharacterDoc[],
  states: ResolvedCharacter[],
  chapterText: string,
): string {
  const matches = docMatchesName

  const entries: Array<{ name: string; profile: SpeechProfile; state?: ResolvedCharacter }> = []
  for (const doc of relevantDocs) {
    const state = states.find((s) => matches(doc, s.name))
    const profile = extractSpeechProfile(doc.content) ?? { addressTerms: [] }
    entries.push({ name: doc.label, profile, state })
  }
  for (const state of states) {
    if (!state.firstPerson && Object.keys(state.addressTerms).length === 0) continue
    if (allDocs.some((d) => matches(d, state.name))) continue
    if (chapterText.trim().length > 0 && !chapterText.includes(state.name)) continue
    entries.push({ name: state.name, profile: { addressTerms: [] }, state })
  }

  const blocks: string[] = []
  for (const { name, profile, state } of entries) {
    const changed = (field: string) => {
      const at = state?.changedAt[field]
      return at ? `（${sectionLabel(at)}で変更）` : "（記録で変更）"
    }
    const fields: string[] = []
    const firstPerson = state?.firstPerson ?? profile.firstPerson
    if (firstPerson) {
      const mark = state?.firstPerson && state.firstPerson !== profile.firstPerson ? changed("firstPerson") : ""
      fields.push(`一人称: ${firstPerson}${mark}`)
    }
    if (profile.secondPerson) fields.push(`二人称: ${profile.secondPerson}`)
    if (profile.politeness) fields.push(`丁寧さ: ${profile.politeness}`)

    const rows = profile.addressTerms.map((r) => ({ ...r, mark: "" }))
    for (const [target, term] of Object.entries(state?.addressTerms ?? {})) {
      const row = rows.find((r) => r.target === target)
      if (!row) rows.push({ target, term, mark: changed(`addressTerms.${target}`) })
      else if (row.term !== term) Object.assign(row, { term, politeness: undefined, mark: changed(`addressTerms.${target}`) })
    }

    if (fields.length === 0 && rows.length === 0) continue
    let block = `**${name}**${fields.length > 0 ? ` — ${fields.join(" ／ ")}` : ""}`
    for (const r of rows) {
      block += `\n  - ${r.target} → ${r.term}${r.politeness ? `（${r.politeness}）` : ""}${r.mark}`
    }
    blocks.push(block)
  }
  return blocks.join("\n")
}

/**
 * 章別プロットから該当する章・節の記述を抜き出す。
 *
 * 見出しの章番号は算用数字・全角数字・漢数字のいずれでも読み取る
 * （「## 第一章」と書かれていても拾えるようにするため）。
 * 章以外の節は「## プロローグ」「## 幕間（第5章のあと）」「## エピローグ」の見出しで探す。
 * 次の章か節の見出しで止める（第5章のプロットに、あとに続く幕間を混ぜないため）。
 */
function extractOutlineSection(outline: string, target: ManuscriptSection): string | null {
  const lines = outline.split("\n")
  let collecting = false
  const collected: string[] = []

  for (const line of lines) {
    const heading = outlineHeadingSection(line)
    if (heading) {
      if (collecting) break
      if (sameSection(heading, target)) collecting = true
    }
    if (collecting) collected.push(line)
  }

  return collected.length > 0 ? collected.join("\n") : null
}

/** 章別プロットの `## ` 見出しが指す章・節。章や節の見出しでなければ null */
function outlineHeadingSection(line: string): ManuscriptSection | null {
  const chapterHeader = line.match(/^##\s+第\s*([0-9０-９〇零一二三四五六七八九十百千]+)\s*章/)
  if (chapterHeader) {
    const num = parseChapterNumber(chapterHeader[1])
    return num === null ? null : { kind: "chapter", chapter: num }
  }
  const m = line.match(/^##\s+(.*)$/)
  return m ? parseSectionLabel(m[1], parseChapterNumber) : null
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
function foreshadowNote(r: ForeshadowReminder, currentLabel: string): string {
  const planted = r.item.status === "planted" ? "張り済み" : "まだ張っていません"
  const target = r.item.targetChapter
  switch (r.timing) {
    case "overdue":
      return `${planted}／回収予定の第${target}章を過ぎています（現在は${currentLabel}）`
    case "due":
      return `${planted}／← この章で回収`
    case "upcoming":
      return `${planted}／第${target}章で回収予定`
    case "undated":
      return `${planted}／回収の章は未定`
  }
}
