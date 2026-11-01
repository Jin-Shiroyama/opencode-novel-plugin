import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelInitExecute } from "../src/tools/init.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { novelContextExecute } from "../src/tools/context.js"
import { novelCheckExecute } from "../src/tools/check.js"
import { novelSaveChapterExecute } from "../src/tools/save.js"

/**
 * 文体の寄せ方（config.json の style）のテスト。
 *
 * 既定はライトノベル寄りで、単位付きの数やステータスに算用数字を使う。
 * 文芸寄り（"literary"）のときだけ、地の文の算用数字を確認として拾う。
 */

const ctx = (dir: string) => ({ directory: dir }) as any

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-style-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const config = (style?: string) =>
  JSON.stringify({
    title: "迷宮の街", genre: "異世界ファンタジー", targetWords: 9000, chapterCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentPhase: "writing",
    ...(style ? { style } : {}),
  })

const BODY = "# 第1章 入口\n\n　HP 1200のスライムが、3メートル先にいた。\n"

describe("novel_init(style)", () => {
  test("省けば書かず（ライトノベル寄り）、literary なら残す", async () => {
    const light = mkdtempSync(join(tmpdir(), "novel-style-"))
    const out = await novelInitExecute({ title: "迷宮の街", genre: "異世界ファンタジー" } as any, ctx(light))
    assert.equal(JSON.parse(readFileSync(join(light, ".novel", "config.json"), "utf-8")).style, undefined)
    assert.match(out, /文体: ライトノベル寄り/)
    const lit = mkdtempSync(join(tmpdir(), "novel-style-"))
    await novelInitExecute({ title: "月下の剣", genre: "時代小説", style: "literary" } as any, ctx(lit))
    assert.equal(JSON.parse(readFileSync(join(lit, ".novel", "config.json"), "utf-8")).style, "literary")
  })
})

describe("文体と表記の点検", () => {
  test("novel_check は文体に合わせて地の文の算用数字を拾う", async () => {
    const light = await novelCheckExecute({ chapterNumber: 1 }, ctx(makeProject({ "config.json": config(), "chapters/chapter-001.md": BODY })))
    assert.doesNotMatch(light, /地の文の算用数字/)
    const lit = await novelCheckExecute({ chapterNumber: 1 }, ctx(makeProject({ "config.json": config("literary"), "chapters/chapter-001.md": BODY })))
    assert.match(lit, /地の文の算用数字/)
  })

  test("保存の報告も同じ", async () => {
    const save = (dir: string) =>
      novelSaveChapterExecute({ chapterNumber: 1, title: "入口", content: "　HP 1200のスライムが、3メートル先にいた。" } as any, ctx(dir))
    assert.match(await save(makeProject({ "config.json": config() })), /📝 表記: 規約から外れた箇所はありません/)
    assert.match(await save(makeProject({ "config.json": config("literary") })), /地の文の算用数字/)
  })
})

describe("文体の表示", () => {
  test("進行状況と執筆用の資料に文体を出す", async () => {
    const dir = makeProject({ "config.json": config("literary") })
    assert.match(await novelStatusExecute({}, ctx(dir)), /✒️ 文体: 文芸寄り/)
    const out = await novelContextExecute({ chapterNumber: 1 } as any, ctx(makeProject({ "config.json": config() })))
    assert.match(out, /- 文体: ライトノベル寄り/)
    assert.match(out, /同じ場面の中で視点人物を入れ替えない/)
  })
})
