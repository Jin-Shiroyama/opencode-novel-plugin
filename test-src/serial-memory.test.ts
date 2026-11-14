import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { buildSummaryContext, summaryGap } from "../src/records.js"
import { determinePhase } from "../src/utils.js"
import { novelContextExecute } from "../src/tools/context.js"
import { novelStatusExecute } from "../src/tools/status.js"

/**
 * 長い連載の記憶のテスト。
 *
 * 章のあらすじは直前の章から枠に詰めるので、話数が増えると古い章が落ちる。落ちた章が「全体の流れ」にも
 * 入っていないとき（資料からまるごと抜けるとき）に、資料と進行状況で知らせることを見る。
 * あわせて、連載ではシーン設計を省いて書きはじめられることを見る。
 */

/** 第1〜n章のあらすじ（1章あたり本文100文字）。overview を渡せば全体の流れを先頭に置く */
function summary(n: number, overview?: { upTo?: number; body: string }): string {
  let out = "# 『迷宮の街』これまでのあらすじ\n\n"
  if (overview) out += `## 全体の流れ${overview.upTo ? `（第${overview.upTo}章まで）` : ""}\n${overview.body}\n\n`
  for (let i = 1; i <= n; i++) out += `## 第${i}章 題${i}\n${`第${i}章の出来事。`.padEnd(100, "あ")}\n\n`
  return out
}

describe("summaryGap", () => {
  test("枠に収まるうちは null", () => {
    assert.equal(summaryGap(summary(5), 6, 4000), null)
  })

  test("枠から落ちた章が全体の流れに入っていなければ、その章を返す", () => {
    // 枠1000文字に、1章あたり110文字ほど → 直前の9章が入り、第1〜11章が落ちる
    const gap = summaryGap(summary(20), 21, 1000)
    assert.ok(gap)
    assert.equal(gap.coverage, 0)
    assert.equal(gap.chapters[0], 1)
    assert.ok(gap.chapters.length >= 10)
    assert.equal(gap.chapters[gap.chapters.length - 1], gap.chapters.length)
  })

  test("全体の流れが落ちた章まで届いていれば null。途中までなら、その先の章だけを返す", () => {
    const body = "序盤の要約。"
    const dropped = summaryGap(summary(20, { body, upTo: 1 }), 21, 1000)!.chapters
    const last = dropped[dropped.length - 1]
    assert.equal(summaryGap(summary(20, { body, upTo: last }), 21, 1000), null)
    const partial = summaryGap(summary(20, { body, upTo: 5 }), 21, 1000)
    assert.ok(partial)
    assert.equal(partial.coverage, 5)
    assert.equal(partial.chapters[0], 6)
    assert.equal(partial.chapters[partial.chapters.length - 1], last)
  })

  test("書く章より先まで含む全体の流れは載らないので、届いていないとみなす", () => {
    // 第21章を書き直すとき、第30章までの全体の流れは載せない
    const gap = summaryGap(summary(30, { body: "要約。", upTo: 30 }), 21, 1000)
    assert.ok(gap)
    assert.equal(gap.coverage, 0)
  })
})

describe("資料と進行状況で知らせる", () => {
  test("buildSummaryContext は、抜ける章と、全体の流れを更新する呼び方を添える", () => {
    const out = buildSummaryContext(summary(20, { body: "序盤の要約。", upTo: 5 }), 21, 1000)
    assert.match(out, /⚠️ 第6〜\d+章の出来事は、枠に収まらず「全体の流れ」にも入っていません（いまの全体の流れは第5章まで）/)
    assert.match(out, /novel_update\(action: "summary", chapterNumber: 12\) に「## 全体の流れ」の行で始まる要約を渡し、第12章まで更新/)
    // 届いていれば、これまでどおり省略の注記だけ
    const covered = buildSummaryContext(summary(20, { body: "要約。", upTo: 15 }), 21, 1000)
    assert.match(covered, /のあらすじは枠に収まらないため省略/)
    assert.doesNotMatch(covered, /全体の流れ」にも入っていません/)
  })

  function makeProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "novel-serial-"))
    for (const [rel, body] of Object.entries(files)) {
      const path = join(dir, ".novel", rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body, "utf-8")
    }
    return dir
  }
  const config = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      title: "迷宮の街", genre: "異世界ファンタジー", targetWords: 120000, chapterCount: 40, serial: true,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentPhase: "writing",
      ...extra,
    })
  const chapters = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`chapters/chapter-${String(i + 1).padStart(3, "0")}.md`, `# 第${i + 1}章 題\n\n　本文。\n`]),
    )
  const ctx = (dir: string) => ({ directory: dir }) as any

  test("novel_context と novel_status が、枠（limits.summary）に応じて知らせる", async () => {
    const files = { ...chapters(20), "summary.md": summary(20, { body: "序盤の要約。", upTo: 5 }) }
    const tight = makeProject({ "config.json": config({ limits: { summary: 1000 } }), ...files })
    assert.match(await novelContextExecute({ chapterNumber: 21 } as any, ctx(tight)), /全体の流れ」にも入っていません/)
    const status = await novelStatusExecute({}, ctx(tight))
    assert.match(status, /⚠️ あらすじの「全体の流れ」が古くなっています: 第6〜\d+章の出来事が、次の章の資料に載りません（全体の流れは第5章まで）/)
    // 既定の枠（4,000文字）なら20章ぶんが収まるので知らせない
    const roomy = makeProject({ "config.json": config(), ...files })
    assert.doesNotMatch(await novelStatusExecute({}, ctx(roomy)), /全体の流れ」が古くなっています/)
    assert.doesNotMatch(await novelContextExecute({ chapterNumber: 21 } as any, ctx(roomy)), /全体の流れ」にも入っていません/)
  })
})

describe("連載ではシーン設計を省ける", () => {
  const FILLED = "# 題\n\n書いた。\n"
  function project(serial: boolean, scenes: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), "novel-serial-phase-"))
    const files: Record<string, string> = {
      "concept.md": FILLED, "world-building.md": FILLED, "characters/profiles.md": FILLED,
      "outline-brief.md": FILLED, "outline/chapter-001.md": FILLED,
      ...(scenes ? { "scenes/chapter-001.md": FILLED } : {}),
    }
    for (const [rel, body] of Object.entries(files)) {
      const path = join(dir, ".novel", rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body, "utf-8")
    }
    return dir
  }
  const cfg = (serial: boolean) => ({ title: "t", genre: "g", serial, createdAt: "", updatedAt: "", currentPhase: "concept" }) as any

  test("連載は章別プロットがあれば本文へ進む。連載でなければシーン設計を待つ", () => {
    assert.equal(determinePhase(project(true, false), cfg(true)), "writing")
    assert.equal(determinePhase(project(false, false), cfg(false)), "scenes")
    assert.equal(determinePhase(project(false, true), cfg(false)), "writing")
  })

  test("連載でも、章別プロットが無ければプロットの段階に留まる", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-serial-phase-"))
    for (const rel of ["concept.md", "world-building.md", "characters/profiles.md", "outline-brief.md"]) {
      const path = join(dir, ".novel", rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, FILLED, "utf-8")
    }
    assert.equal(determinePhase(dir, cfg(true)), "outline")
  })
})
