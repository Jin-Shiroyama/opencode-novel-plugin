import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  parseCharacterUpdates, parseForeshadowUpdates, parseSummaryInput, upsertSummarySections,
  buildSummaryContext, summaryChapters, splitForeshadowEntries, formatChapterRanges,
} from "./records.js"
import { isUntouchedTemplate, fillTemplateVars, REALITY_SOURCE_TEMPLATE, SUMMARY_TEMPLATE } from "./templates.js"

/**
 * 記録の形の検証と、あらすじを章ごとの節で持つ処理の単体テスト。
 *
 * 入力の例は、実際に15章を書いた作品で novel_update に渡された形から取っている。
 */

describe("parseCharacterUpdates", () => {
  test("changes に知らないキーがあれば断り、キー名を示す（state / change / inner）", () => {
    const r = parseCharacterUpdates(
      JSON.stringify({ updates: [{ name: "レン", changes: { state: "重傷", change: "剣を失う", inner: "…" } }] }),
    )
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.message, /1件も書き込んでいません/)
    assert.match(r.message, /"state"/)
    assert.match(r.message, /"inner"/)
    assert.match(r.message, /正しい形の例/)
  })

  test("changes が無ければ断る（以前は例外で落ちていた）", () => {
    const r = parseCharacterUpdates(JSON.stringify({ updates: [{ name: "レン", status: "active" }] }))
    assert.equal(r.ok, false)
  })

  test("最上位が updates でなければ断る（人物名をキーにした形）", () => {
    const r = parseCharacterUpdates(JSON.stringify({ レン: { 状態: "健在" } }))
    assert.equal(r.ok, false)
  })

  test("changes が空なら断る", () => {
    const r = parseCharacterUpdates(JSON.stringify({ updates: [{ name: "レン", changes: {} }] }))
    assert.equal(r.ok, false)
  })

  test("status の値を確かめる", () => {
    const r = parseCharacterUpdates(JSON.stringify({ updates: [{ name: "レン", changes: { status: "健在" } }] }))
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.message, /"active"/)
  })

  test("JSON でなければ断る", () => {
    assert.equal(parseCharacterUpdates("レン：重傷・意識不明").ok, false)
  })

  test("正しい形は通す", () => {
    const r = parseCharacterUpdates(
      JSON.stringify({
        updates: [{ name: "レン", changes: { mentalState: "覚悟", items: { added: ["剣"] }, events: ["出立"] } }],
      }),
    )
    assert.equal(r.ok, true)
  })
})

describe("parseForeshadowUpdates", () => {
  const existing = new Set(["F1", "F2"])

  test("日本語の status は断り、近い値を添える（読み替えはしない）", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", status: "回収済み" }] }), existing)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.message, /"resolved"/)
    assert.match(r.message, /回収したなら/)
  })

  test("「補強済み」には status を変えず notes に書くよう案内する", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", status: "補強済み" }] }), existing)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.message, /notes/)
  })

  test("独自のキー（detail / resolveChapter）は断る", () => {
    const r = parseForeshadowUpdates(
      JSON.stringify({ items: [{ id: "F4", status: "planted", detail: "青白い光", resolveChapter: 9 }] }),
      existing,
    )
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.match(r.message, /"detail"/)
      assert.match(r.message, /"resolveChapter"/)
    }
  })

  test("id をキーにしたオブジェクトの形は断る", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ F1: { 状態: "張った" } }), existing)
    assert.equal(r.ok, false)
  })

  test("新しい伏線には title と content が要る", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F9", status: "planted" }] }), existing)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.message, /title, content が必要/)
  })

  test("既存の伏線は id と変える項目だけでよい", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", status: "resolved" }] }), existing)
    assert.equal(r.ok, true)
  })

  test("removeKeys は記録にある伏線の独自のキーにだけ使える", () => {
    assert.equal(parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", removeKeys: ["detail"] }] }), existing).ok, true)
    assert.equal(
      parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F9", title: "t", content: "c", removeKeys: ["detail"] }] }), existing).ok,
      false,
    )
    assert.equal(parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", removeKeys: ["notes"] }] }), existing).ok, false)
  })

  test("章番号の null は受け付ける（消すため）", () => {
    const r = parseForeshadowUpdates(JSON.stringify({ items: [{ id: "F1", targetChapter: null }] }), existing)
    assert.equal(r.ok, true)
  })
})

