import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelUpdateExecute } from "./track.js"
import { novelContextExecute } from "./context.js"
import { novelStatusExecute } from "./status.js"
import { fillTemplateVars, REALITY_SOURCE_TEMPLATE, SUMMARY_TEMPLATE } from "../templates.js"

/**
 * novel_update と、その記録を読む novel_context / novel_status の結合テスト。
 *
 * 実際の作品で起きたこと（日本語の status、知らないキーでの「成功」、
 * あらすじの全置換、雛形の取材メモ、シーンの未完了）を再現して確かめる。
 */

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-track-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const CONFIG = JSON.stringify({
  title: "勇者の冒険",
  genre: "異世界ファンタジー",
  targetWords: 40000,
  chapterCount: 3,
  narrativePerspective: "三人称一元視点",
  martialArtsSetting: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})

const read = (dir: string, rel: string) => readFileSync(join(dir, ".novel", rel), "utf-8")
const update = (dir: string, action: "character-state" | "summary" | "foreshadow", content: unknown, chapterNumber?: number) =>
  novelUpdateExecute(
    { action, content: typeof content === "string" ? content : JSON.stringify(content), chapterNumber },
    { directory: dir } as never,
  )

const STATE = JSON.stringify({
  characters: [{ name: "レン", status: "active", role: "protagonist", mentalState: "不安", items: ["水筒"] }],
})

describe("novel_update(character-state)", () => {
  test("知らないキーだけの更新は何も書かずに断る（以前は「更新しました」と返していた）", async () => {
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": STATE })
    const out = await update(dir, "character-state", {
      updates: [{ name: "レン", changes: { state: "重傷", change: "剣を失う", inner: "…" } }],
    })
    assert.match(out, /^❌/)
    assert.equal(read(dir, "characters/state.json"), STATE)
  })

  test("1件でも形が違えば、正しい件も書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": STATE })
    await update(dir, "character-state", {
      updates: [
        { name: "レン", changes: { mentalState: "覚悟" } },
        { name: "ミレイ", status: "active" },
      ],
    })
    assert.equal(read(dir, "characters/state.json"), STATE)
  })

  test("変えた項目を人物ごとに返し、章番号を残す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": STATE })
    const out = await update(
      dir,
      "character-state",
      {
        updates: [
          { name: "レン", changes: { physicalState: "肋を折った", items: { added: ["古い剣"], removed: ["水筒"] } } },
          { name: "ミレイ", changes: { role: "supporting", mentalState: "枯渇" } },
        ],
      },
      10,
    )
    assert.match(out, /レン: physicalState, items\(\+1\/-1\)/)
    assert.match(out, /ミレイ（新規）: mentalState/)
    const saved = JSON.parse(read(dir, "characters/state.json")).characters
    assert.equal(saved[0].physicalState, "肋を折った")
    assert.deepEqual(saved[0].items, ["古い剣"])
    assert.equal(saved[0].lastUpdatedChapter, 10)
    assert.equal(saved[1].status, "active")
  })
})

describe("novel_update(character-state) の変化の数え方", () => {
  test("記録と同じ内容なら「変更なし」と返し、ファイルを書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": STATE })
    const out = await update(dir, "character-state", {
      updates: [{ name: "レン", changes: { events: [], mentalState: "不安" } }],
    }, 3)
    assert.match(out, /^ℹ️/)
    assert.match(out, /レン: 変更なし/)
    assert.equal(read(dir, "characters/state.json"), STATE)
  })

  test("持っている品の追加と、無い品の削除は数えない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": STATE })
    const out = await update(dir, "character-state", {
      updates: [{ name: "レン", changes: { items: { added: ["水筒", "剣"], removed: ["盾"] } } }],
    })
    assert.match(out, /レン: items\(\+1\/-0\)/)
    assert.deepEqual(JSON.parse(read(dir, "characters/state.json")).characters[0].items, ["水筒", "剣"])
  })

  test("一部の人物だけ変わったときは、変わらなかった人物も示す", async () => {
    const state = JSON.stringify({
      characters: [
        { name: "レン", status: "active", role: "protagonist", mentalState: "不安" },
        { name: "ソウ", status: "active", role: "supporting", mentalState: "待つ" },
      ],
    })
    const dir = makeProject({ "config.json": CONFIG, "characters/state.json": state })
    const out = await update(dir, "character-state", {
      updates: [
        { name: "レン", changes: { mentalState: "覚悟" } },
        { name: "ソウ", changes: { mentalState: "待つ" } },
      ],
    }, 4)
    assert.match(out, /更新 1人 \/ 変更なし 1人/)
    const saved = JSON.parse(read(dir, "characters/state.json")).characters
    assert.equal(saved[0].lastUpdatedChapter, 4)
    assert.equal(saved[1].lastUpdatedChapter, undefined)
  })
})

