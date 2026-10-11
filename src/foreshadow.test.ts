import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { selectForeshadowReminders } from "./utils.js"
import type { ForeshadowEntry } from "./utils.js"
import { FORESHADOW_LOOKAHEAD } from "./constants.js"
import { novelContextExecute } from "./tools/context.js"

/**
 * 伏線の知らせ方のテスト。
 *
 * 終了した伏線（回収済み・取り下げ済み）を知らせると、書き手は済んだものを
 * もう一度回収しようとする。取り下げたものに「この章で回収」と出るのは特に困る。
 */

function item(over: Partial<ForeshadowEntry> & { id: string }): ForeshadowEntry {
  return {
    title: `伏線${over.id}`,
    content: `${over.id}の内容`,
    category: "event",
    status: "pending",
    ...over,
  }
}

// ============================================================
// 選び方
// ============================================================

describe("selectForeshadowReminders", () => {
  test("回収済みは知らせない", () => {
    const items = [item({ id: "F1", status: "resolved", targetChapter: 1, resolvedChapter: 1 })]
    assert.deepEqual(selectForeshadowReminders(items, 2), [])
  })

  test("取り下げ済みは知らせない", () => {
    const items = [item({ id: "F2", status: "abandoned", targetChapter: 2 })]
    assert.deepEqual(selectForeshadowReminders(items, 2), [])
  })

  test("回収済みでも targetChapter が近ければ知らせない", () => {
    // 以前は targetChapter の条件だけで拾っていたため、回収済みが出ていた
    const items = [
      item({ id: "F1", status: "resolved", targetChapter: 3, resolvedChapter: 1 }),
      item({ id: "F2", status: "abandoned", targetChapter: 2 }),
    ]
    assert.deepEqual(selectForeshadowReminders(items, 2), [])
  })

  test("張り済みは回収の章が遠くても知らせる", () => {
    const items = [item({ id: "F3", status: "planted", targetChapter: 31 })]
    const got = selectForeshadowReminders(items, 2)
    assert.deepEqual(got.map((r) => r.item.id), ["F3"])
    assert.equal(got[0].timing, "upcoming")
  })

  test("張り済みで回収の章が未定でも知らせる", () => {
    const items = [item({ id: "F3", status: "planted" })]
    const got = selectForeshadowReminders(items, 2)
    assert.deepEqual(got.map((r) => r.item.id), ["F3"])
    assert.equal(got[0].timing, "undated")
  })

  test("未着手は回収の章が近いときだけ知らせる", () => {
    const items = [
      item({ id: "近い", status: "pending", targetChapter: 2 + FORESHADOW_LOOKAHEAD }),
      item({ id: "遠い", status: "pending", targetChapter: 2 + FORESHADOW_LOOKAHEAD + 1 }),
      item({ id: "未定", status: "pending" }),
    ]
    assert.deepEqual(selectForeshadowReminders(items, 2).map((r) => r.item.id), ["近い"])
  })

  test("この章が回収予定なら due", () => {
    const got = selectForeshadowReminders([item({ id: "F", status: "planted", targetChapter: 5 })], 5)
    assert.equal(got[0].timing, "due")
  })

  test("回収予定を過ぎていれば overdue", () => {
    const got = selectForeshadowReminders([item({ id: "F", status: "planted", targetChapter: 1 })], 5)
    assert.equal(got[0].timing, "overdue")
  })

  test("未着手でも回収予定を過ぎていれば知らせる", () => {
    const got = selectForeshadowReminders([item({ id: "F", status: "pending", targetChapter: 1 })], 5)
    assert.deepEqual(got.map((r) => r.item.id), ["F"])
    assert.equal(got[0].timing, "overdue")
  })

  test("急ぐものから順に並べる", () => {
    const items = [
      item({ id: "未定", status: "planted" }),
      item({ id: "先", status: "planted", targetChapter: 8 }),
      item({ id: "今", status: "planted", targetChapter: 5 }),
      item({ id: "過ぎ", status: "planted", targetChapter: 2 }),
      item({ id: "もっと先", status: "planted", targetChapter: 20 }),
    ]
    assert.deepEqual(
      selectForeshadowReminders(items, 5).map((r) => r.item.id),
      ["過ぎ", "今", "先", "もっと先", "未定"],
    )
  })

  test("過ぎたものは予定が古い順に並べる", () => {
    const items = [
      item({ id: "少し前", status: "planted", targetChapter: 4 }),
      item({ id: "ずっと前", status: "planted", targetChapter: 1 }),
    ]
    assert.deepEqual(
      selectForeshadowReminders(items, 5).map((r) => r.item.id),
      ["ずっと前", "少し前"],
    )
  })

  test("知らせる章数は引数で変えられる", () => {
    const items = [item({ id: "F", status: "pending", targetChapter: 10 })]
    assert.deepEqual(selectForeshadowReminders(items, 2, 3).map((r) => r.item.id), [])
    assert.deepEqual(selectForeshadowReminders(items, 2, 8).map((r) => r.item.id), ["F"])
  })

  test("空でも落ちない", () => {
    assert.deepEqual(selectForeshadowReminders([], 1), [])
  })

  test("仕様から作った期待値と照合する（状態 × 回収予定の総当たり）", () => {
    // 仕様を下の if 文として書き直し、実装の結果と照合する。
    // 実装を単純化しすぎたり条件を取り違えたりすれば、ここで落ちる。
    //
    // 注意: README.ja.md や novel_guide の文章を読み取っているわけではない。
    // 文書と実装の一致は、文書を直すときに人が確かめる必要がある
    // （自然言語を機械で突き合わせる仕掛けは置いていない）。
    // 仕様の出どころは utils.ts の selectForeshadowReminders の説明。
    const chapterNum = 5
    const L = FORESHADOW_LOOKAHEAD
    const statuses: ForeshadowEntry["status"][] = ["pending", "planted", "resolved", "abandoned"]
    const targets = [undefined, 1, 4, 5, 6, chapterNum + L, chapterNum + L + 1, 30]

    for (const status of statuses) {
      for (const targetChapter of targets) {
        const got = selectForeshadowReminders([item({ id: "F", status, targetChapter })], chapterNum)

        let want: boolean
        if (status === "resolved" || status === "abandoned") {
          want = false // 終了したものは知らせない
        } else if (targetChapter !== undefined && targetChapter <= chapterNum) {
          want = true // 過ぎた・この章が予定なら状態を問わず知らせる
        } else if (status === "planted") {
          want = true // 張り済みは予定が遠くても知らせる
        } else {
          want = targetChapter !== undefined && targetChapter <= chapterNum + L
        }

        assert.equal(
          got.length > 0,
          want,
          `status=${status} targetChapter=${targetChapter} で仕様と食い違う`,
        )
      }
    }
  })
})

