import { safeReadFile, safeReadJson, getDocPath, getChaptersDir, getConfigPath } from "../utils.js"
import type { ForeshadowEntry, CharacterState, NovelConfig } from "../utils.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"
import { existsSync } from "node:fs"

interface ContextArgs {
  chapterNumber: number
  sceneId?: string
  includePrompts?: boolean
}

export async function novelContextExecute(
  args: ContextArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const chapterNum = args.chapterNumber
  const includePrompts = args.includePrompts !== false

  let context = `📝 写作上下文构建 - 第${chapterNum}章\n${"=".repeat(50)}\n\n`

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))

  if (config) {
    context += `## 📖 项目信息\n`
    context += `书名: ${config.title}\n`
    context += `类型: ${config.genre}\n`
    context += `叙事视角: ${config.narrativePerspective ?? "第三人称有限"}\n`
    context += `目标字数: ${config.targetWords?.toLocaleString() ?? "未设定"}字\n\n`
  }

  const outline = await safeReadFile(getDocPath(dir, "outline-detailed"))
  if (outline) {
    const chapterSection = extractChapterSection(outline, chapterNum)
    if (chapterSection) {
      context += `## 📋 本章大纲 (P0 - 必须遵循)\n${chapterSection}\n\n`
    }
  }

  const characters = await safeReadFile(getDocPath(dir, "characters"))
  if (characters) {
    context += `## 👤 角色档案 (P1 - 重要)\n`
    context += characters.substring(0, 3000) + (characters.length > 3000 ? "\n...[已截断]" : "") + "\n\n"
  }

  const charState = await safeReadJson<{ characters: CharacterState[] }>(getDocPath(dir, "character-state"))
  if (charState && charState.characters.length > 0) {
    context += `## 🔄 角色当前状态 (P1 - 重要)\n`
    for (const c of charState.characters) {
      context += `**${c.name}** (${c.role}): ${c.mentalState ?? "正常"}\n`
      if (c.items && c.items.length > 0) context += `  物品: ${c.items.join(", ")}\n`
    }
    context += "\n"
  }

  if (chapterNum > 1) {
    const summary = await safeReadFile(getDocPath(dir, "summary"))
    if (summary) {
      context += `## 📚 前文摘要 (P2 - 参考)\n${summary}\n\n`
    }

    const prevPadded = String(chapterNum - 1).padStart(3, "0")
    const prevChapterPath = join(getChaptersDir(dir), `chapter-${prevPadded}.md`)
    const prevChapter = await safeReadFile(prevChapterPath)
    if (prevChapter) {
      const tail = prevChapter.slice(-1500)
      context += `## 📖 上一章末尾内容 (P1 - 衔接)\n${tail}\n\n`
    }
  }

  const foreshadow = await safeReadJson<{ items: ForeshadowEntry[] }>(getDocPath(dir, "foreshadow"))
  if (foreshadow && foreshadow.items.length > 0) {
    const relevant = foreshadow.items.filter(
      (f) => f.status === "planted" || (f.targetChapter && f.targetChapter <= chapterNum + 3)
    )
    if (relevant.length > 0) {
      context += `## 🎯 伏笔提醒 (P2 - 参考)\n`
      for (const f of relevant) {
        const icon = f.status === "planted" ? "🌱" : "⏰"
        context += `${icon} [${f.id}] ${f.title}: ${f.content}\n`
        if (f.targetChapter) context += `   目标回收章节: 第${f.targetChapter}章\n`
      }
      context += "\n"
    }
  }

  const martialArts = await safeReadFile(getDocPath(dir, "martial-art"))
  if (martialArts) {
    context += `## ⚔️ 功法体系 (P1 - 武侠专属)\n`
    context += martialArts.substring(0, 3000) + (martialArts.length > 3000 ? "\n...[已截断]" : "") + "\n\n"
  }

  const sects = await safeReadFile(getDocPath(dir, "sect"))
  if (sects) {
    context += `## 🏯 门派势力 (P1 - 武侠专属)\n`
    context += sects.substring(0, 2000) + (sects.length > 2000 ? "\n...[已截断]" : "") + "\n\n"
  }

  const weapons = await safeReadFile(getDocPath(dir, "weapon"))
  if (weapons) {
    context += `## 🗡️ 兵器谱 (P2 - 武侠专属)\n`
    context += weapons.substring(0, 2000) + (weapons.length > 2000 ? "\n...[已截断]" : "") + "\n\n"
  }

  const realitySource = await safeReadFile(getDocPath(dir, "reality-source"))
  if (realitySource) {
    context += `## 🌍 现实映射素材 (P1 - 创作源泉)\n`
    context += realitySource.substring(0, 3000) + (realitySource.length > 3000 ? "\n...[已截断]" : "") + "\n\n"
  }

  if (includePrompts) {
    const { getPromptTemplate, fillPrompt } = await import("../prompts.js")
    const templateKey = chapterNum === 1 ? "chapter-write" : "chapter-continue"
    const template = getPromptTemplate(templateKey)
    if (template && config) {
      const prompt = fillPrompt(template, {
        projectTitle: config.title,
        genre: config.genre,
        chapterNumber: String(chapterNum),
        chapterTitle: `第${chapterNum}章`,
        targetWordCount: String(Math.round((config.targetWords ?? 200000) / (config.chapterCount ?? 50))),
        narrativePerspective: config.narrativePerspective ?? "第三人称有限",
        chapterOutline: "[请从上方大纲中提取本章内容]",
        charactersInfo: "[请从上方角色档案中提取]",
        previousContext: chapterNum > 1 ? "[请参考上方前文摘要]" : "",
        foreshadowReminders: "[请参考上方伏笔提醒]",
        globalSummary: "[请参考上方前文摘要]",
        previousChapterSummary: chapterNum > 1 ? "[请从摘要中提取上一章概要]" : "",
        previousChapterTail: chapterNum > 1 ? "[请参考上方上一章末尾]" : "",
      })
      context += `## ✍️ 写作提示词模板\n\`\`\`\n${prompt}\n\`\`\`\n`
    }
  }

  return context
}

function extractChapterSection(outline: string, chapterNum: number): string | null {
  const lines = outline.split("\n")
  let inTargetChapter = false
  let collecting = false
  const collected: string[] = []

  for (const line of lines) {
    const chapterHeader = line.match(/^##\s+第(\d+)章/)
    if (chapterHeader) {
      if (collecting) break
      const num = parseInt(chapterHeader[1])
      if (num === chapterNum) {
        inTargetChapter = true
        collecting = true
      }
    }
    if (collecting) collected.push(line)
  }

  return collected.length > 0 ? collected.join("\n") : null
}
