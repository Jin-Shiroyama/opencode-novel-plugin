import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import {
  sectionFromFileName, sectionFileName, sectionLabel, parseSectionLabel, compareSections, recordChapterOf,
  sectionFromArgs, previousManuscriptFile, listManuscriptFiles, parseParts, partOfChapter,
} from "../src/sections.js"
import type { ManuscriptSection } from "../src/sections.js"
import { parseChapterNumber, stripChapterHeading, chapterTitleFromHeading, determinePhase } from "../src/utils.js"
import { novelSaveChapterExecute } from "../src/tools/save.js"
import { novelStatusExecute } from "../src/tools/status.js"
import { novelCheckExecute } from "../src/tools/check.js"
import { novelExportExecute } from "../src/tools/export.js"
import { novelContextExecute } from "../src/tools/context.js"
import {
  parseForeshadowUpdates, parseCharacterUpdates, upsertSummarySections, summarySections, summaryChapters,
  parseSummaryInput, buildSummaryContext,
} from "../src/records.js"
import { novelUpdateExecute } from "../src/tools/track.js"

/**
 * 本文の節（プロローグ・幕間・エピローグ）のテスト。
 *
 * 節は章の数に入れず、原稿全体を扱うところ（累計・点検・書き出し・前の本文の末尾）でだけ
 * 読む順番に並べて扱う。
 */

const PROLOGUE: ManuscriptSection = { kind: "prologue" }
const EPILOGUE: ManuscriptSection = { kind: "epilogue" }
const ch = (chapter: number): ManuscriptSection => ({ kind: "chapter", chapter })
const il = (chapter: number, index = 1): ManuscriptSection => ({ kind: "interlude", chapter, index })

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-sections-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const CONFIG = JSON.stringify({
  title: "雨の駅",
  genre: "現代ドラマ",
  targetWords: 12000,
  chapterCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  currentPhase: "writing",
})

const ctx = (dir: string) => ({ directory: dir }) as any

describe("節のファイル名", () => {
  test("読み書きが往復する", () => {
    for (const s of [PROLOGUE, EPILOGUE, ch(5), il(5), il(12, 2)]) {
      assert.deepEqual(sectionFromFileName(sectionFileName(s)), s)
    }
    assert.equal(sectionFileName(il(5, 2)), "interlude-005-2.md")
  })

  test("正式な名前でなければ節とみなさない", () => {
    for (const name of ["backup-prologue.md", "prologue.md.bak", "interlude-5.md", "interlude-000-1.md", "interlude-005-0.md", "Prologue.md"]) {
      assert.equal(sectionFromFileName(name), null, name)
    }
  })
})

describe("読む順番と呼び名", () => {
  test("プロローグ → 章 → その章のあとの幕間 → 次の章 → エピローグ", () => {
    const sorted = [EPILOGUE, ch(2), il(1, 2), ch(1), il(1), PROLOGUE].sort(compareSections)
    assert.deepEqual(sorted.map(sectionLabel), [
      "プロローグ", "第1章", "幕間（第1章のあと）", "幕間（第1章のあと・2）", "第2章", "エピローグ",
    ])
  })

  test("呼び名を読み戻せる（漢数字も読む）", () => {
    for (const s of [PROLOGUE, EPILOGUE, il(5), il(5, 3)]) {
      assert.deepEqual(parseSectionLabel(sectionLabel(s) + " 題", parseChapterNumber), s)
    }
    assert.deepEqual(parseSectionLabel("幕間（第五章のあと）", parseChapterNumber), il(5))
    // 位置の無い幕間は、どこに置くか決められないので読まない
    assert.equal(parseSectionLabel("幕間", parseChapterNumber), null)
    assert.equal(parseSectionLabel("プロローグ的な話", parseChapterNumber), null)
  })

  test("記録の章番号: プロローグは 0、幕間は直前の章、エピローグは渡した最後の章", () => {
    assert.equal(recordChapterOf(PROLOGUE, 40), 0)
    assert.equal(recordChapterOf(il(5, 2), 40), 5)
    assert.equal(recordChapterOf(EPILOGUE, 40), 40)
    assert.equal(recordChapterOf(ch(7), 40), 7)
  })

  test("引数から節を決める", () => {
    assert.deepEqual(sectionFromArgs({ chapterNumber: 3 }), { section: ch(3) })
    assert.deepEqual(sectionFromArgs({ section: "prologue" }), { section: PROLOGUE })
    assert.deepEqual(sectionFromArgs({ section: "interlude", chapterNumber: 3, interludeIndex: 2 }), { section: il(3, 2) })
    assert.ok("error" in sectionFromArgs({}))
    assert.ok("error" in sectionFromArgs({ section: "interlude" }))
    assert.ok("error" in sectionFromArgs({ chapterNumber: 3, interludeIndex: 2 }))
    assert.ok("error" in sectionFromArgs({ chapterNumber: 1.5 }))
  })

  test("前の本文: 間の本文が欠けていれば選ばない", () => {
    const files = [PROLOGUE, ch(1), il(1), il(1, 2), ch(3)].map((section) => ({ section, path: "" }))
    const prev = (s: ManuscriptSection) => {
      const f = previousManuscriptFile(files, s)
      return f ? sectionLabel(f.section) : null
    }
    assert.equal(prev(ch(1)), "プロローグ")
    assert.equal(prev(ch(2)), "幕間（第1章のあと・2）")
    assert.equal(prev(il(1, 2)), "幕間（第1章のあと）")
    assert.equal(prev(ch(4)), "第3章")
    assert.equal(prev(ch(5)), null)
    assert.equal(prev(il(2)), null)
    assert.equal(prev(EPILOGUE), "第3章")
    assert.equal(prev(PROLOGUE), null)
  })
})