describe("novel_update(foreshadow)", () => {
  const FORESHADOW = JSON.stringify({
    items: [{ id: "F1", title: "青い花", content: "畑の外れの花", category: "mystery", status: "planted", targetChapter: 12 }],
  })

  test("日本語の status は何も書かずに断る", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    const out = await update(dir, "foreshadow", { items: [{ id: "F1", status: "回収済み" }] })
    assert.match(out, /^❌/)
    assert.equal(read(dir, "foreshadow.json"), FORESHADOW)
  })

  test("回収すると、回収した章を書いている章で埋める", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    const out = await update(dir, "foreshadow", { items: [{ id: "F1", status: "resolved" }] }, 12)
    assert.match(out, /回収済み 1/)
    const saved = JSON.parse(read(dir, "foreshadow.json")).items
    assert.equal(saved[0].resolvedChapter, 12)
    assert.equal(saved[0].title, "青い花")
  })

  test("null を渡した章番号は消す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    await update(dir, "foreshadow", { items: [{ id: "F1", targetChapter: null }] })
    assert.equal(JSON.parse(read(dir, "foreshadow.json")).items[0].targetChapter, undefined)
  })

  test("新しい伏線には空いている id を振る", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({
        items: [{ id: "F2", title: "過去", content: "北の荒野", category: "mystery", status: "planted" }],
      }),
    })
    await update(dir, "foreshadow", { items: [{ title: "光", content: "城の空が光る", status: "planted" }] })
    const ids = JSON.parse(read(dir, "foreshadow.json")).items.map((f: { id: string }) => f.id)
    assert.deepEqual(ids, ["F2", "F3"])
  })

  test("通常の更新では独自のキーを残す（そこにしか無い内容を消さない）", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({
        items: [{ id: "F4", title: "城の光", content: "空が光る", status: "planted", detail: "第9章で補強", resolveChapter: 9 }],
      }),
    })
    await update(dir, "foreshadow", { items: [{ id: "F4", notes: "見張り台から見える" }] })
    const saved = JSON.parse(read(dir, "foreshadow.json")).items[0]
    assert.equal(saved.detail, "第9章で補強")
    assert.equal(saved.resolveChapter, 9)
    assert.equal(saved.notes, "見張り台から見える")
  })

  test("removeKeys を渡したときだけ独自のキーを外し、記録が直る", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({ items: [{ id: "F4", status: "補強済み", detail: "光", resolveChapter: 9 }] }),
    })
    const out = await update(dir, "foreshadow", {
      items: [{
        id: "F4", title: "城の光", content: "夜半に城の空が光る（旧 detail: 光）", status: "resolved",
        resolvedChapter: 9, removeKeys: ["detail", "resolveChapter"],
      }],
    })
    assert.doesNotMatch(out, /形の崩れた記録/)
    const saved = JSON.parse(read(dir, "foreshadow.json")).items[0]
    assert.equal(saved.detail, undefined)
    assert.equal(saved.resolveChapter, undefined)
    assert.equal(saved.removeKeys, undefined)
    assert.equal(saved.status, "resolved")
  })

  test("記録と同じ内容なら「変更なし」と返し、ファイルを書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    const out = await update(dir, "foreshadow", { items: [{ id: "F1", status: "planted" }] })
    assert.match(out, /^ℹ️/)
    assert.equal(read(dir, "foreshadow.json"), FORESHADOW)
  })

  test("形の崩れた記録が残っていれば知らせる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({ items: [{ id: "F4", status: "補強済み", detail: "光" }] }),
    })
    const out = await update(dir, "foreshadow", { items: [{ title: "花", content: "青い花", status: "planted" }] })
    assert.match(out, /形の崩れた記録が残っています.*F4/)
  })
})