describe("splitForeshadowEntries", () => {
  test("形の崩れた保存済みの記録を分ける", () => {
    const { valid, invalid } = splitForeshadowEntries([
      { id: "F1", title: "花", content: "青い花", category: "mystery", status: "resolved" },
      { id: "F2", title: "過去", content: "北の荒野", category: "mystery", status: "回収済み" },
      { id: "F4", status: "補強済み", detail: "光", resolveChapter: 9 },
    ])
    assert.deepEqual(valid.map((f) => f.id), ["F1"])
    assert.deepEqual(invalid.map((x) => x.id), ["F2", "F4"])
    assert.ok(invalid[1].problems.some((p) => p.includes("detail")))
  })

  test("入力と同じ基準で確かめる（id の欠落、章番号の型の誤り）", () => {
    const base = { title: "花", content: "青い花", status: "planted" }
    const { valid, invalid } = splitForeshadowEntries([
      { ...base },
      { ...base, id: "F2", targetChapter: "十二" },
      { ...base, id: "F3", targetChapter: 12 },
      { ...base, id: "F4", targetChapter: null },
    ])
    assert.deepEqual(valid.map((f) => f.id), ["F3", "F4"])
    assert.deepEqual(invalid.map((x) => x.id), ["#1", "F2"])
    assert.ok(invalid[0].problems.some((p) => p.startsWith("id")))
    assert.ok(invalid[1].problems.some((p) => p.startsWith("targetChapter")))
  })
})

describe("parseSummaryInput", () => {
  test("見出しが無く chapterNumber も無ければ断る", () => {
    assert.equal(parseSummaryInput("峠を下りた。", undefined).ok, false)
  })

  test("見出しが無ければ chapterNumber の章として扱う", () => {
    const r = parseSummaryInput("峠を下りた。", 12)
    assert.ok(r.ok)
    if (r.ok) assert.equal(r.value[0].chapter, 12)
  })

  test("見出しから章番号を読む（chapterNumber が無くてもよい）", () => {
    const r = parseSummaryInput("## 第8章：峠の宿場\n\n最後の峠の宿場に着く。", undefined)
    assert.ok(r.ok)
    if (r.ok) assert.equal(r.value[0].chapter, 8)
  })

  test("漢数字の見出しも読む", () => {
    const r = parseSummaryInput("## 第十二章 規則を読む\n\n砂の地図。", undefined)
    assert.ok(r.ok)
    if (r.ok) assert.equal(r.value[0].chapter, 12)
  })

  test("chapterNumber と見出しの章が違えば断る", () => {
    assert.equal(parseSummaryInput("## 第8章\n\n本文", 9).ok, false)
  })

  test("見出しより前に本文があれば断る（どの章のものか決められない）", () => {
    assert.equal(parseSummaryInput("前置き\n\n## 第8章\n\n本文", undefined).ok, false)
  })

  test("章でも全体の流れでもない見出しは断る", () => {
    assert.equal(parseSummaryInput("## 主要人物の現状\n\nレンは…", 3).ok, false)
  })

  test("題の行は捨ててよい", () => {
    assert.ok(parseSummaryInput("# これまでのあらすじ\n\n## 第1章\n\n本文", undefined).ok)
  })
})

