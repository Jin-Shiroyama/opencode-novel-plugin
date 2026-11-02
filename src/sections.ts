/**
 * opencode-novel-plugin - 本文の節（章・プロローグ・幕間・エピローグ）
 *
 * 番号のある章のほかに、番号を持たない節を3種類置ける。
 *
 *   chapters/prologue.md            プロローグ。第1章の前
 *   chapters/interlude-005-1.md     幕間。第5章のあとの1つ目（同じ章のあとに複数置ける）
 *   chapters/epilogue.md            エピローグ。最後の章のあと
 *
 * 節は章の数に入れない。章番号の仕組み（シーンID、chapterCount、工程の判定）は章だけで動く。
 * 文字数の累計や書き出しのように、原稿全体を扱うところでだけ節を含める。
 *
 * 伏線の記録は章番号で持つ。節の出来事は recordChapterOf の章番号で記録する
 * （プロローグは 0、幕間は直前の章、エピローグは最後の章）。
 * 人物の状態は節のキー（sectionKey）ごとの変化として持つ（character-state.ts）。
 * エピローグの「最後の章」は本文のある最後の章で、予定章数ではない（lastChapterForRecords）。
 * 結末を決めずに書き進める連載では、予定章数を超えて書くことがあるため。
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  getChaptersDir, getNovelPath, listMarkdownFiles, chapterNumberFromFileName, readChapterDoc, safeReadFile,
} from "./utils.js"

export type ManuscriptSection =
  | { kind: "chapter"; chapter: number }
  | { kind: "prologue" }
  | { kind: "interlude"; chapter: number; index: number }
  | { kind: "epilogue" }

export type SectionKind = ManuscriptSection["kind"]

export const SECTION_KINDS = ["chapter", "prologue", "interlude", "epilogue"] as const

/** 見出しに書く節の名前 */
export const SECTION_NAMES: Record<Exclude<SectionKind, "chapter">, string> = {
  prologue: "プロローグ",
  interlude: "幕間",
  epilogue: "エピローグ",
}

/**
 * 節のファイル名。CHAPTER_FILE_PATTERN（utils.ts）と並んで「正式な本文ファイル」を定める。
 * 先頭と末尾を固定しているので `backup-prologue.md` や `interlude-5.md` は節とみなさない。
 */
const INTERLUDE_FILE_PATTERN = /^interlude-(\d+)-(\d+)\.md$/

/** ファイル名（パスではなく名前）から節を読む。正式な本文ファイルの名前でなければ null */
export function sectionFromFileName(fileName: string): ManuscriptSection | null {
  const chapter = chapterNumberFromFileName(fileName)
  if (chapter !== null) return { kind: "chapter", chapter }
  if (fileName === "prologue.md") return { kind: "prologue" }
  if (fileName === "epilogue.md") return { kind: "epilogue" }
  const m = fileName.match(INTERLUDE_FILE_PATTERN)
  if (m) {
    const after = parseInt(m[1], 10)
    const index = parseInt(m[2], 10)
    if (after >= 1 && index >= 1) return { kind: "interlude", chapter: after, index }
  }
  return null
}

/** 節のファイル名（chapter-005.md / prologue.md / interlude-005-1.md / epilogue.md） */
export function sectionFileName(s: ManuscriptSection): string {
  const pad = (n: number) => String(n).padStart(3, "0")
  switch (s.kind) {
    case "chapter":
      return `chapter-${pad(s.chapter)}.md`
    case "prologue":
      return "prologue.md"
    case "interlude":
      return `interlude-${pad(s.chapter)}-${s.index}.md`
    case "epilogue":
      return "epilogue.md"
  }
}

/**
 * 記録のキーにする節の名前（chapter-005 / prologue / interlude-005-1 / epilogue）。
 * 人物の状態（state.json）の節ごとの記録に使う。ファイル名から .md を外した形
 */
export function sectionKey(s: ManuscriptSection): string {
  return sectionFileName(s).replace(/\.md$/, "")
}

/** sectionKey の逆。節のキーの形でなければ null */
export function sectionFromKey(key: string): ManuscriptSection | null {
  return sectionFromFileName(`${key}.md`)
}

