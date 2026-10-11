import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { stripChapterHeading, countWords, normalizeChapterTitle } from "./utils.js"
import { novelSaveChapterExecute } from "./tools/save.js"
import { novelStatusExecute } from "./tools/status.js"

/**
 * 章の文字数の数え方のテスト。
 *
 * 保存時（novel_save_chapter）と進行状況（novel_status）で同じ数が出ること。
 * 進行状況は保存済みファイルを読むので、保存ツールが付けた
 * `# 第N章 タイトル` の見出し行が混ざる。見出しを数に入れると、
 * 保存時の報告と食い違い、目標文字数に対する進捗も狂う。
 */

// ============================================================
// タイトルの正規化
// ============================================================

describe("normalizeChapterTitle", () => {
  test("改行を半角空白にまとめる", () => {
    assert.equal(normalizeChapterTitle("雨の駅\n再会"), "雨の駅 再会")
    assert.equal(normalizeChapterTitle("雨の駅\r\n再会"), "雨の駅 再会")
    assert.equal(normalizeChapterTitle("雨の駅\r再会"), "雨の駅 再会")
    assert.equal(normalizeChapterTitle("雨の駅\n\n\n再会"), "雨の駅 再会")
  })

  test("タブと制御文字も半角空白にまとめる", () => {
    assert.equal(normalizeChapterTitle("雨の駅\t再会"), "雨の駅 再会")
    assert.equal(normalizeChapterTitle("雨の駅\v\f再会"), "雨の駅 再会")
  })

  test("全角スペースは残す（日本語のタイトルで正当に使う）", () => {
    assert.equal(normalizeChapterTitle("雨の駅　再会"), "雨の駅　再会")
  })

  test("前後の空白は落とす", () => {
    assert.equal(normalizeChapterTitle("  雨の駅  "), "雨の駅")
    assert.equal(normalizeChapterTitle("　雨の駅　"), "雨の駅")
    assert.equal(normalizeChapterTitle("\n雨の駅\n"), "雨の駅")
  })

  test("半角空白の連続はひとつにまとめる", () => {
    assert.equal(normalizeChapterTitle("雨の駅   再会"), "雨の駅 再会")
  })

  test("1行のタイトルは変えない", () => {
    assert.equal(normalizeChapterTitle("雨の駅"), "雨の駅")
    assert.equal(normalizeChapterTitle("雨の駅「再会」"), "雨の駅「再会」")
  })

  test("空文字列と空白だけなら空になる", () => {
    assert.equal(normalizeChapterTitle(""), "")
    assert.equal(normalizeChapterTitle("   \n　"), "")
  })

  test("直した結果は必ず1行になる", () => {
    for (const title of ["a\nb", "a\r\nb\nc", "\n\n", "a\tb\nc\rd"]) {
      assert.doesNotMatch(normalizeChapterTitle(title), /[\r\n]/, `改行が残っている: ${JSON.stringify(title)}`)
    }
  })
})

// ============================================================
// 見出し行の除去
// ============================================================

describe("stripChapterHeading", () => {
  test("保存ツールが付ける形の見出しを外す", () => {
    assert.equal(stripChapterHeading("# 第1章 題\n\nあいう"), "あいう")
  })

  test("漢数字・全角数字の見出しも外す", () => {
    assert.equal(stripChapterHeading("# 第二章 雨の駅\n\n本文"), "本文")
    assert.equal(stripChapterHeading("# 第１２章 題\n\n本文"), "本文")
    assert.equal(stripChapterHeading("# 第二十三章 題\n\n本文"), "本文")
  })

  test("見出しの装飾や括弧があっても外す", () => {
    assert.equal(stripChapterHeading("# 第1章「雨の駅」\n\n本文"), "本文")
    assert.equal(stripChapterHeading("## 第1章 題\n\n本文"), "本文")
    assert.equal(stripChapterHeading("#第1章題\n\n本文"), "本文")
  })

  test("タイトルがなくても外す", () => {
    assert.equal(stripChapterHeading("# 第1章\n\n本文"), "本文")
  })

  test("CRLF でも外す", () => {
    assert.equal(stripChapterHeading("# 第1章 題\r\n\r\n本文\r\n"), "本文")
  })

  test("見出しの前に空行があっても外す", () => {
    assert.equal(stripChapterHeading("\n\n# 第1章 題\n\n本文"), "本文")
  })

  test("見出しの後ろの空行をまとめて外す", () => {
    assert.equal(stripChapterHeading("# 第1章 題\n\n\n\n本文"), "本文")
  })

  test("章見出しでない見出しは外さない", () => {
    assert.equal(stripChapterHeading("# 雨の降る駅\n\n本文"), "# 雨の降る駅\n\n本文")
    assert.equal(stripChapterHeading("# 序章\n\n本文"), "# 序章\n\n本文")
  })

  test("見出しがなければそのまま返す", () => {
    assert.equal(stripChapterHeading("　本文から始まる原稿。"), "　本文から始まる原稿。")
  })

  test("本文中の章見出しは外さない（先頭の1行だけが対象）", () => {
    const body = "　本文。\n\n# 第2章 次の章\n\n続き。"
    assert.equal(stripChapterHeading(body), body)
  })

  test("見出しを2つ外さない", () => {
    assert.equal(stripChapterHeading("# 第1章 題\n\n# 第1章 題\n\n本文"), "# 第1章 題\n\n本文")
  })

  test("空文字列でも落ちない", () => {
    assert.equal(stripChapterHeading(""), "")
    assert.equal(stripChapterHeading("\n\n"), "")
  })

  test("見出しだけのファイルは空になる", () => {
    assert.equal(stripChapterHeading("# 第1章 題\n"), "")
  })
})

