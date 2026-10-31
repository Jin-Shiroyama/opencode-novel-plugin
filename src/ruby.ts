/**
 * opencode-novel-plugin - ルビと傍点
 *
 * 本文はカクヨムの記法で書く（novel-writing skill の表記規約が正本）。
 *
 *   ｜親文字《ルビ》   ルビ。｜ は半角の | でもよい
 *   漢字《ルビ》       ｜ を省いたルビ。親文字は《の直前に続く漢字だけ
 *   《《傍点》》       傍点
 *   ｜《               ルビでない《そのもの
 *
 * 漢字の続かない《…》（「あの《黒の騎士団》が」）はルビでなく、括弧としてそのまま残す。
 * 漢字の直後に括弧の《を置くときは ｜《 と書く（「王都｜《白の都》」）。
 *
 * ルビは1行の中で閉じる。文字数を数えるとき（親文字だけを数える）、表記を点検するとき
 * （ルビの中の文字を地の文として見ない）、書き出すとき（投稿先の記法に直す）に使う。
 * 位置はすべてコードポイント単位（typography.ts の字の位置と合わせる）。
 */

export type RubySegment =
  /** columns[k] は text の k 文字目の元の行での位置 */
  | { kind: "text"; text: string; columns: number[] }
  /** baseStart は親文字の先頭の位置 */
  | { kind: "ruby"; base: string; reading: string; baseStart: number }
  /** textStart は傍点を付ける文字の先頭の位置 */
  | { kind: "emphasis"; text: string; textStart: number }

export interface RubyIssue {
  /** 行内の位置（0から。コードポイント単位） */
  column: number
  message: string
}

const BARS = new Set(["｜", "|"])
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF々〆ヶ〇\u{20000}-\u{3FFFF}]/u

/** 1行を、地の文・ルビ・傍点に分ける。記法の崩れは issues に返し、その部分は地の文として残す */
export function parseRubyLine(line: string): { segments: RubySegment[]; issues: RubyIssue[] } {
  const chars = [...line]
  const segments: RubySegment[] = []
  const issues: RubyIssue[] = []
  // 地の文をためておき、ルビや傍点の前で吐き出す。文字ごとに元の位置を持つ
  // （｜《 は2字で《1字になるので、位置は連続しない）
  let buffer: Array<{ c: string; at: number }> = []
  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", text: buffer.map((b) => b.c).join(""), columns: buffer.map((b) => b.at) })
    }
    buffer = []
  }
  const pushRange = (from: number, to: number) => {
    for (let k = from; k < to; k++) buffer.push({ c: chars[k], at: k })
  }
  const indexOf = (target: string, from: number) => {
    for (let k = from; k < chars.length; k++) if (chars[k] === target) return k
    return -1
  }

  for (let i = 0; i < chars.length; ) {
    const ch = chars[i]

    if (BARS.has(ch)) {
      // ｜《 は《そのもの
      if (chars[i + 1] === "《") {
        buffer.push({ c: "《", at: i + 1 })
        i += 2
        continue
      }
      const open = indexOf("《", i + 1)
      if (open === -1) {
        issues.push({ column: i, message: `ルビの「${ch}」のあとに《ルビ》がありません（｜親文字《ルビ》の形にする）` })
        pushRange(i, i + 1)
        i++
        continue
      }
      const close = indexOf("》", open + 1)
      if (close === -1) {
        issues.push({ column: open, message: "ルビの《が行の中で閉じていません" })
        pushRange(i, chars.length)
        break
      }
      const base = chars.slice(i + 1, open).join("")
      const reading = chars.slice(open + 1, close).join("")
      if (reading.length === 0) issues.push({ column: open, message: "ルビが空です（｜親文字《ルビ》）" })
      if (chars[open + 1] === "《") {
        issues.push({ column: open, message: "ルビの中に《があります（ルビの入れ子や傍点との組み合わせはできません）" })
      }
      flush()
      segments.push({ kind: "ruby", base, reading, baseStart: i + 1 })
      i = close + 1
      continue
    }

    if (ch === "《" && chars[i + 1] === "《") {
      let close = -1
      for (let k = i + 2; k + 1 < chars.length; k++) {
        if (chars[k] === "》" && chars[k + 1] === "》") {
          close = k
          break
        }
      }
      if (close === -1) {
        issues.push({ column: i, message: "傍点の《《が行の中で閉じていません（《《傍点》》）" })
        pushRange(i, chars.length)
        break
      }
      const text = chars.slice(i + 2, close).join("")
      if (text.length === 0) issues.push({ column: i, message: "傍点を付ける文字がありません（《《傍点》》）" })
      if (/[《｜|]/.test(text)) issues.push({ column: i, message: "傍点の中にルビは入れられません" })
      flush()
      segments.push({ kind: "emphasis", text, textStart: i + 2 })
      i = close + 2
      continue
    }

    if (ch === "《") {
      const close = indexOf("》", i + 1)
      if (close === -1) {
        issues.push({ column: i, message: "《が行の中で閉じていません" })
        pushRange(i, chars.length)
        break
      }
      // 直前に続く漢字を親文字にする（｜を省いたルビ）。｜《 で入れた《は漢字ではないので境目になる
      let n = 0
      while (n < buffer.length && KANJI.test(buffer[buffer.length - 1 - n].c)) n++
      if (n === 0) {
        // 漢字が続いていなければ括弧としてそのまま残す
        pushRange(i, close + 1)
        i = close + 1
        continue
      }
      const reading = chars.slice(i + 1, close).join("")
      if (reading.length === 0) issues.push({ column: i, message: "ルビが空です（漢字《ルビ》）" })
      const baseChars = buffer.splice(buffer.length - n, n)
      flush()
      segments.push({ kind: "ruby", base: baseChars.map((b) => b.c).join(""), reading, baseStart: baseChars[0].at })
      i = close + 1
      continue
    }

    // 単独の》は拾わない（｜《…》の閉じのように、そのまま見せる》があるため）
    pushRange(i, i + 1)
    i++
  }
  flush()
  return { segments, issues }
}