/**
 * 節の呼び名（「第5章」「プロローグ」「幕間（第5章のあと）」）。
 * 同じ章のあとの2つ目からは「幕間（第5章のあと・2）」とする。
 * あらすじの見出しにも使うので、parseSectionLabel で読み戻せる形にしておく。
 */
export function sectionLabel(s: ManuscriptSection): string {
  switch (s.kind) {
    case "chapter":
      return `第${s.chapter}章`
    case "prologue":
    case "epilogue":
      return SECTION_NAMES[s.kind]
    case "interlude":
      return `幕間（第${s.chapter}章のあと${s.index > 1 ? `・${s.index}` : ""}）`
  }
}

const NUM = "[0-9０-９〇零一二三四五六七八九十百千]+"
const LABEL_PATTERN = new RegExp(
  `^(?:(プロローグ)|(エピローグ)|幕間\\s*[（(]\\s*第\\s*(${NUM})\\s*章のあと\\s*(?:[・･]\\s*([0-9０-９]+)\\s*)?[）)])(?=[\\s　]|$)`,
)

/**
 * 見出しの文字列の先頭から、章以外の節の呼び名を読む（sectionLabel の逆）。
 * 「幕間」だけで位置の無いものは、どこに置くか決められないので読まない。
 */
export function parseSectionLabel(text: string, parseNumber: (raw: string) => number | null): ManuscriptSection | null {
  const m = text.trim().match(LABEL_PATTERN)
  if (!m) return null
  if (m[1]) return { kind: "prologue" }
  if (m[2]) return { kind: "epilogue" }
  const after = parseNumber(m[3])
  const index = m[4] ? parseInt(m[4].normalize("NFKC"), 10) : 1
  if (after === null || after < 1 || index < 1) return null
  return { kind: "interlude", chapter: after, index }
}

