import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFrontmatter, loadCommands, COMMAND_CONFIG_KEYS } from "./commands.js"

/**
 * コマンド定義の読み込みのテスト。
 *
 * OpenCode の command 設定が受け付けるのは template / description / agent /
 * model / subtask の5つ（@opencode-ai/sdk の Config 型）。
 * frontmatter の agent を落とすと、専用 agent のプロンプト・温度・権限に
 * 切り替わらないまま現在の agent で実行される。
 */

function makeCommandsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cmds-"))
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, "utf-8")
  }
  return dir
}

// ============================================================
// frontmatter の解析
// ============================================================

describe("parseFrontmatter", () => {
  test("キーと値を読み取る", () => {
    const { data, body } = parseFrontmatter("---\ndescription: 説明\nagent: novel-writer\n---\n\n本文\n")
    assert.deepEqual(data, { description: "説明", agent: "novel-writer" })
    assert.equal(body, "本文")
  })

  test("値に含まれるコロンを落とさない", () => {
    const { data } = parseFrontmatter("---\ndescription: 審稿 — 対象: 全章\n---\n本文\n")
    assert.equal(data.description, "審稿 — 対象: 全章")
  })

  test("引用符を外す", () => {
    const { data } = parseFrontmatter('---\nargument-hint: "<章番号>"\nfoo: \'bar\'\n---\n本文\n')
    assert.equal(data["argument-hint"], "<章番号>")
    assert.equal(data.foo, "bar")
  })

  test("CRLF でも読み取る", () => {
    const { data, body } = parseFrontmatter("---\r\nagent: novel-editor\r\n---\r\n\r\n本文\r\n")
    assert.equal(data.agent, "novel-editor")
    assert.match(body, /本文/)
  })

  test("BOM があっても読み取る", () => {
    const { data } = parseFrontmatter("﻿---\nagent: novel-planner\n---\n本文\n")
    assert.equal(data.agent, "novel-planner")
  })

  test("空行とコメントを飛ばす", () => {
    const { data } = parseFrontmatter("---\n\n# これはコメント\nagent: novel-writer\n\n---\n本文\n")
    assert.deepEqual(data, { agent: "novel-writer" })
  })

  test("frontmatter が無ければ空のまま全文を本文にする", () => {
    const { data, body } = parseFrontmatter("本文だけ\n")
    assert.deepEqual(data, {})
    assert.equal(body, "本文だけ")
  })

  test("閉じられていない frontmatter は本文として扱う", () => {
    const raw = "---\nagent: novel-writer\n本文\n"
    const { data, body } = parseFrontmatter(raw)
    assert.deepEqual(data, {})
    assert.equal(body, raw.trim())
  })

  test("本文中の --- を区切りと誤認しない", () => {
    const { data, body } = parseFrontmatter("---\nagent: novel-writer\n---\n\n## 見出し\n\n---\n\n続き\n")
    assert.equal(data.agent, "novel-writer")
    assert.match(body, /## 見出し/)
    assert.match(body, /続き/)
  })
})

// ============================================================
// コマンドの読み込み
// ============================================================

describe("loadCommands", () => {
  test("agent を落とさない", () => {
    const dir = makeCommandsDir({
      "foo.md": "---\ndescription: 説明\nagent: novel-writer\n---\n\n本文\n",
    })
    const cmds = loadCommands(dir)
    assert.equal(cmds.foo.agent, "novel-writer", "agent が落ちている")
    assert.equal(cmds.foo.description, "説明")
    assert.equal(cmds.foo.template, "本文")
  })

  test("model と subtask も渡す", () => {
    const dir = makeCommandsDir({
      "foo.md": "---\nagent: novel-editor\nmodel: anthropic/claude-opus-5\nsubtask: true\n---\n本文\n",
    })
    const cmds = loadCommands(dir)
    assert.equal(cmds.foo.model, "anthropic/claude-opus-5")
    assert.equal(cmds.foo.subtask, true)
  })

  test("subtask を真偽値にする", () => {
    const dir = makeCommandsDir({
      "t.md": "---\nsubtask: true\n---\n本文\n",
      "f.md": "---\nsubtask: false\n---\n本文\n",
    })
    const cmds = loadCommands(dir)
    assert.equal(cmds.t.subtask, true)
    assert.equal(cmds.f.subtask, false)
  })

  test("OpenCode が受け付けないキーは渡さない", () => {
    // argument-hint は Claude Code の慣習で、OpenCode の command 設定にはない。
    // 渡すと設定の検証で落ちる恐れがあるため、人が読む情報として残すだけにする。
    const dir = makeCommandsDir({
      "foo.md": '---\ndescription: 説明\nargument-hint: "<章番号>"\nunknown: x\n---\n本文\n',
    })
    const cmds = loadCommands(dir)
    assert.deepEqual(Object.keys(cmds.foo).sort(), ["description", "template"])
  })

  test("渡すキーは Config 型に合わせた一覧だけ", () => {
    assert.deepEqual([...COMMAND_CONFIG_KEYS].sort(), ["agent", "description", "model", "subtask"])
  })

  test("frontmatter が無くても読み込む", () => {
    const dir = makeCommandsDir({ "foo.md": "本文だけ\n" })
    const cmds = loadCommands(dir)
    assert.equal(cmds.foo.template, "本文だけ")
    assert.equal(cmds.foo.description, undefined)
  })

  test(".md 以外は読み込まない", () => {
    const dir = makeCommandsDir({ "foo.md": "本文\n", "memo.txt": "ちがう\n" })
    assert.deepEqual(Object.keys(loadCommands(dir)), ["foo"])
  })

  test("ディレクトリが無ければ空", () => {
    assert.deepEqual(loadCommands(join(tmpdir(), "no-such-dir-" + Date.now())), {})
  })
})
