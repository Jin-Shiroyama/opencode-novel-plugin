/**
 * opencode-novel-plugin - 表記の点検
 *
 * novel-writing skill の表記規約のうち、機械で確かめられるものを点検する。
 * 規約の正本は skill 側にあり、ここはそれを写したもの。規約を変えたら両方を直す。
 *
 * 条件つきの決まり（感嘆符のあとの全角スペースなど）は、モデルが長い本文に
 * わたって守り続けるのが難しい。書き終えてから目で探すと見落とすので、
 * 保存のたびに機械で拾う。
 */

export type TypographySeverity = "error" | "warning"

export interface TypographyIssue {
  /** ファイルの行番号（1から） */
  line: number
  /** 行内の位置（1から。コードポイント単位） */
  column: number
  rule: TypographyRule
  severity: TypographySeverity
  message: string
  /** 問題の箇所の前後 */
  excerpt: string
}

export type TypographyRule =
  | "bracket"
  | "dialogue-period"
  | "ellipsis"
  | "dash"
  | "space-after-ellipsis-dash"
  | "halfwidth-punctuation"
  | "exclamation-space"
  | "indent"
  | "fullwidth-digit"
  | "arabic-digit"
  | "ascii-space"

/** 規則の名前（一覧の見出しに使う） */
export const TYPOGRAPHY_RULE_LABELS: Record<TypographyRule, string> = {
  bracket: "括弧の対応",
  "dialogue-period": "会話文末の句点",
  ellipsis: "三点リーダ",
  dash: "ダッシュ",
  "space-after-ellipsis-dash": "三点リーダ・ダッシュのあとの空白",
  "halfwidth-punctuation": "半角の約物",
  "exclamation-space": "感嘆符・疑問符のあとの空白",
  indent: "段落頭の字下げ",
  "fullwidth-digit": "全角の算用数字",
  "arabic-digit": "地の文の算用数字",
  "ascii-space": "日本語と英数字のあいだの空白",
}

const OPEN_BRACKETS: Record<string, string> = { "「": "」", "『": "』" }
const CLOSE_BRACKETS: Record<string, string> = { "」": "「", "』": "『" }

/** 感嘆符・疑問符の直後にあってよい閉じ括弧 */
const CLOSERS = new Set(["」", "』", "）", ")", "】", "〕", "〉", "》"])
/** 感嘆符・疑問符の直後に続いてよい約物（約物が連続するときは空けない） */
const FOLLOWING_PUNCTUATION = new Set(["…", "―", "、", "。", "・", "（", "「", "『", "♪"])
/**
 * 感嘆符・疑問符のあとに全角スペースを挟んで続いたら誤りとする約物。
 * 「待て！　……」「何！　？」のように、約物が続くときは空けない。
 * 開き括弧は含めない（地の文で叫びのあとに会話が始まる形を誤りとしないため）
 */
const NO_SPACE_BEFORE = new Set(["！", "？", "!", "?", "…", "―", "、", "。", "・"])

const KATAKANA = /[ァ-ヺー]/
const JAPANESE = /[぀-ヿ㐀-鿿豈-﫿々〆ヶ]/
const ASCII_ALNUM = /[A-Za-z0-9]/

/** 区切りの記号だけの行（＊、◇◇◇、* * * など）。字下げを求めない */
const SEPARATOR_LINE = /^[\s　]*[＊*◇◆□■○●※・〜~\-－―]+(?:[\s　]*[＊*◇◆□■○●※・〜~\-－―]+)*[\s　]*$/

/**
 * 本文を点検する。
 *
 * 渡すのは章ファイルの全文でよい。`#` で始まる見出しの行と空行は見ない。
 * 行番号はファイルの行番号のまま返す。
 */
