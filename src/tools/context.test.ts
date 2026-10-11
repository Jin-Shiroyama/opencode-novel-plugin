import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelContextExecute } from "./context.js"
import { determinePhase } from "../utils.js"

/**
 * novel_context の結合テスト。
 *
 * 一時ディレクトリに作品データを組み立て、組み上がった資料に何が含まれるかを見る。
 * agent やコマンドが案内している保存のしかた（個別の人物ファイル、章ごとの
 * 分割保存）が、実際に資料へ渡ることを確かめるのが主眼。
 */

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-ctx-"))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, ".novel", rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf-8")
  }
  return dir
}

const CONFIG = JSON.stringify({
  title: "九月の忘れもの",
  genre: "現代ドラマ",
  theme: "沈黙の重さ",
  targetWords: 120000,
  chapterCount: 40,
  narrativePerspective: "三人称一元視点",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  currentPhase: "writing",
})

const run = (dir: string, args: Partial<Parameters<typeof novelContextExecute>[0]> = {}) =>
  novelContextExecute(
    { chapterNumber: 2, includePrompts: false, ...args } as any,
    { directory: dir } as any,
  )

// ============================================================
// 個別の人物ファイル
// ============================================================

describe("個別の人物ファイル", () => {
  const files = {
    "config.json": CONFIG,
    "characters/profiles.md": "# 登場人物一覧\n\n森田悠、杉本千尋、鏡味征一。\n",
    "characters/森田悠.md": "# 森田悠\n\n話し方の癖：短く切る。「ああ」「そうか」が多い。\n",
    "characters/杉本千尋.md": "# 杉本千尋\n\n話し方の癖：丁寧語のまま押し返す。\n",
    "characters/鏡味征一.md": "# 鏡味征一\n\n話し方の癖：前例という語をよく使う。\n",
    "outline-detailed.md": "# 章別プロット\n\n## 第2章：押し直した判子\n森田は訂正せず、自分の判子を押す。杉本は何も言わない。\n",
  }

  test("一覧（profiles.md）が資料に入る", async () => {
    const out = await run(makeProject(files))
    assert.match(out, /森田悠、杉本千尋、鏡味征一/)
  })

  test("この章に出る人物の個別ファイルが資料に入る", async () => {
    const out = await run(makeProject(files))
    assert.match(out, /短く切る/, "森田悠の個別ファイルが資料に入っていない")
    assert.match(out, /丁寧語のまま押し返す/, "杉本千尋の個別ファイルが資料に入っていない")
  })

  test("この章に出ない人物は資料に入れない", async () => {
    const out = await run(makeProject(files))
    assert.doesNotMatch(out, /前例という語をよく使う/, "この章に出ない鏡味征一が資料に入っている")
  })

  test("プロットから人物が特定できないときは全員を入れる", async () => {
    const out = await run(
      makeProject({ ...files, "outline-detailed.md": "# 章別プロット\n\n## 第2章：判子\n詳細は未記入。\n" }),
    )
    assert.match(out, /短く切る/)
    assert.match(out, /前例という語をよく使う/)
  })
})

// ============================================================
// シーン一覧
// ============================================================

describe("シーン一覧", () => {
  const scenes = `# シーン一覧

### 1.1 名簿の印
- [x] **状態**：完了
- **_Prompt**：Role: 小説家 | Task: 第1章の導入

### 2.1 判子を押す手
- [ ] **状態**：未着手
- **視点人物**：森田
- **_Prompt**：Role: 小説家 | Task: 押す直前の逡巡を書く | Avoid: ❌心情を直接書かない

### 2.2 廊下の足音
- [ ] **状態**：未着手
- **_Prompt**：Role: 小説家 | Task: 杉本が現れる前の気配

### 3.1 職員室の空気
- [ ] **状態**：未着手
- **_Prompt**：Role: 小説家 | Task: 第3章の導入
`

  const files = {
    "config.json": CONFIG,
    "outline-detailed.md": "# 章別プロット\n\n## 第2章：押し直した判子\n森田が判子を押す。\n",
    "scenes.md": scenes,
  }

  test("この章のシーンが資料に入る", async () => {
    const out = await run(makeProject(files))
    assert.match(out, /押す直前の逡巡を書く/, "この章のシーンの _Prompt が資料に入っていない")
    assert.match(out, /杉本が現れる前の気配/)
  })

  test("他の章のシーンは入れない", async () => {
    const out = await run(makeProject(files))
    assert.doesNotMatch(out, /第1章の導入/)
    assert.doesNotMatch(out, /第3章の導入/)
  })

  test("sceneId を渡すとそのシーンを目立たせる", async () => {
    const out = await run(makeProject(files), { sceneId: "2.1" })
    assert.match(out, /押す直前の逡巡を書く/)
    // 指定されたシーンが分かる形で示されること
    assert.match(out, /2\.1[^\n]*(←|指定|今回)/u, "sceneId で指定したシーンが区別されていない")
  })
})

