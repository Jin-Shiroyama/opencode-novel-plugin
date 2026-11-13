import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createNovelWriterAgent } from "../src/agents/novel-writer.js"

/**
 * novel-writer agent のプロンプトのテスト。
 *
 * 既定が「書き上げる」であること、作品の種類ごとの書き方を skill に任せていること
 * （指している skill が実在し、移した節がそこにあること）を確かめる。
 */

const here = dirname(fileURLToPath(import.meta.url))
const skillPath = (name: string) => join(here, "..", "skills", name, "SKILL.md")
const agent = createNovelWriterAgent()
const prompt = agent.prompt as string

describe("novel-writer agent", () => {
  test("書き手として、既定で1章を書き上げる（相談は頼まれたときだけ）", () => {
    assert.match(prompt, /^あなたは日本語の小説の書き手です/)
    assert.match(prompt, /既定は「書き上げる」/)
    assert.match(prompt, /相談しながら書くのは、頼まれたときだけ/)
    assert.doesNotMatch(prompt, /執筆コーチ|代わりに書いてしまうのではなく/)
    assert.doesNotMatch(agent.description as string, /コーチ|Coach/)
  })

  test("プロンプトが指す skill は実在する", () => {
    const names = [...new Set([...prompt.matchAll(/`(novel-[a-z]+)`/g)].map((m) => m[1]))]
    assert.deepEqual(names.sort(), ["novel-fanfic", "novel-reality", "novel-webnovel", "novel-writing", "novel-wuxia"])
    for (const name of names) assert.ok(existsSync(skillPath(name)), name)
  })

  test("立ち合いと現実の素材の書き方は skill にあり、プロンプトは節の名前で指す", () => {
    // プロンプトには長い節を置かない
    assert.doesNotMatch(prompt, /## 立ち合いの場面|### 五つの原則|刀剣の書き分け/)
    const wuxia = readFileSync(skillPath("novel-wuxia"), "utf-8")
    assert.match(prompt, /「三、立ち合いの書きかた」/)
    assert.match(wuxia, /^## 三、立ち合いの書きかた$/m)
    assert.match(wuxia, /^### 3\.7 立ち合いの会話$/m)
    const reality = readFileSync(skillPath("novel-reality"), "utf-8")
    assert.match(prompt, /「本文に入れるとき」/)
    assert.match(reality, /^### 本文に入れるとき$/m)
    assert.match(reality, /\*\*言い当てない\*\*/)
  })

  test("温度と権限は変えていない", () => {
    assert.equal(agent.temperature, 0.7)
    assert.deepEqual(agent.permission, { edit: "allow", bash: "allow", webfetch: "deny", question: "allow" })
  })
})
