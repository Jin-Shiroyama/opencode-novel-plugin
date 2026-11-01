import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { determinePhase } from "../src/utils.js"
import type { NovelConfig } from "../src/utils.js"
import { novelInitExecute } from "../src/tools/init.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { novelContextExecute } from "../src/tools/context.js"
import { novelExportExecute } from "../src/tools/export.js"
import { novelSaveChapterExecute } from "../src/tools/save.js"
import { getPromptTemplate, listPromptTemplates } from "../src/prompts.js"
import { getTemplate } from "../src/templates.js"

/**
 * 短編（config.json の form: "short"）のテスト。
 *
 * 短編は世界観と章別プロットの工程を省き、プロット概要（序破急）からシーン一覧へ直接割る。
 * 既定は章なし（1本の本文。内部では第1章1つ）。
 */

const ctx = (dir: string) => ({ directory: dir }) as any

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-short-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const config = (extra: Partial<NovelConfig> = {}) =>
  JSON.stringify({
    title: "雨の駅",
    genre: "現代ドラマ",
    targetWords: 20000,
    chapterCount: 1,
    form: "short",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "concept",
    ...extra,
  })

const BRIEF = `# 『雨の駅』プロット概要（短編・序破急）

## 序（約2割）
- **すること**：佐和が終電を逃す

## 破（約6割）
- **すること**：駅員の森田と話すうち、ずれが広がる

## 急（約2割）
- **すること**：始発の前に、佐和は切符を破る
`

describe("novel_init(form: short)", () => {
  test("短編の既定値で作り、世界観の雛形を作らない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-short-"))
    const out = await novelInitExecute({ title: "雨の駅", genre: "現代ドラマ", form: "short" } as any, ctx(dir))
    const saved = JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8"))
    assert.equal(saved.form, "short")
    assert.equal(saved.targetWords, 20000)
    assert.equal(saved.chapterCount, 1)
    assert.ok(!existsSync(join(dir, ".novel", "world-building.md")))
    assert.match(out, /形: 短編（章なし。1本の本文）/)
    assert.doesNotMatch(out, /world-building\.md/)
    assert.match(out, /登場人物づくりへ進みます/)
  })

  test("渡した字数と章数が既定値より優先される", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-short-"))
    const out = await novelInitExecute(
      { title: "雨の駅", genre: "現代ドラマ", form: "short", targetWords: 30000, chapterCount: 3 } as any,
      ctx(dir),
    )
    const saved = JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8"))
    assert.equal(saved.targetWords, 30000)
    assert.equal(saved.chapterCount, 3)
    assert.match(out, /形: 短編／予定章数: 全3章/)
  })

  test("form を省くと今までどおり長編の作り", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-short-"))
    await novelInitExecute({ title: "雨の駅", genre: "現代ドラマ" } as any, ctx(dir))
    const saved = JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8"))
    assert.equal(saved.form, undefined)
    assert.equal(saved.chapterCount, 40)
    assert.ok(existsSync(join(dir, ".novel", "world-building.md")))
  })
})

describe("短編の工程", () => {
  const filled = { "concept.md": "# コンセプト\n雨の駅の話。", "characters/profiles.md": "# 人物\n佐和。" }

  test("世界観と章別プロットが無くても、concept → characters → outline → scenes → writing と進む", () => {
    const cfg = JSON.parse(config()) as NovelConfig
    const dir = makeProject({ "config.json": config(), "concept.md": "# コンセプト\n[未記入]" })
    assert.equal(determinePhase(dir, cfg), "concept")

    const d2 = makeProject({ "config.json": config(), "concept.md": "# コンセプト\n雨の駅の話。" })
    assert.equal(determinePhase(d2, cfg), "characters")

    const d3 = makeProject({ "config.json": config(), ...filled })
    assert.equal(determinePhase(d3, cfg), "outline")

    const d4 = makeProject({ "config.json": config(), ...filled, "outline-brief.md": BRIEF })
    assert.equal(determinePhase(d4, cfg), "scenes")

    const d5 = makeProject({ "config.json": config(), ...filled, "outline-brief.md": BRIEF, "scenes.md": "## シーン 1.1\n" })
    assert.equal(determinePhase(d5, cfg), "writing")

    // 長編は今までどおり世界観と章別プロットを求める
    const long = { ...cfg, form: undefined }
    assert.equal(determinePhase(d5, long), "world-building")
  })

  test("novel_status は形を示し、省いた工程を一覧に出さない", async () => {
    const dir = makeProject({ "config.json": config(), ...filled, "outline-brief.md": BRIEF, "scenes.md": "## シーン 1.1\n" })
    const out = await novelStatusExecute({}, ctx(dir))
    assert.match(out, /📋 形: 短編（章なし。1本の本文）/)
    assert.doesNotMatch(out, /世界観\n|章別プロット\n/)
    assert.match(out, /短編では世界観と章別プロットの工程を省きます/)
    assert.match(out, /💡 次の一手: `\/write-chapter` で本文を書きましょう。/)
  })
})

