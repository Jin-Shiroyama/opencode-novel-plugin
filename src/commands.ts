/**
 * opencode-novel-plugin - コマンド定義の読み込み
 *
 * commands/*.md を読み、OpenCode の `config.command` に渡す形にする。
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * OpenCode の command 設定が受け付けるキー。
 *
 * @opencode-ai/sdk の Config 型では次の形になっている。
 *   { template: string; description?: string; agent?: string; model?: string; subtask?: boolean }
 *
 * template は本文から作るので、frontmatter から渡すのはこの4つ。
 * ここに無いキー（`argument-hint` など）は渡さない。`argument-hint` は
 * Claude Code の慣習で OpenCode の設定にはないため、渡しても使われず、
 * 設定の検証で落ちる恐れがある。人が読む情報として frontmatter に
 * 書いておくのはかまわない。
 */
export const COMMAND_CONFIG_KEYS = ["description", "agent", "model", "subtask"] as const

export type CommandConfigKey = (typeof COMMAND_CONFIG_KEYS)[number]

/** config.command に渡す1件 */
export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

/**
 * Markdown 先頭の frontmatter を読み取る。
 *
 * 単純な `キー: 値` の並びだけを扱う（入れ子や配列は使わない）。
 * 以前は正規表現ひとつで description だけを抜いており、agent を
 * 捨てていた。agent が渡らないと、コマンドを実行しても専用 agent の
 * プロンプト・温度・権限に切り替わらず、現在の agent のまま動く。
 *
 * 気をつけている点
 *   - 値に含まれるコロンを落とさない（最初のコロンだけで分ける）
 *   - CRLF と BOM
 *   - 本文中の `---`（区切りは frontmatter の終わりの1つだけ）
 *   - 閉じられていない frontmatter は frontmatter 扱いしない
 */
export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  const lines = text.split("\n")

  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: text.trim() }
  }

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---")
  if (end === -1) {
    // 閉じられていない。frontmatter とはみなさない
    return { data: {}, body: text.trim() }
  }

  const data: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue
    const colon = trimmed.indexOf(":")
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    let value = trimmed.slice(colon + 1).trim()
    // 前後の引用符を外す
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) data[key] = value
  }

  return { data, body: lines.slice(end + 1).join("\n").trim() }
}

/** `true` / `false` を真偽値にする。それ以外は undefined */
function toBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const v = value.trim().toLowerCase()
  if (v === "true" || v === "yes") return true
  if (v === "false" || v === "no") return false
  return undefined
}

/**
 * ディレクトリ直下の *.md をコマンド定義として読み込む。
 * ファイル名（拡張子を除く）がコマンド名になる。
 */
export function loadCommands(commandsDir: string): Record<string, CommandConfig> {
  const commands: Record<string, CommandConfig> = {}
  let files: string[]
  try {
    files = readdirSync(commandsDir).filter((f) => f.endsWith(".md")).sort()
  } catch {
    return commands
  }

  for (const file of files) {
    let raw: string
    try {
      raw = readFileSync(join(commandsDir, file), "utf-8")
    } catch {
      continue
    }
    const name = file.replace(/\.md$/, "")
    const { data, body } = parseFrontmatter(raw)

    const config: CommandConfig = { template: body }
    if (data.description) config.description = data.description
    if (data.agent) config.agent = data.agent
    if (data.model) config.model = data.model
    const subtask = toBoolean(data.subtask)
    if (subtask !== undefined) config.subtask = subtask

    commands[name] = config
  }

  return commands
}