// ============================================================
// 保存時と進行状況の一致
// ============================================================

describe("保存時と進行状況の文字数", () => {
  const CONFIG = JSON.stringify({
    title: "T",
    genre: "現代ドラマ",
    targetWords: 120000,
    chapterCount: 40,
    narrativePerspective: "三人称一元視点",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "writing",
  })

  function project(): string {
    const dir = mkdtempSync(join(tmpdir(), "cw-"))
    const files: Record<string, string> = { "config.json": CONFIG }
    for (const rel of [
      "concept.md", "world-building.md", "characters/profiles.md",
      "outline-brief.md", "outline-detailed.md", "scenes.md",
    ]) {
      files[rel] = "# x\n書き終えた内容。\n"
    }
    for (const [rel, body] of Object.entries(files)) {
      const p = join(dir, ".novel", rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body, "utf-8")
    }
    return dir
  }

  const numbers = (text: string) =>
    [...text.matchAll(/([\d,]+)文字/g)].map((m) => parseInt(m[1].replace(/,/g, ""), 10))

  test("同じ数になる", async () => {
    const dir = project()
    const save = await novelSaveChapterExecute(
      { chapterNumber: 1, title: "題", content: "あいう" } as any,
      { directory: dir } as any,
    )
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)

    assert.match(save, /文字数: 3文字/, `保存時が本文の文字数になっていない: ${save}`)
    assert.match(status, /chapter-001\.md: 3文字/, `進行状況が見出しを数に入れている: ${status}`)
  })

  test("長いタイトルでもずれない", async () => {
    const dir = project()
    const title = "雨の降る駅で待っていた人のこと"
    const content = "　放課後の職員室は乾いた匂いがした。"
    await novelSaveChapterExecute(
      { chapterNumber: 1, title, content } as any,
      { directory: dir } as any,
    )
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    const expected = countWords(content)
    assert.match(status, new RegExp(`chapter-001\\.md: ${expected}文字`))
  })

  test("累計と1章平均も本文だけで数える", async () => {
    const dir = project()
    await novelSaveChapterExecute(
      { chapterNumber: 1, title: "一", content: "あいうえお" } as any,
      { directory: dir } as any,
    )
    await novelSaveChapterExecute(
      { chapterNumber: 2, title: "二", content: "かきくけこさ" } as any,
      { directory: dir } as any,
    )
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(status, /累計: 11文字/, `累計が見出しを数に入れている: ${status}`)
    assert.match(status, /1章平均: 6文字/)
  })

  test("本文に見出しが混ざって渡されても二重にならない", async () => {
    // コマンドと skill は「章見出しの行は含めない」と案内しているが、
    // 混ざって渡された場合でもファイルと数が壊れないようにする
    const dir = project()
    const save = await novelSaveChapterExecute(
      { chapterNumber: 3, title: "題", content: "# 第3章 題\n\nあいう" } as any,
      { directory: dir } as any,
    )
    const file = readFileSync(join(dir, ".novel", "chapters", "chapter-003.md"), "utf-8")
    assert.equal((file.match(/^#\s*第/gm) ?? []).length, 1, `見出しが重なっている: ${JSON.stringify(file)}`)
    assert.match(save, /文字数: 3文字/)
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(status, /chapter-003\.md: 3文字/)
  })

  test("タイトルに改行が入っていてもずれない", async () => {
    // 改行をそのまま見出しに埋めると2行以上になり、2行目以降が本文として
    // 数えられていた（保存 3 文字・進行状況 5 文字）
    const dir = project()
    const save = await novelSaveChapterExecute(
      { chapterNumber: 1, title: "雨の駅\n再会", content: "あいう" } as any,
      { directory: dir } as any,
    )
    const file = readFileSync(join(dir, ".novel", "chapters", "chapter-001.md"), "utf-8")
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)

    assert.equal(file.split("\n")[0], "# 第1章 雨の駅 再会", "見出しが1行になっていない")
    assert.match(save, /文字数: 3文字/)
    assert.match(status, /chapter-001\.md: 3文字/, "見出しの2行目が本文として数えられている")
    assert.match(save, /1行に直しました/, "直したことが書き手に伝わらない")
  })

  test("タイトルの全角スペースは保たれる", async () => {
    const dir = project()
    await novelSaveChapterExecute(
      { chapterNumber: 1, title: "雨の駅　再会", content: "あいう" } as any,
      { directory: dir } as any,
    )
    const file = readFileSync(join(dir, ".novel", "chapters", "chapter-001.md"), "utf-8")
    assert.equal(file.split("\n")[0], "# 第1章 雨の駅　再会")
  })

  test("タイトルが空白だけなら見出しに余計な空白を残さない", async () => {
    const dir = project()
    const save = await novelSaveChapterExecute(
      { chapterNumber: 1, title: "   ", content: "あいう" } as any,
      { directory: dir } as any,
    )
    const file = readFileSync(join(dir, ".novel", "chapters", "chapter-001.md"), "utf-8")
    assert.equal(file.split("\n")[0], "# 第1章")
    assert.match(save, /第1章を保存しました/)
    // 見出しは外せるので文字数は本文だけ
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(status, /chapter-001\.md: 3文字/)
  })

  test("手で書いた見出しなしのファイルも数える", async () => {
    const dir = project()
    const p = join(dir, ".novel", "chapters", "chapter-001.md")
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, "　見出しのない原稿。", "utf-8")
    const status = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(status, /chapter-001\.md: 9文字/)
  })
})
