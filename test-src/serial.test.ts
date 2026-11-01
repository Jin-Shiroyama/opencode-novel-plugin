import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { determinePhase } from "../src/utils.js"
import type { NovelConfig } from "../src/utils.js"
import { lastChapterForRecords, listManuscriptFiles } from "../src/sections.js"
import { novelInitExecute } from "../src/tools/init.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { novelContextExecute } from "../src/tools/context.js"
import { novelUpdateExecute } from "../src/tools/track.js"

/**
 * 結末を決めずに書き進める連載（config.json の serial: true）と、予定章数を超えて書いたときのテスト。
 *
 * 予定章数を「結末の章」とみなすと、予定を超えて書いた作品で完結の表示や
 * エピローグの記録の章番号がずれる。
 */

const ctx = (dir: string) => ({ directory: dir }) as any

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-serial-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const config = (extra: Partial<NovelConfig> = {}) =>
  JSON.stringify({
    title: "迷宮の街",
    genre: "異世界ファンタジー",
    targetWords: 9000,
    chapterCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "writing",
    ...extra,
  })

/** 企画の文書をそろえ、第1〜5章を書いた作品（予定は全3章） */
function fiveChapters(extra: Partial<NovelConfig> = {}, more: Record<string, string> = {}): string {
  const chapters: Record<string, string> = {}
  for (let n = 1; n <= 5; n++) chapters[`chapters/chapter-00${n}.md`] = `# 第${n}章\n\n　第${n}章の本文。\n`
  return makeProject({
    "config.json": config(extra),
    "concept.md": "# コンセプト\n迷宮の話。",
    "world-building.md": "# 世界観\n地下の街。",
    "characters/profiles.md": "# 人物\nリオ。",
    "outline-brief.md": "# プロット概要\n当面の山は第一層の主。",
    "outline-detailed.md": "## 第1章 入口\n迷宮に入る。\n",
    "scenes.md": "## シーン 1.1\n",
    ...chapters,
    ...more,
  })
}

describe("novel_init(serial)", () => {
  test("config.json に serial を残し、章数を目安として示す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-serial-"))
    const out = await novelInitExecute({ title: "迷宮の街", genre: "異世界ファンタジー", serial: true } as any, ctx(dir))
    const saved = JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8"))
    assert.equal(saved.serial, true)
    assert.match(out, /連載（結末未定）／章数の目安: 全40章/)
  })

  test("省くと serial を書かない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-serial-"))
    await novelInitExecute({ title: "迷宮の街", genre: "異世界ファンタジー" } as any, ctx(dir))
    assert.equal(JSON.parse(readFileSync(join(dir, ".novel", "config.json"), "utf-8")).serial, undefined)
  })
})

describe("連載の工程", () => {
  test("予定章数を超えても完結にせず、エピローグを書いたら完結", () => {
    const dir = fiveChapters({ serial: true })
    const cfg = JSON.parse(config({ serial: true })) as NovelConfig
    assert.equal(determinePhase(dir, cfg), "writing")
    const done = fiveChapters({ serial: true }, { "chapters/epilogue.md": "# エピローグ\n\n　終わり。\n" })
    assert.equal(determinePhase(done, cfg), "completed")
  })

  test("連載でない作品は今までどおり予定章数で完結", () => {
    const dir = fiveChapters()
    assert.equal(determinePhase(dir, JSON.parse(config()) as NovelConfig), "completed")
  })

  test("novel_status は連載と示し、目標に届かなくても分量不足を知らせない", async () => {
    const dir = fiveChapters({ serial: true }, { "chapters/epilogue.md": "# エピローグ\n\n　終わり。\n" })
    const out = await novelStatusExecute({}, ctx(dir))
    assert.match(out, /📋 連載（結末未定）／章数の目安: 全3章/)
    assert.match(out, /連載で、エピローグを書いた状態です/)
    assert.match(out, /連載なので目安/)
    assert.doesNotMatch(out, /分量が目標に届いていません/)

    const long = fiveChapters()
    assert.match(await novelStatusExecute({}, ctx(long)), /分量が目標に届いていません/)
  })

  test("書いている途中なら、次の章と章別プロットの足し方を案内する", async () => {
    const out = await novelStatusExecute({}, ctx(fiveChapters({ serial: true })))
    assert.match(out, /💡 次の一手: `\/write-chapter 6` で続きを書きましょう（第6章の章別プロットがまだなら/)
  })
})

describe("予定章数を超えて書いたときの記録", () => {
  test("エピローグは本文のある最後の章として記録する（無ければ予定章数）", async () => {
    assert.equal(lastChapterForRecords(await listManuscriptFiles(fiveChapters()), 3), 5)
    assert.equal(lastChapterForRecords(await listManuscriptFiles(makeProject({ "config.json": config() })), 3), 3)

    const dir = fiveChapters({ serial: true }, {
      "foreshadow.json": JSON.stringify({ items: [{ id: "F1", title: "鍵", content: "古い鍵", status: "planted", plantChapter: 4 }] }),
    })
    await novelUpdateExecute(
      { action: "foreshadow", section: "epilogue", content: JSON.stringify({ items: [{ id: "F1", status: "resolved" }] }) },
      ctx(dir),
    )
    const items = JSON.parse(readFileSync(join(dir, ".novel", "foreshadow.json"), "utf-8")).items
    assert.equal(items[0].resolvedChapter, 5, "張った第4章より前（予定の第3章）に回収を置かない")
  })

  test("エピローグの資料では、予定章数より後が期限の伏線も期限切れとして出す", async () => {
    const dir = fiveChapters({ serial: true }, {
      "foreshadow.json": JSON.stringify({ items: [{ id: "F1", title: "鍵", content: "古い鍵", status: "planted", plantChapter: 1, targetChapter: 4 }] }),
    })
    const epi = await novelContextExecute({ section: "epilogue", includePrompts: false } as any, ctx(dir))
    assert.match(epi, /回収予定の第4章を過ぎています（現在はエピローグ）/)
  })

  test("部の範囲は、予定を超えて書いた章まで示す", async () => {
    const parts = [{ title: "第一層", fromChapter: 1 }, { title: "第二層", fromChapter: 3 }]
    const dir = fiveChapters({ serial: true, parts })
    assert.match(await novelStatusExecute({}, ctx(dir)), /第二部「第二層」（第3〜5章）: 3\/3章/)
    const out = await novelContextExecute({ chapterNumber: 5, includePrompts: false } as any, ctx(dir))
    assert.match(out, /部: 第二部「第二層」（第3〜5章）の3章目/)
  })
})

describe("連載の執筆用の資料", () => {
  test("章数を目安として示し、章別プロットの無い章では足すよう知らせる", async () => {
    const dir = fiveChapters({ serial: true })
    const out = await novelContextExecute({ chapterNumber: 6, includePrompts: false } as any, ctx(dir))
    assert.match(out, /連載。章数の目安 全3章、本文は第5章まで/)
    assert.match(out, /⚠️ 第6章のプロットが見つかりません。連載では、書く前に `\/novel-outline`/)
    const first = await novelContextExecute({ chapterNumber: 1, includePrompts: false } as any, ctx(dir))
    assert.doesNotMatch(first, /第1章のプロットが見つかりません/)
  })
})
