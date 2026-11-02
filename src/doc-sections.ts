/**
 * opencode-novel-plugin - 雛形から書いた文書を、節ごとに執筆用の資料へ載せる
 *
 * 世界観（world-building.md）とコンセプト（concept.md）を「## 」見出しごとに分け、
 * novel_context が clipDocParts で枠を配れる形（DocPart）にする。
 *
 *   - 大事な節には priority を立て、先に枠を配る。文書が長いときに先頭から切ると、
 *     世界観の末尾にある「この世界の約束ごと」が真っ先に落ちるため
 *   - 雛形から書き換えていない節は載せない（能力体系の無い作品で、角括弧だけの節が枠を占めないように）
 *   - 書きかけの節では、雛形のまま残った角括弧の行だけを外す
 */

import type { DocPart } from "./utils.js"

/** 雛形の記入欄（角括弧）を含む行か */
const PLACEHOLDER = /\[[^\]\n]+\]/

const normalizeLine = (line: string) => line.replace(/\s+$/, "").trim()

interface SectionPartsOptions {
  /** 前置き（最初の「## 」より前）に付ける名前。ファイル名 */
  fileLabel: string
  /** 先に枠を配る節の見出し（部分一致。見出しを書き換えても当たるように） */
  priority?: RegExp
  /** 載せない節の見出し（ほかの資料と重なるもの） */
  skip?: RegExp
}

/**
 * 世界観を節ごとに分ける。「この世界の約束ごと」と「能力体系」に先に枠を配る
 * （「能力体系（魔法）」のように書き換えても当たる）。
 */
export function worldBuildingParts(content: string, template: string): DocPart[] {
  return templateDocParts(content, template, { fileLabel: "world-building.md", priority: /約束ごと|能力体系/ })
}

/**
 * コンセプトを節ごとに分ける。本文の調子を決めるログライン・作品テーマ・文体と手ざわりに先に枠を配る。
 * 「基本情報」は作品設定（config.json）と同じことなので載せない（資料の「作品情報」に出ている）。
 */
export function conceptParts(content: string, template: string): DocPart[] {
  return templateDocParts(content, template, {
    fileLabel: "concept.md", priority: /ログライン|テーマ|文体/, skip: /^基本情報/,
  })
}

/**
 * 文書を節ごとの DocPart に分ける。
 *
 * label は節の見出し（「この世界の約束ごと」）、content は見出しを除いた本文。
 * 最初の「## 」より前の前置き（題の「# 」行は除く）は、中身があれば label を
 * fileLabel にして先頭に置く。すべての節が雛形のままなら空の配列を返す。
 * 雛形の差し込み箇所（{genre} など）は、何が入っていても雛形の行とみなす。
 */
export function templateDocParts(content: string, template: string, opts: SectionPartsOptions): DocPart[] {
  const exact = new Set<string>()
  const patterns: RegExp[] = []
  for (const line of template.split("\n").map(normalizeLine)) {
    if (line.length === 0) continue
    if (/\{\w+\}/.test(line)) {
      const pattern = line.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
      patterns.push(new RegExp(`^${pattern}$`))
    } else {
      exact.add(line)
    }
  }
  const isTemplateLine = (line: string) => {
    const l = normalizeLine(line)
    return exact.has(l) || patterns.some((p) => p.test(l))
  }

  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }]
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      sections.push({ heading: h[1], lines: [] })
      continue
    }
    // 題の行（「# 『題』世界観」）は資料の見出しと重なるので載せない
    if (sections.length === 1 && /^#\s/.test(line)) continue
    sections[sections.length - 1].lines.push(line)
  }

  const parts: DocPart[] = []
  for (const { heading, lines } of sections) {
    if (heading !== null && opts.skip?.test(heading)) continue
    const written = lines.filter((l) => normalizeLine(l).length > 0)
    // 雛形の行しか無い節は、まだ書いていない節
    if (written.every(isTemplateLine)) continue
    // 書きかけの節から、雛形のままの記入欄の行を外す
    const body = tidy(lines.filter((l) => !(isTemplateLine(l) && PLACEHOLDER.test(l))))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (body.length === 0) continue
    parts.push(
      heading === null
        ? { label: opts.fileLabel, content: body }
        : { label: heading, content: body, ...(opts.priority?.test(heading) ? { priority: true } : {}) },
    )
  }
  return parts
}

const isTableLine = (line: string) => line.trim().startsWith("|")
const isSeparatorRow = (line: string) => /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/.test(line.trim())
const headingLevel = (line: string) => line.match(/^(#{3,6})\s/)?.[1].length ?? 0

/**
 * 記入欄の行を外したあとに残る抜け殻を片づけ、節の中の見出しを1段下げる。
 *
 *   - 見出し行と区切り行しか残らない表（記入欄の行がすべて外れた「主要な勢力」の表など）を外す
 *   - 中身の無い小見出し（次の見出しまで本文の無い「### 制約と代償」など）を外す
 *   - 残った小見出しは1段下げる（資料では節の見出しを「### 」で付けるので、同じ深さに並ばないように）
 */
function tidy(lines: string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i])) {
      kept.push(lines[i])
      continue
    }
    let end = i
    while (end < lines.length && isTableLine(lines[end])) end++
    const rows = lines.slice(i, end)
    if (rows.filter((r, k) => k > 0 && !isSeparatorRow(r)).length > 0) kept.push(...rows)
    i = end - 1
  }

  // 下から見て、次の見出しが同じか浅いところまで本文の無い小見出しを外す
  const out: string[] = []
  let hasBody = false
  let nextLevel = 0
  for (let i = kept.length - 1; i >= 0; i--) {
    const level = headingLevel(kept[i])
    if (level === 0) {
      if (kept[i].trim().length > 0) hasBody = true
      out.unshift(kept[i])
      continue
    }
    const empty = !hasBody && (nextLevel === 0 || nextLevel <= level)
    if (!empty) {
      out.unshift("#" + kept[i])
      nextLevel = level
    }
    hasBody = false
  }
  return out
}
