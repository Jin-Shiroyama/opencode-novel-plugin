import { lstat, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
  safeReadFile, safeReadJson, safeWriteFile, getConfigPath, getNovelDir, getChaptersDir,
  chapterTitleFromHeading, isShortForm, stripChapterHeading, countWords, toKanjiNumber,
} from "../utils.js"
import type { NovelConfig } from "../utils.js"
import { formatChapterRanges } from "../records.js"
import { checkTypography } from "../typography.js"
import { convertRuby, countRubyMarks } from "../ruby.js"
import type { RubyNotation } from "../ruby.js"
import { resolveManuscriptFormat, countManuscriptLines, linesToPages, formatManuscriptLabel } from "../manuscript.js"
import { listManuscriptFiles, describeExtraSections, sectionLabel, SECTION_NAMES, parseParts, partName } from "../sections.js"
import type { ManuscriptFile } from "../sections.js"
import type { ToolContext } from "../index.js"

interface ExportArgs {
  format?: "text" | "markdown"
  numerals?: "kanji" | "arabic"
  ruby?: RubyNotation
  manuscript?: string
  fromChapter?: number
  toChapter?: number
  outputPath?: string
}

/**
 * 書いた章を読む順番に繋いで、原稿を1ファイルに書き出す。
 * プロローグ・幕間・エピローグ（sections.ts）も、置かれた位置に繋ぐ。
 *
 *   text      投稿サイトや縦書きのエディタに貼る形。Markdown の記号を使わず、
 *             見出しは「第一章　タイトル」（全角スペース区切り）
 *   markdown  作品タイトルを `#`、章を `##` にして繋ぐ
 *
 * 範囲（fromChapter / toChapter）を指定したときの節の扱い:
 *   プロローグ  fromChapter が1以下なら含める
 *   幕間        直前の章（第N章のあとなら第N章）が範囲にあれば含める
 *   エピローグ  toChapter を省いたときだけ含める
 *
 * 短編（config.json の form が "short"）では章見出しを「第一章」にしない。作品に章が1つしか無ければ
 * 章見出しを付けず、2つ以上なら「一」「二」（タイトルがあれば「一　タイトル」）にする。
 *
 * config.json に parts（部の構成）があれば、部の最初の章の前に部の見出し（「第一部　春」）を置く。
 * markdown では部を ##、章と節を ### にする。
 *
 * 章見出しの数字は、text は既定で漢数字、markdown は既定で算用数字。
 * 保存ファイルは見出しを算用数字で持つ（機械で章番号を読むため）ので、ここで直す。
 *
 * ルビと傍点は、ruby で指定した書き出し先の記法に直す（ruby.ts の RubyNotation）。
 * 既定は text ならカクヨム形式（原稿の記法のまま）、markdown なら HTML の <ruby>
 * （Markdown の表示では《》の記法が読まれないため）。
 *
 * 本文は保存されたものをそのまま使い、書き換えない。表記の点検はしないが、
 * 規約から外れた箇所の件数を報告に添える。
 */
