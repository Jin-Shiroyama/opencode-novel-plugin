/**
 * opencode-novel-plugin - 文章の点検
 *
 * novel-writing skill の「AI くさい言い回しを避ける」のうち、機械で数えられるものを拾う。
 * 一覧の正本は skill 側にあり、ここはそれを写したもの。一覧を変えたら両方を直す。
 *
 * 見るのは3つ。
 *   - できあいの言い回し（「思わず」「その瞬間」など。回数の決まりがあるものは、超えた分だけ）
 *   - 同じ文末の連続（「〜た。」が4文以上続く。skill の決まりは「3文以上」だが、3文は意図した畳みかけにもよくあるので、
 *     機械では4文からを拾い、3文は目で見る）
 *   - 長い文（1文が80文字を超える）
 *
 * すべて確認（⚠️）にとどめ、規約違反（❌）にしない。語を機械的に置き換えさせると、別のできあいの語に
 * 替わるだけになる。直すなら動作と細部で書き直す、という案内を添えて書き手（とモデル）に返す。
 * 見るのは地の文だけ。会話の中（「」『』）は、人物の話し方として使われるので見ない。
 * ステータス画面や掲示板回の行（typography.ts の isNarrationLine が外すもの）も見ない。
 */

import { stripRubyLine } from "./ruby.js"
import { excerptAt, isNarrationLine, isSeparatorLine } from "./typography.js"

export type ProseRule = "stock-phrase" | "repeated-ending" | "long-sentence"

export const PROSE_RULE_LABELS: Record<ProseRule, string> = {
  "stock-phrase": "できあいの言い回し",
  "repeated-ending": "同じ文末の連続",
  "long-sentence": "長い文",
}

export interface ProseIssue {
  /** ファイルの行番号（1から） */
  line: number
  /** 行内の位置（1から。コードポイント単位。元の行での位置） */
  column: number
  rule: ProseRule
  /** できあいの言い回しのとき、どの語か（件数のまとめに使う） */
  phrase?: string
  message: string
  excerpt: string
}

/** 同じ文末が続いたとみなす文の数（段落をまたいで数える。1文だけの段落が続く書き方でも拾うため） */
export const REPEATED_ENDING_RUN = 4
/** 長い文とみなす文字数（これを超えたら拾う） */
export const LONG_SENTENCE_CHARS = 80

interface PhraseRule {
  /** 件数のまとめに出す名前 */
  phrase: string
  pattern: RegExp
  /** 1章（1ファイル）の中で使ってよい回数。超えた分だけ拾う */
  allowed: number
  advice: string
}

/**
 * できあいの言い回し。skill の一覧（A. 語彙・慣用句、B の副詞）から、語として拾えるものだけ。
 *
 * 載せていないもの:
 *   - 「つまり」「要するに」… 一人称の語りの声として普通に使う（ライトノベル寄り）
 *   - 「〜であった」… ふつうの過去形（「彼は教師であった」）と見分けられない
 */
