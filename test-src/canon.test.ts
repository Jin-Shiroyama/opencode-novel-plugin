import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelInitExecute } from "../src/tools/init.js"
import { novelContextExecute } from "../src/tools/context.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { readCanonParts, sourceWorkOf, hasCanonOverview } from "../src/canon.js"
import {
  CANON_OVERVIEW_TEMPLATE, CANON_TIMELINE_TEMPLATE, CANON_SETTING_TEMPLATE, CANON_CHARACTER_TEMPLATE,
  fillTemplateVars, getTemplate,
} from "../src/templates.js"
import { extractSpeechProfile, extractNameAliases, listCharacterDocs } from "../src/utils.js"

/**
 * 原作の資料（二次創作）のテスト。
 *
 * config.json の sourceWork があるとき、.novel/canon/ の資料と原作の人物が執筆用の資料に載ること、
 * 雛形のままの資料は載せず、土台が無いことを知らせることを見る。
 */

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-canon-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const config = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "灰の塔の居候",
    genre: "異世界ファンタジー",
    targetWords: 120000,
    chapterCount: 40,
    narrativePerspective: "一人称",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "writing",
    ...extra,
  })

const vars = { title: "灰の塔の居候", sourceWork: "灰の塔" }
const ctx = (dir: string) => ({ directory: dir }) as any
const context = (dir: string, args: Record<string, unknown> = {}) =>
  novelContextExecute({ chapterNumber: 2, ...args } as any, ctx(dir))

const OVERVIEW = `# 原作と扱い方

## 原作
- **作品名**：灰の塔
- **基準にする媒体と範囲**：原作小説の第3巻まで

## この作品の形
- **分岐点**：第2巻の塔の崩落で、主人公が助からなかった師を助ける
`

const OUTLINE = `# 章別プロット

## 第2章：居候
レンカが塔に戻り、師と魔導書の扱いで言い争う。
`

describe("sourceWorkOf", () => {
  test("原作名があれば返し、無い・空なら null", () => {
    assert.equal(sourceWorkOf({ sourceWork: " 灰の塔 " }), "灰の塔")
    assert.equal(sourceWorkOf({ sourceWork: "  " }), null)
    assert.equal(sourceWorkOf({}), null)
    assert.equal(sourceWorkOf(null), null)
  })
})

describe("novel_init（二次創作）", () => {
  test("sourceWork を渡すと canon/ の雛形を作り、config.json に原作名を残す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-canon-init-"))
    const report = await novelInitExecute({ title: "灰の塔の居候", genre: "異世界ファンタジー", sourceWork: "灰の塔" }, ctx(dir))
    assert.match(report, /二次創作: 原作『灰の塔』/)
    assert.match(report, /\/novel-canon/)
    for (const name of ["overview.md", "timeline.md", "setting.md"]) {
      assert.ok(existsSync(join(dir, ".novel", "canon", name)), name)
    }
    assert.match(readFileSync(join(dir, ".novel", "canon", "overview.md"), "utf-8"), /作品名\*\*：灰の塔/)
    assert.equal(JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8")).sourceWork, "灰の塔")
  })

  test("sourceWork が無ければ canon/ を作らず、config.json にも書かない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-canon-init-"))
    const report = await novelInitExecute({ title: "九月の忘れもの", genre: "現代ドラマ" }, ctx(dir))
    assert.doesNotMatch(report, /二次創作|canon/)
    assert.ok(!existsSync(join(dir, ".novel", "canon")))
    assert.ok(!("sourceWork" in JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8"))))
  })
})

