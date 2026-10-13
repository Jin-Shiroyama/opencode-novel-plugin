import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelCheckExecute } from "./check.js"
import { novelExportExecute } from "./export.js"
import { novelSaveChapterExecute } from "./save.js"

/**
 * novel_check / novel_export と、保存時の表記の報告の結合テスト。
 */

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-check-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const CONFIG = JSON.stringify({ title: "勇者の冒険", genre: "異世界ファンタジー", chapterCount: 3 })
const GOOD = "# 第1章 畑の花\n\n　露が重かった。\n\n「行こう」\n"
const BAD = "# 第2章 志願\n\n　待って…\n\n「行こう。」\n"
const ctx = (dir: string) => ({ directory: dir }) as never

describe("novel_check", () => {
  test("問題が無ければそう返す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD })
    assert.match(await novelCheckExecute({}, ctx(dir)), /^✅ 表記の点検（1章）/)
  })

  test("規則ごとの件数と、章ごとの箇所を返す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD, "chapters/chapter-002.md": BAD })
    const out = await novelCheckExecute({}, ctx(dir))
    assert.match(out, /規約違反 2件/)
    assert.match(out, /❌ 三点リーダ: 1件/)
    assert.match(out, /❌ 会話文末の句点: 1件/)
    assert.match(out, /## 第2章（2件）/)
    assert.doesNotMatch(out, /## 第1章/)
    assert.match(out, /3行5字目/)
  })

  test("章を指定でき、無い章はそう返す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD, "chapters/chapter-002.md": BAD })
    assert.match(await novelCheckExecute({ chapterNumber: 1 }, ctx(dir)), /^✅ 表記の点検（第1章）/)
    assert.match(await novelCheckExecute({ chapterNumber: 9 }, ctx(dir)), /^❌ 第9章の本文が見つかりません/)
  })

  test("読めない章は「問題なし」にせず、点検できなかったと示す", async () => {
    // chapter-002.md をディレクトリにして、読み込みに失敗させる（権限に頼らない）
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD })
    mkdirSync(join(dir, ".novel", "chapters", "chapter-002.md"))
    const one = await novelCheckExecute({ chapterNumber: 2 }, ctx(dir))
    assert.match(one, /^❌ 点検できる章がありません/)
    assert.match(one, /読み込めず点検できなかった章: 第2章/)
    const all = await novelCheckExecute({}, ctx(dir))
    assert.match(all, /^⚠️ 表記の点検（1章）/)
    assert.match(all, /読み込めず点検できなかった章: 第2章/)
  })

  test("並べる箇所は上限で切るが、件数はすべて数える", async () => {
    const many = "# 第1章\n\n" + Array.from({ length: 5 }, () => "「行こう。」").join("\n")
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": many })
    const out = await novelCheckExecute({ maxIssues: 2 }, ctx(dir))
    assert.match(out, /会話文末の句点: 5件/)
    assert.match(out, /…ほか3件/)
  })
})

describe("novel_save_chapter の表記の報告", () => {
  test("保存したものを点検し、件数と最初の箇所を添える", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const out = await novelSaveChapterExecute(
      { chapterNumber: 2, title: "志願", content: "　待って…\n\n「行こう。」" },
      ctx(dir),
    )
    assert.match(out, /📝 表記: ❌ 規約違反 2件/)
    assert.match(out, /3行5字目/) // 見出しの行を含めた、保存ファイルの行番号
    assert.match(out, /novel_check\(chapterNumber: 2\)/)
  })

  test("問題が無ければ一行で済ませる", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const out = await novelSaveChapterExecute({ chapterNumber: 1, title: "畑", content: "　露が重かった。" }, ctx(dir))
    assert.match(out, /📝 表記: 規約から外れた箇所はありません/)
  })
})