/** 読む順番の比較（プロローグ → 第1章 → 第1章のあとの幕間 → 第2章 … → エピローグ） */
export function compareSections(a: ManuscriptSection, b: ManuscriptSection): number {
  const ka = orderKey(a)
  const kb = orderKey(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
  return 0
}

function orderKey(s: ManuscriptSection): [number, number, number] {
  switch (s.kind) {
    case "prologue":
      return [0, 0, 0]
    case "chapter":
      return [s.chapter, 0, 0]
    case "interlude":
      return [s.chapter, 1, s.index]
    case "epilogue":
      return [Number.MAX_SAFE_INTEGER, 0, 0]
  }
}

/** 同じ節か */
export function sameSection(a: ManuscriptSection, b: ManuscriptSection): boolean {
  return compareSections(a, b) === 0
}

/**
 * 伏線の記録に書く章番号（人物の状態は章番号ではなく、節のキーで記録する。character-state.ts）。
 * プロローグは 0、幕間は直前の章、エピローグは最後の章（lastChapter。lastChapterForRecords で出す）。
 */
export function recordChapterOf(s: ManuscriptSection, lastChapter: number): number {
  switch (s.kind) {
    case "chapter":
    case "interlude":
      return s.chapter
    case "prologue":
      return 0
    case "epilogue":
      return lastChapter
  }
}

/**
 * エピローグの記録に使う「最後の章」。本文のある最後の章で、まだ1章も無ければ予定章数。
 *
 * 予定章数をそのまま使うと、予定（40章）を超えて55章まで書いた連載のエピローグが
 * 第40章の出来事として記録され、第50章で張った伏線の回収章が張った章より前になる。
 * 予定より早く閉じた作品でも、書いていない章に記録を置かない。
 */
export function lastChapterForRecords(files: ManuscriptFile[], chapterCount: number): number {
  const last = lastWrittenChapter(files)
  return last > 0 ? last : chapterCount
}

/** 本文のある最後の章の番号。1章も無ければ 0 */
export function lastWrittenChapter(files: ManuscriptFile[]): number {
  return Math.max(0, ...files.flatMap((f) => (f.section.kind === "chapter" ? [f.section.chapter] : [])))
}

/** ツールの引数（section / chapterNumber / interludeIndex）から節を決める。決められなければ理由を返す */
export function sectionFromArgs(args: {
  section?: SectionKind
  chapterNumber?: number
  interludeIndex?: number
}): { section: ManuscriptSection } | { error: string } {
  const kind = args.section ?? "chapter"
  const n = args.chapterNumber
  const validNumber = n !== undefined && Number.isInteger(n) && n > 0
  if (n !== undefined && !validNumber) {
    return { error: `chapterNumber は1以上の整数で渡してください（受け取ったのは ${n}）` }
  }
  if (args.interludeIndex !== undefined && kind !== "interlude") {
    return { error: `interludeIndex は section が interlude のときだけ使います` }
  }
  switch (kind) {
    case "chapter":
      if (!validNumber) return { error: "章番号（chapterNumber）を渡してください" }
      return { section: { kind: "chapter", chapter: n } }
    case "interlude": {
      if (!validNumber) return { error: "幕間を置く位置として、直前の章の番号（chapterNumber）を渡してください" }
      const index = args.interludeIndex ?? 1
      if (!(Number.isInteger(index) && index > 0)) {
        return { error: `interludeIndex は1以上の整数で渡してください（受け取ったのは ${index}）` }
      }
      return { section: { kind: "interlude", chapter: n, index } }
    }
    case "prologue":
    case "epilogue":
      // 章番号は使わない（渡されても無視せず断ると、モデルが迷うので受け流す）
      return { section: { kind } }
    default:
      return { error: `section は ${SECTION_KINDS.join(" / ")} のどれかにしてください（受け取ったのは ${String(kind)}）` }
  }
}

export interface ManuscriptFile {
  section: ManuscriptSection
  path: string
}

/**
 * 本文のファイル（章と節）を読む順番に返す。
 * 同じ節に名前違いのファイル（chapter-002.md と chapter-2.md）があれば、名前順で先のものを使う。
 */
export async function listManuscriptFiles(projectDir: string): Promise<ManuscriptFile[]> {
  const dir = getChaptersDir(projectDir)
  const out: ManuscriptFile[] = []
  for (const name of await listMarkdownFiles(dir)) {
    const section = sectionFromFileName(name)
    if (!section || out.some((f) => sameSection(f.section, section))) continue
    out.push({ section, path: join(dir, name) })
  }
  return out.sort((a, b) => compareSections(a.section, b.section))
}

/** 章以外の節の一覧を「プロローグ・幕間2・エピローグ」のようにまとめる */
export function describeExtraSections(sections: ManuscriptSection[]): string {
  const prologue = sections.some((s) => s.kind === "prologue")
  const interludes = sections.filter((s) => s.kind === "interlude").length
  const epilogue = sections.some((s) => s.kind === "epilogue")
  return [
    ...(prologue ? ["プロローグ"] : []),
    ...(interludes > 0 ? [`幕間${interludes}`] : []),
    ...(epilogue ? ["エピローグ"] : []),
  ].join("・")
}

/** ツールを呼ぶときの引数の書き方（案内の文に使う）。例: `section: "interlude", chapterNumber: 5` */
export function sectionCallArgs(s: ManuscriptSection): string {
  switch (s.kind) {
    case "chapter":
      return `chapterNumber: ${s.chapter}`
    case "prologue":
    case "epilogue":
      return `section: "${s.kind}"`
    case "interlude":
      return `section: "interlude", chapterNumber: ${s.chapter}${s.index > 1 ? `, interludeIndex: ${s.index}` : ""}`
  }
}

/**
 * 章ごとに分割した文書（outline/ など）から、その節のものを読む。
 * 例: readSectionDoc(dir, "outline", { kind: "prologue" }) → .novel/outline/prologue.md
 * 章は readChapterDoc と同じ。直下のファイルだけを見る。
 */
export async function readSectionDoc(
  projectDir: string,
  dirName: string,
  section: ManuscriptSection,
): Promise<string | null> {
  if (section.kind === "chapter") return readChapterDoc(projectDir, dirName, section.chapter)
  const dir = getNovelPath(projectDir, dirName)
  if (!existsSync(dir)) return null
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return null
  }
  for (const name of names) {
    const s = sectionFromFileName(name)
    if (!s || !sameSection(s, section)) continue
    const content = await safeReadFile(join(dir, name))
    if (content && content.trim().length > 0) return content
  }
  return null
}

