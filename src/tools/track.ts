import { safeReadFile, safeReadJson, safeWriteJson, getDocPath, getChaptersDir, safeWriteFile, getConfigPath } from "../utils.js"
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
      return `❌ 未知更新类型: ${args.action}`
  }
}

async function updateCharacterState(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "character-state")
  const current = await safeReadJson<{ characters: CharacterState[] }>(filePath)

  let updates: { updates: Array<{ name: string; changes: any }> }
  try {
    updates = JSON.parse(content)
  } catch {
    return `❌ 内容必须是有效的 JSON 格式: { "updates": [{ "name": "角色名", "changes": {...} }] }`
  }

  const characters = current?.characters ?? []

  for (const update of updates.updates) {
    const existing = characters.find((c) => c.name === update.name)
    if (existing) {
      if (update.changes.status) existing.status = update.changes.status
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
    } else {
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
        lastUpdatedChapter: undefined,
      })
    }
  }

  await safeWriteJson(filePath, { characters })
  return `✅ 角色状态已更新 (${updates.updates.length}个角色)`
}

async function updateSummary(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "summary")
  await safeWriteFile(filePath, content)
  return `✅ 前文摘要已更新`
}

async function updateForeshadow(dir: string, content: string): Promise<string> {
  const filePath = getDocPath(dir, "foreshadow")
  const current = await safeReadJson<{ items: ForeshadowEntry[] }>(filePath)

  let operations: { items: ForeshadowEntry[] }
  try {
    operations = JSON.parse(content)
  } catch {
    return `❌ 内容必须是有效的 JSON 格式`
  }

  const items = current?.items ?? []

  for (const item of operations.items) {
    if (item.status === "resolved" || item.status === "planted" || item.status === "abandoned") {
      const existing = items.find((f) => f.id === item.id)
      if (existing) {
        existing.status = item.status
        if (item.resolvedChapter) existing.resolvedChapter = item.resolvedChapter
      }
    } else {
      const newId = item.id || `F${items.length + 1}`
      items.push({ ...item, id: newId, status: item.status ?? "pending" })
    }
  }

  await safeWriteJson(filePath, { items })

  const added = operations.items.filter((i) => !items.find((e) => e.id === i.id && e.status !== "pending"))
  const updated = operations.items.filter((i) => items.find((e) => e.id === i.id && e.status !== "pending"))

  return `✅ 伏笔追踪已更新\n   新增: ${added.length} | 更新: ${updated.length} | 总计: ${items.length}`
}

async function getUpdatePrompt(dir: string, promptType: string, chapterNumber?: number): Promise<string> {
  const { getPromptTemplate } = await import("../prompts.js")
  const template = getPromptTemplate(promptType)
  if (!template) {
    return `❌ 未找到提示词模板: ${promptType}\n可用模板: character-state-update, summary-update, consistency-check`
  }

  const config = await safeReadJson<any>(getConfigPath(dir))
  const characters = await safeReadFile(getDocPath(dir, "characters"))
  const summary = await safeReadFile(getDocPath(dir, "summary"))

  let filled = template
  if (config) {
    filled = filled.replace(/\{title\}/g, config.title)
    filled = filled.replace(/\{genre\}/g, config.genre)
  }
  if (chapterNumber) {
    filled = filled.replace(/\{chapterNumber\}/g, String(chapterNumber))
  }
  if (characters) {
    filled = filled.replace(/\{charactersToTrack\}/g, "所有出场角色")
  }

  return `📝 提示词模板「${promptType}」:\n\n${filled}\n\n💡 请将上述提示词结合章节内容使用，获取更新数据后通过 novel_update 工具保存。`
}