// ============================================================
// 資料に出る形
// ============================================================

describe("伏線の節", () => {
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

  function project(items: ForeshadowEntry[]): string {
    const dir = mkdtempSync(join(tmpdir(), "fs-"))
    for (const [rel, body] of Object.entries({
      "config.json": CONFIG,
      "foreshadow.json": JSON.stringify({ items }),
    })) {
      const p = join(dir, ".novel", rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body, "utf-8")
    }
    return dir
  }

  const section = async (items: ForeshadowEntry[], chapterNumber = 2) => {
    const out = await novelContextExecute(
      { chapterNumber, includePrompts: false } as any,
      { directory: project(items) } as any,
    )
    const parts = out.split("## 🎯 伏線の確認")
    return parts.length > 1 ? parts[1].split("\n\n")[0] : ""
  }

  test("回収済み・取り下げ済みは節に出ない", async () => {
    const sec = await section([
      item({ id: "F1", status: "resolved", targetChapter: 1, resolvedChapter: 1 }),
      item({ id: "F2", status: "abandoned", targetChapter: 2 }),
    ])
    assert.equal(sec, "", "終了した伏線だけなら節そのものが出ないこと")
  })

  test("取り下げ済みに「この章で回収」と出さない", async () => {
    const sec = await section([item({ id: "F2", status: "abandoned", targetChapter: 2 })])
    assert.doesNotMatch(sec, /この章で回収/)
  })

  test("この章が回収予定なら、この章で回収と出す", async () => {
    const sec = await section([item({ id: "F", status: "planted", targetChapter: 2 })])
    assert.match(sec, /この章で回収/)
  })

  test("回収予定を過ぎていれば、過ぎていると出す", async () => {
    const sec = await section([item({ id: "F", status: "planted", targetChapter: 1 })])
    assert.match(sec, /過ぎ/, "過ぎたことが分からない")
    assert.doesNotMatch(sec, /第1章で回収予定/, "まだ予定であるかのように出ている")
  })

  test("先の予定は第N章で回収予定と出す", async () => {
    const sec = await section([item({ id: "F", status: "planted", targetChapter: 31 })])
    assert.match(sec, /第31章で回収予定/)
  })

  test("張り済みかどうかが分かる", async () => {
    const sec = await section([
      item({ id: "張", status: "planted", targetChapter: 2 }),
      item({ id: "未", status: "pending", targetChapter: 2 }),
    ])
    assert.match(sec, /張り済み/)
    assert.match(sec, /まだ張っていません/)
  })

  test("終了したものを混ぜても、生きているものだけが出る", async () => {
    const sec = await section([
      item({ id: "F1", status: "resolved", targetChapter: 1, resolvedChapter: 1 }),
      item({ id: "F2", status: "abandoned", targetChapter: 2 }),
      item({ id: "F3", status: "planted", targetChapter: 31 }),
      item({ id: "F4", status: "pending", targetChapter: 4 }),
      item({ id: "F5", status: "pending", targetChapter: 30 }),
      item({ id: "F6", status: "planted", targetChapter: 1 }),
    ])
    for (const id of ["F3", "F4", "F6"]) assert.match(sec, new RegExp(`\\[${id}\\]`), `${id} が出ていない`)
    for (const id of ["F1", "F2", "F5"]) {
      assert.doesNotMatch(sec, new RegExp(`\\[${id}\\]`), `${id} が出ている`)
    }
  })
})
