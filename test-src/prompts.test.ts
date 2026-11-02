import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { buildPromptVars, getPromptTemplate, remainingPlaceholders } from "../src/prompts.js"
import { getTemplate, CHARACTER_PROFILE_TEMPLATE } from "../src/templates.js"
import { novelUpdateExecute } from "../src/tools/track.js"
import { novelContextExecute } from "../src/tools/context.js"

/**
 * プロンプトの差し込み（novel_update(action: "prompt")）と、執筆用の資料の末尾の条件のテスト。
 *
 * 以前は題・ジャンル・章番号しか埋めず、{act1Words} や {joWords} が残ったまま返っていた。
 * プロローグ（記録の章番号 0）では {chapterNumber} も埋まらなかった。
 */

const ctx = (dir: string) => ({ directory: dir }) as any

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-prompts-"))
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
  targetWords: 120000,
  chapterCount: 40,
  narrativePerspective: "三人称一元視点",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})

const num = (s: string) => Number(s.replace(/,/g, ""))

describe("buildPromptVars", () => {
  test("三幕の章数は合計が章数と一致し、ジレンマは第二幕後半と第三幕に入る", () => {
    for (const chapterCount of [40, 25, 7, 3, 1]) {
      const v = buildPromptVars({ targetWords: 120000, chapterCount })
      const chapters = ["act1", "act2a", "act2b", "act3"].map((a) => num(v[`${a}Chapters`]))
      assert.equal(chapters.reduce((a, b) => a + b, 0), chapterCount, `全${chapterCount}章`)
      const act2bEnd = chapters[0] + chapters[1] + chapters[2]
      assert.ok(num(v.dilemma1Chapter) <= Math.max(1, act2bEnd), `全${chapterCount}章の1つめ`)
      assert.ok(num(v.dilemma2Chapter) <= chapterCount, `全${chapterCount}章の2つめ`)
    }
    const v = buildPromptVars({ targetWords: 120000, chapterCount: 40 })
    assert.equal(v.act1Words, "30,000")
    assert.equal(v.dilemma1Chapter, "25") // 第二幕後半（第21〜30章）の中ほど
    assert.equal(v.dilemma2Chapter, "35") // 第三幕（第31〜40章）の中ほど
  })

  test("序破急は 2:6:2", () => {
    const v = buildPromptVars({ targetWords: 20000, chapterCount: 1 })
    assert.deepEqual([v.joWords, v.haWords, v.kyuWords], ["4,000", "12,000", "4,000"])
  })

  test("章番号は 0 も入れ、渡されなければ入れない", () => {
    assert.equal(buildPromptVars(null, { chapterNumber: 0 }).chapterNumber, "0")
    assert.equal(buildPromptVars(null).chapterNumber, undefined)
  })

  test("残った差し込みを重複なく拾う", () => {
    assert.deepEqual(remainingPlaceholders("{a} と {b} と {a}"), ["a", "b"])
  })
})

describe("novel_update(action: prompt)", () => {
  const prompt = (dir: string, content: string, extra: Record<string, unknown> = {}) =>
    novelUpdateExecute({ action: "prompt", content, ...extra } as any, ctx(dir))

  test("プロット概要（三幕・序破急）の差し込みが残らない", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const brief = await prompt(dir, "outline-brief")
    assert.doesNotMatch(brief, /\{act1Words\}|\{act3Chapters\}|\{dilemma1Chapter\}|\{chapterCount\}/)
    assert.match(brief, /### 第一幕：導入（約30,000文字、10章）/)
    const short = await prompt(dir, "outline-short")
    assert.doesNotMatch(short, /\{joWords\}|\{haWords\}|\{kyuWords\}|\{targetWords\}/)
    assert.doesNotMatch(short, /📌 資料から埋めて使う差し込み/)
  })

  test("プロローグでは章番号 0 が入る", async () => {
    const dir = makeProject({ "config.json": CONFIG })
    const out = await prompt(dir, "summary-update", { section: "prologue" })
    assert.doesNotMatch(out, /\{chapterNumber\}/)
    assert.match(out, /第0章/)
  })

  test("追う人物は状態の記録にいる人物の名前を並べる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/state.json": JSON.stringify({
        sections: {
          "chapter-002": { updates: [{ name: "森田", changes: { mentalState: "眠い" } }] },
          "prologue": { updates: [{ name: "佐和", changes: { mentalState: "待つ" } }] },
        },
      }),
    })
    const out = await prompt(dir, "character-state-update", { chapterNumber: 3 })
    assert.match(out, /佐和、森田（この章に出てこない人物は省く）/)
    const none = await prompt(makeProject({ "config.json": CONFIG }), "character-state-update", { chapterNumber: 3 })
    assert.match(none, /この章に出てきた全員/)
  })

  test("本文のプロンプトも、題と1章の目標文字数が埋まる", async () => {
    const out = await prompt(makeProject({ "config.json": CONFIG }), "chapter-write", { chapterNumber: 1 })
    assert.doesNotMatch(out, /\{projectTitle\}|\{targetWordCount\}|\{genre\}|\{narrativePerspective\}/)
    assert.match(out, /『雨の駅』の著者/)
    assert.match(out, /目標文字数：3,000文字/)
  })

  test("書き手の材料の差し込みは、埋めずに一覧で示す", async () => {
    const out = await prompt(makeProject({ "config.json": CONFIG }), "characters")
    assert.match(out, /📌 資料から埋めて使う差し込み: .*\{protagonistName\}/)
  })

  test("所属の変化を入れるキーを示す", () => {
    assert.match(getPromptTemplate("character-state-update")!, /所属.*events に書く/)
  })

  test("つじつま確認は JSON ではなく、skill と同じ表で返させる", () => {
    const p = getPromptTemplate("consistency-check")!
    assert.doesNotMatch(p, /JSON/)
    assert.match(p, /\| # \| 観点 \| 重さ \| 場所 \|/)
  })
})

describe("三幕の見出し", () => {
  test("括弧が閉じている", () => {
    for (const text of [getPromptTemplate("outline-brief")!, getTemplate("outline-brief")]) {
      const heads = text.split("\n").filter((l) => /^### 第[一二三]幕/.test(l))
      assert.equal(heads.length, 4)
      for (const h of heads) assert.equal((h.match(/（/g) ?? []).length, (h.match(/）/g) ?? []).length, h)
    }
  })
})

describe("執筆用の資料の末尾", () => {
  test("プロンプトの全文を写し直さず、書くときの条件を短く置く", async () => {
    const dir = makeProject({ "config.json": CONFIG, "outline-detailed.md": "## 第1章 駅\n佐和が終電を逃す。\n" })
    const out = await novelContextExecute({ chapterNumber: 1 } as any, ctx(dir))
    assert.doesNotMatch(out, /書き写してください|執筆プロンプト/)
    assert.match(out, /## ✍️ 書くときの条件\n- 書くもの: 第1章（物語の書き出し/)
    assert.match(out, /- 分量: 3,000文字 ±10%/)
    const off = await novelContextExecute({ chapterNumber: 1, includePrompts: false } as any, ctx(dir))
    assert.doesNotMatch(off, /書くときの条件/)
  })
})

describe("人物設定の雛形", () => {
  test("章ごとの記録の表は持たず、state.json に記録するよう案内する", () => {
    assert.doesNotMatch(CHARACTER_PROFILE_TEMPLATE, /## 章ごとの記録/)
    assert.match(CHARACTER_PROFILE_TEMPLATE, /novel_update\(character-state\)/)
  })
})
