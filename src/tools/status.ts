import { existsSync } from "node:fs"
import { basename } from "node:path"
import {
  getNovelDir, getDocPath, getChaptersDir, getConfigPath,
  safeReadFile, safeReadJson, listMarkdownFiles,
  countWords, progressBar,
  determinePhase, usesMartialArtsSetting, isDocFilled, isShortForm, isSerial,
  hasOutlineDetailed, hasSceneList, collectScenes, stripChapterHeading,
  sceneChapterNumber, toKanjiNumber,
} from "../utils.js"
import type { NovelConfig, DocType, Phase } from "../utils.js"
import {
  splitForeshadowEntries, summaryChapters, summarySections, formatChapterRanges,
  readForeshadowRecord, readCharacterStateRecord, readTextRecord, describeBrokenRecord,
} from "../records.js"
import {
  resolveManuscriptFormat, countManuscriptLines, linesToPages, linesToPagesDecimal, formatManuscriptLabel,
} from "../manuscript.js"
import {
  listManuscriptFiles, describeExtraSections, sectionLabel, sameSection, parseParts, partName, partRange,
} from "../sections.js"
import type { ManuscriptSection } from "../sections.js"
import type { ToolContext } from "../index.js"

interface StatusArgs {
  detailed?: boolean
  /** 原稿用紙の書式（「20x20」）。省くと config.json の manuscript。どちらも無ければ枚数を出さない */
  manuscript?: string
}

const PHASE_LABELS: Record<Phase, string> = {
  concept: "📝 コンセプト",
  "world-building": "🌍 世界観づくり",
  characters: "👤 人物づくり",
  outline: "📋 プロット",
  scenes: "🎬 シーン設計",
  writing: "✍️ 本文執筆",
  completed: "✅ 完結",
}

/** 進行段階ごとの次の一手 */
const PHASE_HINTS: Record<Phase, string> = {
  concept: "`/novel-concept` でコンセプトを固めましょう。",
  "world-building": "`/novel-world` で世界観を組み立てましょう。",
  characters: "`/novel-characters` で登場人物を設計しましょう。",
  outline: "`/novel-outline` でプロットを作りましょう。",
  scenes: "`/novel-scenes` で各章をシーンに割りましょう。",
  writing: "`/write-chapter <章番号>` で本文を書き進めましょう。",
  completed: "全章そろいました。`/novel-review all` で通し読みの推敲へ。",
}

/** 連載で書き進めるときの次の一手。章別プロットは章ごとに足していくので、先に確かめるよう添える */
function serialHint(next: number): string {
  return `\`/write-chapter ${next}\` で続きを書きましょう（第${next}章の章別プロットがまだなら、先に \`/novel-outline\` で足します。結末を決めたら \`/write-chapter epilogue\`）。`
}