/**
 * 読む順番で、target のすぐ前に来る本文を選ぶ（前の本文の末尾を資料に載せるため）。
 * 間の本文が欠けていれば null（離れた本文の末尾を「直前」として渡さない）。
 *
 *   第N章        第N-1章、第N-1章のあとの幕間、第1章ならプロローグ
 *   幕間（N, k）  第N章、同じ位置の前の幕間
 *   エピローグ    最後の本文
 */
export function previousManuscriptFile(files: ManuscriptFile[], target: ManuscriptSection): ManuscriptFile | null {
  const before = files.filter((f) => compareSections(f.section, target) < 0)
  const prev = before[before.length - 1]
  if (!prev) return null
  const p = prev.section
  switch (target.kind) {
    case "prologue":
      return null
    case "chapter":
      if (target.chapter === 1) return p.kind === "prologue" ? prev : null
      return (p.kind === "chapter" || p.kind === "interlude") && p.chapter === target.chapter - 1 ? prev : null
    case "interlude":
      return (p.kind === "chapter" || p.kind === "interlude") && p.chapter === target.chapter ? prev : null
    case "epilogue":
      return prev
  }
}

// ============================================================
// 部（第一部・第二部 …）
// ============================================================

/** config.json の parts の1件。部の最初の章を fromChapter で示す（章番号は部をまたいで通し） */
export interface PartConfig {
  title: string
  fromChapter: number
}

export interface Part {
  /** 何番目の部か（1から） */
  number: number
  title: string
  fromChapter: number
  /** 部の最後の章。最後の部は null（予定章数か、それを超えて書いた最後の章まで） */
  toChapter: number | null
}

/**
 * config.json の parts を読む。書かれていなければ null（部を使わない）。
 * 形が違えば error を返す（黙って一部だけ使うと、見出しが欠けたまま書き出してしまう）。
 */
export function parseParts(value: unknown): { parts: Part[] } | { error: string } | null {
  if (value === undefined || value === null) return null
  const example = `例: "parts": [{ "title": "春", "fromChapter": 1 }, { "title": "夏", "fromChapter": 13 }]`
  if (!Array.isArray(value)) return { error: `config.json の parts は配列で書いてください。${example}` }
  if (value.length === 0) return null
  const problems: string[] = []
  const parts: Part[] = []
  value.forEach((raw, i) => {
    const item = raw as Partial<PartConfig> | null
    const where = `${i + 1}つ目`
    if (typeof item !== "object" || item === null) {
      problems.push(`${where}が { "title", "fromChapter" } の形ではありません`)
      return
    }
    const title = typeof item.title === "string" ? item.title.trim() : ""
    if (!title) problems.push(`${where}の title が空です`)
    const from = item.fromChapter
    if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
      problems.push(`${where}の fromChapter は1以上の整数にしてください`)
      return
    }
    const prev = parts[parts.length - 1]
    if (prev && from <= prev.fromChapter) {
      problems.push(`${where}の fromChapter（${from}）が前の部（${prev.fromChapter}）より後ろになっていません`)
    }
    parts.push({ number: parts.length + 1, title, fromChapter: from, toChapter: null })
  })
  if (problems.length > 0) return { error: `config.json の parts を読めません: ${problems.join("、")}。${example}` }
  for (let i = 0; i < parts.length - 1; i++) parts[i].toChapter = parts[i + 1].fromChapter - 1
  return { parts }
}

/** 章が入る部。どの部にも入らなければ（最初の部より前の章）null */
export function partOfChapter(parts: Part[], chapter: number): Part | null {
  let found: Part | null = null
  for (const p of parts) if (p.fromChapter <= chapter) found = p
  return found
}

/** 部の名前（「第一部」）。numerals が arabic なら「第1部」 */
export function partName(part: Part, numerals: "kanji" | "arabic", toKanji: (n: number) => string): string {
  return `第${numerals === "kanji" ? toKanji(part.number) : String(part.number)}部`
}

/** 部の範囲（「第1〜12章」「第13章〜」） */
export function partRange(part: Part, lastChapter?: number): string {
  const to = part.toChapter ?? lastChapter ?? null
  if (to === null) return `第${part.fromChapter}章〜`
  return to === part.fromChapter ? `第${to}章` : `第${part.fromChapter}〜${to}章`
}
