import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { novelSaveChapterExecute } from "../../src/tools/save.js"
import { novelStatusExecute } from "../../src/tools/status.js"

/**
 * novel_save_chapter の上書きのテスト。
 *
 * 書き直しを頼んだだけで前の原稿が消えないよう、内容が変わるときは
 * 旧稿を .novel/drafts/ に残してから上書きする。
 */

const save = (dir: string, content: string, chapterNumber = 1) =>
  novelSaveChapterExecute({ chapterNumber, title: "雨の駅", content } as any, { directory: dir } as any)

const drafts = (dir: string): string[] => {
  const d = join(dir, ".novel", "drafts")
  return existsSync(d) ? readdirSync(d).sort() : []
}

describe("novel_save_chapter の上書き", () => {
  test("初めて保存するときは旧稿を作らない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    const out = await save(dir, "　初稿。")
    assert.doesNotMatch(out, /前の原稿/)
    assert.deepEqual(drafts(dir), [])
  })

  test("内容が変わるときは前の原稿を drafts/ に残し、報告で知らせる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    await save(dir, "　初稿。")
    const out = await save(dir, "　二稿。")
    assert.match(out, /🗂️ 前の原稿を残しました: .*drafts[\\/]chapter-001-\d{8}-\d{6}\.md/)
    const [kept] = drafts(dir)
    assert.match(readFileSync(join(dir, ".novel", "drafts", kept), "utf-8"), /初稿/)
    assert.match(readFileSync(join(dir, ".novel", "chapters", "chapter-001.md"), "utf-8"), /二稿/)
  })

  test("同じ秒に何度書き直しても、先の旧稿を消さない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    await save(dir, "　初稿。")
    await save(dir, "　二稿。")
    await save(dir, "　三稿。")
    const kept = drafts(dir).map((f) => readFileSync(join(dir, ".novel", "drafts", f), "utf-8"))
    assert.equal(kept.length, 2)
    assert.ok(kept.some((t) => t.includes("初稿")), "初稿が消えている")
    assert.ok(kept.some((t) => t.includes("二稿")), "二稿が消えている")
  })

  test("内容が前と同じなら旧稿を作らない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    await save(dir, "　初稿。")
    const out = await save(dir, "　初稿。")
    assert.match(out, /前に保存した内容と同じ/)
    assert.deepEqual(drafts(dir), [])
  })

  test("いまの章ファイルを読み込めなければ、書かずに断る", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    // 章ファイルの場所がディレクトリになっている
    mkdirSync(join(dir, ".novel", "chapters", "chapter-001.md"), { recursive: true })
    const out = await save(dir, "　初稿。")
    assert.match(out, /^❌ 第1章は保存していません/)
    assert.deepEqual(drafts(dir), [])
  })

  test("旧稿は章として数えない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    await save(dir, "　初稿。")
    await save(dir, "　二稿です。")
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(status, /chapter-001\.md: 5文字/)
    assert.doesNotMatch(status, /chapter-001-\d{8}/)
  })
})

describe("novel_save_chapter と原稿用紙換算", () => {
  test("config.json に manuscript が無ければ枚数を出さない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    assert.doesNotMatch(await save(dir, "　初稿。"), /原稿用紙/)
  })

  test("config.json に manuscript があれば枚数を添える", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    mkdirSync(join(dir, ".novel"), { recursive: true })
    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ title: "t", genre: "g", manuscript: "20x20" }))
    assert.match(await save(dir, "　初稿。"), /原稿用紙換算: 0\.1枚（20字×20行）/)
  })

  test("novel_status: 指定が無ければ枚数を出さず、引数か config.json で出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "save-"))
    mkdirSync(join(dir, ".novel"), { recursive: true })
    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ title: "t", genre: "g" }))
    await save(dir, "　" + "あ".repeat(30))
    const status = (args: object) => novelStatusExecute(args as any, { directory: dir } as any)
    assert.doesNotMatch(await status({ detailed: true }), /原稿用紙/)
    const out = await status({ detailed: true, manuscript: "20x20" })
    // 文字数は字下げの全角スペースを数えないが、原稿用紙では1マス使う（31マスで2行）
    assert.match(out, /chapter-001\.md: 30文字（原稿用紙 0\.1枚）/)
    assert.match(out, /原稿用紙換算: 1枚（20字×20行、2行。空行は数えない）/)

    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ title: "t", genre: "g", manuscript: "abc" }))
    assert.match(await status({}), /⚠️ config\.json の manuscript/)
  })
})