describe("節の見出し", () => {
  test("見出しを外して数え、タイトルを読む", () => {
    assert.equal(stripChapterHeading("# プロローグ 雨\n\n　本文。"), "　本文。")
    assert.equal(stripChapterHeading("# 幕間\n\n　本文。"), "　本文。")
    assert.equal(chapterTitleFromHeading("# エピローグ 晴れ\n\n本文"), "晴れ")
    assert.equal(chapterTitleFromHeading("# 幕間 遠い町\n\n本文"), "遠い町")
    // 「プロローグ」で始まる別の見出しは外さない
    assert.equal(stripChapterHeading("# プロローグ的なもの\n\n本文"), "# プロローグ的なもの\n\n本文")
  })
})

describe("novel_save_chapter と節", () => {
  test("プロローグと幕間を保存する", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const out = await novelSaveChapterExecute({ section: "prologue", title: "雨", content: "　降っていた。" }, ctx(dir))
    assert.match(out, /✅ プロローグ「雨」を保存しました/)
    assert.equal(readFileSync(join(dir, ".novel", "chapters", "prologue.md"), "utf-8"), "# プロローグ 雨\n\n　降っていた。")

    const il2 = await novelSaveChapterExecute(
      { section: "interlude", chapterNumber: 2, interludeIndex: 2, title: "", content: "　遠くで。" },
      ctx(dir),
    )
    assert.match(il2, /✅ 幕間（第2章のあと・2）を保存しました/)
    assert.match(il2, /⚠️ 第2章の本文はまだありません/)
    assert.equal(readFileSync(join(dir, ".novel", "chapters", "interlude-002-2.md"), "utf-8"), "# 幕間\n\n　遠くで。")
  })

  test("章と幕間で章番号が無ければ断り、何も書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    assert.match(await novelSaveChapterExecute({ title: "t", content: "x" }, ctx(dir)), /^❌ 保存していません/)
    assert.match(
      await novelSaveChapterExecute({ section: "interlude", title: "t", content: "x" }, ctx(dir)),
      /^❌ 保存していません。幕間を置く位置/,
    )
    assert.throws(() => readdirSync(join(dir, ".novel", "chapters")))
  })

  test("節を書き直すと旧稿を残す", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    await novelSaveChapterExecute({ section: "epilogue", title: "", content: "　初稿。" }, ctx(dir))
    const out = await novelSaveChapterExecute({ section: "epilogue", title: "", content: "　二稿。" }, ctx(dir))
    assert.match(out, /drafts[\\/]epilogue-\d{8}-\d{6}\.md/)
  })

  test("表記の点検の案内は節を指す", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const out = await novelSaveChapterExecute({ section: "interlude", chapterNumber: 1, title: "", content: "　あ!" }, ctx(dir))
    assert.match(out, /novel_check\(section: "interlude", chapterNumber: 1\)/)
  })
})