describe("原作の資料を執筆用の資料に載せる", () => {
  test("書いた資料を載せ、雛形のままの資料は載せない", async () => {
    const dir = makeProject({
      "config.json": config({ sourceWork: "灰の塔" }),
      "outline-detailed.md": OUTLINE,
      "canon/overview.md": OVERVIEW,
      "canon/timeline.md": fillTemplateVars(CANON_TIMELINE_TEMPLATE, vars),
      "canon/setting.md": fillTemplateVars(CANON_SETTING_TEMPLATE, vars),
    })
    const out = await context(dir)
    assert.match(out, /## 📚 原作の資料 —『灰の塔』/)
    assert.match(out, /原作小説の第3巻まで/)
    assert.doesNotMatch(out, /原作の時系列と分岐/)
    assert.doesNotMatch(out, /確かめていないこと/)
    // 書くときの条件にも、原作を記憶で補わない旨を添える
    assert.match(out, /二次創作（原作『灰の塔』）/)
  })

  test("資料がまだ無ければ ⚠️ で知らせる（進行状況の記録の点検にも出す）", async () => {
    const dir = makeProject({
      "config.json": config({ sourceWork: "灰の塔" }),
      "outline-detailed.md": OUTLINE,
      "canon/overview.md": fillTemplateVars(CANON_OVERVIEW_TEMPLATE, vars),
    })
    assert.match(await context(dir), /⚠️ 原作の資料がまだありません/)
    assert.equal(await hasCanonOverview(dir), false)
    const status = await novelStatusExecute({}, ctx(dir))
    assert.match(status, /📚 二次創作: 原作『灰の塔』/)
    assert.match(status, /⚠️ 原作の資料がまだありません/)
  })

  test("扱い方を書いてあれば、進行状況で知らせない", async () => {
    const dir = makeProject({ "config.json": config({ sourceWork: "灰の塔" }), "canon/overview.md": OVERVIEW })
    assert.equal(await hasCanonOverview(dir), true)
    assert.doesNotMatch(await novelStatusExecute({}, ctx(dir)), /原作の資料がまだありません/)
  })

  test("オリジナル作品では、原作の節も条件も出さない", async () => {
    const dir = makeProject({ "config.json": config(), "outline-detailed.md": OUTLINE })
    const out = await context(dir)
    assert.doesNotMatch(out, /原作/)
    assert.doesNotMatch(await novelStatusExecute({}, ctx(dir)), /二次創作|原作/)
  })

  test("扱い方と、この章のプロットに名前の出る項目に先に枠を配る", async () => {
    const dir = makeProject({
      "config.json": config({ sourceWork: "灰の塔", limits: { canon: 400 } }),
      "outline-detailed.md": OUTLINE,
      "canon/overview.md": OVERVIEW,
      "canon/timeline.md": `# 時系列\n${"塔の歴史。".repeat(200)}`,
      "canon/setting/魔導書.md": "# 魔導書\n読むたびに頁が減る。",
      "canon/setting/王都.md": `# 王都\n${"白い城壁。".repeat(200)}`,
    })
    const parts = await readCanonParts(dir, "師と魔導書の扱いで言い争う")
    assert.deepEqual(
      parts.filter((p) => p.priority).map((p) => p.label),
      ["canon/overview.md", "canon/setting/魔導書.md"],
    )
    const out = await context(dir)
    assert.match(out, /原作小説の第3巻まで/)
    assert.match(out, /読むたびに頁が減る/)
  })
})

describe("原作の人物（canon/characters/）", () => {
  const CANON_CHARACTER = `# レンカ

## 基本情報
- **名前**：レンカ
- **呼称**：レンカ、居候

## ことばづかい
- **一人称**：あたし
- **二人称**：あんた

### 相手ごとの呼び方

| 相手 | 呼び方 | 丁寧さ | 変わるとき |
|---|---|---|---|
| 師 | 「お師匠」 | ため口 | — |
`

  test("人物設定と同じように選ばれ、見出しで区別され、ことばづかいに載る", async () => {
    const dir = makeProject({
      "config.json": config({ sourceWork: "灰の塔" }),
      "outline-detailed.md": OUTLINE,
      "canon/overview.md": OVERVIEW,
      "canon/characters/レンカ.md": CANON_CHARACTER,
      "canon/characters/ゴドー.md": "# ゴドー\n\n王都の衛兵。\n",
      "characters/ユウト.md": "# ユウト\n\nこの作品だけの人物。\n",
    })
    const docs = await listCharacterDocs(dir)
    assert.deepEqual(docs.map((d) => [d.label, Boolean(d.canon)]), [["ユウト", false], ["ゴドー", true], ["レンカ", true]])
    const out = await context(dir)
    assert.match(out, /### レンカ（原作の人物）|この章に関わる人物の設定を載せています: レンカ/)
    assert.match(out, /\*\*レンカ\*\* — 一人称: あたし ／ 二人称: あんた/)
    assert.match(out, /師 → 「お師匠」/)
    // 原作の人物は、原作の資料の節には重ねて載せない
    assert.doesNotMatch(out, /canon\/characters/)
    assert.doesNotMatch(out, /王都の衛兵/)
  })

  test("同じ名前がこの作品の人物設定にもあれば、ことばづかいはこの作品の設定を使う", async () => {
    const dir = makeProject({
      "config.json": config({ sourceWork: "灰の塔" }),
      "outline-detailed.md": OUTLINE,
      "canon/characters/レンカ.md": CANON_CHARACTER,
      "characters/レンカ.md": "# レンカ\n\n## ことばづかい\n- **一人称**：私\n",
    })
    const out = await context(dir)
    assert.match(out, /\*\*レンカ\*\* — 一人称: 私/)
    assert.doesNotMatch(out, /一人称: あたし ／/)
  })

  test("雛形のことばづかいは人物設定と同じ形で読め、記入例を呼称として拾わない", () => {
    const template = getTemplate("canon-character")
    assert.equal(template, CANON_CHARACTER_TEMPLATE)
    assert.deepEqual(extractNameAliases(template), [])
    const filled = template.replace("- **一人称**：[俺／僕／私／わたし／あたし／自分 など]", "- **一人称**：あたし")
    assert.equal(extractSpeechProfile(filled)?.firstPerson, "あたし")
  })
})
