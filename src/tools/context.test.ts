import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { novelContextExecute } from "./context.js"
import { novelStatusExecute } from "./status.js"
import { determinePhase, allocateCharBudget, characterNameKeys, extractNameAliases } from "../utils.js"

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

// ============================================================
// 文字数の枠の配分
// ============================================================

describe("allocateCharBudget", () => {
  test("枠に収まるならそのまま配る", () => {
    assert.deepEqual(allocateCharBudget([100, 200], 1000), [100, 200])
  })

  test("短いものを満たしてから長いものを切る", () => {
    // 連結してから先頭から切ると、後ろの短い文書が丸ごと落ちる
    assert.deepEqual(allocateCharBudget([8500, 20], 6000), [5980, 20])
  })

  test("全員が枠を使い切るときは均等に配る", () => {
    assert.deepEqual(allocateCharBudget([5000, 5000], 4000), [2000, 2000])
  })

  test("枠が0以下なら何も配らない", () => {
    assert.deepEqual(allocateCharBudget([100, 200], 0), [0, 0])
    assert.deepEqual(allocateCharBudget([100, 200], -5), [0, 0])
  })

  test("配った合計が枠を超えない", () => {
    for (const sizes of [[1, 1, 1], [9999, 1], [300, 300, 300], [1, 5000, 50]]) {
      for (const limit of [1, 7, 100, 1000]) {
        const total = allocateCharBudget(sizes, limit).reduce((a, b) => a + b, 0)
        assert.ok(total <= limit, `sizes=${sizes} limit=${limit} total=${total}`)
      }
    }
  })
})

// ============================================================
// 上限を超えたときの振る舞い
// ============================================================

describe("上限を超えたとき", () => {
  test("人物一覧が長くても、この章に出る人物の個別設定が落ちない", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/profiles.md": "# 一覧\n" + "あ".repeat(8500),
      "characters/森田悠.md": "# 森田悠\n短く切る話し方。\n",
      "outline-detailed.md": "# 章別\n\n## 第2章：判子\n森田が押す。\n",
    })
    const out = await run(dir)
    assert.match(out, /短く切る話し方/, "人物一覧に枠を食われて個別設定が落ちている")
  })

  test("他のシーンが長くても、sceneId で指定したシーンは落ちない", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "scenes.md":
        "### 2.1 長いシーン\n- **_Prompt**：" + "あ".repeat(4100) + "\n\n" +
        "### 2.2 指定したいシーン\n- **_Prompt**：Role: 小説家 | Task: 短い指示\n",
    })
    const out = await run(dir, { sceneId: "2.2" })
    assert.match(out, /短い指示/, "指定したシーンが枠から落ちている")
  })

  test("統合ファイルが長くても、分割ファイルが落ちない", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "wuxia/sects.md": "# 旧\n" + "い".repeat(4400),
      "wuxia/sects/天真一刀流.md": "# 天真一刀流\n分割ファイル側の記述。\n",
    })
    const out = await run(dir)
    assert.match(out, /分割ファイル側の記述/, "統合ファイルに枠を食われて分割が落ちている")
  })

  test("枠が回らず落ちた文書は、落ちたことが分かる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/profiles.md": "# 一覧\n" + "あ".repeat(100),
      "characters/森田悠.md": "# 森田悠\n" + "い".repeat(100),
      "outline-detailed.md": "# 章別\n\n## 第2章\n森田。\n",
      "config-note.md": "",
    })
    // 枠を極端に小さくする
    const tiny = makeProject({
      "config.json": JSON.stringify({ ...JSON.parse(CONFIG), limits: { characterProfiles: 1 } }),
      "characters/profiles.md": "# 一覧\n" + "あ".repeat(100),
      "characters/森田悠.md": "# 森田悠\n" + "い".repeat(100),
      "outline-detailed.md": "# 章別\n\n## 第2章\n森田。\n",
    })
    const out = await run(tiny)
    assert.match(out, /枠が足りず省略|以下省略/, "落ちたことが分からない")
    void dir
  })
})

// ============================================================
// 統合ファイルと分割ファイルの併存
// ============================================================

describe("統合ファイルと分割ファイルの併存", () => {
  test("武芸設定は両方を載せる（どちらか一方を捨てない）", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "wuxia/sects.md": "# 流派の概観\n統合ファイル側の記述。\n",
      "wuxia/sects/天真一刀流.md": "# 天真一刀流\n分割ファイル側の記述。\n",
    })
    const out = await run(dir)
    assert.match(out, /統合ファイル側の記述/)
    assert.match(out, /分割ファイル側の記述/)
  })

  test("取材メモも両方を載せる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "reality-source.md": "# 取材メモ\n統合ファイル側の記述。\n",
      "reality/events/名簿の改め.md": "# 名簿の改め\n分割ファイル側の記述。\n",
    })
    const out = await run(dir)
    assert.match(out, /統合ファイル側の記述/)
    assert.match(out, /分割ファイル側の記述/)
  })

  test("どのファイル由来かが分かる", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "wuxia/sects.md": "# 概観\n統合側。\n",
      "wuxia/sects/天真一刀流.md": "# 天真一刀流\n分割側。\n",
    })
    const out = await run(dir)
    assert.match(out, /wuxia\/sects\.md/)
    assert.match(out, /天真一刀流\.md/)
  })
})

// ============================================================
// 人物名の照合
// ============================================================

