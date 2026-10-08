import { safeReadFile, safeReadJson, safeWriteJson, getDocPath, safeWriteFile, getConfigPath } from "../utils.js"
import type { ForeshadowEntry, CharacterState } from "../utils.js"
import type { ToolContext } from "../index.js"

interface UpdateArgs {
  action: "character-state" | "summary" | "foreshadow" | "prompt"
  content: string
  chapterNumber?: number
}

export async function novelUpdateExecute(
  args: UpdateArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory

  switch (args.action) {
    case "character-state":
      return updateCharacterState(dir, args.content)
    case "summary":
      return updateSummary(dir, args.content)
    case "foreshadow":
      return updateForeshadow(dir, args.content)
    case "prompt":
      return getUpdatePrompt(dir, args.content, args.chapterNumber)
    default:
      return `❌ 対応していない更新種別です: ${args.action}`
  }
}

async function updateCharacterState(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "character-state")
  const current = await safeReadJson<{ characters: CharacterState[] }>(filePath)

  let updates: { updates: Array<{ name: string; changes: any }> }
  try {
    updates = JSON.parse(content)
  } catch {
    return `❌ content は JSON で渡してください: { "updates": [{ "name": "人物名", "changes": {...} }] }`
  }

  if (!Array.isArray(updates?.updates)) {
    return `❌ JSON の形が違います。最上位に "updates" 配列が必要です。`
  }

  const characters = current?.characters ?? []
  let added = 0
  let changed = 0

  for (const update of updates.updates) {
    const existing = characters.find((c) => c.name === update.name)
    if (existing) {
      changed++
      if (update.changes.status) existing.status = update.changes.status
      if (update.changes.physicalState) existing.physicalState = update.changes.physicalState
      if (update.changes.mentalState) existing.mentalState = update.changes.mentalState
      if (update.changes.items) {
        if (update.changes.items.added) existing.items = [...(existing.items ?? []), ...update.changes.items.added]
        if (update.changes.items.removed) existing.items = existing.items?.filter((i) => !update.changes.items.removed.includes(i))
      }
      if (update.changes.abilities) {
        if (update.changes.abilities.added) existing.abilities = [...(existing.abilities ?? []), ...update.changes.abilities.added]
        if (update.changes.abilities.removed) existing.abilities = existing.abilities?.filter((a) => !update.changes.abilities.removed.includes(a))
      }
      if (update.changes.relationships) {
        existing.relationships = { ...(existing.relationships ?? {}), ...update.changes.relationships }
      }
      if (update.changes.events) {
        existing.events = [...(existing.events ?? []), ...update.changes.events]
      }
      if (update.changes.lastUpdatedChapter) existing.lastUpdatedChapter = update.changes.lastUpdatedChapter
    } else {
      added++
      characters.push({
        name: update.name,
        status: update.changes.status ?? "active",
        role: update.changes.role ?? "supporting",
        physicalState: update.changes.physicalState ?? "",
        mentalState: update.changes.mentalState ?? "",
        items: update.changes.items?.added ?? [],
        abilities: update.changes.abilities?.added ?? [],
        relationships: update.changes.relationships ?? {},
        events: update.changes.events ?? [],
        lastUpdatedChapter: update.changes.lastUpdatedChapter,
      })
    }
  }

  await safeWriteJson(filePath, { characters })
  return `✅ 登場人物の状態を更新しました（新規 ${added}人 / 更新 ${changed}人 / 合計 ${characters.length}人）`
}

async function updateSummary(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "summary")
  await safeWriteFile(filePath, content)
  return `✅ これまでのあらすじを更新しました`
}

async function updateForeshadow(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "foreshadow")
  const current = await safeReadJson<{ items: ForeshadowEntry[] }>(filePath)

  let operations: { items: ForeshadowEntry[] }
  try {
    operations = JSON.parse(content)
  } catch {
    return `❌ content は JSON で渡してください: { "items": [...] }`
  }

  if (!Array.isArray(operations?.items)) {
    return `❌ JSON の形が違います。最上位に "items" 配列が必要です。`
  }

  const items = current?.items ?? []
  // 既存判定は書き換える前に済ませる（書き換え後に数えると新規分も更新に混ざる）
  let added = 0
  let changed = 0

  for (const item of operations.items) {
    const existing = item.id ? items.find((f) => f.id === item.id) : undefined
    if (existing) {
      changed++
      if (item.status) existing.status = item.status
      if (item.title) existing.title = item.title
      if (item.content) existing.content = item.content
      if (item.category) existing.category = item.category
      if (item.plantChapter) existing.plantChapter = item.plantChapter
      if (item.targetChapter) existing.targetChapter = item.targetChapter
      if (item.resolvedChapter) existing.resolvedChapter = item.resolvedChapter
      if (item.notes) existing.notes = item.notes
    } else {
      added++
      const newId = item.id || `F${items.length + 1}`
      items.push({ ...item, id: newId, status: item.status ?? "pending" })
    }
  }

  await safeWriteJson(filePath, { items })

  const planted = items.filter((f) => f.status === "planted").length
  const resolved = items.filter((f) => f.status === "resolved").length

  return `✅ 伏線の記録を更新しました
   新規 ${added} / 更新 ${changed} / 合計 ${items.length}
   内訳: 張り済み ${planted} / 回収済み ${resolved}`
}

async function getUpdatePrompt(dir: string, promptType: string, chapterNumber?: number): Promise<string> {
  const { getPromptTemplate, listPromptTemplates } = await import("../prompts.js")
  const template = getPromptTemplate(promptType)
  if (!template) {
    return `❌ そのプロンプトは見つかりません: ${promptType}
使えるもの: ${listPromptTemplates().join(", ")}`
  }

  const config = await safeReadJson<any>(getConfigPath(dir))
  const characters = await safeReadFile(getDocPath(dir, "characters"))

  let filled = template
  if (config) {
    filled = filled.replace(/\{title\}/g, config.title)
    filled = filled.replace(/\{genre\}/g, config.genre)
  }
  if (chapterNumber) {
    filled = filled.replace(/\{chapterNumber\}/g, String(chapterNumber))
  }
  if (characters) {
    filled = filled.replace(/\{charactersToTrack\}/g, "この章に出てきた全員")
  }

  return `📝 プロンプト「${promptType}」:

${filled}

💡 このプロンプトと章の本文を合わせて使い、得られた結果を novel_update で保存してください。`
}
