/**
 * opencode-novel-plugin - 用語集（.novel/glossary.md）
 *
 * 造語・固有名詞の意味と表記を、表の形で持つ。
 *
 *   | 用語 | 読み | 意味 | 使わない表記 |
 *
 * 列は名前で読む（並べ替えても、「初出」などの列を足してもよい）。表は「用語」の列を
 * 持つものだけを読み、直前の見出し（「## 地名」など）を分類として添える。
 *
 * novel_context は、この章のプロットとシーンに出る用語を先に、残りを枠の許すかぎり載せる。
 * 照合には用語のほか、読みと使わない表記も使う（プロットに誤った表記で書かれた章こそ、
 * 正しい表記を資料に載せる必要があるため）。
 */

import { isPlaceholderValue, safeReadFile, getDocPath } from "./utils.js"
import type { GlossaryCheck } from "./typography.js"

export interface GlossaryEntry {
  term: string
  reading?: string
  meaning?: string
  /** 使わない表記（表記ゆれ・書き間違えやすい形） */
  avoid: string[]
  /** 直前の見出し（「地名」「魔法」など） */
  category?: string
  /** 名前で読まない列（「初出」など）。[列名, 値] */
  extra: Array<[string, string]>
}

type Column = "term" | "reading" | "meaning" | "avoid"

/** 表の見出しの名前から、どの列かを決める。読まない列は null */
function columnOf(header: string): Column | null {
  if (header === "用語") return "term"
  if (header.includes("読み")) return "reading"
  if (header.includes("意味")) return "meaning"
  if (header.includes("使わない") || header.includes("表記ゆれ")) return "avoid"
  return null
}

const splitCells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.replace(/\*\*/g, "").trim())

const isSeparatorRow = (cells: string[]) => cells.every((c) => /^:?-+:?$/.test(c) || c === "")

/**
 * 用語集の文書から用語を読み取る。
 * 「用語」の列が雛形のまま（角括弧）の行は読まない。ほかの列の雛形のままの値は空とみなす。
 */
export function parseGlossary(content: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  let category: string | undefined
  let columns: Array<{ name: string; kind: Column | null }> | null = null

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim()
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      columns = null
      // 題の行（「# 『題』用語集」）は分類にしない
      category = heading[1].length === 1 ? undefined : heading[2]
      continue
    }
    if (!trimmed.startsWith("|")) {
      columns = null
      continue
    }
    const cells = splitCells(trimmed)
    if (columns === null) {
      const named = cells.map((name) => ({ name, kind: columnOf(name) }))
      // 「用語」の列が無い表は用語集の表として読まない
      columns = named.some((c) => c.kind === "term") ? named : []
      continue
    }
    if (columns.length === 0 || isSeparatorRow(cells)) continue

    const entry: GlossaryEntry = { term: "", avoid: [], extra: [] }
    columns.forEach((col, i) => {
      const value = cells[i] ?? ""
      if (isPlaceholderValue(value)) return
      switch (col.kind) {
        case "term":
          entry.term = value
          break
        case "reading":
          entry.reading = value
          break
        case "meaning":
          entry.meaning = value
          break
        case "avoid":
          entry.avoid = value.split(/[、,\uFF0C\/／]+/).map((v) => v.trim()).filter((v) => v.length > 0)
          break
        default:
          entry.extra.push([col.name, value])
      }
    })
    if (entry.term.length === 0) continue
    if (category) entry.category = category
    entries.push(entry)
  }
  return entries
}

/**
 * 用語をプロット・シーンと照らす手がかり。用語・読み・使わない表記。
 * 1文字のものは漢字のときだけ使う（仮名1文字はほとんどの文に当たる。characterNameKeys と同じ扱い）。
 */
export function glossaryKeys(entry: GlossaryEntry): string[] {
  const keys = [entry.term, entry.reading ?? "", ...entry.avoid].map((k) => k.trim())
  return [...new Set(keys.filter(isUsableKey))]
}