export function checkTypography(text: string): TypographyIssue[] {
  const issues: TypographyIssue[] = []
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  lines.forEach((line, i) => {
    if (line.trim().length === 0 || /^#/.test(line)) return
    checkLine([...line], i + 1, issues)
  })
  return issues
}

function checkLine(chars: string[], lineNo: number, issues: TypographyIssue[]): void {
  const add = (column: number, rule: TypographyRule, severity: TypographySeverity, message: string) => {
    issues.push({ line: lineNo, column: column + 1, rule, severity, message, excerpt: excerptAt(chars, column) })
  }

  checkIndent(chars, add)

  // 括弧の対応。「」の中では改行しないので、1行の中で閉じていなければならない
  const stack: Array<{ ch: string; at: number }> = []
  // 地の文か会話の中か（算用数字の判定に使う）
  const inDialogue: boolean[] = []

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    inDialogue[i] = stack.length > 0

    if (ch in OPEN_BRACKETS) {
      stack.push({ ch, at: i })
    } else if (ch in CLOSE_BRACKETS) {
      const top = stack[stack.length - 1]
      if (top && top.ch === CLOSE_BRACKETS[ch]) {
        stack.pop()
      } else {
        add(i, "bracket", "error", `対応する「${CLOSE_BRACKETS[ch]}」の無い「${ch}」です`)
      }
      if (ch === "」" && chars[i - 1] === "。") {
        add(i - 1, "dialogue-period", "error", "会話文末に句点を打たない（「行こう。」→「行こう」）")
      }
    }
  }
  for (const open of stack) {
    add(open.at, "bracket", "error", `「${open.ch}」が行の中で閉じていません（括弧の中では改行しない）`)
  }

  for (let i = 0; i < chars.length; ) {
    const ch = chars[i]

    // 三点リーダ・ダッシュ：連なりを1つとして見る
    if (ch === "…" || ch === "―") {
      let j = i
      while (chars[j] === ch) j++
      const run = j - i
      if (run % 2 === 1) {
        if (ch === "…") add(i, "ellipsis", "error", `三点リーダは2つ重ね（……）。偶数個にする（いまは${run}個）`)
        else add(i, "dash", "error", `ダッシュは2つ重ね（――）。偶数個にする（いまは${run}個）`)
      }
      if (chars[j] === "　") {
        add(j, "space-after-ellipsis-dash", "error", `${ch === "…" ? "三点リーダ" : "ダッシュ"}の直後に全角スペースを入れない`)
      }
      i = j
      continue
    }

    if (ch === "‥" || (ch === "・" && chars[i + 1] === "・") || (ch === "." && chars[i + 1] === "." && chars[i + 2] === ".")) {
      add(i, "ellipsis", "error", "三点リーダは「……」を使う（‥、・・・、... は使わない）")
      let j = i
      while (chars[j] === ch) j++
      i = j
      continue
    }

    if (ch === "—" || ch === "─" || ch === "–") {
      add(i, "dash", "error", `ダッシュは「――」（U+2015）を使う（「${ch}」は使わない）`)
      let j = i
      while (chars[j] === ch) j++
      i = j
      continue
    }

    // 長音符の連なりでダッシュを代用している（カタカナ語の長音「ゴーーン」は除く）
    if (ch === "ー" && chars[i + 1] === "ー" && !(i > 0 && KATAKANA.test(chars[i - 1]))) {
      add(i, "dash", "error", "長音符「ー」でダッシュを代用しない（「――」を使う）")
      let j = i
      while (chars[j] === "ー") j++
      i = j
      continue
    }

    if (ch === "!" || ch === "?") {
      add(i, "halfwidth-punctuation", "error", `半角の「${ch}」は使わない（全角「${ch === "!" ? "！" : "？"}」にする）`)
    }

    // 感嘆符・疑問符：連なり（！？ など）を1つとして見て、直後を確かめる
    if (ch === "！" || ch === "？" || ch === "!" || ch === "?") {
      let j = i
      while (chars[j] === "！" || chars[j] === "？" || chars[j] === "!" || chars[j] === "?") j++
      for (let k = i + 1; k < j; k++) {
        if (chars[k] === "!" || chars[k] === "?") {
          add(k, "halfwidth-punctuation", "error", `半角の「${chars[k]}」は使わない（全角「${chars[k] === "!" ? "！" : "？"}」にする）`)
        }
      }
      checkAfterExclamation(chars, j, add)
      i = j
      continue
    }

    if (/[０-９]/.test(ch)) {
      add(i, "fullwidth-digit", "error", "算用数字は半角にする（全角の「０〜９」は使わない）")
      while (/[０-９]/.test(chars[i] ?? "")) i++
      continue
    }

    if (/[0-9]/.test(ch) && !inDialogue[i] && !(i > 0 && /[A-Za-z0-9._\-]/.test(chars[i - 1]))) {
      add(i, "arabic-digit", "warning", "地の文の数量は原則漢数字（年号・型番などで算用数字が自然なら、作品の中でそろえる）")
      while (/[0-9]/.test(chars[i] ?? "")) i++
      continue
    }

    if (ch === " " && i > 0 && i + 1 < chars.length) {
      const before = chars[i - 1]
      const after = chars[i + 1]
      if ((JAPANESE.test(before) && ASCII_ALNUM.test(after)) || (ASCII_ALNUM.test(before) && JAPANESE.test(after))) {
        add(i, "ascii-space", "warning", "日本語と英数字のあいだに半角スペースを入れない")
      }
    }

    i++
  }
}

