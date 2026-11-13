import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { novelExportExecute } from "../src/tools/export.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { parsePublishInfo, publishIssues, describePublishInfo, publishLength } from "../src/publish.js"

/**
 * 投稿支援のテスト。
 *
 *   - 章の単位の呼び名（「第1話」）と、1話ずつの書き出し（novel_export の unit / split）
 *   - 投稿用の情報（.novel/publish.md）の読み取りと、キャッチコピーの文字数・タグの数の点検
 */

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-publish-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const config = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "荷物持ちの底なし鞄",
    genre: "異世界ファンタジー",
    targetWords: 120000,
    chapterCount: 40,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "writing",
    ...extra,
  })

const CHAPTERS = {
  "chapters/prologue.md": "# プロローグ 成人の儀\n\n　十五年待った。\n",
  "chapters/chapter-001.md": "# 第1章 追放\n\n　｜背負子《しょいこ》が軽い。\n「出ていけ」\n",
  "chapters/chapter-002.md": "# 第2章 底なし\n\n　岩を入れた。変わらない。\n",
  "chapters/interlude-002-1.md": "# 幕間 掲示板\n\n1：名無しの探索者\n　マジで？\n",
}

const ctx = (dir: string) => ({ directory: dir }) as any
const read = (dir: string, ...rel: string[]) => readFileSync(join(dir, ...rel), "utf-8")

