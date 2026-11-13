import { safeReadFile, safeReadJson, getConfigPath } from "../utils.js"
import type { NovelConfig } from "../utils.js"
import { checkTypography, countByRule, formatIssue, TYPOGRAPHY_RULE_LABELS } from "../typography.js"
import type { TypographyIssue } from "../typography.js"
import { formatChapterRanges } from "../records.js"
import { listManuscriptFiles, describeExtraSections, sectionFromArgs, sectionLabel, sectionFileName, sameSection, sectionCallArgs } from "../sections.js"
import type { ManuscriptSection, SectionKind } from "../sections.js"
import { readGlossaryCheck } from "../glossary.js"
import type { GlossaryCheck } from "../typography.js"
import { checkProse, summarizeProse, formatProseIssue, PROSE_RULE_LABELS } from "../prose.js"
import type { ProseIssue } from "../prose.js"
import type { ToolContext } from "../index.js"

interface CheckArgs {
  section?: SectionKind
  chapterNumber?: number
  interludeIndex?: number
  maxIssues?: number
}

/** 1章あたりに並べる指摘の既定の上限（多すぎると読めないため。件数は規則ごとにすべて数える） */
export const DEFAULT_MAX_ISSUES = 30

/**
 * 本文の表記と文章を点検する。
 *
 * 表記（typography.ts。規約違反 ❌ と確認 ⚠️）のあとに、文章（prose.ts。できあいの言い回し・同じ文末の連続・長い文。
 * すべて確認 ⚠️）を別の節で並べる。表記の ❌ は必ず直すもの、文章の ⚠️ は書き直すか判断するものなので、混ぜない。
 *
 * chapterNumber（または section）を渡せばその章・節だけ、省けば章と節のすべてを読む順番に見る。
 * 規則ごとの件数をすべて数えたうえで、具体的な箇所は章ごとに上限まで並べる。
 */
export async function novelCheckExecute(args: CheckArgs, ctx: ToolContext): Promise<string> {
  const max = args.maxIssues ?? DEFAULT_MAX_ISSUES
  // 章も節も指定が無ければ全部を見る
  let target: ManuscriptSection | null = null
  if (args.section !== undefined || args.chapterNumber !== undefined || args.interludeIndex !== undefined) {
    const resolved = sectionFromArgs(args)
    if ("error" in resolved) return `❌ ${resolved.error}。`
    target = resolved.section
  }
  const files = (await listManuscriptFiles(ctx.directory)).filter(
    (f) => target === null || sameSection(f.section, target),
  )
  if (files.length === 0) {
    return target === null
      ? `❌ 本文がまだありません（.novel/chapters/chapter-NNN.md）。`
      : `❌ ${sectionLabel(target)}の本文が見つかりません（.novel/chapters/${sectionFileName(target)}）。`
  }

  // 文体（config.json の style）で、地の文の算用数字を拾うかが変わる
  const style = (await safeReadJson<NovelConfig>(getConfigPath(ctx.directory)))?.style
  // 用語集の「使わない表記」も拾う
  const glossary = await readGlossaryCheck(ctx.directory)
  const results: Array<{ section: ManuscriptSection; issues: TypographyIssue[]; prose: ProseIssue[] }> = []
  // 読めなかった章は「問題なし」と区別して示す（空の本文として点検すると0件になってしまう）
  const unreadable: ManuscriptSection[] = []
  for (const f of files) {
    const text = await safeReadFile(f.path)
    if (text === null) unreadable.push(f.section)
    else results.push({ section: f.section, issues: checkTypography(text, { style, glossary }), prose: checkProse(text) })
  }
  const unreadableNote = unreadable.length > 0
    ? `⚠️ 読み込めず点検できなかった章: ${formatSections(unreadable)}（ファイルの権限や中身を確かめてください）\n`
    : ""
  if (results.length === 0) {
    return `❌ 点検できる章がありません。\n${unreadableNote}`
  }

  const all = results.flatMap((r) => r.issues)
  const scope = target === null ? describeScope(results.map((r) => r.section)) : sectionLabel(target)
  const proseReport = formatProseReport(results, scope, max)
  if (all.length === 0) {
    const head = unreadable.length > 0
      ? `⚠️ 表記の点検（${scope}）: 点検できた章には、規約から外れた箇所はありません。\n${unreadableNote}`
      : `✅ 表記の点検（${scope}）: 規約から外れた箇所はありません。`
    return proseReport ? `${head.replace(/\n$/, "")}\n\n${proseReport}` : head
  }

  const errors = all.filter((i) => i.severity === "error").length
  let report = `📝 表記の点検（${scope}）: ❌ 規約違反 ${errors}件 / ⚠️ 確認 ${all.length - errors}件\n`
  report += unreadableNote
  report += `（規約の正本は novel-writing skill。用語の表記は .novel/glossary.md。行と字の位置はファイルのもの。□ は全角スペース）\n\n`

  report += `## 規則ごとの件数\n`
  for (const { rule, severity, count } of countByRule(all)) {
    report += `- ${severity === "error" ? "❌" : "⚠️"} ${TYPOGRAPHY_RULE_LABELS[rule]}: ${count}件\n`
  }

  for (const { section, issues } of results) {
    if (issues.length === 0) continue
    report += `\n## ${sectionLabel(section)}（${issues.length}件）\n`
    for (const issue of issues.slice(0, max)) report += `${formatIssue(issue)}\n`
    if (issues.length > max) {
      report += `…ほか${issues.length - max}件（maxIssues を上げるか、章を指定して見てください）\n`
    }
  }
  return proseReport ? `${report}\n${proseReport}` : report
}