describe("novel_update(summary)", () => {
  const SUMMARY = fillTemplateVars(SUMMARY_TEMPLATE, { title: "勇者の冒険" })

  test("章ごとに渡しても前の章が残り、本文の章タイトルを見出しに使う", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "summary.md": SUMMARY,
      "chapters/chapter-001.md": "# 第1章 畑の花\n\n　露が重かった。",
    })
    await update(dir, "summary", "レンは畑で青い花を見つける。", 1)
    const out = await update(dir, "summary", "村の寄り合いでレンが志願する。", 2)
    assert.match(out, /記録のある章: 第1〜2章/)
    const text = read(dir, "summary.md")
    assert.match(text, /## 第1章 畑の花\n\nレンは畑で青い花を見つける。/)
    assert.match(text, /## 第2章\n\n村の寄り合い/)
  })

  test("章番号が分からなければ書かない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "summary.md": SUMMARY })
    const out = await update(dir, "summary", "レンは畑で青い花を見つける。")
    assert.match(out, /^❌/)
    assert.equal(read(dir, "summary.md"), SUMMARY)
  })
})

describe("記録を読む側", () => {
  test("novel_context: 形の崩れた伏線を「期限超過」と言わず、直すよう促す", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({
        items: [
          { id: "F1", title: "青い花", content: "花", category: "mystery", status: "回収済み", targetChapter: 1 },
          { id: "F2", title: "光", content: "空", category: "mystery", status: "planted", targetChapter: 3 },
        ],
      }),
    })
    const out = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, { directory: dir } as never)
    assert.match(out, /🎯 \[F2\] 光/)
    assert.match(out, /❓ \[F1\] 青い花/)
    assert.doesNotMatch(out, /F1.*\n.*過ぎています/)
  })

  test("novel_context: 雛形のままの取材メモは載せず、書き込んだものは載せる", async () => {
    const template = fillTemplateVars(REALITY_SOURCE_TEMPLATE, { title: "勇者の冒険" })
    const untouched = makeProject({ "config.json": CONFIG, "reality-source.md": template })
    const outA = await novelContextExecute({ chapterNumber: 1, includePrompts: false }, { directory: untouched } as never)
    assert.doesNotMatch(outA, /取材メモ/)

    const edited = makeProject({ "config.json": CONFIG, "reality-source.md": template.replace("[見出し]", "北辺境の飢饉") })
    const outB = await novelContextExecute({ chapterNumber: 1, includePrompts: false }, { directory: edited } as never)
    assert.match(outB, /取材メモ/)
    assert.match(outB, /北辺境の飢饉/)
  })

  test("novel_context: あらすじは直前までの章を載せる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "summary.md": "# 題\n\n## 第1章 畑の花\n\n一の筋。\n\n## 第2章 志願\n\n二の筋。\n\n## 第3章 門の水\n\n三の筋。\n",
    })
    const out = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, { directory: dir } as never)
    assert.match(out, /### 第1章 畑の花\n一の筋。/)
    assert.match(out, /### 第2章 志願\n二の筋。/)
    assert.doesNotMatch(out, /三の筋。/)
  })

  test("novel_status: 一部だけ未完了のシーンが残る章も、シーンIDを添えて拾う", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "scenes.md": "### 1.1 畑\n- [x] **状態**：完了\n### 1.2 夜\n- [ ] **状態**：未着手\n",
      "chapters/chapter-001.md": "# 第1章 畑\n\n　本文。",
    })
    const out = await novelStatusExecute({}, { directory: dir } as never)
    assert.match(out, /\(1\/2\)/)
    assert.match(out, /完了になっていないシーンが残っている章: 第1章（1\.2）/)
  })

  test("novel_status: 記録の欠けと、印を重ねたシーンの状態を拾う", async () => {
    const scenes = [
      "### 1.1 畑",
      "- - [x] **状態**：完了",
      "### 2.1 寄り合い",
      "- - [ ] **状態**：未着手",
      "### 3.1 門",
      "- [ ] **状態**：未着手",
    ].join("\n")
    const dir = makeProject({
      "config.json": CONFIG,
      "concept.md": "コンセプト",
      "world-building.md": "世界観",
      "characters/profiles.md": "人物",
      "outline-brief.md": "概要",
      "outline-detailed.md": "## 第1章\n筋",
      "scenes.md": scenes,
      "summary.md": "# 題\n\n## 第1章\n\n一。\n",
      "foreshadow.json": JSON.stringify({ items: [{ id: "F1", status: "回収済み", title: "花", content: "花" }] }),
      "chapters/chapter-001.md": "# 第1章 畑\n\n　本文。",
      "chapters/chapter-002.md": "# 第2章 寄り合い\n\n　本文。",
      "chapters/chapter-003.md": "# 第3章 門\n\n　本文。",
    })
    const out = await novelStatusExecute({}, { directory: dir } as never)
    assert.match(out, /✅ 完結\n.*予定の章数がそろった状態/)
    assert.match(out, /\(1\/3\)/)
    assert.match(out, /あらすじの記録が無い章: 第2〜3章/)
    assert.match(out, /完了になっていないシーンが残っている章: 第2〜3章（全シーン）/)
    assert.match(out, /伏線 F1 の記録の形が崩れています/)
    assert.match(out, /形の崩れた記録 1/)
    assert.match(out, /分量が目標に届いていません/)
  })
})

