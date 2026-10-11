import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  getNovelDir, getDocPath, getChaptersDir, getConfigPath,
  safeReadFile, safeReadJson, listMarkdownFiles,
  countWords, progressBar,
  determinePhase, usesMartialArtsSetting, isDocFilled,
  hasOutlineDetailed, hasSceneList, collectScenes,
} from "../utils.js"
import type { NovelConfig, ForeshadowEntry, DocType, Phase } from "../utils.js"
import type { ToolContext } from "../index.js"

interface StatusArgs {
  detailed?: boolean
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

  let report = `📊 作品の進行状況\n${"=".repeat(40)}\n\n`

  if (config) {
    report += `📖 タイトル: ${config.title}\n`
    report += `🏷️  ジャンル: ${config.genre}\n`
    report += `🎯 目標文字数: ${config.targetWords?.toLocaleString("ja-JP") ?? "未設定"}文字\n`
    report += `📋 予定章数: ${config.chapterCount ? `全${config.chapterCount}章` : "未設定"}\n`
    report += `👁️  視点: ${config.narrativePerspective ?? "未設定"}\n`
    if (usesMartialArtsSetting(config)) {
      report += `🗡️  流派・武芸設定: 使用中\n`
    }
    report += `📅 開始日: ${new Date(config.createdAt).toLocaleDateString("ja-JP")}\n\n`
  }

  report += `📍 現在の段階: ${PHASE_LABELS[phase] ?? phase}\n\n`

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
  ]

  report += `📋 工程の進み具合:\n`
  for (const stage of stages) {
    let mark = stage.done ? "✅" : "⬜"
    // 雛形はあるが未記入の状態を区別して示す
    if (!stage.done && stage.template) mark = "📝"
    report += `  ${mark} ${stage.label}\n`
  }
  report += `  （✅ 記入済み / 📝 雛形あり・未記入 / ⬜ 未作成）\n`

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

  const chaptersDir = getChaptersDir(dir)
  if (existsSync(chaptersDir)) {
    const chapters = await listMarkdownFiles(chaptersDir)
    if (chapters.length > 0) {
      let totalWords = 0
      report += `\n✍️ 執筆済み: ${chapters.length}章\n`
      for (const ch of chapters) {
        const content = await safeReadFile(join(chaptersDir, ch))
        if (!content) continue
        const words = countWords(content)
        totalWords += words
        if (detailed) {
          report += `  📄 ${ch}: ${words.toLocaleString("ja-JP")}文字\n`
        }
      }
      report += `\n📊 累計: ${totalWords.toLocaleString("ja-JP")}文字`
      if (config?.targetWords) {
        const percent = Math.round((totalWords / config.targetWords) * 100)
        report += ` / ${config.targetWords.toLocaleString("ja-JP")}文字 (${percent}%)`
      }
      report += "\n"
      if (config?.chapterCount) {
        const perChapter = Math.round(totalWords / chapters.length)
        report += `📐 1章平均: ${perChapter.toLocaleString("ja-JP")}文字\n`
      }
    }
  }

  const foreshadow = await safeReadJson<{ items: ForeshadowEntry[] }>(getDocPath(dir, "foreshadow"))
  if (foreshadow && foreshadow.items.length > 0) {
    const planted = foreshadow.items.filter((f) => f.status === "planted").length
    const resolved = foreshadow.items.filter((f) => f.status === "resolved").length
    const pending = foreshadow.items.filter((f) => f.status === "pending").length
    const abandoned = foreshadow.items.filter((f) => f.status === "abandoned").length
    report += `\n🎯 伏線: 張り済み ${planted} / 回収済み ${resolved} / 未着手 ${pending}`
    if (abandoned > 0) report += ` / 取り下げ ${abandoned}`
    report += `\n`
  }

  report += `\n💡 次の一手: ${PHASE_HINTS[phase] ?? ""}\n`

  return report
}
