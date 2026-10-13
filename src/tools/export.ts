import { lstat, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
  safeReadFile, safeReadJson, safeWriteFile, getConfigPath, getNovelDir, getChaptersDir,
  listChapterFiles, chapterTitleFromHeading, stripChapterHeading, countWords, toKanjiNumber,
} from "../utils.js"
import type { NovelConfig } from "../utils.js"
import { formatChapterRanges } from "../records.js"
import { checkTypography } from "../typography.js"
import type { ToolContext } from "../index.js"

interface ExportArgs {
  format?: "text" | "markdown"
  numerals?: "kanji" | "arabic"
  fromChapter?: number
  toChapter?: number
  outputPath?: string
}

/**
 * 書いた章を順に繋いで、原稿を1ファイルに書き出す。
 *
 *   text      投稿サイトや縦書きのエディタに貼る形。Markdown の記号を使わず、
 *             見出しは「第一章　タイトル」（全角スペース区切り）
 *   markdown  作品タイトルを `#`、章を `##` にして繋ぐ
 *
 * 章見出しの数字は、text は既定で漢数字、markdown は既定で算用数字。
 * 保存ファイルは見出しを算用数字で持つ（機械で章番号を読むため）ので、ここで直す。
 *
 * 本文は保存されたものをそのまま使い、書き換えない。表記の点検はしないが、
 * 規約から外れた箇所の件数を報告に添える。
 */
export async function novelExportExecute(args: ExportArgs, ctx: ToolContext): Promise<string> {
  const dir = ctx.directory
  const format = args.format ?? "text"
  const numerals = args.numerals ?? (format === "text" ? "kanji" : "arabic")
  const from = args.fromChapter ?? 1
  const to = args.toChapter ?? Number.MAX_SAFE_INTEGER
  if (from > to) return `❌ fromChapter（${from}）が toChapter（${to}）より後ろです。`

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const workTitle = config?.title?.trim() || "原稿"

  // 書き出し先は作品のディレクトリの中に限る（外へ書かない）
  const ext = format === "text" ? "txt" : "md"
  const defaultPath = join(getNovelDir(dir), "export", `${safeFileName(workTitle)}.${ext}`)
  const outPath = args.outputPath ? resolve(dir, args.outputPath) : defaultPath
  const refused = await checkOutputPath(dir, outPath, args.outputPath ?? outPath)
  if (refused) return refused

  const files = (await listChapterFiles(dir)).filter((f) => f.chapter >= from && f.chapter <= to)
  if (files.length === 0) return `❌ 書き出す章がありません（.novel/chapters/chapter-NNN.md）。`

  // 先にすべて読む。読めない章があれば何も書かない
  // （空の本文として繋ぐと、章が欠けたまま「書き出しました」と返してしまう）
  const texts: string[] = []
  const unreadable: number[] = []
  for (const f of files) {
    const text = await safeReadFile(f.path)
    if (text === null) unreadable.push(f.chapter)
    else texts.push(text)
  }
  if (unreadable.length > 0) {
    return `❌ 読み込めない章があるため、書き出していません: ${formatChapterRanges(unreadable)}
   ファイルの権限や中身（ディレクトリになっていないか）を確かめてください。`
  }

  const parts: string[] = []
  let totalChars = 0
  let typographyErrors = 0
  for (const [i, f] of files.entries()) {
    const text = texts[i]
    const title = chapterTitleFromHeading(text)
    const body = stripChapterHeading(text).replace(/\s+$/, "")
    totalChars += countWords(body)
    typographyErrors += checkTypography(text).filter((i) => i.severity === "error").length

    const no = numerals === "kanji" ? toKanjiNumber(f.chapter) : String(f.chapter)
    const heading =
      format === "text"
        ? `第${no}章${title ? `　${title}` : ""}`
        : `## 第${no}章${title ? ` ${title}` : ""}`
    parts.push(`${heading}\n\n${body}`)
  }

  const head = format === "text" ? `${workTitle}\n\n\n` : `# ${workTitle}\n\n`
  // 章のあいだは text では2行空けて区切りを見やすくする
  const separator = format === "text" ? "\n\n\n" : "\n\n"
  await safeWriteFile(outPath, head + parts.join(separator) + "\n")

  // 範囲の中で抜けている章。toChapter を明示されたら、その章までを見る
  // （存在する最後の章で切ると、範囲の末尾の欠けを見落とす）
  const present = new Set(files.map((f) => f.chapter))
  const last = args.toChapter ?? files[files.length - 1].chapter
  const missing: number[] = []
  for (let n = from; n <= last; n++) if (!present.has(n)) missing.push(n)

  const range = formatChapterRanges(files.map((f) => f.chapter))
  let report = `✅ 原稿を書き出しました（${format === "text" ? "テキスト" : "Markdown"}）
📄 ファイル: ${outPath}
📚 章: ${range}（${files.length}章）
📊 文字数: ${totalChars.toLocaleString("ja-JP")}文字（本文のみ。見出しは含まない）
`
  if (missing.length > 0) {
    report += `⚠️ 本文の無い章を飛ばしました: ${formatChapterRanges(missing)}\n`
  }
  if (typographyErrors > 0) {
    report += `⚠️ 表記の規約違反が ${typographyErrors}件あります（書き出しでは直していません）。novel_check で確かめられます\n`
  }
  return report
}