describe("短編の執筆用の資料", () => {
  test("章別プロットが無ければ、プロット概要（序破急）を載せる", async () => {
    const dir = makeProject({ "config.json": config(), "outline-brief.md": BRIEF })
    const out = await novelContextExecute({ chapterNumber: 1, includePrompts: false } as any, ctx(dir))
    assert.match(out, /📝 執筆用の資料 — 本文/)
    assert.match(out, /本文の目安: 20,000文字/)
    assert.match(out, /## 📋 作品のプロット（序破急）[^\n]*\n# 『雨の駅』プロット概要/)
    assert.match(out, /始発の前に、佐和は切符を破る/)
  })

  test("章を分けた短編では、どこに当たるかを確かめるよう添える。章別プロットがあればそちらを使う", async () => {
    const dir = makeProject({ "config.json": config({ chapterCount: 3 }), "outline-brief.md": BRIEF })
    const out = await novelContextExecute({ chapterNumber: 2, includePrompts: false } as any, ctx(dir))
    assert.match(out, /📝 執筆用の資料 — 第2章/)
    assert.match(out, /第2章が序・破・急のどこに当たるか/)

    const withDetailed = makeProject({
      "config.json": config({ chapterCount: 3 }),
      "outline-brief.md": BRIEF,
      "outline-detailed.md": "## 第2章 駅員\n森田と話す。\n",
    })
    const detailed = await novelContextExecute({ chapterNumber: 2, includePrompts: false } as any, ctx(withDetailed))
    assert.match(detailed, /森田と話す。/)
    assert.doesNotMatch(detailed, /作品のプロット（序破急）/)
  })

  test("長編では、章別プロットが無くてもプロット概要を載せない", async () => {
    const dir = makeProject({ "config.json": config({ form: undefined, chapterCount: 40 }), "outline-brief.md": BRIEF })
    const out = await novelContextExecute({ chapterNumber: 1, includePrompts: false } as any, ctx(dir))
    assert.doesNotMatch(out, /作品のプロット（序破急）/)
  })
})

describe("短編の保存", () => {
  test("章を分けない短編では「本文」として報告する", async () => {
    const dir = makeProject({ "config.json": config() })
    const out = await novelSaveChapterExecute({ chapterNumber: 1, title: "雨", content: "　雨だった。" } as any, ctx(dir))
    assert.match(out, /✅ 本文「雨」を保存しました/)
    const split = makeProject({ "config.json": config({ chapterCount: 3 }) })
    assert.match(await novelSaveChapterExecute({ chapterNumber: 1, title: "雨", content: "　雨。" } as any, ctx(split)), /✅ 第1章「雨」/)
  })
})

describe("短編の書き出し", () => {
  test("章が1つなら章見出しを付けない", async () => {
    const dir = makeProject({ "config.json": config(), "chapters/chapter-001.md": "# 第1章 雨\n\n　雨だった。\n" })
    const out = await novelExportExecute({}, ctx(dir))
    assert.match(out, /📚 章: 本文（短編・章なし）/)
    assert.equal(readFileSync(join(dir, ".novel", "export", "雨の駅.txt"), "utf-8"), "雨の駅\n\n\n　雨だった。\n")
    await novelExportExecute({ format: "markdown" }, ctx(dir))
    assert.equal(readFileSync(join(dir, ".novel", "export", "雨の駅.md"), "utf-8"), "# 雨の駅\n\n　雨だった。\n")
  })

  test("章が2つ以上なら「一」「二」の見出しにする", async () => {
    const dir = makeProject({
      "config.json": config({ chapterCount: 2 }),
      "chapters/chapter-001.md": "# 第1章 雨\n\n　雨だった。\n",
      "chapters/chapter-002.md": "# 第2章\n\n　晴れた。\n",
    })
    await novelExportExecute({}, ctx(dir))
    const text = readFileSync(join(dir, ".novel", "export", "雨の駅.txt"), "utf-8")
    assert.match(text, /^一　雨\n\n　雨だった。/m)
    assert.match(text, /^二\n\n　晴れた。/m)
    assert.doesNotMatch(text, /第一章/)
    await novelExportExecute({ format: "markdown" }, ctx(dir))
    assert.match(readFileSync(join(dir, ".novel", "export", "雨の駅.md"), "utf-8"), /## 1 雨\n\n[\s\S]*## 2\n\n/)
  })
})

describe("序破急の雛形とプロンプト", () => {
  test("引ける。破を山場と取り違えない注意がある", () => {
    assert.ok(listPromptTemplates().includes("outline-short"))
    const prompt = getPromptTemplate("outline-short")!
    assert.match(prompt, /「破」を山場と取り違えない/)
    assert.match(getTemplate("outline-brief-short"), /「破」は山場ではありません/)
  })

  test("長編のプロンプトで「転」を危機の幕に当てていない", () => {
    assert.doesNotMatch(getPromptTemplate("outline-brief")!, /25%／転/)
  })
})