/** 照合に使える手がかりか。2文字以上か、漢字1文字 */
function isUsableKey(k: string): boolean {
  const n = [...k].length
  return n >= 2 || (n === 1 && /^\p{Script=Han}$/u.test(k))
}

/**
 * 表記の点検（typography.ts）に渡す材料。使わない表記は glossaryKeys と同じく、
 * 1文字のものは漢字のときだけ使う（仮名1文字を拾うと、ほとんどの行が指摘になる）
 */
export function glossaryCheckTerms(entries: GlossaryEntry[]): GlossaryCheck | undefined {
  const avoid = entries.flatMap((e) => e.avoid.filter(isUsableKey).map((form) => ({ form, term: e.term })))
  if (avoid.length === 0) return undefined
  return { terms: entries.map((e) => e.term), avoid }
}

/** 用語集のファイルを読み、表記の点検の材料にする。無い・読めない・使わない表記が1つも無いときは undefined */
export async function readGlossaryCheck(projectDir: string): Promise<GlossaryCheck | undefined> {
  const content = await safeReadFile(getDocPath(projectDir, "glossary"))
  return content ? glossaryCheckTerms(parseGlossary(content)) : undefined
}

/** 資料に載せる1行 */
export function formatGlossaryEntry(entry: GlossaryEntry): string {
  let line = `- **${entry.term}**`
  if (entry.reading) line += `（${entry.reading}）`
  if (entry.category) line += `［${entry.category}］`
  line += `：${entry.meaning ?? "（意味は未記入）"}`
  if (entry.avoid.length > 0) line += ` ／ 使わない表記：${entry.avoid.join("、")}`
  for (const [name, value] of entry.extra) line += ` ／ ${name}：${value}`
  return line
}

/**
 * 用語集を執筆用の資料にする。用語が1つも無ければ空文字。
 *
 * haystack（この章のプロットとシーン）に出る用語を先に、残りをそのあとに並べる。
 * 枠（limit。コードポイントで数える）を超えたら1行単位で省き、省いた数を示す。
 * この章に出る用語を省いたときは名前も示す（書き手がファイルで引けるように）。
 */
export function buildGlossaryContext(entries: GlossaryEntry[], haystack: string, limit: number): string {
  if (entries.length === 0) return ""
  const matched = haystack.trim().length === 0
    ? []
    : entries.filter((e) => glossaryKeys(e).some((k) => haystack.includes(k)))
  const others = entries.filter((e) => !matched.includes(e))

  const lines: string[] = []
  let used = 0
  const omittedMatched: string[] = []
  let omittedOthers = 0
  const take = (heading: string | null, group: GlossaryEntry[], onOmit: (e: GlossaryEntry) => void) => {
    let headed = false
    for (const e of group) {
      const line = formatGlossaryEntry(e)
      const size = [...line].length + 1
      if (used + size > limit && used > 0) {
        onOmit(e)
        continue
      }
      if (heading && !headed) {
        lines.push(heading)
        headed = true
      }
      // 1行目だけで枠を超えるときは、その行を枠に収まるところまで載せる
      lines.push(used + size > limit ? [...line].slice(0, limit).join("") + "…" : line)
      used += size
    }
  }

  const grouped = matched.length > 0 && others.length > 0
  take(grouped ? "### この章のプロット・シーンに出る用語" : null, matched, (e) => omittedMatched.push(e.term))
  take(grouped ? "\n### ほかの用語" : null, others, () => omittedOthers++)

  const notes: string[] = []
  if (omittedMatched.length > 0) notes.push(`この章に出る用語 ${omittedMatched.join("、")}`)
  if (omittedOthers > 0) notes.push(`ほかの用語 ${omittedOthers}語`)
  if (notes.length > 0) {
    lines.push(`…（枠が足りず省略: ${notes.join("／")}。全文は .novel/glossary.md を参照。limits.glossary で枠を広げられます）`)
  }
  return lines.join("\n")
}
