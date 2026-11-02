import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseGlossary, glossaryKeys, buildGlossaryContext, formatGlossaryEntry, glossaryCheckTerms } from "../src/glossary.js"
import { checkTypography } from "../src/typography.js"
import { GLOSSARY_TEMPLATE, fillTemplateVars } from "../src/templates.js"
import { novelInitExecute } from "../src/tools/init.js"

const GLOSSARY = `# 『灰の王冠』用語集

## 魔法
| 用語 | 読み | 意味 | 使わない表記 |
|---|---|---|---|
| 灰術 | かいじゅつ | 灰を食べて火を出す術。代償は記憶 | 灰魔法、灰の術 |
| 霊脈 | レイライン | 大地の下を流れる力の筋 | マナライン |

## 地名
| 読み | 用語 | 意味 | 初出 |
|---|---|---|---|
| おうと | 王都 | 灰の積もらない唯一の街 | 第1章 |
`

describe("parseGlossary", () => {
  test("表を列の名前で読み、見出しを分類にする（列の順番や足した列にも対応）", () => {
    const entries = parseGlossary(GLOSSARY)
    assert.equal(entries.length, 3)
    assert.deepEqual(entries[0], {
      term: "灰術", reading: "かいじゅつ", meaning: "灰を食べて火を出す術。代償は記憶",
      avoid: ["灰魔法", "灰の術"], category: "魔法", extra: [],
    })
    assert.deepEqual(entries[2], {
      term: "王都", reading: "おうと", meaning: "灰の積もらない唯一の街",
      avoid: [], category: "地名", extra: [["初出", "第1章"]],
    })
  })

  test("雛形の行は読まない", () => {
    assert.deepEqual(parseGlossary(fillTemplateVars(GLOSSARY_TEMPLATE, { title: "灰の王冠" })), [])
  })

  test("「用語」の列が無い表は読まない", () => {
    assert.deepEqual(parseGlossary("| 名前 | 説明 |\n|---|---|\n| 王都 | 街 |\n"), [])
  })

  test("ほかの列の雛形のままの値は空とみなす", () => {
    const [e] = parseGlossary("| 用語 | 読み | 意味 |\n|---|---|---|\n| 灰術 | [よみ] | [意味] |\n")
    assert.equal(e.reading, undefined)
    assert.equal(e.meaning, undefined)
    assert.match(formatGlossaryEntry(e), /意味は未記入/)
  })
})

describe("glossaryKeys", () => {
  test("用語・読み・使わない表記を手がかりにする", () => {
    const [e] = parseGlossary(GLOSSARY)
    assert.deepEqual(glossaryKeys(e), ["灰術", "かいじゅつ", "灰魔法", "灰の術"])
  })

  test("1文字は漢字だけ使う（仮名1文字はほとんどの文に当たる）", () => {
    assert.deepEqual(glossaryKeys({ term: "環", reading: "わ", avoid: ["ワ"], extra: [] }), ["環"])
  })
})

describe("buildGlossaryContext", () => {
  const entries = parseGlossary(GLOSSARY)

  test("この章に出る用語を先に、残りをあとに並べる", () => {
    const out = buildGlossaryContext(entries, "王都で灰術を使う", 3000)
    const lines = out.split("\n")
    assert.equal(lines[0], "### この章のプロット・シーンに出る用語")
    assert.match(lines[1], /^- \*\*灰術\*\*（かいじゅつ）［魔法］：灰を食べて/)
    assert.match(lines[2], /^- \*\*王都\*\*.*初出：第1章/)
    assert.match(out, /### ほかの用語\n- \*\*霊脈\*\*/)
  })

  test("使わない表記で書かれていても拾う", () => {
    const out = buildGlossaryContext(entries, "マナラインが乱れる", 3000)
    assert.match(out.split("\n")[1], /霊脈/)
  })

  test("プロットもシーンも無ければ見出しを分けずに全部並べる", () => {
    const out = buildGlossaryContext(entries, "", 3000)
    assert.doesNotMatch(out, /###/)
    assert.equal(out.split("\n").length, 3)
  })

  test("枠を超えたら行ごとに省き、この章に出る用語は名前を示す", () => {
    const first = formatGlossaryEntry(entries[0])
    const out = buildGlossaryContext(entries, "灰術と王都", [...first].length + 1)
    assert.match(out, /灰術/)
    assert.match(out, /枠が足りず省略: この章に出る用語 王都／ほかの用語 1語/)
  })

  test("用語が無ければ空", () => {
    assert.equal(buildGlossaryContext([], "王都", 3000), "")
  })
})

describe("novel_init と用語集", () => {
  for (const form of ["long", "short"] as const) {
    test(`${form === "short" ? "短編" : "長編"}でも用語集の雛形を作る`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "novel-glossary-"))
      const out = await novelInitExecute({ title: "灰の王冠", genre: "ファンタジー", form } as any, { directory: dir } as any)
      const saved = readFileSync(join(dir, ".novel", "glossary.md"), "utf-8")
      assert.match(saved, /^# 『灰の王冠』用語集/)
      assert.match(out, /glossary\.md/)
    })
  }
})

describe("用語集の使わない表記の点検", () => {
  const glossary = glossaryCheckTerms(parseGlossary(`| 用語 | 使わない表記 |
|---|---|
| 霊脈 | マナライン、霊の脈 |
| 魔素結晶 | |
| 王都 | 都、ミヤコ、ト |
`))!
  const hits = (text: string) =>
    checkTypography(text, { glossary }).filter((i) => i.rule === "glossary-term")

  test("使わない表記を確認として、行と字の位置つきで拾う", () => {
    const [issue] = hits("　足もとのマナラインが脈打つ。")
    assert.equal(issue.severity, "warning")
    assert.equal(issue.line, 1)
    assert.equal(issue.column, 6)
    assert.match(issue.message, /「マナライン」は用語集で使わない表記です（「霊脈」と書く/)
  })

  test("正しい表記の中に含まれる箇所は拾わない", () => {
    const g = glossaryCheckTerms(parseGlossary("| 用語 | 使わない表記 |\n|---|---|\n| 魔素 | 魔力 |\n| 魔力炉 | |\n"))!
    assert.equal(checkTypography("　魔力炉が唸る。", { glossary: g }).filter((i) => i.rule === "glossary-term").length, 0)
    assert.equal(checkTypography("　魔力が満ちる。", { glossary: g }).filter((i) => i.rule === "glossary-term").length, 1)
  })

  test("1文字の使わない表記は漢字だけ使う（仮名1文字はほとんどの行に当たる）", () => {
    assert.deepEqual(glossary.avoid.map((a) => a.form), ["マナライン", "霊の脈", "都", "ミヤコ"])
  })

  test("ルビの記法を外した親文字で見て、位置は元の行に戻す", () => {
    const [issue] = hits("　｜霊の脈《れいのみゃく》を辿る。")
    assert.equal(issue.column, 3)
  })

  test("使わない表記が無ければ材料を作らない", () => {
    assert.equal(glossaryCheckTerms(parseGlossary("| 用語 |\n|---|\n| 霊脈 |\n")), undefined)
  })

  test("渡さなければ拾わない（今までどおり）", () => {
    assert.equal(checkTypography("　マナラインが脈打つ。").length, 0)
  })
})
