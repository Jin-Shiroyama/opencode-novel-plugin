/**
 * opencode-novel-plugin - 投稿用の情報（.novel/publish.md）
 *
 * 題・キャッチコピー・紹介文・タグを /novel-publish で作って置く文書。
 * モデルは文字数を数えるのが不得手で、「35文字以内」と頼んでも超えたものを出す。
 * そこで、キャッチコピーの文字数とタグの数だけは機械で数え、進行状況（novel_status）で知らせる。
 *
 * 形は `## ` の節で分ける（/novel-publish の雛形）。
 *
 *   ## 投稿先          カクヨム など
 *   ## 題              採用する題と候補
 *   ## キャッチコピー   1行
 *   ## 紹介文
 *   ## タグ            箇条書き、または読点区切りの1行
 */

import { isPlaceholderValue } from "./utils.js"

/**
 * カクヨムの上限。投稿先が「カクヨム」のときだけ当てる（ほかの投稿先の上限は持たない）。
 * 規約や投稿画面が変われば変わるので、知らせるときは「投稿画面で確かめる」と添える
 */
export const KAKUYOMU_LIMITS = { catchphrase: 35, tags: 8 } as const

export interface PublishInfo {
  /** 投稿先（書かれていなければ空） */
  site: string
  catchphrase: string | null
  tags: string[]
}

/** 文字数（コードポイント単位。空白も1文字として数える。投稿画面の入力欄の数え方に合わせる） */
export const publishLength = (text: string): number => [...text].length

/** `## 見出し` ごとに本文の行を集める（見出しは前後の空白を除いたもの） */
function sections(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      current = []
      out.set(m[1], current)
    } else if (/^#\s/.test(line)) {
      current = null
    } else if (current) {
      current.push(line)
    }
  }
  return out
}

/** 節の中の、書かれた行（空行・引用の注記・小見出し・雛形のままの行を除く。箇条書きの記号は外す） */
function writtenLines(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .filter((l) => !/^\s*(>|#)/.test(l))
    .map((l) => l.replace(/^\s*[-*・]\s*/, "").trim())
    .filter((l) => l.length > 0 && !isPlaceholderValue(l))
}

/** 見出しの名前にその語を含む節（「キャッチコピー（35文字以内）」のような見出しでも読む） */
function sectionOf(all: Map<string, string[]>, word: string): string[] | undefined {
  for (const [title, lines] of all) if (title.includes(word)) return lines
  return undefined
}

/** 投稿用の情報を読む。キャッチコピーは節の最初の1行、タグは箇条書きか区切り文字で分けた語 */
export function parsePublishInfo(markdown: string): PublishInfo {
  const all = sections(markdown)
  const site = writtenLines(sectionOf(all, "投稿先"))[0] ?? ""
  const catchphrase = writtenLines(sectionOf(all, "キャッチコピー"))[0] ?? null
  const tags = writtenLines(sectionOf(all, "タグ"))
    .flatMap((l) => l.split(/[、,\s　]+/))
    .map((t) => t.replace(/^#/, "").trim())
    .filter((t) => t.length > 0)
  return { site, catchphrase, tags: [...new Set(tags)] }
}

/** 進行状況に出す1行（何も書かれていなければ null） */
export function describePublishInfo(info: PublishInfo): string | null {
  const parts: string[] = []
  if (info.catchphrase) parts.push(`キャッチコピー ${publishLength(info.catchphrase)}文字`)
  if (info.tags.length > 0) parts.push(`タグ ${info.tags.length}個`)
  if (parts.length === 0) return null
  return `${info.site ? `${info.site}／` : ""}${parts.join("／")}`
}

/** 上限を超えているもの。投稿先がカクヨムのときだけ見る */
export function publishIssues(info: PublishInfo): string[] {
  if (!info.site.includes("カクヨム")) return []
  const issues: string[] = []
  if (info.catchphrase) {
    const n = publishLength(info.catchphrase)
    if (n > KAKUYOMU_LIMITS.catchphrase) {
      issues.push(`キャッチコピーが${n}文字あります（カクヨムは${KAKUYOMU_LIMITS.catchphrase}文字まで。${n - KAKUYOMU_LIMITS.catchphrase}文字削る。.novel/publish.md）`)
    }
  }
  if (info.tags.length > KAKUYOMU_LIMITS.tags) {
    issues.push(`タグが${info.tags.length}個あります（カクヨムは${KAKUYOMU_LIMITS.tags}個まで。.novel/publish.md）`)
  }
  return issues
}