describe("章の単位の呼び名（unit / chapterUnit）", () => {
  test("既定は「第一章」のまま", async () => {
    const dir = makeProject({ "config.json": config(), ...CHAPTERS })
    await novelExportExecute({}, ctx(dir))
    const out = read(dir, ".novel", "export", "荷物持ちの底なし鞄.txt")
    assert.match(out, /^第一章　追放$/m)
    assert.doesNotMatch(out, /話　/)
  })

  test("config.json の chapterUnit が「話」なら「第1話」になり、数字の既定は算用数字", async () => {
    const dir = makeProject({ "config.json": config({ chapterUnit: "話" }), ...CHAPTERS })
    await novelExportExecute({}, ctx(dir))
    const out = read(dir, ".novel", "export", "荷物持ちの底なし鞄.txt")
    assert.match(out, /^第1話　追放$/m)
    assert.match(out, /^第2話　底なし$/m)
    // 節の呼び名は変わらない
    assert.match(out, /^プロローグ　成人の儀$/m)
    assert.match(out, /^幕間　掲示板$/m)
  })

  test("引数の unit が config より優先。numerals を渡せば漢数字にもできる", async () => {
    const dir = makeProject({ "config.json": config({ chapterUnit: "話" }), ...CHAPTERS })
    await novelExportExecute({ unit: "章" }, ctx(dir))
    assert.match(read(dir, ".novel", "export", "荷物持ちの底なし鞄.txt"), /^第一章　追放$/m)
    await novelExportExecute({ unit: "話", numerals: "kanji", format: "markdown" }, ctx(dir))
    assert.match(read(dir, ".novel", "export", "荷物持ちの底なし鞄.md"), /^## 第一話 追放$/m)
  })

  test("読めない単位は、書き出さずに断る", async () => {
    const dir = makeProject({ "config.json": config({ chapterUnit: "回" }), ...CHAPTERS })
    const report = await novelExportExecute({}, ctx(dir))
    assert.match(report, /❌ 章の単位（config\.json の chapterUnit）は「章」か「話」/)
    assert.ok(!existsSync(join(dir, ".novel", "export")))
  })
})

describe("1話ずつの書き出し（split）", () => {
  test("本文だけのファイルを読む順番の数だけ作り、題と文字数を index に並べる", async () => {
    const dir = makeProject({
      "config.json": config({ chapterUnit: "話", parts: [{ title: "追放", fromChapter: 1 }] }),
      ...CHAPTERS,
    })
    const report = await novelExportExecute({ split: true }, ctx(dir))
    assert.match(report, /✅ 原稿を書き出しました（テキスト・1話ずつ）/)
    const out = join(dir, ".novel", "export", "episodes")
    assert.deepEqual(readdirSync(out).sort(), [
      "chapter-001.txt", "chapter-002.txt", "index.txt", "interlude-002-1.txt", "prologue.txt",
    ])
    // 本文だけ。見出しは付けず、ルビは既定（カクヨムの記法）のまま
    assert.equal(read(out, "chapter-001.txt"), "　｜背負子《しょいこ》が軽い。\n「出ていけ」\n")
    assert.equal(
      read(out, "index.txt"),
      [
        "荷物持ちの底なし鞄",
        "",
        "prologue.txt　プロローグ　成人の儀（7文字）",
        "",
        "■ 第1部　追放",
        "chapter-001.txt　第1話　追放（13文字）",
        "chapter-002.txt　第2話　底なし（12文字）",
        "interlude-002-1.txt　幕間　掲示板（13文字）",
        "",
      ].join("\n"),
    )
  })

  test("範囲とルビの記法の指定が効く。書き出し直すと同じファイルに上書きする", async () => {
    const dir = makeProject({ "config.json": config(), ...CHAPTERS })
    await novelExportExecute({ split: true, fromChapter: 1, toChapter: 1, ruby: "none", outputPath: "out/ep" }, ctx(dir))
    assert.deepEqual(readdirSync(join(dir, "out", "ep")).sort(), ["chapter-001.txt", "index.txt", "prologue.txt"])
    assert.match(read(dir, "out", "ep", "chapter-001.txt"), /^　背負子が軽い。$/m)
    await novelExportExecute({ split: true, fromChapter: 1, toChapter: 1, outputPath: "out/ep" }, ctx(dir))
    assert.deepEqual(readdirSync(join(dir, "out", "ep")).sort(), ["chapter-001.txt", "index.txt", "prologue.txt"])
    assert.match(read(dir, "out", "ep", "chapter-001.txt"), /｜背負子《しょいこ》/)
  })

  test("章ファイルのディレクトリ・作品の外・ファイルを書き出し先にすると、何も書かずに断る", async () => {
    const dir = makeProject({ "config.json": config(), ...CHAPTERS, "notes.txt": "メモ" })
    assert.match(await novelExportExecute({ split: true, outputPath: ".novel/chapters" }, ctx(dir)), /❌ \.novel\/chapters\/ には書き出せません/)
    assert.match(await novelExportExecute({ split: true, outputPath: "../outside" }, ctx(dir)), /❌ 書き出し先は作品のディレクトリの中/)
    assert.match(await novelExportExecute({ split: true, outputPath: ".novel/notes.txt" }, ctx(dir)), /❌ 1話ずつ書き出すときの書き出し先はディレクトリ/)
    assert.deepEqual(readdirSync(join(dir, ".novel", "chapters")).sort(), Object.keys(CHAPTERS).map((k) => k.slice("chapters/".length)).sort())
  })

  test("書き出し先のファイルがリンクなら、1つも書かずに断る", async () => {
    const dir = makeProject({ "config.json": config(), ...CHAPTERS })
    const out = join(dir, "ep")
    mkdirSync(out)
    symlinkSync(join(dir, ".novel", "chapters", "chapter-002.md"), join(out, "chapter-002.txt"))
    const report = await novelExportExecute({ split: true, outputPath: "ep" }, ctx(dir))
    assert.match(report, /❌ 書き出し先がシンボリックリンクです/)
    assert.deepEqual(readdirSync(out), ["chapter-002.txt"])
    assert.match(read(dir, ".novel", "chapters", "chapter-002.md"), /^# 第2章 底なし/)
  })
})

describe("投稿用の情報（publish.md）", () => {
  const PUBLISH = `# 『荷物持ちの底なし鞄』投稿用の情報

## 投稿先
カクヨム

## 題
荷物持ちの底なし鞄

### 候補
- 追放された荷物持ち、鞄が底なしだった

## キャッチコピー
> 1行で書く
その鞄、どこまで入るんですか？

## 紹介文
追放された。

## タグ
- 異世界ファンタジー
- 追放
- #成り上がり
`

  test("キャッチコピーは節の最初の1行、タグは箇条書きから読む", () => {
    const info = parsePublishInfo(PUBLISH)
    assert.equal(info.site, "カクヨム")
    assert.equal(info.catchphrase, "その鞄、どこまで入るんですか？")
    assert.deepEqual(info.tags, ["異世界ファンタジー", "追放", "成り上がり"])
    assert.equal(publishLength(info.catchphrase!), 15)
    assert.equal(describePublishInfo(info), "カクヨム／キャッチコピー 15文字／タグ 3個")
    assert.deepEqual(publishIssues(info), [])
  })

  test("タグは読点区切りの1行でも読み、重なりは1つにする。雛形のままの行は読まない", () => {
    const info = parsePublishInfo("## キャッチコピー\n[1行で]\n\n## タグ\n追放、成り上がり, 追放　スローライフ\n")
    assert.equal(info.catchphrase, null)
    assert.deepEqual(info.tags, ["追放", "成り上がり", "スローライフ"])
  })

  test("カクヨムの上限（35文字・8個）を超えたら知らせる。ほかの投稿先では知らせない", () => {
    const long = "あ".repeat(36)
    const tags = Array.from({ length: 9 }, (_, i) => `- タグ${i + 1}`).join("\n")
    const over = `## 投稿先\nカクヨム\n\n## キャッチコピー（35文字以内）\n${long}\n\n## タグ\n${tags}\n`
    assert.deepEqual(publishIssues(parsePublishInfo(over)).map((x) => x.split("（")[0]), [
      "キャッチコピーが36文字あります", "タグが9個あります",
    ])
    assert.deepEqual(publishIssues(parsePublishInfo(over.replace("カクヨム", "pixiv"))), [])
    // ちょうど上限なら知らせない
    assert.deepEqual(publishIssues(parsePublishInfo(`## 投稿先\nカクヨム\n\n## キャッチコピー\n${"あ".repeat(35)}\n`)), [])
  })

  test("進行状況に数を出し、超えていれば記録の点検で知らせる。publish.md が無ければ何も出さない", async () => {
    const none = makeProject({ "config.json": config() })
    assert.doesNotMatch(await novelStatusExecute({}, ctx(none)), /投稿用の情報|キャッチコピー/)
    const ok = makeProject({ "config.json": config(), "publish.md": PUBLISH })
    const status = await novelStatusExecute({}, ctx(ok))
    assert.match(status, /📣 投稿用の情報: カクヨム／キャッチコピー 15文字／タグ 3個/)
    assert.doesNotMatch(status, /キャッチコピーが/)
    const over = makeProject({ "config.json": config(), "publish.md": PUBLISH.replace("その鞄、どこまで入るんですか？", "あ".repeat(40)) })
    assert.match(await novelStatusExecute({}, ctx(over)), /⚠️ キャッチコピーが40文字あります（カクヨムは35文字まで。5文字削る/)
  })

  test("/novel-publish の雛形は、そのまま読める形になっている", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const command = readFileSync(join(here, "..", "commands", "novel-publish.md"), "utf-8")
    const form = command.match(/```markdown\n([\s\S]*?)```/)![1]
    const filled = form.replace("{1行。括弧や引用符で囲まない}", "その鞄、どこまで入るんですか？")
    const info = parsePublishInfo(filled)
    assert.equal(info.site, "カクヨム")
    assert.equal(info.catchphrase, "その鞄、どこまで入るんですか？")
    assert.equal(info.tags.length, 1)
  })
})