describe("境界条件", () => {
  const FORESHADOW = JSON.stringify({
    items: [
      { id: "F1", title: "青い花", content: "花", category: "mystery", status: "resolved", resolvedChapter: 12 },
      { id: "F2", title: "光", content: "空", category: "mystery", status: "planted" },
    ],
  })

  test("回収済みの伏線に同じ状態を伝え直しても、回収章は変えない", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    const out = await update(dir, "foreshadow", { items: [{ id: "F1", status: "resolved" }] }, 15)
    assert.match(out, /^ℹ️/)
    assert.equal(JSON.parse(read(dir, "foreshadow.json")).items[0].resolvedChapter, 12)
  })

  test("回収章を明示すれば書き換える", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    await update(dir, "foreshadow", { items: [{ id: "F1", status: "resolved", resolvedChapter: 13 }] }, 15)
    assert.equal(JSON.parse(read(dir, "foreshadow.json")).items[0].resolvedChapter, 13)
  })

  test("張り済みから回収済みに変わったときだけ、回収章を書いている章で補う", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": FORESHADOW })
    await update(dir, "foreshadow", { items: [{ id: "F2", status: "resolved" }] }, 15)
    assert.equal(JSON.parse(read(dir, "foreshadow.json")).items[1].resolvedChapter, 15)
  })

  test("chapterNumber が整数でない・1未満なら、何も書かずに断る", async () => {
    const summary = "# 題\n\n## 全体の流れ\n"
    const dir = makeProject({ "config.json": CONFIG, "summary.md": summary, "foreshadow.json": FORESHADOW })
    const a = await update(dir, "summary", "峠を下りた。", 1.5)
    assert.match(a, /^❌/)
    assert.equal(read(dir, "summary.md"), summary)
    const b = await update(dir, "foreshadow", { items: [{ id: "F2", status: "resolved" }] }, -1)
    assert.match(b, /^❌/)
    assert.equal(read(dir, "foreshadow.json"), FORESHADOW)
  })

  test("あらすじの見出しの章番号も1以上に限る", async () => {
    const dir = makeProject({ "config.json": CONFIG, "summary.md": "# 題\n" })
    assert.match(await update(dir, "summary", "## 第〇章\n\n前日譚。"), /^❌/)
    assert.match(await update(dir, "summary", "## 第1.5章\n\n幕間。"), /^❌/)
  })

  test("ツールの引数でも chapterNumber を1以上の整数に限る", async () => {
    const mod = await import("../index.js")
    const hooks = await (mod.default as any).server({})
    for (const name of ["novel_update", "novel_save_chapter", "novel_context"]) {
      const schema = hooks.tool[name].args.chapterNumber
      assert.equal(schema.safeParse(1.5).success, false, name)
      assert.equal(schema.safeParse(-1).success, false, name)
      assert.equal(schema.safeParse(0).success, false, name)
      assert.equal(schema.safeParse(3).success, true, name)
    }
  })

  test("移すときの範囲には、移す前のあらすじにある章の節も含める（本文ファイルが無くても）", async () => {
    const summary = "# 題\n\n## 物語の進み\n\n第10章で相棒が死亡する。\n\n## 第11章\n\n第11章の筋。\n"
    const dir = makeProject({ "config.json": CONFIG, "summary.md": summary })

    // 移す前も、第3章の資料には載せていない
    const before = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, { directory: dir } as never)
    assert.doesNotMatch(before, /相棒が死亡/)

    await update(dir, "summary", "第2章の筋。", 2)
    assert.match(read(dir, "summary.md"), /## 以前の形式のあらすじ（第11章まで）/)
    const after = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, { directory: dir } as never)
    assert.doesNotMatch(after, /相棒が死亡/)
    assert.match(after, /### 第2章\n第2章の筋。/)
  })

  test("旧形式のあらすじの範囲は移したときに固定し、過去の章を足しても縮めない", async () => {
    const legacy = "# 題\n\n## 物語の進み\n\n第10章で相棒が死亡する。\n"
    const files: Record<string, string> = { "config.json": CONFIG, "summary.md": legacy }
    for (let n = 1; n <= 11; n++) files[`chapters/chapter-${String(n).padStart(3, "0")}.md`] = `# 第${n}章\n\n　本文。`
    const dir = makeProject(files)

    await update(dir, "summary", "第11章の筋。", 11)
    assert.match(read(dir, "summary.md"), /## 以前の形式のあらすじ（第11章まで）/)

    // 過去の章の節を足しても、範囲は変わらない
    await update(dir, "summary", "第2章の筋。", 2)
    assert.match(read(dir, "summary.md"), /## 以前の形式のあらすじ（第11章まで）/)

    const ctx3 = await novelContextExecute({ chapterNumber: 3, includePrompts: false }, { directory: dir } as never)
    assert.doesNotMatch(ctx3, /相棒が死亡/)
    // タイトルの無い本文の見出し（# 第2章）から、本文の1行目をタイトルに取らない
    assert.match(ctx3, /### 第2章\n第2章の筋。/)
    const ctx12 = await novelContextExecute({ chapterNumber: 12, includePrompts: false }, { directory: dir } as never)
    assert.match(ctx12, /相棒が死亡/)
  })
})

describe("壊れた記録ファイルは上書きしない", () => {
  // 構文エラー・形の異常・読み込めない、の3つ。いずれも空の記録として扱うと、
  // 新しい内容だけで上書きしてそれまでの記録が消える
  const BROKEN_SYNTAX = '{"items":[{"id":"F1","title":"花","content":"青い花","status":"planted"},]}'
  const NEW_ITEM = { items: [{ title: "光", content: "空", status: "planted" }] }

  test("伏線: 構文エラーなら断り、元のファイルを残す", async () => {
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": BROKEN_SYNTAX })
    const out = await update(dir, "foreshadow", NEW_ITEM)
    assert.match(out, /^❌ 伏線の記録は更新していません（元のファイルはそのまま残しています）/)
    assert.match(out, /JSON として読めません/)
    assert.equal(read(dir, "foreshadow.json"), BROKEN_SYNTAX)
  })

  for (const [name, body] of [
    ["items が null", '{"items": null}'],
    ["最上位が配列", "[]"],
    ["項目がオブジェクトでない", '{"items": [null]}'],
    ["空のファイル", ""],
  ] as const) {
    test(`伏線: 形の異常（${name}）なら断り、元のファイルを残す`, async () => {
      const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": body })
      assert.match(await update(dir, "foreshadow", NEW_ITEM), /^❌ 伏線の記録は更新していません/)
      assert.equal(read(dir, "foreshadow.json"), body)
    })
  }

  test("伏線: 項目ごとの不正は断らず、渡し直して直せる", async () => {
    const body = JSON.stringify({ items: [{ id: "F1", title: "花", content: "青い花", status: "回収済み" }] })
    const dir = makeProject({ "config.json": CONFIG, "foreshadow.json": body })
    const out = await update(dir, "foreshadow", { items: [{ id: "F1", status: "resolved" }] }, 12)
    assert.match(out, /^✅/)
    assert.equal(JSON.parse(read(dir, "foreshadow.json")).items[0].status, "resolved")
  })

  for (const [name, body] of [
    ["構文エラー", '{"characters": [{"name": "レン",}]}'],
    ["characters が無い", '{"people": []}'],
    ["名前が無い", '{"characters": [{"mentalState": "不安"}]}'],
    ["所持品が文字列", '{"characters": [{"name": "レン", "items": "水筒"}]}'],
  ] as const) {
    test(`人物の状態: ${name}なら断り、元のファイルを残す`, async () => {
      const dir = makeProject({ "config.json": CONFIG, "characters/state.json": body })
      const out = await update(dir, "character-state", { updates: [{ name: "レン", changes: { mentalState: "覚悟" } }] })
      assert.match(out, /^❌ 登場人物の状態は更新していません（元のファイルはそのまま残しています）/)
      assert.equal(read(dir, "characters/state.json"), body)
    })
  }

  test("読み込めないファイル（ディレクトリ）なら断る", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    mkdirSync(join(dir, ".novel", "foreshadow.json"))
    mkdirSync(join(dir, ".novel", "summary.md"))
    assert.match(await update(dir, "foreshadow", NEW_ITEM), /読み込めません（EISDIR）/)
    assert.match(await update(dir, "summary", "第1章の筋。", 1), /^❌ あらすじは更新していません（元のファイルはそのまま残しています）/)
  })

  test("ファイルが無いだけなら、新しく作って更新する", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    assert.match(await update(dir, "foreshadow", NEW_ITEM), /^✅/)
    assert.match(await update(dir, "character-state", { updates: [{ name: "レン", changes: { mentalState: "覚悟" } }] }), /^✅/)
    assert.match(await update(dir, "summary", "第1章の筋。", 1), /^✅/)
  })

  test("novel_status: 壊れた記録を「0件」と区別して示す", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": BROKEN_SYNTAX,
      "characters/state.json": '{"characters": [{"name": "レン", "items": "水筒"}]}',
      "chapters/chapter-001.md": "# 第1章\n\n　本文。",
    })
    mkdirSync(join(dir, ".novel", "summary.md"))
    const out = await novelStatusExecute({}, { directory: dir } as never)
    assert.match(out, /🎯 伏線: ⚠️ 記録を読めません/)
    assert.doesNotMatch(out, /張り済み 0/)
    assert.match(out, /\.novel\/foreshadow\.json が JSON として読めません/)
    assert.match(out, /\.novel\/characters\/state\.json の形が違います/)
    assert.match(out, /\.novel\/summary\.md を読み込めません/)
    // あらすじが読めないときは、欠けている章を数えない
    assert.doesNotMatch(out, /あらすじの記録が無い章/)
  })

  test("novel_context: 壊れた記録を黙って省かず、知らせる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "foreshadow.json": BROKEN_SYNTAX,
      "characters/state.json": "{",
      "summary.md": "# 題\n\n## 第1章\n\n一。\n",
    })
    const out = await novelContextExecute({ chapterNumber: 2, includePrompts: false }, { directory: dir } as never)
    assert.match(out, /## 🔄 登場人物の現在の状態[^\n]*\n⚠️ \.novel\/characters\/state\.json が JSON として読めません/)
    assert.match(out, /## 🎯 伏線の確認[^\n]*\n⚠️ \.novel\/foreshadow\.json が JSON として読めません/)
    assert.match(out, /### 第1章\n一。/)
  })
})