describe("novel_export", () => {
  const files = {
    "config.json": CONFIG,
    "chapters/chapter-001.md": GOOD,
    "chapters/chapter-003.md": "# 第3章\n\n　帰った。\n",
    "chapters/chapter-010.md": "# 第10章 門の水\n\n　冷たかった。\n",
  }

  test("text: 漢数字の見出しで繋ぎ、Markdown の記号を残さない", async () => {
    const dir = makeProject(files)
    const out = await novelExportExecute({}, ctx(dir))
    const path = join(dir, ".novel", "export", "勇者の冒険.txt")
    const text = readFileSync(path, "utf-8")
    assert.ok(text.startsWith("勇者の冒険\n\n\n第一章　畑の花\n\n　露が重かった。"))
    assert.match(text, /第三章\n\n　帰った。/)
    assert.match(text, /第十章　門の水/)
    assert.doesNotMatch(text, /^#/m)
    assert.match(out, /第1章、第3章、第10章（3章）/)
    assert.match(out, /本文の無い章を飛ばしました: 第2章、第4〜9章/)
  })

  test("markdown: 作品タイトルを #、章を ## にし、既定は算用数字", async () => {
    const dir = makeProject(files)
    await novelExportExecute({ format: "markdown", toChapter: 3 }, ctx(dir))
    const text = readFileSync(join(dir, ".novel", "export", "勇者の冒険.md"), "utf-8")
    assert.ok(text.startsWith("# 勇者の冒険\n\n## 第1章 畑の花\n\n"))
    assert.match(text, /## 第3章\n\n　帰った。/)
    assert.doesNotMatch(text, /第10章/)
  })

  test("本文は書き換えず、規約違反の件数を知らせる", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-002.md": BAD })
    const out = await novelExportExecute({}, ctx(dir))
    assert.match(out, /表記の規約違反が 2件/)
    const text = readFileSync(join(dir, ".novel", "export", "勇者の冒険.txt"), "utf-8")
    assert.match(text, /「行こう。」/)
  })

  test("書き出し先は作品のディレクトリの中に限り、章ファイルの場所には書かない", async () => {
    const dir = makeProject(files)
    assert.match(await novelExportExecute({ outputPath: "../outside.txt" }, ctx(dir)), /^❌/)
    assert.match(await novelExportExecute({ outputPath: "/tmp/outside.txt" }, ctx(dir)), /^❌/)
    assert.match(await novelExportExecute({ outputPath: ".novel/chapters/all.md" }, ctx(dir)), /^❌/)
    const ok = await novelExportExecute({ outputPath: "out/原稿.txt" }, ctx(dir))
    assert.match(ok, /^✅/)
    assert.ok(existsSync(join(dir, "out", "原稿.txt")))
  })

  test("読めない章があれば、何も書き出さずに断る", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD })
    mkdirSync(join(dir, ".novel", "chapters", "chapter-002.md"))
    const out = await novelExportExecute({}, ctx(dir))
    assert.match(out, /^❌ 読み込めない章があるため、書き出していません: 第2章/)
    assert.equal(existsSync(join(dir, ".novel", "export", "勇者の冒険.txt")), false)
  })

  test("toChapter を明示したら、範囲の末尾の欠けも知らせる", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD })
    const out = await novelExportExecute({ fromChapter: 1, toChapter: 3 }, ctx(dir))
    assert.match(out, /本文の無い章を飛ばしました: 第2〜3章/)
  })

  test("シンボリックリンクを経由して、章ファイルや作品の外へは書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "chapters/chapter-001.md": GOOD })
    const chapter = join(dir, ".novel", "chapters", "chapter-001.md")
    const outside = mkdtempSync(join(tmpdir(), "novel-outside-"))

    // 書き出し先そのものがリンク（章ファイルを指す）
    symlinkSync(chapter, join(dir, "alias.txt"))
    assert.match(await novelExportExecute({ outputPath: "alias.txt" }, ctx(dir)), /^❌ 書き出し先がシンボリックリンク/)
    assert.equal(readFileSync(chapter, "utf-8"), GOOD)

    // 親ディレクトリがリンク（章ディレクトリ・作品の外を指す）
    symlinkSync(join(dir, ".novel", "chapters"), join(dir, "chapters-link"))
    assert.match(await novelExportExecute({ outputPath: "chapters-link/all.txt" }, ctx(dir)), /^❌ \.novel\/chapters\/ には/)
    symlinkSync(outside, join(dir, "outside-link"))
    assert.match(await novelExportExecute({ outputPath: "outside-link/all.txt" }, ctx(dir)), /^❌ 書き出し先は作品のディレクトリの中/)
    assert.equal(existsSync(join(outside, "all.txt")), false)

    // まだ無いディレクトリの下は、存在する祖先の実体で判定して書ける
    assert.match(await novelExportExecute({ outputPath: "out/new/原稿.txt" }, ctx(dir)), /^✅/)
  })

  test("範囲が逆さま、または章が無ければ断る", async () => {
    const dir = makeProject(files)
    assert.match(await novelExportExecute({ fromChapter: 5, toChapter: 2 }, ctx(dir)), /^❌/)
    assert.match(await novelExportExecute({ fromChapter: 4, toChapter: 9 }, ctx(dir)), /^❌ 書き出す章がありません/)
  })
})
