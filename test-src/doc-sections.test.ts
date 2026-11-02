import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { worldBuildingParts, conceptParts } from "../src/doc-sections.js"
import { WORLD_BUILDING_TEMPLATE, CONCEPT_TEMPLATE, fillTemplateVars } from "../src/templates.js"

const template = WORLD_BUILDING_TEMPLATE
const untouched = fillTemplateVars(template, { title: "灰の王冠" })

/** 雛形の節の中身を書き換える */
function fill(heading: string, body: string, base = untouched): string {
  const lines = base.split("\n")
  const start = lines.findIndex((l) => l === `## ${heading}`)
  assert.ok(start >= 0, `雛形に「## ${heading}」が無い`)
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  return [...lines.slice(0, start + 1), body, "", ...lines.slice(end)].join("\n")
}

describe("worldBuildingParts", () => {
  test("雛形のままなら何も返さない（題が変わっていても）", () => {
    assert.deepEqual(worldBuildingParts(untouched, template), [])
  })

  test("書いた節だけを返し、雛形のままの節（能力体系の無い作品など）は載せない", () => {
    const content = fill("時代と背景", "灰の降る大陸。王国暦三百年。")
    const parts = worldBuildingParts(content, template)
    assert.deepEqual(parts.map((p) => p.label), ["時代と背景"])
    assert.equal(parts[0].content, "灰の降る大陸。王国暦三百年。")
  })

  test("約束ごとと能力体系の節に priority を立てる（見出しを書き換えても当たる）", () => {
    let content = fill("この世界の約束ごと", "1. 死者は灰になる")
    content = fill("時代と背景", "灰の降る大陸。", content).replace("## 能力体系（あれば）", "## 能力体系（灰術）")
    content = fill("能力体系（灰術）", "灰を食べて火を出す。代償は記憶。", content)
    const parts = worldBuildingParts(content, template)
    const priority = parts.filter((p) => p.priority).map((p) => p.label)
    assert.deepEqual(priority, ["能力体系（灰術）", "この世界の約束ごと"])
    assert.ok(!parts.find((p) => p.label === "時代と背景")?.priority)
  })

  test("書きかけの節では、雛形のままの記入欄の行だけを外す", () => {
    const content = untouched.replace("- **[場所1]**：[どんな場所か、物語でどう使うか]", "- **王都**：灰の積もらない唯一の街")
    const parts = worldBuildingParts(content, template)
    assert.equal(parts.length, 1)
    assert.equal(parts[0].label, "舞台")
    assert.match(parts[0].content, /^#### 主要な場所\n- \*\*王都\*\*/)
    assert.match(parts[0].content, /王都/)
    assert.doesNotMatch(parts[0].content, /\[場所2\]/)
    assert.doesNotMatch(parts[0].content, /\[場所どうしの位置関係/)
  })

  test("表の見出し行は残し、記入欄の行は外す", () => {
    const content = untouched.replace("| [勢力1] | [説明] | [関係] |", "| 灰教会 | 灰を神の恵みとする | 敵 |")
    const [part] = worldBuildingParts(content, template)
    assert.match(part.content, /\| 勢力 \| 目的・特徴 \| 主人公との関係 \|/)
    assert.match(part.content, /灰教会/)
    assert.doesNotMatch(part.content, /\[勢力2\]/)
  })

  test("記入欄が外れて中身の無くなった小見出しと表は載せない", () => {
    const content = untouched
      .replace("[どういう仕組みで働くのか]", "灰を食べて火を出す。")
      .replace("[誰がどうやって物事を決めているか]", "王と灰教会の合議。")
    const parts = worldBuildingParts(content, template)
    const ability = parts.find((p) => p.label === "能力体系（あれば）")!
    assert.equal(ability.content, "#### 基本の約束ごと\n灰を食べて火を出す。")
    const society = parts.find((p) => p.label === "社会のしくみ")!
    assert.equal(society.content, "#### 権力のかたち\n王と灰教会の合議。")
  })

  test("深い見出しに中身があれば、その上の見出しも残す", () => {
    const content = "## 地理\n### 北方\n#### 灰の森\n木がすべて白い。\n### 南方\n"
    const [part] = worldBuildingParts(content, template)
    assert.equal(part.content, "#### 北方\n##### 灰の森\n木がすべて白い。")
  })

  test("雛形に無い節や前置きも載せる。題の行は載せない", () => {
    const content = "# 『灰の王冠』世界観\n\n灰の降る世界の覚え書き。\n\n## 暦\n一年は十の月。\n"
    const parts = worldBuildingParts(content, template)
    assert.deepEqual(parts.map((p) => [p.label, p.content]), [
      ["world-building.md", "灰の降る世界の覚え書き。"],
      ["暦", "一年は十の月。"],
    ])
  })
})

describe("conceptParts", () => {
  const vars = { title: "灰の王冠", genre: "ファンタジー", targetWords: 120000, chapterCount: 40 }
  const blank = fillTemplateVars(CONCEPT_TEMPLATE, vars)

  test("雛形のまま（差し込み済みの基本情報を含む）なら何も返さない", () => {
    assert.deepEqual(conceptParts(blank, CONCEPT_TEMPLATE), [])
  })

  test("基本情報は書いても載せない（作品情報と同じことなので）", () => {
    const content = blank.replace("- 視点：[三人称一元視点／一人称／三人称多元視点／三人称客観]", "- 視点：一人称")
    assert.deepEqual(conceptParts(content, CONCEPT_TEMPLATE), [])
  })

  test("ログライン・作品テーマ・文体と手ざわりに先に枠を配る", () => {
    const content = blank
      .replace("[この物語で伝えたい主題。一文で]", "失ったものは灰の中に残る")
      .replace("- 全体の調子：[軽い／張りつめた／重い／ユーモラス]", "- 全体の調子：張りつめた")
      .replace("[主人公が立ち向かう外側の困難]", "灰教会の追手")
    const parts = conceptParts(content, CONCEPT_TEMPLATE)
    assert.deepEqual(parts.map((p) => [p.label, Boolean(p.priority)]), [
      ["中心にある対立", false],
      ["作品テーマ", true],
      ["文体と手ざわり", true],
    ])
    assert.equal(parts[2].content, "- 全体の調子：張りつめた")
  })
})