// ============================================================
// 章ごとの分割保存
// ============================================================

describe("章ごとの分割保存", () => {
  test("outline/chapter-002.md からプロットを読む", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "outline/chapter-002.md": "# 第2章：押し直した判子\n\n森田は訂正せず、自分の判子を押す。\n",
    })
    const out = await run(dir)
    assert.match(out, /この章のプロット/)
    assert.match(out, /自分の判子を押す/, "分割されたプロットが読まれていない")
  })

  test("scenes/chapter-002.md からシーンを読む", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "scenes/chapter-002.md": "### 2.1 判子を押す手\n- **_Prompt**：Role: 小説家 | Task: 押す直前の逡巡\n",
    })
    const out = await run(dir)
    assert.match(out, /押す直前の逡巡/, "分割されたシーン一覧が読まれていない")
  })

  test("統合ファイルと分割ファイルが両方あれば分割を優先する", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "outline-detailed.md": "# 章別プロット\n\n## 第2章：古い内容\n統合ファイル側の記述。\n",
      "outline/chapter-002.md": "# 第2章：新しい内容\n\n分割ファイル側の記述。\n",
    })
    const out = await run(dir)
    assert.match(out, /分割ファイル側の記述/)
  })

  test("流派・刀剣の分割保存を読む", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "wuxia/sects/天真一刀流.md": "# 天真一刀流\n\n城下の本家。掟は三つ。\n",
      "wuxia/weapons/朽葉.md": "# 朽葉\n\n刃長二尺三寸。脂に弱い。\n",
    })
    const out = await run(dir)
    assert.match(out, /城下の本家/, "分割された流派の設定が読まれていない")
    assert.match(out, /刃長二尺三寸/, "分割された刀剣の設定が読まれていない")
  })

  test("取材メモの分割保存を読む", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "reality/events/名簿の改め.md": "# 名簿の改め\n\n書類に残ったことだけが事実になる構造。\n",
    })
    const out = await run(dir)
    assert.match(out, /書類に残ったことだけが事実/, "分割された取材メモが読まれていない")
  })
})

// ============================================================
// determinePhase と分割保存
// ============================================================

describe("determinePhase と分割保存", () => {
  const filled = {
    "concept.md": "# コンセプト\n\n書き終えた内容。\n",
    "world-building.md": "# 世界観\n\n書き終えた内容。\n",
    "characters/profiles.md": "# 人物\n\n書き終えた内容。\n",
    "outline-brief.md": "# プロット概要\n\n書き終えた内容。\n",
  }

  test("outline/ に章ファイルがあれば章別プロットができているとみなす", () => {
    const dir = makeProject({ ...filled, "outline/chapter-001.md": "# 第1章\n\n内容。\n" })
    assert.equal(determinePhase(dir), "scenes")
  })

  test("scenes/ に章ファイルがあればシーン一覧ができているとみなす", () => {
    const dir = makeProject({
      ...filled,
      "outline/chapter-001.md": "# 第1章\n\n内容。\n",
      "scenes/chapter-001.md": "### 1.1 場面\n- [ ] 未着手\n",
    })
    assert.equal(determinePhase(dir), "writing")
  })

  test("分割ディレクトリが空なら未作成とみなす", () => {
    const dir = makeProject({ ...filled, "outline/.keep": "" })
    assert.equal(determinePhase(dir), "outline")
  })
})
