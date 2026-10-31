/**
 * opencode-novel-plugin - 原稿用紙の枚数換算
 *
 * 文字数（countWords）とは別の、もう一つの物差し。新人賞の応募規定のように
 * 「400字詰め原稿用紙換算で何枚」と分量を決められたときに使う。
 *
 * 書式を指定したとき（config.json の manuscript、またはツールの引数）だけ表示する。
 * 指定しなければどの出力も変わらない。目標文字数や分量の判定は、これまでどおり文字数で行う
 * （Web 小説のように文字数で書く作品の邪魔をしないため）。
 *
 * 数え方は原稿用紙の書き方に合わせる。
 *   - 段落（ファイルの1行）は新しい行から書きはじめる。段落の最後の行の残りのマスも1行と数える
 *   - 1文字1マス。段落頭の字下げの全角スペースも1マス。「……」「――」は2マス
 *   - 行頭に来る句読点・閉じ括弧は、前の行の最後のマスに収める（ぶら下げ）
 *   - ルビと傍点は記法を外し、親文字だけを数える（ruby.ts）
 *   - 空行は数えない。Web 小説で段落ごとに入れる空行で枚数が膨らまないようにするため
 *   - 章見出しの行は数えない（文字数と同じく本文だけを見る）
 *
 * 枚数は全体の行数を1枚の行数で割って切り上げる（章ごとの改ページはしない）。
 */
import { stripRuby } from "./ruby.js"

export interface ManuscriptFormat {
  /** 1行の字数 */
  columns: number
  /** 1枚の行数 */
  rows: number
}

/** 行頭に置かず、前の行の最後のマスに収める文字（句読点と閉じ括弧） */
const HANGING = new Set(["、", "。", "」", "』", "）", "〕", "］", "｝", "〉", "》", "】"])

const FORMAT_PATTERN = /^\s*(\d{1,3})\s*[x×Xｘ＊*]\s*(\d{1,3})\s*$/

/**
 * 書式の文字列（「20x20」「40×30」）を読む。字数×行数の順。
 * 読めない・範囲外（1〜100）なら null。
 */
export function parseManuscriptFormat(value: unknown): ManuscriptFormat | null {
  if (typeof value !== "string") return null
  const m = value.normalize("NFKC").match(FORMAT_PATTERN)
  if (!m) return null
  const columns = Number(m[1])
  const rows = Number(m[2])
  if (columns < 1 || columns > 100 || rows < 1 || rows > 100) return null
  return { columns, rows }
}

/** 書式の表示（「20字×20行」） */
export function formatManuscriptLabel(format: ManuscriptFormat): string {
  return `${format.columns}字×${format.rows}行`
}

/** 本文を原稿用紙に書いたときの行数 */
export function countManuscriptLines(text: string, columns: number): number {
  let lines = 0
  for (const raw of stripRuby(text).replace(/\r\n/g, "\n").split("\n")) {
    const chars = [...raw.replace(/\s+$/, "")]
    if (chars.length === 0) continue
    let used = 0
    lines++
    for (const ch of chars) {
      if (used < columns) {
        used++
      } else if (HANGING.has(ch)) {
        // 行が埋まっていても、句読点と閉じ括弧は最後のマスに収める
        continue
      } else {
        lines++
        used = 1
      }
    }
  }
  return lines
}

/** 行数を枚数にする（切り上げ） */
export function linesToPages(lines: number, format: ManuscriptFormat): number {
  return Math.ceil(lines / format.rows)
}

/** 章ごとの表示用。小数第1位まで（「3.4枚」） */
export function linesToPagesDecimal(lines: number, format: ManuscriptFormat): string {
  return (Math.round((lines / format.rows) * 10) / 10).toLocaleString("ja-JP", { minimumFractionDigits: 1 })
}

/**
 * 使う書式を決める。引数があれば引数、無ければ config.json の manuscript。
 * どちらも無ければ null（枚数を出さない）。読めない値なら error を返す。
 */
export function resolveManuscriptFormat(
  arg: string | undefined,
  configValue: unknown,
): { format: ManuscriptFormat } | { error: string } | null {
  const source = arg ?? configValue
  if (source === undefined || source === null || source === "") return null
  const format = parseManuscriptFormat(source)
  if (format) return { format }
  const where = arg !== undefined ? "manuscript の指定" : "config.json の manuscript"
  return { error: `${where}（${JSON.stringify(source)}）を読めません。「20x20」のように字数×行数で書いてください（1〜100）` }
}