/** プロローグ・第1〜2章・第1章のあとの幕間2つ・エピローグのある作品 */
function sampleProject(): string {
  return makeProject({
    "config.json": CONFIG,
    "chapters/prologue.md": "# プロローグ 雨\n\n　雨が降っていた。\n",
    "chapters/chapter-001.md": "# 第1章 駅\n\n　駅に着いた。\n",
    "chapters/interlude-001-1.md": "# 幕間 町\n\n　町は眠る。\n",
    "chapters/interlude-001-2.md": "# 幕間\n\n　犬が吠える。\n",
    "chapters/chapter-002.md": "# 第2章 傘\n\n　傘を忘れた。\n",
    "chapters/epilogue.md": "# エピローグ 晴れ\n\n　晴れた。\n",
    "chapters/メモ.md": "推敲の覚え書き\n",
  })
}

describe("novel_status と節", () => {
  test("節は章の数・平均・工程に入らず、累計には入る", async () => {
    const dir = sampleProject()
    const out = await novelStatusExecute({ detailed: true }, ctx(dir))
    assert.match(out, /✍️ 執筆済み: 2章（ほかにプロローグ・幕間2・エピローグ）/)
    // 累計は 8+6+5+6+6+4 = 35。平均は章だけ（6+6）/2
    assert.match(out, /📊 累計: 35文字 \/ 12,000文字 \(0%\)（プロローグ・幕間2・エピローグを含む）/)
    assert.match(out, /📐 1章平均: 6文字/)
    // detailed は読む順番
    const order = ["prologue.md", "chapter-001.md", "interlude-001-1.md", "interlude-001-2.md", "chapter-002.md", "epilogue.md"]
    const positions = order.map((f) => out.indexOf(`📄 ${f}`))
    assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), out)
    assert.match(out, /interlude-001-2\.md（幕間（第1章のあと・2））: 6文字/)
    // 本文以外のファイルとして挙げるのはメモだけ
    assert.match(out, /本文以外のファイルは数えていません: メモ\.md\n/)
    assert.notEqual(determinePhase(dir, JSON.parse(CONFIG)), "completed")
  })
})

describe("novel_check と節", () => {
  test("省くと章と節をすべて点検し、節だけも指せる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "chapters/prologue.md": "# プロローグ\n\n　雨だ!\n",
      "chapters/chapter-001.md": "# 第1章\n\n　駅だ。\n",
    })
    const all = await novelCheckExecute({}, ctx(dir))
    assert.match(all, /表記の点検（1章とプロローグ）/)
    assert.match(all, /## プロローグ（1件）/)
    const one = await novelCheckExecute({ section: "prologue" }, ctx(dir))
    assert.match(one, /表記の点検（プロローグ）/)
    assert.match(await novelCheckExecute({ section: "epilogue" }, ctx(dir)), /❌ エピローグの本文が見つかりません（\.novel\/chapters\/epilogue\.md）/)
  })
})

