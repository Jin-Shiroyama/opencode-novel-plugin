import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  getNovelDir, getDocPath, getChaptersDir, getConfigPath,
  safeReadFile, safeReadJson, listMarkdownFiles,
  parseScenes, countWords, progressBar,
  determinePhase,
} from "../utils.js"
import type { NovelConfig, ForeshadowEntry } from "../utils.js"
import type { ToolContext } from "../index.js"

interface StatusArgs {
  detailed?: boolean
}

export async function novelStatusExecute(
  args: StatusArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const novelDir = getNovelDir(dir)

  if (!existsSync(novelDir)) {
    return `❌ 未找到小说项目。请先使用 novel_init 初始化项目。`
  }

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const phase = determinePhase(dir)
  const detailed = args.detailed ?? false

  let report = `📊 小说项目状态\n${"=".repeat(40)}\n\n`

  if (config) {
    report += `📖 书名: ${config.title}\n`
    report += `🏷️  类型: ${config.genre}\n`
    report += `🎯 目标字数: ${config.targetWords?.toLocaleString() ?? "未设定"}字\n`
    report += `📋 预计章节: ${config.chapterCount ?? "未设定"}章\n`
    report += `📅 创建时间: ${new Date(config.createdAt).toLocaleDateString("zh-CN")}\n\n`
  }

  const phaseLabels: Record<string, string> = {
    concept: "📝 故事概念",
    "world-building": "🌍 世界观构建",
    characters: "👤 角色设计",
    outline: "📋 大纲编写",
    scenes: "🎬 场景设计",
    writing: "✍️ 正文创作",
    completed: "✅ 已完成",
  }

  report += `📍 当前阶段: ${phaseLabels[phase] ?? phase}\n\n`

  const phases = [
    { key: "concept", label: "故事概念", file: "concept.md" },
    { key: "world-building", label: "世界观", file: "world-building.md" },
    { key: "characters", label: "角色档案", file: "characters/profiles.md" },
    { key: "outline-brief", label: "简要大纲", file: "outline-brief.md" },
    { key: "outline-detailed", label: "详细大纲", file: "outline-detailed.md" },
    { key: "scenes", label: "场景列表", file: "scenes.md" },
  ]

  report += `📋 阶段进度:\n`
  for (const p of phases) {
    const path = p.file.includes("/") ? join(novelDir, p.file) : getDocPath(dir, p.file as any)
    const exists = existsSync(path)
    const icon = exists ? "✅" : "⬜"
    report += `  ${icon} ${p.label}\n`
  }

  const scenesContent = await safeReadFile(getDocPath(dir, "scenes"))
  if (scenesContent) {
    const scenes = parseScenes(scenesContent)
    const completed = scenes.filter((s) => s.status === "completed").length
    const inProgress = scenes.filter((s) => s.status === "in-progress").length
    const total = scenes.length

    report += `\n🎬 场景进度:\n`
    report += `  ${progressBar(completed, total)}\n`
    if (inProgress > 0) {
      report += `  🔄 进行中: ${inProgress}个场景\n`
    }
  }

  const chaptersDir = getChaptersDir(dir)
  if (existsSync(chaptersDir)) {
    const chapters = await listMarkdownFiles(chaptersDir)
    if (chapters.length > 0) {
      let totalWords = 0
      report += `\n✍️ 已写章节 (${chapters.length}章):\n`
      for (const ch of chapters) {
        const content = await safeReadFile(join(chaptersDir, ch))
        if (content && detailed) {
          const words = countWords(content)
          totalWords += words
          report += `  📄 ${ch}: ${words.toLocaleString()}字\n`
        } else if (content) {
          totalWords += countWords(content)
        }
      }
      report += `\n📊 总字数: ${totalWords.toLocaleString()}字`
      if (config?.targetWords) {
        const percent = Math.round((totalWords / config.targetWords) * 100)
        report += ` / ${config.targetWords.toLocaleString()}字 (${percent}%)`
      }
      report += "\n"
    }
  }

  const foreshadow = await safeReadJson<{ items: ForeshadowEntry[] }>(getDocPath(dir, "foreshadow"))
  if (foreshadow && foreshadow.items.length > 0) {
    const planted = foreshadow.items.filter((f) => f.status === "planted").length
    const resolved = foreshadow.items.filter((f) => f.status === "resolved").length
    const pending = foreshadow.items.filter((f) => f.status === "pending").length
    report += `\n🎯 伏笔追踪: ${planted} 已埋设 | ${resolved} 已回收 | ${pending} 待处理\n`
  }

  return report
}
