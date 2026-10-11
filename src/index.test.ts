import { test, describe, before } from "node:test"
import assert from "node:assert/strict"

/**
 * config フックの結合テスト。
 *
 * 実際のリポジトリの commands/ を読み、OpenCode に渡る設定が
 * 期待どおりかを見る。コマンドの agent 指定が落ちると、専用 agent の
 * プロンプト・温度・権限に切り替わらないまま実行される。
 */

type CommandConfig = { template: string; description?: string; agent?: string }
let config: { command: Record<string, CommandConfig>; agent: Record<string, any> }

before(async () => {
  const mod = await import("./index.js")
  const hooks = await (mod.default as any).server({})
  const c: any = {}
  await hooks.config(c)
  config = c
})

describe("コマンドの agent 指定", () => {
  const expected: Record<string, string> = {
    novel: "novel-planner",
    "novel-init": "novel-planner",
    "novel-concept": "novel-planner",
    "novel-world": "novel-planner",
    "novel-characters": "novel-planner",
    "novel-outline": "novel-planner",
    "novel-scenes": "novel-planner",
    "novel-reality": "novel-planner",
    "write-chapter": "novel-writer",
    "novel-review": "novel-editor",
  }

  for (const [name, agent] of Object.entries(expected)) {
    test(`/${name} は ${agent} で動く`, () => {
      const cmd = config.command[name]
      assert.ok(cmd, `コマンド ${name} が登録されていない`)
      assert.equal(cmd.agent, agent, `agent が落ちているか違っている`)
    })
  }

  test("agent を指定しないコマンドは未設定のまま（現在の agent で動く）", () => {
    // /novel-status は状態を見るだけなので、どの agent でも差し支えない
    assert.equal(config.command["novel-status"].agent, undefined)
  })

  test("指定された agent はすべて登録済みの agent である", () => {
    for (const [name, cmd] of Object.entries(config.command)) {
      if (!cmd.agent) continue
      assert.ok(config.agent[cmd.agent], `${name} が未登録の agent ${cmd.agent} を指している`)
    }
  })
})

describe("コマンドの登録", () => {
  test("11 のコマンドが登録される", () => {
    assert.equal(Object.keys(config.command).length, 11)
  })

  test("description と template が入っている", () => {
    for (const [name, cmd] of Object.entries(config.command)) {
      assert.ok(cmd.template && cmd.template.length > 0, `${name} の template が空`)
      assert.ok(cmd.description && cmd.description.length > 0, `${name} の description が空`)
    }
  })

  test("template に frontmatter が残っていない", () => {
    for (const [name, cmd] of Object.entries(config.command)) {
      assert.doesNotMatch(cmd.template, /^---/, `${name} の template に frontmatter が残っている`)
      assert.doesNotMatch(cmd.template, /^description:/m, `${name} の template に frontmatter が残っている`)
    }
  })

  test("OpenCode が受け付けないキーを渡していない", () => {
    const allowed = new Set(["template", "description", "agent", "model", "subtask"])
    for (const [name, cmd] of Object.entries(config.command)) {
      for (const key of Object.keys(cmd)) {
        assert.ok(allowed.has(key), `${name} に未対応のキー ${key} を渡している`)
      }
    }
  })
})

describe("agent の登録", () => {
  test("3 つの agent が primary で登録される", () => {
    for (const name of ["novel-planner", "novel-writer", "novel-editor"]) {
      assert.ok(config.agent[name], `${name} が登録されていない`)
      assert.equal(config.agent[name].mode, "primary")
    }
  })
})