describe("upsertSummarySections", () => {
  const template = fillTemplateVars(SUMMARY_TEMPLATE, { title: "勇者の冒険" })

  const add = (current: string, content: string, chapter?: number) => {
    const r = parseSummaryInput(content, chapter)
    assert.ok(r.ok, r.ok ? "" : r.message)
    return upsertSummarySections(current, r.ok ? r.value : [])
  }

  test("章ごとに渡しても前の章が残る（以前は丸ごと置き換えていた）", () => {
    let text = template
    text = add(text, "第1章の筋。", 1)
    text = add(text, "第2章の筋。", 2)
    text = add(text, "## 第3章 門の水\n\n第3章の筋。")
    assert.deepEqual(summaryChapters(text), [1, 2, 3])
    assert.match(text, /第1章の筋。/)
    assert.match(text, /^# 『勇者の冒険』これまでのあらすじ/)
  })

  test("同じ章は差し替え、章番号順に並べる", () => {
    let text = template
    text = add(text, "三。", 3)
    text = add(text, "一。", 1)
    text = add(text, "一の改。", 1)
    assert.ok(text.indexOf("一の改。") < text.indexOf("三。"))
    assert.ok(!text.includes("一。\n"))
  })

  test("全体の流れを差し替え、何章までの要約かを見出しに残す", () => {
    let text = add(template, "第1章の筋。", 1)
    text = add(text, "## 全体の流れ\n\n村を出て王都へ。", 1)
    assert.match(text, /## 全体の流れ（第1章まで）\n\n村を出て王都へ。/)
    assert.ok(text.indexOf("全体の流れ") < text.indexOf("## 第1章"))
    text = add(text, "## 全体の流れ（第2章まで）\n\n王都で触れを受ける。")
    assert.match(text, /## 全体の流れ（第2章まで）\n\n王都で触れを受ける。/)
    assert.doesNotMatch(text, /村を出て王都へ。/)
  })

  test("全体の流れは何章までの要約か分からなければ断る", () => {
    assert.equal(parseSummaryInput("## 全体の流れ\n\n村を出て王都へ。", undefined).ok, false)
  })

  test("旧形式の雛形の未記入の節は捨てる", () => {
    const old = `# 『勇者の冒険』これまでのあらすじ\n\n## 物語の進み\n\n[第1章ができたら書き入れます]\n\n## 主要人物の現状\n\n[人物が登場したら書き入れます]\n`
    const text = add(old, "第1章の筋。", 1)
    assert.ok(!text.includes("物語の進み"))
  })
})

describe("buildSummaryContext", () => {
  const text = [
    "# 題",
    "> 説明",
    "## 全体の流れ（第5章まで）",
    "村から王都へ。",
    ...[1, 2, 3, 4, 5].map((n) => `## 第${n}章\n${"筋".repeat(100)}${n}`),
  ].join("\n\n")

  test("書く章より前の章だけを載せる（先の章は混ぜない）", () => {
    const out = buildSummaryContext(text, 3, 4000)
    assert.match(out, /### 第1章/)
    assert.match(out, /### 第2章/)
    assert.doesNotMatch(out, /第3章/)
    assert.doesNotMatch(out, /> 説明/)
  })

  test("枠が足りなければ古い章から落とし、直前の章を残す", () => {
    const out = buildSummaryContext(text, 6, 350)
    assert.match(out, /### 第5章/)
    assert.doesNotMatch(out, /### 第1章/)
    assert.match(out, /第1〜\d章のあらすじは枠に収まらないため省略/)
    assert.match(out, /全体の流れ（第5章まで）\n村から王都へ。/)
  })

  test("全体の流れが書く章以降を含むなら載せない（先の出来事を混ぜない）", () => {
    const summary = "## 全体の流れ（第10章まで）\n\n第10章で相棒が死亡する。\n\n## 第1章\n\n一。"
    const out = buildSummaryContext(summary, 2, 4000)
    assert.doesNotMatch(out, /相棒が死亡/)
    assert.match(out, /第10章までの要約で、この章より先を含むため載せていません/)
    assert.match(buildSummaryContext(summary, 11, 4000), /相棒が死亡/)
  })

  test("見出しに範囲の無い全体の流れは、記録のある最後の章までの要約とみなす", () => {
    const summary = "## 全体の流れ\n\n手書きの要約。\n\n## 第1章\n\n一。\n\n## 第4章\n\n四。"
    assert.doesNotMatch(buildSummaryContext(summary, 3, 4000), /手書きの要約/)
    assert.match(buildSummaryContext(summary, 5, 4000), /手書きの要約/)
  })

  test("旧形式の記述は、章の節を足したあとも資料に残る", () => {
    const legacy = "# 題\n\n## 物語の進み\n\n第1〜2章の筋。\n\n## 主要人物の現状\n\nレンは旅立った。\n"
    const r = parseSummaryInput("第3章の筋。", 3)
    assert.ok(r.ok)
    const text = upsertSummarySections(legacy, r.ok ? r.value : [])
    const out = buildSummaryContext(text, 4, 4000)
    assert.match(out, /以前の形式のあらすじ/)
    assert.match(out, /第1〜2章の筋。/)
    assert.match(out, /レンは旅立った。/)
    assert.match(out, /### 第3章\n第3章の筋。/)
  })

  test("移すときの範囲は、移す前の章の節の最大章番号を下回らない（呼び手が小さい値を渡しても）", () => {
    const legacy = "## 物語の進み\n\n第1〜10章の筋。\n\n## 第11章\n\n十一。"
    const r = parseSummaryInput("二。", 2)
    assert.ok(r.ok)
    const text = upsertSummarySections(legacy, r.ok ? r.value : [], 0)
    assert.match(text, /## 以前の形式のあらすじ（第11章まで）/)
    assert.doesNotMatch(buildSummaryContext(text, 3, 4000), /第1〜10章の筋。/)
  })

  test("旧形式の記述は、最初の章の節より前の章を書くときは載せない", () => {
    const text = "## 物語の進み\n\n第1〜4章の筋。\n\n## 第5章\n\n五。"
    assert.doesNotMatch(buildSummaryContext(text, 3, 4000), /第1〜4章の筋。/)
    assert.match(buildSummaryContext(text, 6, 4000), /第1〜4章の筋。/)
  })

  test("記録の無い章を知らせる", () => {
    const out = buildSummaryContext("## 第1章\n一。\n\n## 第3章\n三。", 5, 4000)
    assert.match(out, /あらすじの記録が無い章: 第2章、第4章/)
  })

  test("章の節が無い旧形式は先頭から載せる", () => {
    const out = buildSummaryContext("# 題\n\n北の村の話。レンが旅立つ。", 2, 4000)
    assert.match(out, /北の村の話/)
  })

  test("雛形のままなら何も載せない", () => {
    const empty = fillTemplateVars(SUMMARY_TEMPLATE, { title: "題" })
    assert.equal(buildSummaryContext(empty, 2, 4000), "⚠️ あらすじの記録が無い章: 第1章")
  })
})

describe("isUntouchedTemplate", () => {
  test("差し込み箇所が何であっても雛形のままなら true", () => {
    const filled = fillTemplateVars(REALITY_SOURCE_TEMPLATE, { title: "勇者の冒険", genre: "異世界" })
    assert.equal(isUntouchedTemplate(filled, REALITY_SOURCE_TEMPLATE), true)
  })

  test("一部でも書き込んであれば false", () => {
    const filled = fillTemplateVars(REALITY_SOURCE_TEMPLATE, { title: "勇者の冒険" })
    const edited = filled.replace("[見出し]", "北辺境の飢饉")
    assert.equal(isUntouchedTemplate(edited, REALITY_SOURCE_TEMPLATE), false)
  })
})

test("formatChapterRanges は連続する章をまとめる", () => {
  assert.equal(formatChapterRanges([1, 2, 3, 5, 7, 8]), "第1〜3章、第5章、第7〜8章")
})