describe("novel_status の本文の集計", () => {
  // 完結の段階まで進めるための最低限の資料（chapterCount は 3）
  const DOCS = {
    "config.json": CONFIG,
    "concept.md": "コンセプト",
    "world-building.md": "世界観",
    "characters/profiles.md": "人物",
    "outline-brief.md": "概要",
    "outline-detailed.md": "## 第1章\n筋",
    "scenes.md": "### 1.1 畑\n- [x] **状態**：完了\n",
  }

  test("章ファイル以外の .md を数えず、累計・平均・不足表示を同じ値にそろえる", async () => {
    const dir = makeProject({
      ...DOCS,
      "chapters/chapter-001.md": "# 第1章 畑\n\n　あいうえお",
      "chapters/chapter-002.md": "# 第2章 寄り合い\n\n　かきくけこさしすせそ",
      "chapters/chapter-003.md": "# 第3章 門\n\n　たちつてと",
      "chapters/推敲メモ.md": "メモ".repeat(150),
      "chapters/backup-chapter-002.md": "古い原稿".repeat(50),
    })
    const out = await novelStatusExecute({ detailed: true }, { directory: dir } as never)
    assert.match(out, /✍️ 執筆済み: 3章/)
    assert.match(out, /📊 累計: 20文字 \/ 40,000文字/)
    assert.match(out, /📐 1章平均: 7文字/)
    assert.match(out, /分量が目標に届いていません: 20 \/ 40,000文字/)
    assert.doesNotMatch(out, /📄 推敲メモ\.md/)
    assert.match(out, /chapters\/ にある章以外のファイルは数えていません: backup-chapter-002\.md、推敲メモ\.md/)
  })

  test("読み込めない章は数えず、そのことを示す", async () => {
    const dir = makeProject({
      ...DOCS,
      "chapters/chapter-001.md": "# 第1章 畑\n\n　あいうえお",
      "chapters/chapter-003.md": "# 第3章 門\n\n　たちつてと",
    })
    mkdirSync(join(dir, ".novel", "chapters", "chapter-002.md"))
    const out = await novelStatusExecute({}, { directory: dir } as never)
    assert.match(out, /✍️ 執筆済み: 章ファイル 3章 ／ 集計できた本文 2章/)
    assert.match(out, /読み込めず数えていない章: 第2章/)
    assert.match(out, /📊 累計: 10文字/)
    assert.match(out, /📐 1章平均: 5文字/)
    assert.match(out, /読み込めない章があります: 第2章/)
  })
})
