import { safeReadFile, listChapterFiles } from "../utils.js"
import { checkTypography, countByRule, formatIssue, TYPOGRAPHY_RULE_LABELS } from "../typography.js"
import type { TypographyIssue } from "../typography.js"
import { formatChapterRanges } from "../records.js"
import type { ToolContext } from "../index.js"

interface CheckArgs {
  chapterNumber?: number
  maxIssues?: number
}

/** 1章あたりに並べる指摘の既定の上限（多すぎると読めないため。件数は規則ごとにすべて数える） */
export const DEFAULT_MAX_ISSUES = 30

/**
 * 本文の表記を点検する。
 *
 * chapterNumber を渡せばその章だけ、省けば書いた章すべてを見る。
 * 規則ごとの件数をすべて数えたうえで、具体的な箇所は章ごとに上限まで並べる。
 */
export async function novelCheckExecute(args: CheckArgs, ctx: ToolContext): Promise<string> {
  const max = args.maxIssues ?? DEFAULT_MAX_ISSUES
  const files = (await listChapterFiles(ctx.directory)).filter(
    (f) => args.chapterNumber === undefined || f.chapter === args.chapterNumber,
  )
  if (files.length === 0) {
    return args.chapterNumber === undefined
      ? `❌ 本文がまだありません（.novel/chapters/chapter-NNN.md）。`
      : `❌ 第${args.chapterNumber}章の本文が見つかりません（.novel/chapters/chapter-${String(args.chapterNumber).padStart(3, "0")}.md）。`
  }

  const results: Array<{ chapter: number; issues: TypographyIssue[] }> = []
  // 読めなかった章は「問題なし」と区別して示す（空の本文として点検すると0件になってしまう）
  const unreadable: number[] = []
  for (const f of files) {
    const text = await safeReadFile(f.path)
    if (text === null) unreadable.push(f.chapter)
    else results.push({ chapter: f.chapter, issues: checkTypography(text) })
  }
  const unreadableNote = unreadable.length > 0
    ? `⚠️ 読み込めず点検できなかった章: ${formatChapterRanges(unreadable)}（ファイルの権限や中身を確かめてください）\n`
    : ""
  if (results.length === 0) {
    return `❌ 点検できる章がありません。\n${unreadableNote}`
  }

  const all = results.flatMap((r) => r.issues)
  const scope = args.chapterNumber === undefined ? `${results.length}章` : `第${args.chapterNumber}章`
  if (all.length === 0) {
    return unreadable.length > 0
      ? `⚠️ 表記の点検（${scope}）: 点検できた章には、規約から外れた箇所はありません。\n${unreadableNote}`
      : `✅ 表記の点検（${scope}）: 規約から外れた箇所はありません。`
  }

  const errors = all.filter((i) => i.severity === "error").length
  let report = `📝 表記の点検（${scope}）: ❌ 規約違反 ${errors}件 / ⚠️ 確認 ${all.length - errors}件\n`
  report += unreadableNote
  report += `（規約の正本は novel-writing skill。行と字の位置はファイルのもの。□ は全角スペース）\n\n`

  report += `## 規則ごとの件数\n`
  for (const { rule, severity, count } of countByRule(all)) {
    report += `- ${severity === "error" ? "❌" : "⚠️"} ${TYPOGRAPHY_RULE_LABELS[rule]}: ${count}件\n`
  }

  for (const { chapter, issues } of results) {
    if (issues.length === 0) continue
    report += `\n## 第${chapter}章（${issues.length}件）\n`
    for (const issue of issues.slice(0, max)) report += `${formatIssue(issue)}\n`
    if (issues.length > max) {
      report += `…ほか${issues.length - max}件（maxIssues を上げるか、章を指定して見てください）\n`
    }
  }
  return report
}

/**
 * 保存直後の報告に添える短い点検結果。
 * 多くを並べると保存の報告が埋もれるので、件数と最初の数件だけにする。
 */
export function summarizeForSave(text: string, chapter: number, shown = 3): string {
  const issues = checkTypography(text)
  if (issues.length === 0) return `📝 表記: 規約から外れた箇所はありません\n`
  const errors = issues.filter((i) => i.severity === "error").length
  const counts = countByRule(issues)
    .map(({ rule, count }) => `${TYPOGRAPHY_RULE_LABELS[rule]} ${count}`)
    .join("、")
  let out = `📝 表記: ❌ 規約違反 ${errors}件 / ⚠️ 確認 ${issues.length - errors}件（${counts}）\n`
  for (const issue of issues.slice(0, shown)) out += `  ${formatIssue(issue).replace(/\n/g, "\n  ")}\n`
  out += `  → novel_check(chapterNumber: ${chapter}) で全件を見て、直してから保存し直してください\n`
  return out
}