describe("novel_export と節", () => {
  test("読む順番に繋ぎ、節の見出しを付ける", async () => {
    const dir = sampleProject()
    const out = await novelExportExecute({}, ctx(dir))
    const text = readFileSync(join(dir, ".novel", "export", "雨の駅.txt"), "utf-8")
    const order = ["プロローグ　雨", "第一章　駅", "幕間　町", "幕間\n\n　犬", "第二章　傘", "エピローグ　晴れ"]
    const positions = order.map((h) => text.indexOf(h))
    assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), text)
    assert.match(out, /📚 章: 第1〜2章（2章）＋プロローグ・幕間2・エピローグ/)
    assert.match(out, /📊 文字数: 35文字/)
  })

  test("範囲を指定したときの節の扱い", async () => {
    const dir = sampleProject()
    await novelExportExecute({ format: "markdown", toChapter: 1 }, ctx(dir))
    const first = readFileSync(join(dir, ".novel", "export", "雨の駅.md"), "utf-8")
    assert.match(first, /## プロローグ 雨/)
    assert.match(first, /## 幕間 町/)
    assert.doesNotMatch(first, /第2章|エピローグ/)

    await novelExportExecute({ format: "markdown", fromChapter: 2 }, ctx(dir))
    const second = readFileSync(join(dir, ".novel", "export", "雨の駅.md"), "utf-8")
    assert.doesNotMatch(second, /プロローグ|幕間|第1章/)
    assert.match(second, /## 第2章 傘[\s\S]*## エピローグ 晴れ/)
  })
})

describe("novel_context と節", () => {
  const outline = `# 章別プロット

## プロローグ
雨の夜の駅。

## 第1章 駅
駅に着く。

## 幕間（第1章のあと）
町の視点。

## 第2章 傘
傘を忘れる。
`

  test("節のプロットを統合ファイルから抜き出し、章のプロットに節を混ぜない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "outline-detailed.md": outline })
    const pro = await novelContextExecute({ section: "prologue", includePrompts: false }, ctx(dir))
    assert.match(pro, /📝 執筆用の資料 — プロローグ/)
    assert.match(pro, /## 📋 この節のプロット[^\n]*\n## プロローグ\n雨の夜の駅。/)
    assert.doesNotMatch(pro, /駅に着く/)
    assert.match(pro, /分量の目安: プロットに従う/)

    const one = await novelContextExecute({ chapterNumber: 1, includePrompts: false }, ctx(dir))
    assert.match(one, /駅に着く。/)
    assert.doesNotMatch(one, /町の視点/)
  })

  test("節のプロットは分割ファイルを優先し、無ければ知らせる", async () => {
    const dir = makeProject({ "config.json": CONFIG, "outline-detailed.md": outline, "outline/interlude-001-1.md": "分割した幕間のプロット" })
    const out = await novelContextExecute({ section: "interlude", chapterNumber: 1, includePrompts: false }, ctx(dir))
    assert.match(out, /分割した幕間のプロット/)
    const missing = await novelContextExecute({ section: "epilogue", includePrompts: false }, ctx(dir))
    assert.match(missing, /⚠️ エピローグのプロットが見つかりません/)
  })

  test("前の本文の末尾を、幕間やプロローグからも取る", async () => {
    const dir = sampleProject()
    const two = await novelContextExecute({ chapterNumber: 2, includePrompts: false }, ctx(dir))
    assert.match(two, /## 📖 前の幕間（第1章のあと・2）の末尾[^\n]*\n[\s\S]*犬が吠える/)
    const one = await novelContextExecute({ chapterNumber: 1, includePrompts: false }, ctx(dir))
    assert.match(one, /## 📖 前のプロローグの末尾[^\n]*\n[\s\S]*雨が降っていた/)
    const epi = await novelContextExecute({ section: "epilogue", includePrompts: false }, ctx(dir))
    assert.match(epi, /## 📖 前章の末尾[^\n]*\n[\s\S]*傘を忘れた/)
  })

  test("伏線の期限は記録の章番号で見る（エピローグは最後の章）", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({
        items: [{ id: "F1", title: "鍵", content: "古い鍵", status: "planted", plantChapter: 0, targetChapter: 2 }],
      }),
    })
    const epi = await novelContextExecute({ section: "epilogue", includePrompts: false }, ctx(dir))
    assert.match(epi, /回収予定の第2章を過ぎています（現在はエピローグ）/)
  })
})

describe("記録の章番号 0（プロローグ）", () => {
  test("伏線の張った章・回収した章に 0 を書ける", () => {
    const f = parseForeshadowUpdates(JSON.stringify({ items: [{ title: "鍵", content: "古い鍵", plantChapter: 0 }] }), new Set())
    assert.ok(f.ok)
    const target = parseForeshadowUpdates(JSON.stringify({ items: [{ title: "鍵", content: "古い鍵", targetChapter: 0 }] }), new Set())
    assert.ok(!target.ok, "回収の予定は 0 にしない")
  })
})

describe("listManuscriptFiles", () => {
  test("同じ節の名前違いは、名前順で先のものを使う", async () => {
    const dir = makeProject({
      "chapters/interlude-001-1.md": "# 幕間\n\nA",
      "chapters/interlude-1-1.md": "# 幕間\n\nB",
      "chapters/chapter-001.md": "# 第1章\n\nC",
    })
    const files = await listManuscriptFiles(dir)
    assert.deepEqual(files.map((f) => f.path.split(/[\\/]/).pop()), ["chapter-001.md", "interlude-001-1.md"])
  })
})

describe("あらすじの節", () => {
  const base = `# あらすじ

## 第1章 駅
駅に着いた。

## 第2章 傘
傘を忘れた。
`

  test("節を読む順番に差し込み、同じ節は置き換える", () => {
    let text = upsertSummarySections(base, [{ chapter: null, section: il(1), heading: "## 幕間（第1章のあと） 町", body: "町は眠る。" }])
    text = upsertSummarySections(text, [{ chapter: null, section: PROLOGUE, heading: "## プロローグ", body: "雨。" }])
    text = upsertSummarySections(text, [{ chapter: null, section: PROLOGUE, heading: "## プロローグ 雨", body: "雨の夜。" }])
    const headings = text.split("\n").filter((l) => l.startsWith("## "))
    assert.deepEqual(headings, ["## プロローグ 雨", "## 第1章 駅", "## 幕間（第1章のあと） 町", "## 第2章 傘"])
    assert.deepEqual(summarySections(text), [PROLOGUE, il(1)])
    assert.deepEqual(summaryChapters(text), [1, 2])
  })

  test("渡された本文を、指した節の見出しにする。見出しと指定が食い違えば断る", () => {
    const ok = parseSummaryInput("雨の夜。", PROLOGUE)
    assert.ok(ok.ok)
    assert.equal(ok.value[0].heading, "## プロローグ")
    const ng = parseSummaryInput("## 第1章\n駅。", il(1, 2))
    assert.ok(!ng.ok)
    assert.match(ng.message, /指定は幕間（第1章のあと・2）ですが、見出しは 第1章 です/)
  })

  test("資料には読む順番で前の章・節だけを載せる", () => {
    const text = upsertSummarySections(base, [
      { chapter: null, section: PROLOGUE, heading: "## プロローグ", body: "雨の夜。" },
      { chapter: null, section: il(1), heading: "## 幕間（第1章のあと）", body: "町は眠る。" },
      { chapter: null, section: EPILOGUE, heading: "## エピローグ", body: "晴れた。" },
    ])
    const forInterlude = buildSummaryContext(text, il(1, 2), 4000)
    assert.match(forInterlude, /雨の夜。[\s\S]*駅に着いた。[\s\S]*町は眠る。/)
    assert.doesNotMatch(forInterlude, /傘を忘れた|晴れた/)

    const forOne = buildSummaryContext(text, 1, 4000)
    assert.match(forOne, /雨の夜。/)
    assert.doesNotMatch(forOne, /駅に着いた/)

    const forEpilogue = buildSummaryContext(text, EPILOGUE, 4000, 3)
    assert.match(forEpilogue, /傘を忘れた/)
    assert.doesNotMatch(forEpilogue, /晴れた/)
    assert.match(forEpilogue, /⚠️ あらすじの記録が無い章: 第3章/)
  })

  test("全体の流れ（第N章まで）は、第N章のあとの幕間を書くときには載せない", () => {
    const text = `## 全体の流れ（第1章まで）\n駅までの話。\n\n## 第1章\n駅に着いた。\n`
    assert.match(buildSummaryContext(text, il(1), 4000), /全体の流れは第1章までの要約で、この章より先を含むため/)
    assert.match(buildSummaryContext(text, 2, 4000), /駅までの話。/)
  })

  test("novel_update(summary) で節を書き、novel_status は記録の無い節を知らせる", async () => {
    const dir = sampleProject()
    const out = await novelUpdateExecute({ action: "summary", section: "prologue", content: "雨の夜。" }, ctx(dir))
    assert.match(out, /✅ あらすじを更新しました（プロローグ）/)
    assert.match(readFileSync(join(dir, ".novel", "summary.md"), "utf-8"), /## プロローグ 雨\n\n雨の夜。/)
    const status = await novelStatusExecute({}, ctx(dir))
    assert.match(status, /あらすじの記録が無い節: 幕間（第1章のあと）、幕間（第1章のあと・2）、エピローグ/)
  })

  test("伏線には節の記録用の章番号を使い、人物の状態は節のキーで残す", async () => {
    const dir = sampleProject()
    await novelUpdateExecute(
      { action: "foreshadow", section: "prologue", content: JSON.stringify({ items: [{ title: "鍵", content: "古い鍵", status: "planted" }] }) },
      ctx(dir),
    )
    await novelUpdateExecute(
      { action: "foreshadow", section: "epilogue", content: JSON.stringify({ items: [{ id: "F1", status: "resolved" }] }) },
      ctx(dir),
    )
    const items = JSON.parse(readFileSync(join(dir, ".novel", "foreshadow.json"), "utf-8")).items
    // 予定は全3章でも、本文は第2章まで。エピローグは本文のある最後の章として記録する
    assert.equal(items[0].resolvedChapter, 2)
    await novelUpdateExecute(
      { action: "character-state", section: "prologue", content: JSON.stringify({ updates: [{ name: "佐和", changes: { mentalState: "眠い" } }] }) },
      ctx(dir),
    )
    const state = JSON.parse(readFileSync(join(dir, ".novel", "characters", "state.json"), "utf-8"))
    assert.deepEqual(Object.keys(state.sections), ["prologue"])
    assert.equal(state.sections.prologue.updates[0].name, "佐和")
  })
})

describe("部（config.json の parts）", () => {
  test("読み取りと検証", () => {
    assert.equal(parseParts(undefined), null)
    assert.equal(parseParts([]), null)
    const ok = parseParts([{ title: "春", fromChapter: 1 }, { title: "夏", fromChapter: 3 }])
    assert.ok(ok && "parts" in ok)
    assert.deepEqual(ok.parts.map((p) => [p.number, p.fromChapter, p.toChapter]), [[1, 1, 2], [2, 3, null]])
    assert.equal(partOfChapter(ok.parts, 2)?.title, "春")
    assert.equal(partOfChapter(ok.parts, 9)?.title, "夏")

    for (const bad of [{}, [{ title: "", fromChapter: 1 }], [{ title: "春", fromChapter: 0 }], [{ title: "春", fromChapter: 3 }, { title: "夏", fromChapter: 3 }]]) {
      const r = parseParts(bad)
      assert.ok(r && "error" in r, JSON.stringify(bad))
    }
  })

  /** 第一部「春」が第1章から、第二部「夏」が第2章から */
  const withParts = () => {
    const dir = sampleProject()
    const config = { ...JSON.parse(CONFIG), parts: [{ title: "春", fromChapter: 1 }, { title: "夏", fromChapter: 2 }] }
    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify(config))
    return dir
  }

  test("書き出し: 部の最初の章の前に部の見出しを置く（幕間は前の部に残る）", async () => {
    const dir = withParts()
    const out = await novelExportExecute({}, ctx(dir))
    const text = readFileSync(join(dir, ".novel", "export", "雨の駅.txt"), "utf-8")
    const order = ["プロローグ　雨", "第一部　春", "第一章　駅", "幕間　町", "第二部　夏", "第二章　傘", "エピローグ"]
    const positions = order.map((h) => text.indexOf(h))
    assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), text)
    assert.match(out, /🗂️ 部の見出し: 第一部・第二部/)

    await novelExportExecute({ format: "markdown", fromChapter: 2 }, ctx(dir))
    const md = readFileSync(join(dir, ".novel", "export", "雨の駅.md"), "utf-8")
    assert.match(md, /## 第2部 夏\n\n### 第2章 傘[\s\S]*### エピローグ 晴れ/)
    assert.doesNotMatch(md, /第1部/)
  })

  test("書き出し: parts が読めなければ書かずに断る", async () => {
    const dir = sampleProject()
    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ ...JSON.parse(CONFIG), parts: [{ title: "春" }] }))
    assert.match(await novelExportExecute({}, ctx(dir)), /^❌ config\.json の parts を読めません/)
  })

  test("進行状況と執筆用の資料に部を示す", async () => {
    const dir = withParts()
    const status = await novelStatusExecute({}, ctx(dir))
    assert.match(status, /第一部「春」（第1章）: 1\/1章/)
    assert.match(status, /第二部「夏」（第2〜3章）: 1\/2章/)
    const context = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, ctx(dir))
    assert.match(context, /部: 第二部「夏」（第2〜3章）の2章目/)

    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ ...JSON.parse(CONFIG), parts: "春" }))
    assert.match(await novelStatusExecute({}, ctx(dir)), /⚠️ config\.json の parts は配列で/)
  })
})
