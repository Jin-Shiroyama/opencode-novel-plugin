import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { checkTypography, countByRule } from "./typography.js"
import type { TypographyRule } from "./typography.js"
import { toKanjiNumber } from "./utils.js"

/**
 * 表記の点検の単体テスト。規約の正本は novel-writing skill。
 *
 * 規約どおりの文は何も拾わないこと（誤検出しないこと）と、
 * 規約から外れた文を正しい規則で拾うことの両方を見る。
 */

const rules = (text: string): TypographyRule[] => checkTypography(text).map((i) => i.rule)

describe("規約どおりの文は拾わない", () => {
  test("skill の書き出しの一例（会話行は字下げしない）", () => {
    const text = [
      "# 第1章 九月",
      "",
      "　放課後の職員室は、暖房を切ったあとの乾いた匂いがした。",
      "「先生、あれ出しました」",
      "　廊下の光を背にして立っているので、杉本の顔は影になっていた。",
      "「いつ」",
      "「先週の……たしか、水曜です」",
      "　水曜。森田はその日の自分を思い出そうとして、思い出せなかった。",
    ].join("\n")
    assert.deepEqual(checkTypography(text), [])
  })

  test("感嘆符・疑問符の規則の例外（閉じ括弧の直前・行末・約物の連続）", () => {
    const text = [
      "　本当か？　彼は息を止めた。",
      "「待て！　行くな」",
      "「待て！」",
      "「どこだ！？」",
      "「嘘だろ？！」",
      "「来るな！！」",
      "　まさか！",
      "「なんで！……」",
    ].join("\n")
    assert.deepEqual(checkTypography(text), [])
  })

  test("三点リーダ・ダッシュの偶数個と、それで始まる行", () => {
    const text = ["……来ない。", "――いや、そうじゃなくて。", "　待っていた…………まだ。", "　息を――止めた。"].join("\n")
    assert.deepEqual(checkTypography(text), [])
  })

  test("カタカナ語の長音、区切りの記号だけの行、会話の中の算用数字", () => {
    const text = ["　ゴーーンと鐘が鳴った。", "＊", "◇　◇　◇", "「3番線です」"].join("\n")
    assert.deepEqual(checkTypography(text), [])
  })
})

describe("規約から外れた文を拾う", () => {
  const cases: Array<[string, string, TypographyRule]> = [
    ["会話文末の句点", "「行こう。」", "dialogue-period"],
    ["閉じていない括弧", "「行こう", "bracket"],
    ["対応しない閉じ括弧", "　行こう」", "bracket"],
    ["三点リーダ1つ", "　待って…", "ellipsis"],
    ["三点リーダ3つ", "　待って………", "ellipsis"],
    ["半角ピリオド3つ", "　待って...", "ellipsis"],
    ["中黒の連続", "　待って・・・", "ellipsis"],
    ["ダッシュ1つ", "　花が―畑に", "dash"],
    ["U+2014 のダッシュ", "「花が——畑の外れに」", "dash"],
    ["長音符での代用", "「花がーー畑に」", "dash"],
    ["三点リーダのあとの全角スペース", "　待って……　来ない。", "space-after-ellipsis-dash"],
    ["半角の感嘆符", "「待て!」", "halfwidth-punctuation"],
    ["感嘆符のあとに空白が無い", "　本当か？彼は息を止めた。", "exclamation-space"],
    ["閉じ括弧の直前の空白", "「待て！　」", "exclamation-space"],
    ["約物が続くときの空白（三点リーダ）", "「待て！　……」", "exclamation-space"],
    ["約物が続くときの空白（疑問符）", "「何！　？」", "exclamation-space"],
    ["空白が2つ", "　本当か？　　彼は", "exclamation-space"],
    ["感嘆符のあとの半角スペース", "　本当か？ 彼は", "exclamation-space"],
    ["地の文の字下げが無い", "最初に見えたのは、花だった。", "indent"],
    ["会話行の字下げ", "　「行こう」", "indent"],
    ["全角の算用数字", "　３日後に発つ。", "fullwidth-digit"],
  ]
  for (const [name, text, rule] of cases) {
    test(name, () => assert.ok(rules(text).includes(rule), `${text} → ${rules(text).join(", ")}`))
  }

  test("地の文の算用数字と、英数字との半角スペースは確認（warning）にとどめる", () => {
    const issues = checkTypography("　第5章で見た群れ。\n　昨日 iPhone を買った。")
    assert.deepEqual(
      issues.map((i) => [i.rule, i.severity]),
      [["arabic-digit", "warning"], ["ascii-space", "warning"], ["ascii-space", "warning"]],
    )
  })

  test("行と字の位置はファイルのものを返す", () => {
    const [issue] = checkTypography("# 第1章 畑\n\n　花が――畑に…\n")
    assert.equal(issue.line, 3)
    assert.equal(issue.column, 8)
    assert.match(issue.excerpt, /□花が――畑に…/)
  })

  test("規則ごとに数え、規約違反を先に並べる", () => {
    const counts = countByRule(checkTypography("「行こう。」\n「行く。」\n　第5章の話。"))
    assert.deepEqual(counts[0], { rule: "dialogue-period", severity: "error", count: 2 })
    assert.equal(counts[1].severity, "warning")
  })
})

test("toKanjiNumber", () => {
  assert.deepEqual(
    [1, 10, 11, 20, 23, 100, 105, 1000, 1234].map(toKanjiNumber),
    ["一", "十", "十一", "二十", "二十三", "百", "百五", "千", "千二百三十四"],
  )
})