/**
 * 書き出し先を確かめる。問題があれば断る文を、無ければ null を返す。
 *
 * パスの文字列だけで判定すると、シンボリックリンクを経由して作品の外や
 * 本文の章ファイルへ書けてしまう（alias.txt → .novel/chapters/chapter-001.md など）。
 * そこで、書き出し先そのものがリンクなら断り、親ディレクトリは実体をたどって判定する。
 */
async function checkOutputPath(dir: string, outPath: string, shown: string): Promise<string | null> {
  const outside = `❌ 書き出し先は作品のディレクトリの中にしてください（受け取ったのは ${shown}）。`
  const intoChapters = `❌ .novel/chapters/ には書き出せません（本文の章ファイルと混ざるため）。`

  // 文字列としての判定（存在しないパスも含めて）
  const rel = relative(dir, outPath)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return outside
  const chaptersDir = getChaptersDir(dir)
  if (isInside(chaptersDir, outPath)) return intoChapters

  // 書き出し先そのものがリンクなら書かない（リンク先を上書きしてしまうため）
  const stat = await lstat(outPath).catch(() => null)
  if (stat?.isSymbolicLink()) {
    return `❌ 書き出し先がシンボリックリンクです（${shown}）。リンク先を上書きしないよう、書き出していません。`
  }
  if (stat?.isDirectory()) return `❌ 書き出し先がディレクトリです（${shown}）。ファイル名まで指定してください。`

  // 親ディレクトリは実体で判定する。まだ無い部分は、存在する祖先の実体につなげる
  const realProject = await realpath(dir)
  const realChapters = await realpath(chaptersDir).catch(() => resolve(realProject, relative(dir, chaptersDir)))
  const realTarget = join(await realpathOfNearest(dirname(outPath)), basename(outPath))
  if (!isInside(realProject, realTarget)) return outside
  if (isInside(realChapters, realTarget)) return intoChapters
  return null
}

/** 存在する最も近い祖先の実体に、残りのパスをつなげる */
async function realpathOfNearest(path: string): Promise<string> {
  const rest: string[] = []
  let current = path
  for (;;) {
    try {
      return join(await realpath(current), ...rest.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return path
      rest.push(basename(current))
      current = parent
    }
  }
}

/** child が base の中（base 自身を含まない）にあるか */
function isInside(base: string, child: string): boolean {
  const rel = relative(base, child)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** ファイル名に使えない文字を置き換える */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 100) || "原稿"
}
