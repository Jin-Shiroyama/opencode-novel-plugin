import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  parseManuscriptFormat, countManuscriptLines, linesToPages, linesToPagesDecimal, resolveManuscriptFormat,
} from "../src/manuscript.js"

/**
 * 原稿用紙の枚数換算の単体テスト。
 *
 * 文字数とは別の物差しで、書式を指定したときだけ使う。段落ごとに行を改め、
 * 行頭の句読点・閉じ括弧は前の行に収め、空行とルビの記法は数えない。
 */

const twenty = "あ".repeat(20)

describe("parseManuscriptFormat", () => {
  test("字数×行数を読む", () => {
    assert.deepEqual(parseManuscriptFormat("20x20"), { columns: 20, rows: 20 })
    assert.deepEqual(parseManuscriptFormat("40×30"), { columns: 40, rows: 30 })
    assert.deepEqual(parseManuscriptFormat("４２×３４"), { columns: 42, rows: 34 })
  })

  test("読めない・範囲外は null", () => {
    for (const v of ["", "20", "20x", "abc", "0x20", "20x101", 400, null]) {
      assert.equal(parseManuscriptFormat(v), null, String(v))
    }
  })
})

describe("countManuscriptLines", () => {
  test("段落ごとに行を改め、行の残りのマスも1行と数える", () => {
    assert.equal(countManuscriptLines("　あいう\n「はい」", 20), 2)
  })

  test("字数を超えたら次の行へ", () => {
    assert.equal(countManuscriptLines(twenty, 20), 1)
    assert.equal(countManuscriptLines(twenty + "い", 20), 2)
  })

  test("行頭に来る句読点・閉じ括弧は前の行に収める（ぶら下げ）", () => {
    assert.equal(countManuscriptLines(twenty + "。", 20), 1)
    assert.equal(countManuscriptLines(twenty + "。」", 20), 1)
    assert.equal(countManuscriptLines(twenty + "。」い", 20), 2)
  })

  test("空行は数えない（段落ごとに空行を入れる書き方でも枚数が膨らまない）", () => {
    assert.equal(countManuscriptLines("　あ\n\n\n　い\n", 20), 2)
  })

  test("ルビと傍点は記法を外して親文字だけを数える", () => {
    // 親文字2字＋18字＝20字で1行に収まる
    assert.equal(countManuscriptLines("｜十七《じゅうしち》" + "あ".repeat(18), 20), 1)
    assert.equal(countManuscriptLines("《《本当》》" + "あ".repeat(18), 20), 1)
  })
})

test("linesToPages は切り上げ、linesToPagesDecimal は小数第1位", () => {
  const f = { columns: 20, rows: 20 }
  assert.equal(linesToPages(20, f), 1)
  assert.equal(linesToPages(21, f), 2)
  assert.equal(linesToPagesDecimal(21, f), "1.1")
  assert.equal(linesToPagesDecimal(40, f), "2.0")
})

describe("resolveManuscriptFormat", () => {
  test("どちらも無ければ null（枚数を出さない）", () => {
    assert.equal(resolveManuscriptFormat(undefined, undefined), null)
  })

  test("引数が config.json より優先する", () => {
    assert.deepEqual(resolveManuscriptFormat("40x30", "20x20"), { format: { columns: 40, rows: 30 } })
    assert.deepEqual(resolveManuscriptFormat(undefined, "20x20"), { format: { columns: 20, rows: 20 } })
  })

  test("読めない値は、どこの指定かを添えて知らせる", () => {
    const r = resolveManuscriptFormat(undefined, "400字")
    assert.ok(r && "error" in r)
    if (r && "error" in r) assert.match(r.error, /config\.json の manuscript/)
  })
})
