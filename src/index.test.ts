import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_MODEL } from "./constants.js"

/**
 * config フックの結合テスト。
 *
 * 実際のリポジトリの commands/ を読み、OpenCode に渡る設定が
 * 期待どおりかを見る。コマンドの agent 指定が落ちると、専用 agent の
 * プロンプト・温度・権限に切り替わらないまま実行される。
 */

type CommandConfig = { template: string; description?: string; agent?: string }
let config: { command: Record<string, CommandConfig>; agent: Record<string, any> }

/** config フックを、与えた設定に対して走らせる */
async function applyConfig(userConfig: Record<string, any> = {}): Promise<any> {
  const mod = await import("./index.js")
  const hooks = await (mod.default as any).server({})
  const c = structuredClone(userConfig)
  await hooks.config(c)
  return c
}

before(async () => {
  config = await applyConfig()
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

describe("opencode.json 側の agent 設定の優先", () => {
  test("利用者が指定した model が勝つ", async () => {
    const c = await applyConfig({ agent: { "novel-writer": { model: "anthropic/claude-haiku-4-5-20251001" } } })
    assert.equal(c.agent["novel-writer"].model, "anthropic/claude-haiku-4-5-20251001")
  })

  test("指定していないキーはプラグインの既定が残る", async () => {
    // 以前は agent ごとまるごと置き換えていたため、利用者が model を書くと
    // プロンプトや温度まで消えていた
    const c = await applyConfig({ agent: { "novel-writer": { model: "x" } } })
    assert.equal(c.agent["novel-writer"].temperature, 0.7)
    assert.ok(c.agent["novel-writer"].prompt?.length > 0, "プロンプトが失われている")
    assert.equal(c.agent["novel-writer"].mode, "primary")
  })

  test("指定していない agent は既定のまま", async () => {
    const c = await applyConfig({ agent: { "novel-writer": { model: "x" } } })
    assert.equal(c.agent["novel-planner"].model, DEFAULT_MODEL)
    assert.equal(c.agent["novel-editor"].model, DEFAULT_MODEL)
  })

  test("利用者の他の agent を消さない", async () => {
    const c = await applyConfig({ agent: { build: { model: "x" }, "my-agent": { prompt: "p" } } })
    for (const name of ["build", "my-agent", "novel-planner", "novel-writer", "novel-editor"]) {
      assert.ok(c.agent[name], `${name} が消えている`)
    }
  })

  test("mode も利用者の指定で上書きできる", async () => {
    const c = await applyConfig({ agent: { "novel-editor": { mode: "subagent" } } })
    assert.equal(c.agent["novel-editor"].mode, "subagent")
  })

  test("agent 設定が無くても落ちない", async () => {
    for (const userConfig of [{}, { agent: undefined }, { agent: {} }]) {
      const c = await applyConfig(userConfig)
      assert.equal(c.agent["novel-writer"].model, DEFAULT_MODEL)
    }
  })

  test("OpenCode が足す空の permission / options で、プラグインの権限を消さない", async () => {
    // OpenCode は config フックに渡す前に、利用者の agent 設定へ options: {} と
    // permission: {} を足す。model しか書いていなくても、この形で渡ってくる。
    // 以前はこれでプラグインの権限が消え、writer が OpenCode の既定（すべて許可）で動いていた
    const c = await applyConfig({
      agent: { "novel-writer": { model: "x", options: {}, permission: {} } },
    })
    assert.equal(c.agent["novel-writer"].model, "x")
    assert.equal(c.agent["novel-writer"].permission.webfetch, "deny")
    assert.equal(c.agent["novel-writer"].permission.edit, "allow")
  })

  test("permission は利用者が書いたキーだけが勝ち、ほかはプラグインの既定が残る", async () => {
    const c = await applyConfig({ agent: { "novel-writer": { permission: { edit: "ask", bash: "deny" } } } })
    assert.equal(c.agent["novel-writer"].permission.edit, "ask")
    assert.equal(c.agent["novel-writer"].permission.bash, "deny")
    assert.equal(c.agent["novel-writer"].permission.webfetch, "deny")
  })

  test("permission の中の1つのキーの値は丸ごと入れ替える", async () => {
    const c = await applyConfig({
      agent: { "novel-editor": { permission: { bash: { "*": "ask", "git *": "allow" } } } },
    })
    assert.deepEqual(c.agent["novel-editor"].permission.bash, { "*": "ask", "git *": "allow" })
  })

  test("options も中身ごと重ねる", async () => {
    const c = await applyConfig({ agent: { "novel-planner": { options: { foo: 1 } } } })
    assert.deepEqual(c.agent["novel-planner"].options, { foo: 1 })
  })
})
