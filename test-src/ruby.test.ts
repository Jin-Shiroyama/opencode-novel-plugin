import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { parseRubyLine, stripRuby, stripRubyLine, convertRuby, countRubyMarks } from "../src/ruby.js"

/**
 * ルビと傍点の単体テスト。記法の正本は novel-writing skill の表記規約。
 *
 * 原稿はカクヨムの記法で書き、数えるときは親文字だけを、書き出すときは
 * 投稿先の記法に直す。
 */

const LINE = "　｜十七《じゅうしち》の夏、東京《とうきょう》で彼は《《本当に》》来た。"

describe("parseRubyLine", () => {
  test("｜付きのルビ、｜を省いたルビ、傍点を分ける", () => {
    const kinds = parseRubyLine(LINE).segments.map((s) =>
      s.kind === "text" ? s.text : s.kind === "ruby" ? `[${s.base}/${s.reading}]` : `<${s.text}>`,
    )
    assert.deepEqual(kinds, ["　", "[十七/じゅうしち]", "の夏、", "[東京/とうきょう]", "で彼は", "<本当に>", "来た。"])
    assert.deepEqual(parseRubyLine(LINE).issues, [])
  })

  test("半角の | も使える", () => {
    const [seg] = parseRubyLine("|雨《あめ》").segments
    assert.deepEqual(seg, { kind: "ruby", base: "雨", reading: "あめ", baseStart: 1 })
  })

  test("｜を省いたルビの親文字は、直前に続く漢字だけ", () => {
    const ruby = parseRubyLine("　あの王都《ロンドン》へ").segments.find((s) => s.kind === "ruby")
    assert.deepEqual(ruby, { kind: "ruby", base: "王都", reading: "ロンドン", baseStart: 3 })
  })

  test("漢字の続かない《…》と ｜《 は、ルビにせず括弧として残す", () => {
    for (const line of ["　あの《黒の騎士団》が", "　王都｜《白の都》へ"]) {
      const { segments, issues } = parseRubyLine(line)
      assert.ok(segments.every((s) => s.kind === "text"), line)
      assert.deepEqual(issues, [], line)
    }
  })

  for (const [name, line, column] of [
    ["｜のあとに《》が無い", "　壊れた｜ルビ", 4],
    ["ルビの《が閉じていない", "　｜漢字《かんじ", 4],
    ["ルビが空", "　漢字《》", 3],
    ["傍点が閉じていない", "　《《本当に》", 1],
    ["傍点の中のルビ", "　《《｜本当《ほんとう》》》", 1],
  ] as const) {
    test(`記法の崩れを拾う: ${name}`, () => {
      const { issues } = parseRubyLine(line)
      assert.ok(issues.length > 0, `拾っていない: ${line}`)
      assert.equal(issues[0].column, column)
    })
  }
})

describe("stripRuby / stripRubyLine", () => {
  test("親文字と傍点の文字だけを残す", () => {
    assert.equal(stripRuby(LINE), "　十七の夏、東京で彼は本当に来た。")
    assert.equal(stripRuby("　王都｜《白の都》へ\n《《強》》"), "　王都《白の都》へ\n強")
  })

  test("残した文字ごとに、元の行での位置を返す", () => {
    const { chars, columns } = stripRubyLine("　｜十七《じゅうしち》の夏")
    assert.deepEqual(chars, ["　", "十", "七", "の", "夏"])
    assert.deepEqual(columns, [0, 2, 3, 11, 12])
  })
})

describe("convertRuby", () => {
  const cases: Array<[Parameters<typeof convertRuby>[1], string]> = [
    ["kakuyomu", "　｜十七《じゅうしち》の夏、｜東京《とうきょう》で彼は《《本当に》》来た。"],
    ["narou", "　｜十七《じゅうしち》の夏、｜東京《とうきょう》で彼は｜本《・》｜当《・》｜に《・》来た。"],
    ["aozora", "　｜十七《じゅうしち》の夏、｜東京《とうきょう》で彼は本当に［＃「本当に」に傍点］来た。"],
    ["pixiv", "　[[rb:十七 > じゅうしち]]の夏、[[rb:東京 > とうきょう]]で彼は[[rb:本 > ・]][[rb:当 > ・]][[rb:に > ・]]来た。"],
    ["html", "　<ruby>十七<rt>じゅうしち</rt></ruby>の夏、<ruby>東京<rt>とうきょう</rt></ruby>で彼は<ruby>本<rt>・</rt></ruby><ruby>当<rt>・</rt></ruby><ruby>に<rt>・</rt></ruby>来た。"],
    ["paren", "　十七（じゅうしち）の夏、東京（とうきょう）で彼は本当に来た。"],
    ["none", "　十七の夏、東京で彼は本当に来た。"],
  ]
  for (const [notation, expected] of cases) {
    test(notation, () => assert.equal(convertRuby(LINE, notation), expected))
  }

  test("括弧の《》: カクヨムとなろうは ｜《 を残し、青空文庫は注記に直す", () => {
    const line = "　王都｜《白の都》へ"
    assert.equal(convertRuby(line, "kakuyomu"), line)
    assert.equal(convertRuby(line, "narou"), line)
    assert.equal(convertRuby(line, "aozora"), "　王都※［＃始め二重山括弧、1-1-52］白の都※［＃終わり二重山括弧、1-1-53］へ")
    assert.equal(convertRuby(line, "none"), "　王都《白の都》へ")
  })

  test("記法の崩れた部分は書き換えない", () => {
    assert.equal(convertRuby("　｜漢字《かんじ", "kakuyomu"), "　｜漢字《かんじ")
  })
})

test("countRubyMarks", () => {
  assert.deepEqual(countRubyMarks(`${LINE}\n　雨《あめ》`), { ruby: 3, emphasis: 1 })
})
