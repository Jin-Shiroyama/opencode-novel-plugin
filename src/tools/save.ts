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

  // 保存ファイルの見出しは算用数字で統一する（機械的に章番号を取り出せるようにするため）。
  // 縦組みの原稿として書き出すときに漢数字へ直せばよい。
  const header = `# 第${num}章 ${args.title}\n\n`
  await safeWriteFile(filePath, header + args.content)

  const wordCount = countWords(args.content)

  let report = `✅ 第${num}章「${args.title}」を保存しました\n`
  report += `📄 ファイル: ${filePath}\n`
  report += `📊 文字数: ${wordCount.toLocaleString("ja-JP")}文字\n`

  if (args.updateState !== false) {
    report += `\n💡 novel_update で次の記録を更新しておくと、後の章でつじつまが合わせやすくなります:\n`
    report += `  - character-state: 登場人物の状態の変化\n`
    report += `  - summary: これまでのあらすじ\n`
    report += `  - foreshadow: 伏線の進み具合\n`
  }

  return report
}
