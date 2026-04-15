import { safeWriteFile, safeWriteJson, safeReadFile, safeReadJson, getDocPath, getChaptersDir, countWords } from "../utils.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

type DocType = "concept" | "world-building" | "characters" | "character-state" | "outline-brief" | "outline-detailed" | "scenes" | "summary" | "foreshadow" | "reality-source" | "sect" | "martial-art" | "weapon"

interface SaveArgs {
  documentType: DocType
  content: string
  chapterNumber?: number
  chapterTitle?: string
  updateTracking?: boolean
}

export async function novelSaveExecute(
  args: SaveArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const { documentType, content } = args

  if (documentType === "concept" || documentType === "world-building" || documentType === "characters" ||
      documentType === "outline-brief" || documentType === "outline-detailed" || documentType === "scenes" ||
      documentType === "summary" || documentType === "reality-source" || documentType === "sect" || documentType === "martial-art" || documentType === "weapon") {
    const filePath = getDocPath(dir, documentType)
    await safeWriteFile(filePath, content)
    return `✅ 已保存 ${documentType} 文档: ${filePath}`
  }

  if (documentType === "character-state" || documentType === "foreshadow") {
    const filePath = getDocPath(dir, documentType)
    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      return `❌ ${documentType} 的内容必须是有效的 JSON 格式`
    }
    await safeWriteJson(filePath, parsed)
    return `✅ 已保存 ${documentType} 数据: ${filePath}`
  }

  return `❌ 未知的文档类型: ${documentType}`
}

interface SaveChapterArgs {
  chapterNumber: number
  title: string
  content: string
  updateState?: boolean
}

export async function novelSaveChapterExecute(
  args: SaveChapterArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const num = args.chapterNumber
  const padded = String(num).padStart(3, "0")
  const fileName = `chapter-${padded}.md`
  const chaptersDir = getChaptersDir(dir)
  const filePath = join(chaptersDir, fileName)

  const header = `# 第${num}章 ${args.title}\n\n`
  await safeWriteFile(filePath, header + args.content)

  const wordCount = countWords(args.content)

  let report = `✅ 第${num}章「${args.title}」已保存\n`
  report += `📄 文件: ${filePath}\n`
  report += `📊 字数: ${wordCount.toLocaleString()}字\n`

  if (args.updateState !== false) {
    report += `\n💡 建议使用 novel_update 工具更新以下追踪文件：\n`
    report += `  - character-state: 角色状态变化\n`
    report += `  - summary: 全局摘要更新\n`
    report += `  - foreshadow: 伏笔状态更新\n`
  }

  return report
}
