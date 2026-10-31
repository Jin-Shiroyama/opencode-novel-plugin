import {
  safeReadFile, safeReadJson, safeWriteFile, getChaptersDir, getNovelDir, getConfigPath, countWords,
  stripChapterHeading, normalizeChapterTitle, existsSync,
} from "../utils.js"
import type { NovelConfig } from "../utils.js"
import { resolveManuscriptFormat, countManuscriptLines, linesToPagesDecimal, formatManuscriptLabel } from "../manuscript.js"
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

  // 書き直しで前の原稿が消えないよう、内容が変わるときは旧稿を drafts/ に残してから上書きする。
  // 読み込めない（ディレクトリになっている、権限が無い）ときは、旧稿を残せないので書かずに断る
  let previousNote = ""
  if (existsSync(filePath)) {
    const previous = await safeReadFile(filePath)
    if (previous === null) {
      return `❌ 第${num}章は保存していません。いまの ${fileName} を読み込めず、前の原稿を残せないためです。
   ファイルの権限や中身（ディレクトリになっていないか）を確かめてください。`
    }
    if (previous === saved) {
      previousNote = `ℹ️ 前に保存した内容と同じでした\n`
    } else {
      const backupPath = await backupPreviousDraft(dir, fileName, previous)
      previousNote = `🗂️ 前の原稿を残しました: ${backupPath}\n`
    }
  }
  await safeWriteFile(filePath, saved)

  const wordCount = countWords(body)

  let report = title.length > 0
    ? `✅ 第${num}章「${title}」を保存しました\n`
    : `✅ 第${num}章を保存しました\n`
  if (title !== args.title.trim()) {
    report += `ℹ️ タイトルに改行などが含まれていたため、1行に直しました\n`
  }
  report += `📄 ファイル: ${filePath}\n`
  report += previousNote
  report += `📊 文字数: ${wordCount.toLocaleString("ja-JP")}文字\n`
  // 原稿用紙の書式が config.json にあるときだけ枚数を添える
  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const manuscript = resolveManuscriptFormat(undefined, config?.manuscript)
  if (manuscript && "format" in manuscript) {
    const lines = countManuscriptLines(body, manuscript.format.columns)
    report += `📄 原稿用紙換算: ${linesToPagesDecimal(lines, manuscript.format)}枚（${formatManuscriptLabel(manuscript.format)}）\n`
  } else if (manuscript) {
    report += `⚠️ ${manuscript.error}\n`
  }
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

/**
 * 旧稿を .novel/drafts/chapter-NNN-YYYYMMDD-HHMMSS.md に書き、そのパスを返す。
 *
 * 置き場所を chapters/ の外にし、名前も chapter-NNN.md の形から外す
 * （章ファイルとして数えたり読んだりされないように。utils.ts の CHAPTER_FILE_PATTERN）。
 * 同じ秒に二度書き直したときは -2, -3 … を付けて、先の旧稿を消さない。
 */
async function backupPreviousDraft(dir: string, fileName: string, content: string): Promise<string> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = join(getNovelDir(dir), "drafts", `${fileName.replace(/\.md$/, "")}-${stamp}`)
  let path = `${base}.md`
  for (let n = 2; existsSync(path); n++) path = `${base}-${n}.md`
  await safeWriteFile(path, content)
  return path
}
