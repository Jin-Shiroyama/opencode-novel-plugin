import { safeWriteFile, getChaptersDir, countWords } from "../utils.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

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