export async function novelExportExecute(args: ExportArgs, ctx: ToolContext): Promise<string> {
  const dir = ctx.directory
  const format = args.format ?? "text"
  const numerals = args.numerals ?? (format === "text" ? "kanji" : "arabic")
  const ruby: RubyNotation = args.ruby ?? (format === "text" ? "kakuyomu" : "html")
  const from = args.fromChapter ?? 1
  const to = args.toChapter ?? Number.MAX_SAFE_INTEGER
  if (from > to) return `❌ fromChapter（${from}）が toChapter（${to}）より後ろです。`

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  const workTitle = config?.title?.trim() || "原稿"
  // 原稿用紙の書式は、指定があるときだけ使う。読めない指定なら書き出す前に断る
  const manuscript = resolveManuscriptFormat(args.manuscript, config?.manuscript)
  if (manuscript && "error" in manuscript) return `❌ ${manuscript.error}`
  const paper = manuscript?.format ?? null
  // 部の構成は、読めなければ書き出す前に断る（見出しが欠けたまま書き出さないため）
  const partsResult = parseParts(config?.parts)
  if (partsResult && "error" in partsResult) return `❌ ${partsResult.error}`
  const bookParts = partsResult?.parts ?? []

  // 書き出し先は作品のディレクトリの中に限る（外へ書かない）
  const ext = format === "text" ? "txt" : "md"
  const defaultPath = join(getNovelDir(dir), "export", `${safeFileName(workTitle)}.${ext}`)
  const outPath = args.outputPath ? resolve(dir, args.outputPath) : defaultPath
  const refused = await checkOutputPath(dir, outPath, args.outputPath ?? outPath)
  if (refused) return refused

  const files = (await listManuscriptFiles(dir)).filter((f) => inRange(f, from, to, args.toChapter === undefined))
  if (files.length === 0) return `❌ 書き出す章がありません（.novel/chapters/chapter-NNN.md）。`
  const chapters = files.flatMap((f) => (f.section.kind === "chapter" ? [f.section.chapter] : []))
  // 短編で章を分けていなければ（作品全体で章が1つ）、章見出しを付けない
  const short = isShortForm(config)
  const allChapters = (await listManuscriptFiles(dir)).filter((f) => f.section.kind === "chapter").length
  const bareChapter = short && allChapters <= 1

  // 先にすべて読む。読めない章があれば何も書かない
  // （空の本文として繋ぐと、章が欠けたまま「書き出しました」と返してしまう）
  const texts: string[] = []
  const unreadable: ManuscriptFile[] = []
  for (const f of files) {
    const text = await safeReadFile(f.path)
    if (text === null) unreadable.push(f)
    else texts.push(text)
  }
  if (unreadable.length > 0) {
    const unreadableChapters = unreadable.flatMap((f) => (f.section.kind === "chapter" ? [f.section.chapter] : []))
    const names = [
      ...(unreadableChapters.length > 0 ? [formatChapterRanges(unreadableChapters)] : []),
      ...unreadable.filter((f) => f.section.kind !== "chapter").map((f) => sectionLabel(f.section)),
    ]
    return `❌ 読み込めない章があるため、書き出していません: ${names.join("、")}
   ファイルの権限や中身（ディレクトリになっていないか）を確かめてください。`
  }

  const parts: string[] = []
  let totalChars = 0
  let totalLines = 0
  let typographyErrors = 0
  const marks = { ruby: 0, emphasis: 0 }
  // markdown では部があれば部を ##、章を ### にする
  const chapterMark = bookParts.length > 0 ? "###" : "##"
  const partsShown: string[] = []
  for (const [i, f] of files.entries()) {
    const text = texts[i]
    // 部の最初の章の前に部の見出しを置く（範囲の途中から書き出すときも、範囲に入る最初の章が部の頭なら置く）
    const section = f.section
    const part = section.kind === "chapter" ? bookParts.find((p) => p.fromChapter === section.chapter) : undefined
    if (part) {
      const name = partName(part, numerals, toKanjiNumber)
      partsShown.push(name)
      parts.push(format === "text" ? `${name}　${part.title}` : `## ${name} ${part.title}`)
    }
    const rawBody = stripChapterHeading(text).replace(/\s+$/, "")
    totalChars += countWords(rawBody)
    if (paper) totalLines += countManuscriptLines(rawBody, paper.columns)
    typographyErrors += checkTypography(text).filter((i) => i.severity === "error").length
    const counted = countRubyMarks(text)
    marks.ruby += counted.ruby
    marks.emphasis += counted.emphasis
    const title = convertRuby(chapterTitleFromHeading(text), ruby)
    const body = convertRuby(rawBody, ruby)

    if (f.section.kind === "chapter" && bareChapter) {
      parts.push(body)
      continue
    }
    const no = f.section.kind === "chapter" ? (numerals === "kanji" ? toKanjiNumber(f.section.chapter) : String(f.section.chapter)) : ""
    const name =
      f.section.kind === "chapter" ? (short ? no : `第${no}章`) : SECTION_NAMES[f.section.kind]
    const heading =
      format === "text"
        ? `${name}${title ? `　${title}` : ""}`
        : `${chapterMark} ${name}${title ? ` ${title}` : ""}`
    parts.push(`${heading}\n\n${body}`)
  }

  const head = format === "text" ? `${workTitle}\n\n\n` : `# ${workTitle}\n\n`
  // 章のあいだは text では2行空けて区切りを見やすくする
  const separator = format === "text" ? "\n\n\n" : "\n\n"
  await safeWriteFile(outPath, head + parts.join(separator) + "\n")

  // 範囲の中で抜けている章。toChapter を明示されたら、その章までを見る
  // （存在する最後の章で切ると、範囲の末尾の欠けを見落とす）
  const present = new Set(chapters)
  const last = args.toChapter ?? (chapters.length > 0 ? chapters[chapters.length - 1] : from - 1)
  const missing: number[] = []
  for (let n = from; n <= last; n++) if (!present.has(n)) missing.push(n)

  const extras = describeExtraSections(files.map((f) => f.section))
  const range = [
    ...(bareChapter && chapters.length > 0
      ? ["本文（短編・章なし）"]
      : chapters.length > 0 ? [`${formatChapterRanges(chapters)}（${chapters.length}章）`] : []),
    ...(extras ? [extras] : []),
  ].join("＋")
  let report = `✅ 原稿を書き出しました（${format === "text" ? "テキスト" : "Markdown"}）
📄 ファイル: ${outPath}
📚 章: ${range}
📊 文字数: ${totalChars.toLocaleString("ja-JP")}文字（本文のみ。見出しは含まない）
`
  if (partsShown.length > 0) report += `🗂️ 部の見出し: ${partsShown.join("・")}\n`
  if (paper) {
    report += `📄 原稿用紙換算: ${linesToPages(totalLines, paper).toLocaleString("ja-JP")}枚（${formatManuscriptLabel(paper)}、本文のみ。空行は数えない）\n`
  }
  if (marks.ruby + marks.emphasis > 0) {
    report += `🔤 ルビ ${marks.ruby}箇所・傍点 ${marks.emphasis}箇所を ${RUBY_NOTATION_LABELS[ruby]} で書き出しました\n`
  }
  if (missing.length > 0) {
    report += `⚠️ 本文の無い章を飛ばしました: ${formatChapterRanges(missing)}\n`
  }
  if (typographyErrors > 0) {
    report += `⚠️ 表記の規約違反が ${typographyErrors}件あります（書き出しでは直していません）。novel_check で確かめられます\n`
  }
  return report
}

/** 書き出す範囲に入るか（節の扱いは novelExportExecute の説明を参照） */
function inRange(f: ManuscriptFile, from: number, to: number, toEnd: boolean): boolean {
  switch (f.section.kind) {
    case "chapter":
    case "interlude":
      return f.section.chapter >= from && f.section.chapter <= to
    case "prologue":
      return from <= 1
    case "epilogue":
      return toEnd
  }
}

const RUBY_NOTATION_LABELS: Record<RubyNotation, string> = {
  kakuyomu: "カクヨム形式（｜親文字《ルビ》・《《傍点》》）",
  narou: "小説家になろう形式（｜親文字《ルビ》。傍点は「・」のルビ）",
  aozora: "青空文庫形式（｜親文字《ルビ》・［＃「…」に傍点］）",
  pixiv: "pixiv 形式（[[rb:親文字 > ルビ]]。傍点は「・」のルビ）",
  html: "HTML の <ruby>（傍点は「・」のルビ）",
  paren: "括弧書き（親文字（ルビ）。傍点は外す）",
  none: "ルビなし（親文字だけ。傍点は外す）",
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