/** 感嘆符・疑問符の連なりの直後（位置 j）を確かめる */
function checkAfterExclamation(
  chars: string[],
  j: number,
  add: (column: number, rule: TypographyRule, severity: TypographySeverity, message: string) => void,
): void {
  const next = chars[j]
  if (next === undefined) return // 行末・段落末は空けない
  if (CLOSERS.has(next) || FOLLOWING_PUNCTUATION.has(next)) return
  if (next === "　") {
    // 空白の連なりを飛ばして、その次を見る
    let k = j
    while (chars[k] === "　" || chars[k] === " ") k++
    const after = chars[k]
    if (after === undefined) {
      add(j, "exclamation-space", "error", "感嘆符・疑問符のあと、行末には空白を入れない")
    } else if (CLOSERS.has(after)) {
      add(j, "exclamation-space", "error", "閉じ括弧の直前には空白を入れない（「待て！　」→「待て！」）")
    } else if (NO_SPACE_BEFORE.has(after)) {
      add(j, "exclamation-space", "error", `約物が続くときは空白を入れない（「！　${after}」→「！${after}」）`)
    } else if (k - j > 1) {
      add(j, "exclamation-space", "error", "感嘆符・疑問符のあとの空白は全角スペース1つにする")
    }
    return
  }
  if (next === " ") {
    add(j, "exclamation-space", "error", "感嘆符・疑問符のあとは全角スペースにする（半角スペースは使わない）")
    return
  }
  add(j, "exclamation-space", "error", "感嘆符・疑問符の直後に全角スペースを1つ入れる（「本当か？　彼は」）")
}

/**
 * 段落頭の字下げ。
 *
 *   - 地の文の段落は全角スペース1字下げ
 *   - 「『 で始まる会話行、…… ―― で始まる行は字下げしない
 *   - 区切りの記号だけの行（＊ など）は見ない
 */
function checkIndent(
  chars: string[],
  add: (column: number, rule: TypographyRule, severity: TypographySeverity, message: string) => void,
): void {
  const line = chars.join("")
  if (SEPARATOR_LINE.test(line)) return

  let n = 0
  while (chars[n] === "　") n++
  const first = chars[n]

  if (chars[0] === " " || chars[0] === "\t") {
    add(0, "indent", "error", "段落頭に半角スペースやタブを使わない（地の文は全角スペース1字下げ）")
    return
  }
  if (first === "「" || first === "『") {
    if (n > 0) add(0, "indent", "error", "会話行（「『で始まる行）は字下げしない")
    return
  }
  if (first === "…" || first === "―") {
    if (n > 0) add(0, "indent", "error", "三点リーダ・ダッシュで始まる行は字下げしない")
    return
  }
  if (n === 0) {
    add(0, "indent", "error", "地の文の段落頭は全角スペース1字下げ")
  } else if (n > 1) {
    add(0, "indent", "warning", `段落頭の字下げが${n}字あります（1字にする）`)
  }
}

function excerptAt(chars: string[], column: number): string {
  const start = Math.max(0, column - 8)
  const end = Math.min(chars.length, column + 9)
  const head = start > 0 ? "…" : ""
  const tail = end < chars.length ? "…" : ""
  // 全角スペースは見えにくいので印に置き換える
  return (head + chars.slice(start, end).join("") + tail).replace(/　/g, "□")
}

/** 点検結果を規則ごとに数える */
export function countByRule(issues: TypographyIssue[]): Array<{ rule: TypographyRule; severity: TypographySeverity; count: number }> {
  const map = new Map<string, { rule: TypographyRule; severity: TypographySeverity; count: number }>()
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.rule}`
    const entry = map.get(key) ?? { rule: issue.rule, severity: issue.severity, count: 0 }
    entry.count++
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) =>
    a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : 1,
  )
}

/** 点検結果の一行 */
export function formatIssue(issue: TypographyIssue): string {
  const mark = issue.severity === "error" ? "❌" : "⚠️"
  return `${mark} ${issue.line}行${issue.column}字目［${TYPOGRAPHY_RULE_LABELS[issue.rule]}］${issue.message}\n     ${issue.excerpt}`
}