const PHRASES: PhraseRule[] = [
  { phrase: "思わず", pattern: /思わず|ずにはいられな/g, allowed: 0, advice: "動作をそのまま書く（「思わず笑った」→「口の端が上がった」）" },
  { phrase: "胸が熱く・込み上げる", pattern: /胸が熱く|胸の奥が締めつけ|込み上げ|こみ上げ/g, allowed: 0, advice: "身体の細部で書く（「鼻の奥が痛くなって、顔を伏せた」）" },
  { phrase: "その瞬間", pattern: /(?:その|次の|この)瞬間/g, allowed: 0, advice: "動作の連続で時間を示す" },
  { phrase: "まるで・かのよう", pattern: /まるで|かのよう/g, allowed: 2, advice: "型の直喩を続けない。事物を直接書く" },
  { phrase: "世界が止まった", pattern: /世界が止まっ|世界から音が消え|時が止まっ|時間が止まっ/g, allowed: 0, advice: "具体を一つ書く（「冷蔵庫の音だけが聞こえた」）" },
  { phrase: "目の奥・瞳の色", pattern: /目の奥に|瞳の奥に|瞳に[^。]{0,12}色が(?:浮か|宿|揺)/g, allowed: 0, advice: "目の具体的な動きを書く（「目を細めた」「視線を外した」）" },
  { phrase: "心の中で呟く", pattern: /(?:心の中|心のなか|胸の内|胸のうち|内心)で(?:呟|つぶや)/g, allowed: 0, advice: "ラベルを外し、地の文にそのまま置く" },
  { phrase: "言葉を失う・息を呑む", pattern: /言葉を失|息を呑|息をのん|絶句し/g, allowed: 1, advice: "1章に1回まで。あとは動作で" },
  { phrase: "静寂が支配・空気が張り詰める", pattern: /静寂が(?:支配|包|訪)|沈黙が(?:降り|落ち|支配)|空気が張り詰め|空気が張りつめ/g, allowed: 0, advice: "聞こえるものを一つ書く" },
  { phrase: "総括の語", pattern: /結論として|言うまでもなく|言うまでもない/g, allowed: 0, advice: "削る。場面を切り替える" },
  { phrase: "〜なのだった", pattern: /なのだった|のであった/g, allowed: 2, advice: "「〜た」「〜る」の素の文末へ（語り手の声として使うなら、続けない）" },
  { phrase: "できあいの擬音", pattern: /ドクンと|ドキリと|ゴクリと|視界が(?:涙で)?滲/g, allowed: 0, advice: "できあいの組み合わせを避け、その場の音や動きを書く" },
  { phrase: "煽りの語り", pattern: /運命は|それだけではなかった|まだ知らなかった|知る由もなかった/g, allowed: 1, advice: "削って、次の場面を出す" },
  { phrase: "硬い漢語調", pattern: /を余儀なくされ|を禁じ得な/g, allowed: 0, advice: "平たい言葉にする" },
  { phrase: "ゆっくりと", pattern: /ゆっくりと/g, allowed: 3, advice: "動詞を替える（「ゆっくりと立ち上がった」→「立ち上がるのに、ひと呼吸かかった」）" },
  { phrase: "そっと", pattern: /そっと/g, allowed: 3, advice: "動詞を替える（「そっと置いた」→「音を立てずに置いた」）" },
  { phrase: "静かに", pattern: /静かに/g, allowed: 3, advice: "動詞を替えるか、聞こえるものを書く" },
]

const OPEN = new Set(["「", "『"])
const CLOSE = new Set(["」", "』"])
/** 文の終わり */
const SENTENCE_END = new Set(["。", "！", "？"])

interface Sentence {
  /** 記法を外した行での始まりの位置 */
  start: number
  /** 句点などを除いた本文 */
  text: string
  /** 句点（。）で終わったか。「！」「？」で終わる文は文末の連続に数えない */
  period: boolean
}

/**
 * 地の文の行を文に分ける。会話の括弧の中では切らない（行の中に挟まった台詞は、その文の一部として数える）。
 * 括弧の中かどうかも返す（できあいの言い回しを、地の文の部分だけで探すため）
 */
function splitSentences(chars: string[]): { sentences: Sentence[]; inDialogue: boolean[] } {
  const sentences: Sentence[] = []
  const inDialogue: boolean[] = []
  let depth = 0
  let start = 0
  while (chars[start] === "　") start++
  const push = (end: number, period: boolean) => {
    const text = chars.slice(start, end).join("").trim()
    if (text.length > 0) sentences.push({ start, text, period })
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (OPEN.has(ch)) depth++
    inDialogue[i] = depth > 0
    if (CLOSE.has(ch) && depth > 0) depth--
    if (depth === 0 && SENTENCE_END.has(ch)) {
      // 続く「！？」などは同じ文末
      let j = i
      while (j + 1 < chars.length && SENTENCE_END.has(chars[j + 1])) j++
      push(i, ch === "。" && j === i)
      i = j
      start = j + 1
      while (chars[start] === "　") start++
    }
  }
  push(chars.length, false)
  return { sentences, inDialogue }
}

/** 文末の型。仮名で終わる文だけを数える（体言止めは連続を切る） */
function endingOf(sentence: Sentence): string | null {
  if (!sentence.period) return null
  const last = [...sentence.text].pop()
  return last && /[ぁ-ん]/.test(last) ? last : null
}

/**
 * 本文の文章を点検する。渡すのは章ファイルの全文でよい（見出しの行と空行は見ない）。
 * 行番号と字の位置は、ファイルのもの（ルビの記法を外す前の行）で返す。
 */
