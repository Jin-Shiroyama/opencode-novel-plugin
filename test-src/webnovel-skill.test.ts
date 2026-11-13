import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { checkTypography } from "../src/typography.js"

/**
 * novel-webnovel skill の書式の作例（ステータス画面・通知・掲示板回・配信回・別視点の回）が、
 * 表記の点検で何も拾われないことを確かめる。
 *
 * 作例が規約から外れていると、モデルは作例どおりに書いて保存のたびに ❌ を受け、直して画面の体裁を崩す。
 * skill は test-src/prepare-test-out.mjs が test-out/skills/ に写したものを読む。
 */

const here = dirname(fileURLToPath(import.meta.url))
const skill = readFileSync(join(here, "..", "skills", "novel-webnovel", "SKILL.md"), "utf-8")

/** ```text で囲んだ作例を取り出す */
function textBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1])
}

describe("novel-webnovel skill の作例", () => {
  const blocks = textBlocks(skill)

  test("書式の作例が5つ以上ある", () => {
    assert.ok(blocks.length >= 5, `作例は ${blocks.length} 個`)
  })

  for (const [i, block] of blocks.entries()) {
    test(`作例${i + 1}は表記の点検で何も拾われない（${block.split("\n")[0]}）`, () => {
      const issues = checkTypography(block).map((x) => `${x.line}行 ${x.rule}: ${x.message}（${x.excerpt}）`)
      assert.deepEqual(issues, [])
    })
  }

  test("書き比べの作例（引用の中の ✅）も、規約どおりの字下げと約物になっている", () => {
    // 「✅」の見出しから次の「**どこが違うか**」までの引用を本文として点検する
    const good = [...skill.matchAll(/✅[^\n]*\n((?:> [^\n]*\n)+)/g)].map((m) => m[1].replace(/^> /gm, ""))
    assert.ok(good.length >= 3)
    for (const text of good) {
      assert.deepEqual(checkTypography(text).filter((x) => x.severity === "error"), [])
    }
  })
})