/** 文章の点検の節。拾ったものが無ければ空文字（表記の報告だけを返す） */
function formatProseReport(
  results: Array<{ section: ManuscriptSection; prose: ProseIssue[] }>, scope: string, max: number,
): string {
  const all = results.flatMap((r) => r.prose)
  if (all.length === 0) return ""
  let report = `✍️ 文章の点検（${scope}）: ⚠️ 確認 ${all.length}件\n`
  report += `（novel-writing skill の「AI くさい言い回し」のうち機械で数えられるもの。地の文だけを見ます。意図したものは残してかまいません。\n`
  report += ` 直すときは語を言い換えるのではなく、動作と細部で書き直します）\n\n`
  report += `## 種類ごとの件数\n`
  for (const { rule, count, detail } of summarizeProse(all)) {
    report += `- ⚠️ ${PROSE_RULE_LABELS[rule]}: ${count}件${detail ? `（${detail}）` : ""}\n`
  }
  for (const { section, prose } of results) {
    if (prose.length === 0) continue
    report += `\n## ${sectionLabel(section)}（${prose.length}件）\n`
    for (const issue of prose.slice(0, max)) report += `${formatProseIssue(issue)}\n`
    if (prose.length > max) {
      report += `…ほか${prose.length - max}件（maxIssues を上げるか、章を指定して見てください）\n`
    }
  }
  return report
}

/**
 * 保存直後の報告に添える、文章の点検の1行。拾ったものが無ければ空文字。
 * 件数と内訳だけを出す（箇所は novel_check で見る。保存の報告を埋めないため）
 */
export function summarizeProseForSave(text: string, section: ManuscriptSection): string {
  const issues = checkProse(text)
  if (issues.length === 0) return ""
  const counts = summarizeProse(issues)
    .map(({ rule, count, detail }) => `${PROSE_RULE_LABELS[rule]} ${count}${detail ? `：${detail}` : ""}`)
    .join("／")
  return `✍️ 文章: ⚠️ 確認 ${issues.length}件（${counts}）\n  → novel_check(${sectionCallArgs(section)}) で箇所を見られます。語を言い換えるのではなく、動作と細部で書き直します（意図したものは残してよい）\n`
}

/**
 * 保存直後の報告に添える短い点検結果。
 * 多くを並べると保存の報告が埋もれるので、件数と最初の数件だけにする。
 */
export function summarizeForSave(
  text: string, section: ManuscriptSection, shown = 3, style?: "light" | "literary", glossary?: GlossaryCheck,
): string {
  const issues = checkTypography(text, { style, glossary })
  if (issues.length === 0) return `📝 表記: 規約から外れた箇所はありません\n`
  const errors = issues.filter((i) => i.severity === "error").length
  const counts = countByRule(issues)
    .map(({ rule, count }) => `${TYPOGRAPHY_RULE_LABELS[rule]} ${count}`)
    .join("、")
  let out = `📝 表記: ❌ 規約違反 ${errors}件 / ⚠️ 確認 ${issues.length - errors}件（${counts}）\n`
  for (const issue of issues.slice(0, shown)) out += `  ${formatIssue(issue).replace(/\n/g, "\n  ")}\n`
  out += `  → novel_check(${sectionCallArgs(section)}) で全件を見て、直してから保存し直してください\n`
  return out
}

/** 章は範囲でまとめ、節は呼び名で並べる（「第1〜3章、プロローグ」） */
function formatSections(sections: ManuscriptSection[]): string {
  const chapters = sections.flatMap((s) => (s.kind === "chapter" ? [s.chapter] : []))
  const others = sections.filter((s) => s.kind !== "chapter").map(sectionLabel)
  return [...(chapters.length > 0 ? [formatChapterRanges(chapters)] : []), ...others].join("、")
}

/** 点検した範囲（「3章」「3章とプロローグ・幕間1」） */
function describeScope(sections: ManuscriptSection[]): string {
  const chapters = sections.filter((s) => s.kind === "chapter").length
  const extras = describeExtraSections(sections)
  if (!extras) return `${chapters}章`
  return chapters > 0 ? `${chapters}章と${extras}` : extras
}