export async function novelStatusExecute(
  args: StatusArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const novelDir = getNovelDir(dir)

  if (!existsSync(novelDir)) {
    return `❌ 作品データが見つかりません。先に novel_init でプロジェクトを作ってください。`
  }

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const phase = determinePhase(dir, config)
  const detailed = args.detailed ?? false
  const short = isShortForm(config)
  const serial = isSerial(config)

  let report = `📊 作品の進行状況\n${"=".repeat(40)}\n\n`

  if (config) {
    report += `📖 タイトル: ${config.title}\n`
    report += `🏷️  ジャンル: ${config.genre}\n`
    report += `🎯 目標文字数: ${config.targetWords?.toLocaleString("ja-JP") ?? "未設定"}文字\n`
    if (short) {
      report += `📋 形: 短編（${config.chapterCount && config.chapterCount > 1 ? `全${config.chapterCount}章` : "章なし。1本の本文"}）\n`
    } else if (serial) {
      // 連載では章数は目安。超えて書いても崩れない（完結はエピローグで判断する）
      report += `📋 連載（結末未定）／章数の目安: ${config.chapterCount ? `全${config.chapterCount}章` : "未設定"}\n`
    } else {
      report += `📋 予定章数: ${config.chapterCount ? `全${config.chapterCount}章` : "未設定"}\n`
    }
    report += `👁️  視点: ${config.narrativePerspective ?? "未設定"}\n`
    if (usesMartialArtsSetting(config)) {
      report += `🗡️  流派・武芸設定: 使用中\n`
    }
    report += `📅 開始日: ${new Date(config.createdAt).toLocaleDateString("ja-JP")}\n\n`
  }

  report += `📍 現在の段階: ${PHASE_LABELS[phase] ?? phase}\n`
  if (phase === "completed") {
    // 完結は「予定の章数がそろった」（連載ならエピローグを書いた）という意味でしかない。分量と記録は下で別に示す
    report += serial
      ? `   （連載で、エピローグを書いた状態です。記録の点検は下を参照）\n`
      : `   （予定の章数がそろった状態です。分量と記録の点検は下を参照）\n`
  }
  report += `\n`

  // 各工程の文書がそろっているか。
  // getDocPath に DocType を渡す（以前はファイル名を渡していたため
  // concept.md.md のような存在しないパスを見ていて常に未完了表示だった）
  //
  // novel_init が雛形として先に作る3文書は、ファイルの有無では判定できない。
  // determinePhase と同じ基準（角括弧プレースホルダが残っていないか）で見る。
  // 章別プロットとシーン一覧は、統合ファイルでも章ごとの分割でも「できている」とみなす。
  // determinePhase と同じ判定を使う。別々に判定すると、分割保存だけの作品で
  // 「現在の段階: 本文執筆」と「章別プロット: 未作成」が同時に出てしまう。
  const stages: Array<{ label: string; done: boolean; template?: boolean }> = [
    {
      label: "作品コンセプト",
      done: isDocFilled(getDocPath(dir, "concept")),
      template: existsSync(getDocPath(dir, "concept")),
    },
    {
      label: "世界観",
      done: isDocFilled(getDocPath(dir, "world-building")),
      template: existsSync(getDocPath(dir, "world-building")),
    },
    {
      label: "登場人物",
      done: isDocFilled(getDocPath(dir, "characters")),
      template: existsSync(getDocPath(dir, "characters")),
    },
    { label: "プロット概要", done: existsSync(getDocPath(dir, "outline-brief")) },
    { label: "章別プロット", done: hasOutlineDetailed(dir) },
    { label: "シーン一覧", done: hasSceneList(dir) },
  ].filter((stage) => !(short && (stage.label === "世界観" || stage.label === "章別プロット")))

  report += `📋 工程の進み具合:\n`
  for (const stage of stages) {
    let mark = stage.done ? "✅" : "⬜"
    // 雛形はあるが未記入の状態を区別して示す
    if (!stage.done && stage.template) mark = "📝"
    report += `  ${mark} ${stage.label}\n`
  }
  report += `  （✅ 記入済み / 📝 雛形あり・未記入 / ⬜ 未作成）\n`
  if (short) report += `  （短編では世界観と章別プロットの工程を省きます。プロットはプロット概要の序破急からシーンに割ります）\n`

  // シーンは統合ファイルと章ごとの分割の両方から集める。
  // 同じ章が両方にあるときは分割側だけを数える（collectScenes が面倒を見る）
  const scenes = await collectScenes(dir)
  if (scenes.length > 0) {
    const completed = scenes.filter((s) => s.status === "completed").length
    const inProgress = scenes.filter((s) => s.status === "in-progress").length
    const total = scenes.length
    const sources = new Set(scenes.map((s) => s.source))

    report += `\n🎬 シーンの進捗:\n`
    report += `  ${progressBar(completed, total)}\n`
    if (inProgress > 0) {
      report += `  🔄 執筆中: ${inProgress}シーン\n`
    }
    if (sources.size > 1) {
      report += `  📁 ${sources.size}ファイルから集計\n`
    }
  }

  // 本文の集計。本文のファイル（章と、プロローグ・幕間・エピローグの節）の一覧を一度だけ取り、
  // 返された実際のパスを読んで数える。章数・累計・平均・分量の不足表示は、
  // すべてこの1つの集計値を使う。
  //
  // 以前は累計を chapters/ の .md すべてで、段階の判定や分量の不足を章ファイルだけで
  // 数えていたため、推敲メモなどを置くと同じ画面の中で数字が食い違っていた。
  //
  // 章の数と1章平均は章だけで出す（段階の判定と同じ数）。累計の文字数と原稿用紙の枚数は
  // 原稿全体の分量なので節も含める。
  const chaptersDir = getChaptersDir(dir)
  const manuscriptFiles = await listManuscriptFiles(dir)
  const chapterFiles = manuscriptFiles.filter((f) => f.section.kind === "chapter")
  const extraFiles = manuscriptFiles.filter((f) => f.section.kind !== "chapter")
  const writtenChapters = chapterFiles.flatMap((f) => (f.section.kind === "chapter" ? [f.section.chapter] : []))
  // 原稿用紙の書式は、指定があるときだけ使う（無ければ枚数を出さず、出力は変わらない）
  const manuscript = resolveManuscriptFormat(args.manuscript, config?.manuscript)
  const format = manuscript && "format" in manuscript ? manuscript.format : null
  const counted: Array<{ section: ManuscriptSection; file: string; words: number; lines: number }> = []
  const unreadable: ManuscriptSection[] = []
  for (const f of manuscriptFiles) {
    const content = await safeReadFile(f.path)
    if (content === null) {
      unreadable.push(f.section)
      continue
    }
    // 保存ツールが付けた章見出しは数えない。本文だけを数える規則に、保存時の報告と揃える
    const body = stripChapterHeading(content)
    counted.push({
      section: f.section,
      file: basename(f.path),
      words: countWords(body),
      lines: format ? countManuscriptLines(body, format.columns) : 0,
    })
  }
  const countedChapters = counted.filter((c) => c.section.kind === "chapter")
  const unreadableChapters = unreadable.flatMap((s) => (s.kind === "chapter" ? [s.chapter] : []))
  const unreadableExtras = unreadable.filter((s) => s.kind !== "chapter").map(sectionLabel)
  const totalWords = counted.reduce((sum, c) => sum + c.words, 0)
  // chapters/ にある本文以外の .md（推敲メモなど）は数えない。数えないことを示す
  const manuscriptFileNames = new Set(manuscriptFiles.map((f) => basename(f.path)))
  const otherFiles = (await listMarkdownFiles(chaptersDir)).filter((f) => !manuscriptFileNames.has(f))

  if (manuscriptFiles.length > 0) {
    // 章ファイルの数（段階の判定と同じ数）と、累計・平均の元になった章の数を分けて示す。
    // 読めない章があると両者が食い違うため、そのときは並べて書く
    const extras = describeExtraSections(extraFiles.map((f) => f.section))
    const extrasNote = extras ? `（ほかに${extras}）` : ""
    report +=
      unreadableChapters.length > 0
        ? `\n✍️ 執筆済み: 章ファイル ${chapterFiles.length}章 ／ 集計できた本文 ${countedChapters.length}章${extrasNote}\n`
        : `\n✍️ 執筆済み: ${chapterFiles.length}章${extrasNote}\n`
    if (detailed) {
      for (const c of counted) {
        const pages = format ? `（原稿用紙 ${linesToPagesDecimal(c.lines, format)}枚）` : ""
        const name = c.section.kind === "chapter" ? "" : `（${sectionLabel(c.section)}）`
        report += `  📄 ${c.file}${name}: ${c.words.toLocaleString("ja-JP")}文字${pages}\n`
      }
    }
    if (unreadable.length > 0) {
      const names = [...(unreadableChapters.length > 0 ? [formatChapterRanges(unreadableChapters)] : []), ...unreadableExtras]
      report += `  ⚠️ 読み込めず数えていない章: ${names.join("、")}\n`
    }
    report += `\n📊 累計: ${totalWords.toLocaleString("ja-JP")}文字`
    if (config?.targetWords) {
      const percent = Math.round((totalWords / config.targetWords) * 100)
      report += ` / ${config.targetWords.toLocaleString("ja-JP")}文字 (${percent}%${serial ? "。連載なので目安" : ""})`
    }
    if (counted.some((c) => c.section.kind !== "chapter")) report += `（${extras}を含む）`
    report += "\n"
    if (countedChapters.length > 0) {
      const chapterWords = countedChapters.reduce((sum, c) => sum + c.words, 0)
      const perChapter = Math.round(chapterWords / countedChapters.length)
      report += `📐 1章平均: ${perChapter.toLocaleString("ja-JP")}文字\n`
    }
    if (format) {
      const lines = counted.reduce((sum, c) => sum + c.lines, 0)
      report += `📄 原稿用紙換算: ${linesToPages(lines, format).toLocaleString("ja-JP")}枚（${formatManuscriptLabel(format)}、${lines.toLocaleString("ja-JP")}行。空行は数えない）\n`
    }
  }
  if (manuscript && "error" in manuscript) report += `⚠️ ${manuscript.error}\n`

  // 部ごとの進み具合（config.json に parts があるときだけ）
  const parts = parseParts(config?.parts)
  if (parts && "parts" in parts) {
    const planned = config?.chapterCount ?? undefined
    report += `\n📚 部の進み具合:\n`
    for (const part of parts.parts) {
      // 最後の部は、予定章数を超えて書いていればその章まで（連載で予定を延ばしたとき）
      const to = part.toChapter ?? Math.max(planned ?? part.fromChapter, part.fromChapter, ...writtenChapters)
      const total = Math.max(0, to - part.fromChapter + 1)
      const done = writtenChapters.filter((n) => n >= part.fromChapter && n <= to).length
      report += `  ${partName(part, "kanji", toKanjiNumber)}「${part.title}」（${partRange(part, to)}）: ${done}/${total}章\n`
    }
  }
  if (otherFiles.length > 0) {
    report += `ℹ️ chapters/ にある本文以外のファイルは数えていません: ${otherFiles.join("、")}\n`
  }

  // 記録ファイルそのものが壊れているとき（構文エラーなど）は、空の記録と区別して示す。
  // 空として数えると「伏線 0件」に見え、更新が断られる理由にも気づけない
  const issues: string[] = []
  const foreshadowRecord = await readForeshadowRecord(getDocPath(dir, "foreshadow"))
  const { valid: foreshadowItems, invalid: brokenForeshadow } = splitForeshadowEntries(
    foreshadowRecord.kind === "ok" ? foreshadowRecord.value.items : [],
  )
  if (foreshadowRecord.kind === "broken") {
    report += `\n🎯 伏線: ⚠️ 記録を読めません（下の「記録の点検」を参照）\n`
    issues.push(`${describeBrokenRecord(".novel/foreshadow.json", foreshadowRecord)}。直すまで伏線の更新はできません`)
  } else if (foreshadowItems.length + brokenForeshadow.length > 0) {
    const count = (status: string) => foreshadowItems.filter((f) => f.status === status).length
    report += `\n🎯 伏線: 張り済み ${count("planted")} / 回収済み ${count("resolved")} / 未着手 ${count("pending")}`
    if (count("abandoned") > 0) report += ` / 取り下げ ${count("abandoned")}`
    if (brokenForeshadow.length > 0) report += ` / 形の崩れた記録 ${brokenForeshadow.length}`
    report += `\n`
  }

  // --- 記録の点検 ---
  // 章数がそろっても、あらすじや伏線の記録が追いついていなければ
  // 後の章や推敲で資料が食い違う。気づけるよう、問題があるときだけ並べる。
  const stateRecord = await readCharacterStateRecord(getDocPath(dir, "character-state"))
  if (stateRecord.kind === "broken") {
    issues.push(`${describeBrokenRecord(".novel/characters/state.json", stateRecord)}。直すまで人物の状態の更新はできません`)
  }
  const summaryRecord = await readTextRecord(getDocPath(dir, "summary"))
  if (summaryRecord.kind === "broken") {
    issues.push(`${describeBrokenRecord(".novel/summary.md", summaryRecord)}。直すまであらすじの更新はできません`)
  }
  if (writtenChapters.length > 0) {
    // あらすじが読めないときは、欠けている章を判断できないので数えない
    if (summaryRecord.kind !== "broken") {
      const recorded = new Set(summaryRecord.kind === "ok" ? summaryChapters(summaryRecord.value) : [])
      const missing = writtenChapters.filter((n) => !recorded.has(n))
      if (missing.length > 0) {
        issues.push(`あらすじの記録が無い章: ${formatChapterRanges(missing)}`)
      }
    }

    // 本文があるのに、完了になっていないシーンが残っている章。
    // 1つでも残っていれば拾う（全シーン未完了の章だけを見ると、書き残しを見落とす）。
    // 全シーンが残っている章はまとめ、一部だけのものはシーンIDを示す
    const allOpen: number[] = []
    const partlyOpen: string[] = []
    for (const n of writtenChapters) {
      const mine = scenes.filter((s) => sceneChapterNumber(s.id) === n)
      const open = mine.filter((s) => s.status !== "completed")
      if (open.length === 0) continue
      if (open.length === mine.length) allOpen.push(n)
      else partlyOpen.push(`第${n}章（${open.map((s) => s.id).join(", ")}）`)
    }
    if (allOpen.length > 0 || partlyOpen.length > 0) {
      const parts = [...(allOpen.length > 0 ? [`${formatChapterRanges(allOpen)}（全シーン）`] : []), ...partlyOpen]
      issues.push(`本文はあるが、完了になっていないシーンが残っている章: ${parts.join("、")}（書いたシーンはシーン一覧の状態を [x] に）`)
    }
  }
  // プロローグ・幕間・エピローグも、本文があればあらすじの節を持つ
  if (extraFiles.length > 0 && summaryRecord.kind !== "broken") {
    const recorded = summaryRecord.kind === "ok" ? summarySections(summaryRecord.value) : []
    const missing = extraFiles.filter((f) => !recorded.some((r) => sameSection(r, f.section)))
    if (missing.length > 0) {
      issues.push(`あらすじの記録が無い節: ${missing.map((f) => sectionLabel(f.section)).join("、")}`)
    }
  }
  for (const x of brokenForeshadow) {
    issues.push(`伏線 ${x.id} の記録の形が崩れています: ${x.problems.join("、")}`)
  }
  if (unreadableChapters.length > 0) {
    issues.push(`読み込めない章があります: ${formatChapterRanges(unreadableChapters)}（累計と平均には含めていません。章ファイルとしては数えるので、段階の判定には入ります）`)
  }
  if (parts && "error" in parts) issues.push(parts.error)
  if (unreadableExtras.length > 0) {
    issues.push(`読み込めない節があります: ${unreadableExtras.join("、")}（累計には含めていません）`)
  }
  // 連載の目標文字数は目安なので、届かなくても知らせない
  if (config?.targetWords && phase === "completed" && !serial && totalWords < config.targetWords) {
    // 分量は章数とは別に示す。数は上の累計と同じ集計値を使う
    issues.push(`分量が目標に届いていません: ${totalWords.toLocaleString("ja-JP")} / ${config.targetWords.toLocaleString("ja-JP")}文字（${Math.round((totalWords / config.targetWords) * 100)}%）`)
  }
  if (issues.length > 0) {
    report += `\n🗂️ 記録の点検:\n`
    for (const issue of issues) report += `  ⚠️ ${issue}\n`
  }

  const hint =
    short && phase === "writing" && (config?.chapterCount ?? 1) === 1
      ? "`/write-chapter` で本文を書きましょう。"
      : short && phase === "outline"
        ? "`/novel-outline` で序破急のプロット概要を作りましょう。"
        : serial && phase === "writing"
          ? serialHint(Math.max(0, ...writtenChapters) + 1)
          : (PHASE_HINTS[phase] ?? "")
  report += `\n💡 次の一手: ${hint}\n`

  return report
}