describe("人物名の照合", () => {
  test("姓の推定に失敗する人物も落とさない（一文字姓）", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/森田悠.md": "# 森田悠\n森田の設定。\n",
      "characters/林美咲.md": "# 林美咲\n林の設定。\n",
      "outline-detailed.md": "# 章別\n\n## 第2章：会話\n森田が林に話しかける。\n",
    })
    const out = await run(dir)
    assert.match(out, /森田の設定/)
    assert.match(out, /林の設定/, "先頭2文字が姓でない人物が落ちている")
  })

  test("名だけで書かれていても拾う", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/杉本千尋.md": "# 杉本千尋\n千尋の設定。\n",
      "characters/鏡味征一.md": "# 鏡味征一\n鏡味の設定。\n",
      "outline-detailed.md": "# 章別\n\n## 第2章\n千尋は黙っていた。\n",
    })
    const out = await run(dir)
    assert.match(out, /千尋の設定/)
    assert.doesNotMatch(out, /鏡味の設定/)
  })

  test("呼称が書かれていればそれで拾う", async () => {
    const dir = makeProject({
      "config.json": CONFIG,
      "characters/鏡味征一.md": "# 鏡味征一\n- **呼称**：教頭、鏡味先生\n鏡味の設定。\n",
      "characters/柳井久子.md": "# 柳井久子\n柳井の設定。\n",
      "outline-detailed.md": "# 章別\n\n## 第2章\n教頭が前例を持ち出す。\n",
    })
    const out = await run(dir)
    assert.match(out, /鏡味の設定/, "呼称で拾えていない")
    assert.doesNotMatch(out, /柳井の設定/)
  })
})

describe("characterNameKeys", () => {
  test("姓と名の両方を手がかりにする", () => {
    const { strong, weak } = characterNameKeys("森田悠")
    assert.ok(strong.includes("森田悠"))
    assert.ok(strong.includes("森田"))
    assert.ok(strong.includes("田悠"))
    assert.ok(weak.includes("森"))
    assert.ok(weak.includes("悠"))
  })

  test("一文字は weak に入る（拾いすぎを防ぐため二段目で使う）", () => {
    const { strong, weak } = characterNameKeys("林美咲")
    assert.ok(!strong.includes("林"))
    assert.ok(weak.includes("林"))
  })

  test("呼称を手がかりに加える", () => {
    const { strong } = characterNameKeys("鏡味征一", ["教頭", "鏡味先生"])
    assert.ok(strong.includes("教頭"))
    assert.ok(strong.includes("鏡味先生"))
  })
})

describe("extractNameAliases", () => {
  test("呼称の行を読み取る", () => {
    assert.deepEqual(extractNameAliases("- **呼称**：森田、先生\n"), ["森田", "先生"])
  })

  test("別名・通称・愛称も読み取る", () => {
    assert.deepEqual(extractNameAliases("別名: ちひろ\n"), ["ちひろ"])
    assert.deepEqual(extractNameAliases("通称：教頭\n"), ["教頭"])
  })

  test("書かれていなければ空", () => {
    assert.deepEqual(extractNameAliases("# 森田悠\n38歳、国語教師。\n"), [])
  })
})

// ============================================================
// 進行表示との整合
// ============================================================

describe("進行表示と分割保存の整合", () => {
  const base = {
    "config.json": CONFIG,
    "concept.md": "# C\n書き終えた内容。\n",
    "world-building.md": "# W\n書き終えた内容。\n",
    "characters/profiles.md": "# P\n書き終えた内容。\n",
    "outline-brief.md": "# B\n書き終えた内容。\n",
  }

  test("分割保存だけの作品で、工程一覧が未作成にならない", async () => {
    const dir = makeProject({
      ...base,
      "outline/chapter-001.md": "# 第1章\n内容。\n",
      "scenes/chapter-001.md": "### 1.1 場面\n- [ ] **状態**：未着手\n",
    })
    const out = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(out, /✅ 章別プロット/, "分割されているのに未作成と出ている")
    assert.match(out, /✅ シーン一覧/, "分割されているのに未作成と出ている")
  })

  test("現在の段階と工程一覧が食い違わない", async () => {
    const dir = makeProject({
      ...base,
      "outline/chapter-001.md": "# 第1章\n内容。\n",
      "scenes/chapter-001.md": "### 1.1 場面\n- [ ] **状態**：未着手\n",
    })
    assert.equal(determinePhase(dir), "writing")
    const out = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(out, /現在の段階: ✍️ 本文執筆/)
    assert.doesNotMatch(out, /⬜ 章別プロット/)
    assert.doesNotMatch(out, /⬜ シーン一覧/)
  })

  test("分割されたシーンも進捗に数える", async () => {
    const dir = makeProject({
      ...base,
      "outline/chapter-001.md": "# 第1章\n内容。\n",
      "scenes/chapter-001.md": "### 1.1 場面\n- [x] **状態**：完了\n### 1.2 場面\n- [ ] **状態**：未着手\n",
      "scenes/chapter-002.md": "### 2.1 場面\n- [-] **状態**：執筆中\n",
    })
    const out = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(out, /シーンの進捗/, "分割されたシーンが集計されていない")
    assert.match(out, /\(1\/3\)/, "3シーン中1件完了として数えられていない")
    assert.match(out, /執筆中: 1シーン/)
  })

  test("統合ファイルと分割ファイルの両方を数える", async () => {
    const dir = makeProject({
      ...base,
      "outline-detailed.md": "# 章別\n\n## 第1章\n内容。\n",
      "scenes.md": "### 1.1 場面\n- [x] **状態**：完了\n",
      "scenes/chapter-002.md": "### 2.1 場面\n- [ ] **状態**：未着手\n",
    })
    const out = await novelStatusExecute({ detailed: true } as any, { directory: dir } as any)
    assert.match(out, /\(1\/2\)/)
  })
})