/**
 * ルビの記法を外し、親文字と傍点の文字だけを残す（文字数を数えるため）。
 * columns[k] は、残した k 文字目の元の行での位置（表記の点検で、字の位置を元の行に戻すため）。
 */
export function stripRubyLine(line: string): { chars: string[]; columns: number[] } {
  const chars: string[] = []
  const columns: number[] = []
  for (const seg of parseRubyLine(line).segments) {
    if (seg.kind === "text") {
      chars.push(...seg.text)
      columns.push(...seg.columns)
      continue
    }
    const text = seg.kind === "ruby" ? seg.base : seg.text
    const start = seg.kind === "ruby" ? seg.baseStart : seg.textStart
    ;[...text].forEach((c, k) => {
      chars.push(c)
      columns.push(start + k)
    })
  }
  return { chars, columns }
}

/** 複数行の文章からルビの記法を外す */
export function stripRuby(text: string): string {
  return text
    .split("\n")
    .map((line) => stripRubyLine(line).chars.join(""))
    .join("\n")
}

/**
 * 書き出し先の記法。
 *
 *   kakuyomu  ｜親文字《ルビ》・《《傍点》》（原稿の記法。｜を省いたルビにも｜を付ける）
 *   narou     ｜親文字《ルビ》。傍点は1字ずつ「・」のルビにする（小説家になろうは傍点の記法を持たない）
 *   aozora    ｜親文字《ルビ》・傍点［＃「傍点」に傍点］（青空文庫の注記）。青空文庫は漢字以外にも
 *             ルビを振るので、括弧の《》は ※［＃始め二重山括弧、1-1-52］ の形に直す
 *   pixiv     [[rb:親文字 > ルビ]]。傍点は1字ずつ「・」のルビにする
 *   html      <ruby>親文字<rt>ルビ</rt></ruby>。傍点は1字ずつ「・」のルビにする
 *   paren     親文字（ルビ）。傍点は外す（応募原稿などで括弧書きを求められるとき）
 *   none      親文字だけ。傍点は外す
 */
export const RUBY_NOTATIONS = ["kakuyomu", "narou", "aozora", "pixiv", "html", "paren", "none"] as const
export type RubyNotation = (typeof RUBY_NOTATIONS)[number]

/** 文章のルビと傍点を、書き出し先の記法に直す。記法の崩れた部分はそのまま残す */
export function convertRuby(text: string, notation: RubyNotation): string {
  return text
    .split("\n")
    .map((line) => convertLine(line, notation))
    .join("\n")
}

function convertLine(line: string, notation: RubyNotation): string {
  const original = [...line]
  const { segments } = parseRubyLine(line)
  return segments
    .map((seg) => {
      if (seg.kind === "text") return formatText(seg, original, notation)
      if (seg.kind === "ruby") return formatRuby(seg.base, seg.reading, notation)
      return formatEmphasis(seg.text, notation)
    })
    .join("")
}

/**
 * 地の文の《》を、書き出し先でルビと読まれない形にする。
 *
 *   kakuyomu / narou  原稿で ｜《 と書いた《を ｜《 のまま残す（記法の崩れた《には足さない）
 *   aozora            《》をすべて ※［＃…］ の注記にする（青空文庫は漢字以外にもルビを振るため）
 */
function formatText(seg: Extract<RubySegment, { kind: "text" }>, original: string[], notation: RubyNotation): string {
  const chars = [...seg.text]
  if (notation === "aozora") {
    return chars
      .map((c) => (c === "《" ? "※［＃始め二重山括弧、1-1-52］" : c === "》" ? "※［＃終わり二重山括弧、1-1-53］" : c))
      .join("")
  }
  if (notation === "kakuyomu" || notation === "narou") {
    return chars
      .map((c, k) => (c === "《" && BARS.has(original[seg.columns[k] - 1] ?? "") ? "｜《" : c))
      .join("")
  }
  return seg.text
}

function formatRuby(base: string, reading: string, notation: RubyNotation): string {
  switch (notation) {
    case "kakuyomu":
    case "narou":
    case "aozora":
      return `｜${base}《${reading}》`
    case "pixiv":
      return `[[rb:${base} > ${reading}]]`
    case "html":
      return `<ruby>${base}<rt>${reading}</rt></ruby>`
    case "paren":
      return `${base}（${reading}）`
    case "none":
      return base
  }
}

function formatEmphasis(text: string, notation: RubyNotation): string {
  switch (notation) {
    case "kakuyomu":
      return `《《${text}》》`
    case "aozora":
      return `${text}［＃「${text}」に傍点］`
    case "narou":
    case "pixiv":
    case "html":
      return [...text].map((c) => formatRuby(c, "・", notation)).join("")
    case "paren":
    case "none":
      return text
  }
}

/** 文章の中のルビと傍点の数（書き出しの報告に使う） */
export function countRubyMarks(text: string): { ruby: number; emphasis: number } {
  let ruby = 0
  let emphasis = 0
  for (const line of text.split("\n")) {
    for (const seg of parseRubyLine(line).segments) {
      if (seg.kind === "ruby") ruby++
      else if (seg.kind === "emphasis") emphasis++
    }
  }
  return { ruby, emphasis }
}