export function checkProse(text: string): ProseIssue[] {
  const issues: ProseIssue[] = []
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const phraseHits = new Map<PhraseRule, Array<{ line: number; column: number; excerpt: string; word: string }>>()
  // 同じ文末の連続。会話行と区切りの行で切る（空行では切らない）
  let run: { ending: string; count: number; line: number; column: number; excerpt: string } | null = null
  const flushRun = () => {
    if (run && run.count >= REPEATED_ENDING_RUN) {
      issues.push({
        line: run.line, column: run.column, rule: "repeated-ending",
        message: `「〜${run.ending}。」で終わる文が${run.count}文続いています（体言止め・現在形・短い段落を混ぜる）`,
        excerpt: run.excerpt,
      })
    }
    run = null
  }

  lines.forEach((line, i) => {
    if (line.trim().length === 0) return
    const original = [...line]
    const { chars, columns } = stripRubyLine(line)
    const at = (column: number) => (column < columns.length ? columns[column] : original.length)
    if (!isNarrationLine(chars)) {
      // 空行は見ない行だが連続を切らない。会話行・区切り・画面の行は切る
      if (isSeparatorLine(line) || /^#/.test(line) || chars.length > 0) flushRun()
      return
    }
    const { sentences, inDialogue } = splitSentences(chars)

    // できあいの言い回し（地の文の部分だけ）
    const narration = chars.map((ch, k) => (inDialogue[k] ? "\u0000" : ch)).join("")
    // 文字列の位置（UTF-16）を、コードポイントの位置に直す
    const toIndex = (offset: number) => [...narration.slice(0, offset)].length
    for (const rule of PHRASES) {
      for (const m of narration.matchAll(rule.pattern)) {
        const column = at(toIndex(m.index ?? 0))
        const hits = phraseHits.get(rule) ?? []
        hits.push({ line: i + 1, column: column + 1, excerpt: excerptAt(original, column), word: m[0] })
        phraseHits.set(rule, hits)
      }
    }

    for (const s of sentences) {
      const column = at(s.start)
      const length = [...s.text].length
      if (length > LONG_SENTENCE_CHARS) {
        issues.push({
          line: i + 1, column: column + 1, rule: "long-sentence",
          message: `1文が${length}文字あります（${LONG_SENTENCE_CHARS}文字を超える文は、2〜3文に割る）`,
          excerpt: excerptAt(original, column),
        })
      }
      const ending = endingOf(s)
      if (ending && run && run.ending === ending) {
        run.count++
      } else {
        flushRun()
        if (ending) run = { ending, count: 1, line: i + 1, column: column + 1, excerpt: excerptAt(original, column) }
      }
    }
  })
  flushRun()

  for (const [rule, hits] of phraseHits) {
    if (hits.length <= rule.allowed) continue
    const total = hits.length
    const limit = rule.allowed > 0 ? `この章に${total}回（${rule.allowed}回まで）。` : total > 1 ? `この章に${total}回。` : ""
    for (const hit of hits.slice(rule.allowed)) {
      issues.push({
        line: hit.line, column: hit.column, rule: "stock-phrase", phrase: rule.phrase,
        message: `「${hit.word}」${limit}${rule.advice}`,
        excerpt: hit.excerpt,
      })
    }
  }
  return issues.sort((a, b) => a.line - b.line || a.column - b.column)
}

/** 種類ごとの件数。できあいの言い回しは語ごとの内訳も付ける（多い順） */
export function summarizeProse(issues: ProseIssue[]): Array<{ rule: ProseRule; count: number; detail: string }> {
  const order: ProseRule[] = ["stock-phrase", "repeated-ending", "long-sentence"]
  return order.flatMap((rule) => {
    const of = issues.filter((i) => i.rule === rule)
    if (of.length === 0) return []
    const phrases = new Map<string, number>()
    for (const i of of) if (i.phrase) phrases.set(i.phrase, (phrases.get(i.phrase) ?? 0) + 1)
    const detail = [...phrases].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join("、")
    return [{ rule, count: of.length, detail }]
  })
}

/** 点検結果の一行 */
export function formatProseIssue(issue: ProseIssue): string {
  return `⚠️ ${issue.line}行${issue.column}字目［${PROSE_RULE_LABELS[issue.rule]}］${issue.message}\n     ${issue.excerpt}`
}
