import { safeWriteFile, getChaptersDir, countWords, stripChapterHeading, normalizeChapterTitle } from "../utils.js"
import { summarizeForSave } from "./check.js"
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

  // 本文に章見出しが混ざって渡されることがある（コマンドと skill は
  // 含めないよう案内しているが、守られない場合に備える）。
  // そのまま書くと見出しが二重になり、進行状況の文字数ともずれる。
  const body = stripChapterHeading(args.content)

  // タイトルに改行が入っていると見出しが2行以上になり、2行目以降が本文として
  // 数えられてしまう。見出しを作る側で1行であることを保証する。
  const title = normalizeChapterTitle(args.title)

  // 保存ファイルの見出しは算用数字で統一する（機械的に章番号を取り出せるようにするため）。
  // 縦組みの原稿として書き出すときに漢数字へ直せばよい。
  const header = title.length > 0 ? `# 第${num}章 ${title}\n\n` : `# 第${num}章\n\n`
  const saved = header + body
  await safeWriteFile(filePath, saved)

  const wordCount = countWords(body)

  let report = title.length > 0
    ? `✅ 第${num}章「${title}」を保存しました\n`
    : `✅ 第${num}章を保存しました\n`
  if (title !== args.title.trim()) {
    report += `ℹ️ タイトルに改行などが含まれていたため、1行に直しました\n`
  }
  report += `📄 ファイル: ${filePath}\n`
  report += `📊 文字数: ${wordCount.toLocaleString("ja-JP")}文字\n`
  // 保存したものをそのまま点検する（行番号が保存ファイルと一致するように）
  report += summarizeForSave(saved, num)

  if (args.updateState !== false) {
    report += `\n💡 novel_update で次の記録を更新しておくと、後の章でつじつまが合わせやすくなります:\n`
    report += `  - character-state: 登場人物の状態の変化\n`
    report += `  - summary: これまでのあらすじ\n`
    report += `  - foreshadow: 伏線の進み具合\n`
  }

  return report
}
