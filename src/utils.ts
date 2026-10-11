/**
 * opencode-novel-plugin - 共通ユーティリティ
 *
 * パス解決・ファイル入出力・文書解析・進行状況の判定をまとめたモジュール。
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { join, resolve, relative } from "node:path"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { DEFAULTS, LIMITS, MARTIAL_ARTS_GENRE_KEYWORDS } from "./constants.js"
import type { LimitKey } from "./constants.js"

export { existsSync } from "node:fs"

// ============================================================
// 定数
// ============================================================

/** 作品データを置くディレクトリ */
export const NOVEL_DIR = ".novel"

/**
 * 文書の種類。
 * `sect` / `martial-art` / `weapon` は流派・武芸設定（内部識別子 wuxia）用。
 */
export type DocType =
  | "concept"
  | "world-building"
  | "characters"
  | "character-state"
  | "outline-brief"
  | "outline-detailed"
  | "scenes"
  | "summary"
  | "foreshadow"
  | "chapter"
  | "reality-source"
  | "sect"
  | "martial-art"
  | "weapon"

/** 執筆の進行段階 */
export type Phase = "concept" | "world-building" | "characters" | "outline" | "scenes" | "writing" | "completed"

/** シーンの状態 */
export type SceneStatus = "pending" | "in-progress" | "completed"

/** 伏線の状態 */
export type ForeshadowStatus = "pending" | "planted" | "resolved" | "abandoned"

/** キャラクターの生存状態 */
export type CharacterStatus = "active" | "deceased" | "missing" | "retired"

/** キャラクターの役割 */
export type CharacterRole = "protagonist" | "supporting" | "antagonist" | "minor"

// ============================================================
// パス
// ============================================================

/** 作品データディレクトリのパスを返す */
export function getNovelDir(projectDir: string): string {
  return join(projectDir, NOVEL_DIR)
}

/** 設定ファイルのパスを返す */
export function getConfigPath(projectDir: string): string {
  return join(getNovelDir(projectDir), "config.json")
}

/** 文書の種類からファイルパスを返す */
export function getDocPath(projectDir: string, docType: DocType, name?: string): string {
  const base = getNovelDir(projectDir)
  switch (docType) {
    case "concept":
      return join(base, "concept.md")
    case "world-building":
      return join(base, "world-building.md")
    case "characters":
      return join(base, "characters", "profiles.md")
    case "character-state":
      return join(base, "characters", "state.json")
    case "outline-brief":
      return join(base, "outline-brief.md")
    case "outline-detailed":
      return join(base, "outline-detailed.md")
    case "scenes":
      return join(base, "scenes.md")
    case "summary":
      return join(base, "summary.md")
    case "foreshadow":
      return join(base, "foreshadow.json")
    case "sect":
      return join(base, "wuxia", "sects.md")
    case "martial-art":
      return join(base, "wuxia", "martial-arts.md")
    case "reality-source":
      return join(base, "reality-source.md")
    case "weapon":
      return join(base, "wuxia", "weapons.md")
    case "chapter":
      return join(base, "chapters", `${name}.md`)
    default:
      return join(base, `${docType}.md`)
  }
}

/** 本文ディレクトリのパスを返す */
export function getChaptersDir(projectDir: string): string {
  return join(getNovelDir(projectDir), "chapters")
}

// ============================================================
// ファイル入出力
// ============================================================

/** ファイルを読む。存在しなければ null を返す */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8")
  } catch {
    return null
  }
}

/** ファイルを書く。親ディレクトリがなければ作る */
export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const dir = resolve(filePath, "..")
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(filePath, content, "utf-8")
}

/** JSON ファイルを読む。存在しないか壊れていれば null を返す */
export async function safeReadJson<T>(filePath: string): Promise<T | null> {
  const content = await safeReadFile(filePath)
  if (!content) return null
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/** JSON ファイルを書く */
export async function safeWriteJson<T>(filePath: string, data: T): Promise<void> {
  await safeWriteFile(filePath, JSON.stringify(data, null, 2))
}

// ============================================================
// 分割保存
// ============================================================

/**
 * 長編では一つの文書が大きくなるため、agent とコマンドは章ごと・項目ごとの
 * 分割保存を案内している。この節はその分割を読むための道具をまとめる。
 *
 *   .novel/outline/chapter-001.md        章別プロット（章ごと）
 *   .novel/scenes/chapter-001.md         シーン一覧（章ごと）
 *   .novel/characters/{キャラクター名}.md  一人ずつの設定
 *   .novel/wuxia/sects/{流派名}.md        流派（1流派1ファイル）
 *   .novel/wuxia/weapons/{刀剣名}.md      刀剣（1本1ファイル）
 *   .novel/reality/events/ など           取材メモ
 */

/** .novel/ 配下のパスを組み立てる */
export function getNovelPath(projectDir: string, ...parts: string[]): string {
  return join(getNovelDir(projectDir), ...parts)
}

/** 文書の一片。label はどのファイル由来かを示す */
export interface DocPart {
  label: string
  content: string
  /** 文字数の枠を先に確保する（指定されたシーンなど） */
  priority?: boolean
}

/** ディレクトリを再帰的にたどり、.md のパスを集める（深さは3階層まで） */
function collectMarkdownPaths(dir: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...collectMarkdownPaths(full, depth - 1))
    else if (name.endsWith(".md")) out.push(full)
  }
  return out
}

/**
 * 統合ファイルと分割ディレクトリの両方から文書を集める。
 *
 * 片方しか無ければそれだけを返す。両方あれば両方返す（呼び手が選ぶ）。
 * 例: readDocParts(dir, "wuxia/sects.md", "wuxia/sects")
 */
export async function readDocParts(
  projectDir: string,
  filePath: string | null,
  dirPath: string | null,
): Promise<DocPart[]> {
  const parts: DocPart[] = []
  if (filePath) {
    const content = await safeReadFile(getNovelPath(projectDir, filePath))
    if (content && content.trim().length > 0) parts.push({ label: filePath, content })
  }
  if (dirPath) {
    const base = getNovelPath(projectDir, dirPath)
    for (const full of collectMarkdownPaths(base)) {
      const content = await safeReadFile(full)
      if (content && content.trim().length > 0) {
        parts.push({ label: relative(getNovelDir(projectDir), full), content })
      }
    }
  }
  return parts
}

/** 章ごとの分割ファイル名（chapter-002.md のように3桁ゼロ埋め） */
export function chapterFileName(chapterNum: number): string {
  return `chapter-${String(chapterNum).padStart(3, "0")}.md`
}

/**
 * 章ごとに分割された文書を読む。
 * 例: readChapterDoc(dir, "outline", 2) → .novel/outline/chapter-002.md
 */
export async function readChapterDoc(
  projectDir: string,
  dirName: string,
  chapterNum: number,
): Promise<string | null> {
  const path = getNovelPath(projectDir, dirName, chapterFileName(chapterNum))
  const content = await safeReadFile(path)
  return content && content.trim().length > 0 ? content : null
}

/**
 * 章ごとの分割ファイルが1つ以上あるか（進行段階の判定に使う）。
 * .keep のような空ファイルや、章ファイル以外は数えない。
 */
export function hasChapterDocs(projectDir: string, dirName: string): boolean {
  const dir = getNovelPath(projectDir, dirName)
  if (!existsSync(dir)) return false
  try {
    return readdirSync(dir).some((f) => /^chapter-\d+\.md$/.test(f))
  } catch {
    return false
  }
}

/**
 * 章別プロットができているか。
 * 統合ファイル outline-detailed.md でも、章ごとの outline/chapter-NNN.md でもよい。
 * agent とコマンドが分割保存を案内しているため、片方しか見ないと
 * 案内どおりに保存した書き手の進行が止まる。
 */
export function hasOutlineDetailed(projectDir: string): boolean {
  return existsSync(getDocPath(projectDir, "outline-detailed")) || hasChapterDocs(projectDir, "outline")
}

/**
 * シーン一覧ができているか。
 * 統合ファイル scenes.md でも、章ごとの scenes/chapter-NNN.md でもよい。
 */
export function hasSceneList(projectDir: string): boolean {
  return existsSync(getDocPath(projectDir, "scenes")) || hasChapterDocs(projectDir, "scenes")
}

/**
 * 一人ずつの人物設定ファイルを列挙する。
 * profiles.md（一覧）と state.json は除く。
 */
export interface CharacterDoc extends DocPart {
  /** 文書中に書かれた呼称・別名 */
  aliases: string[]
}

export async function listCharacterDocs(projectDir: string): Promise<CharacterDoc[]> {
  const dir = getNovelPath(projectDir, "characters")
  if (!existsSync(dir)) return []
  let names: string[]
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "profiles.md").sort()
  } catch {
    return []
  }
  const parts: CharacterDoc[] = []
  for (const name of names) {
    const content = await safeReadFile(join(dir, name))
    if (content && content.trim().length > 0) {
      parts.push({
        label: name.replace(/\.md$/, ""),
        content,
        aliases: extractNameAliases(content),
      })
    }
  }
  return parts
}

/**
 * 人物設定の文書から呼称・別名を読み取る。
 *
 * 「- **呼称**：森田、先生」のような行を拾う。姓の推定が当たらない人物
 * （一文字姓など）を取りこぼさないための、書き手が明示できる逃げ道。
 */
const ALIAS_LINE = /(?:呼称|別名|通称|愛称|あだ名)[^：:\n]{0,6}[：:]\s*(.+)/
export function extractNameAliases(content: string): string[] {
  const out: string[] = []
  for (const line of content.split("\n")) {
    const m = line.match(ALIAS_LINE)
    if (!m) continue
    for (const piece of m[1].split(/[、,\uFF0C・\/\s\u3000]+/)) {
      const t = piece.replace(/[*`「」『』（）()\[\]]/g, "").trim()
      if (t.length >= 1) out.push(t)
    }
  }
  return [...new Set(out)]
}

/**
 * 人物名から、本文中で照合するための手がかりを作る。
 *
 * ファイル名は「森田悠」のようにフルネームだが、プロットやシーンでは
 * 「森田」と姓だけ、あるいは「悠」と名だけで書かれることが多い。
 * そこで次を手がかりにする。
 *
 *   strong（2文字以上。誤って拾う危険が小さい）
 *     - フルネームそのまま
 *     - 区切り記号（空白・中黒）で分けた部分
 *     - 先頭からの部分（姓）と末尾からの部分（名）
 *     - 文書に書かれた呼称・別名
 *   weak（1文字。単独では拾いすぎるので、strong で当たらなかったときだけ使う）
 *     - 先頭1文字（「林美咲」の「林」のような一文字姓）
 *     - 1文字の呼称・別名
 *
 * 「林美咲」は先頭2文字が「林美」なので、姓だけの「林」では strong が当たらない。
 * weak の段で拾う。
 */
export function characterNameKeys(name: string, aliases: string[] = []): { strong: string[]; weak: string[] } {
  const strong = new Set<string>()
  const weak = new Set<string>()
  const trimmed = name.trim()
  if (trimmed.length === 0) return { strong: [], weak: [] }

  const add = (k: string) => {
    const t = k.trim()
    if (t.length === 0) return
    if ([...t].length === 1) weak.add(t)
    else strong.add(t)
  }

  add(trimmed)
  for (const piece of trimmed.split(/[\s\u3000・]+/)) add(piece)

  const chars = [...trimmed]
  for (let n = 1; n < chars.length; n++) {
    add(chars.slice(0, n).join("")) // 姓の候補
    add(chars.slice(chars.length - n).join("")) // 名の候補
  }

  for (const a of aliases) add(a)

  return { strong: [...strong], weak: [...weak] }
}

/**
 * この章に出る人物の設定ファイルを選ぶ。
 *
 * 二段で照合する。まず strong（2文字以上）で当たるものを採り、
 * 当たらなかった人物だけ weak（1文字）でもう一度照合する。
 * 一段目で誰かが当たったからといって二段目を省かないのが肝心で、
 * 省くと姓の推定に失敗した人物（一文字姓など）が落ちる。
 *
 * 誰も当たらなければ、絞り込みに失敗したものとして全員を返す
 * （資料が足りないより、多いほうが害が小さい）。
 */
export function selectCharacterDocs<T extends DocPart & { aliases?: string[] }>(
  docs: T[],
  haystack: string,
): T[] {
  if (docs.length === 0) return []
  if (haystack.trim().length === 0) return docs

  const keyed = docs.map((d) => ({ doc: d, keys: characterNameKeys(d.label, d.aliases ?? []) }))
  const hit = new Set<T>()

  for (const { doc, keys } of keyed) {
    if (keys.strong.some((k) => haystack.includes(k))) hit.add(doc)
  }
  for (const { doc, keys } of keyed) {
    if (hit.has(doc)) continue
    if (keys.weak.some((k) => haystack.includes(k))) hit.add(doc)
  }

  if (hit.size === 0) return docs
  return docs.filter((d) => hit.has(d))
}

// ============================================================
// 文字数の枠の配分
// ============================================================

/**
 * 複数の文書に文字数の枠を配分する（max-min fair allocation）。
 *
 * 単純に連結してから先頭から切ると、前に置いた文書が長いだけで後ろの文書が
 * 丸ごと落ちる。たとえば人物一覧が上限を超えていると、この章に出る人物の
 * 個別設定が一件も資料に入らない。
 *
 * そこで、小さい文書から順に満たしていく。余った枠は残りに回すので、
 * 短い文書は必ず全文が入り、長い文書だけが切られる。
 */
export function allocateCharBudget(sizes: number[], limit: number): number[] {
  const alloc = sizes.map(() => 0)
  if (limit <= 0) return alloc

  let remaining = limit
  let pending = sizes.map((_, i) => i).filter((i) => sizes[i] > 0)

  while (pending.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / pending.length)
    if (share < 1) break
    const satisfied = pending.filter((i) => sizes[i] <= share)
    if (satisfied.length === 0) {
      // 全員が枠を使い切る。均等に配って終わり
      for (const i of pending) {
        alloc[i] = share
        remaining -= share
      }
      pending = []
      break
    }
    for (const i of satisfied) {
      alloc[i] = sizes[i]
      remaining -= sizes[i]
    }
    const done = new Set(satisfied)
    pending = pending.filter((i) => !done.has(i))
  }

  // 端数を、まだ余裕のあるものへ順に配る
  for (const i of pending) {
    if (remaining <= 0) break
    const give = Math.min(remaining, sizes[i] - alloc[i])
    alloc[i] += give
    remaining -= give
  }

  return alloc
}

/**
 * 複数の文書を、文字数の枠を配分しながら連ねる。
 *
 * priority を立てた文書は先頭に置く（どれが今回の対象かを分かりやすくする）。
 * 枠が回らずまるごと落ちた文書は、名前だけを残して落ちたことが分かるようにする。
 */
export function clipDocParts(parts: DocPart[], limit: number): string {
  if (parts.length === 0) return ""

  const ordered = [...parts.filter((p) => p.priority), ...parts.filter((p) => !p.priority)]
  const bodies = ordered.map((p) => p.content.trim())
  const sizes = bodies.map((b) => [...b].length)
  const showLabels = ordered.length > 1
  const label = (i: number) => (showLabels ? `### ${ordered[i].label}\n` : "")

  if (sizes.reduce((a, b) => a + b, 0) <= limit) {
    return ordered.map((_, i) => label(i) + bodies[i]).join("\n\n")
  }

  const alloc = allocateCharBudget(sizes, limit)
  const out: string[] = []
  for (let i = 0; i < ordered.length; i++) {
    if (alloc[i] <= 0) {
      out.push(`### ${ordered[i].label}\n…（文字数の枠が足りず省略。全文はファイルを直接参照してください）`)
      continue
    }
    const [body, truncated] = truncateChars(bodies[i], alloc[i])
    out.push(label(i) + body + (truncated ? "\n…（以下省略。全文は該当ファイルを直接参照してください）" : ""))
  }
  return out.join("\n\n")
}

// ============================================================
// 文書解析
// ============================================================

/**
 * シーン一覧を解析して、状態付きのシーン配列を返す。
 *
 * 見出しは次のいずれでも拾う。
 *   `### 1.1 タイトル` / `### シーン1.1 タイトル` / `### Scene 1.1 - タイトル`
 */
export function parseScenes(content: string): Array<{
  id: string
  title: string
  status: SceneStatus
  raw: string
}> {
  const scenes: Array<{ id: string; title: string; status: SceneStatus; raw: string }> = []
  const lines = content.split("\n")
  let currentScene: { id: string; title: string; status: SceneStatus; rawLines: string[] } | null = null

  for (const line of lines) {
    const sceneMatch = line.match(/^###\s+(?:(?:シーン|場面|Scene)\s*)?(\d+(?:\.\d+)?)\s*[-–—]?\s*(.*)/)
    if (sceneMatch) {
      if (currentScene) {
        scenes.push({ ...currentScene, raw: currentScene.rawLines.join("\n") })
      }
      currentScene = {
        id: sceneMatch[1],
        title: sceneMatch[2].trim(),
        status: "pending",
        rawLines: [line],
      }
      continue
    }

    // チェックボックスから状態を読む
    const checkMatch = line.match(/^-\s+\[([ x\-])\]/)
    if (checkMatch && currentScene) {
      const flag = checkMatch[1]
      if (flag === "x") currentScene.status = "completed"
      else if (flag === "-") currentScene.status = "in-progress"
      else currentScene.status = "pending"
    }

    if (currentScene) {
      currentScene.rawLines.push(line)
    }
  }

  if (currentScene) {
    scenes.push({ ...currentScene, raw: currentScene.rawLines.join("\n") })
  }

  return scenes
}

/** 伏線の項目 */
export interface ForeshadowEntry {
  id: string
  title: string
  content: string
  category: string
  status: ForeshadowStatus
  plantChapter?: number
  targetChapter?: number
  resolvedChapter?: number
  notes?: string
}

/** キャラクターの現在状態 */
export interface CharacterState {
  name: string
  status: CharacterStatus
  role: CharacterRole
  physicalState?: string
  mentalState?: string
  items?: string[]
  abilities?: string[]
  relationships?: Record<string, string>
  events?: string[]
  lastUpdatedChapter?: number
}

/**
 * novel_context が資料を読み込む際の文字数上限。
 * config.json の `limits` に書くと既定値（constants.ts の LIMITS）を上書きできる。
 */
export type NovelLimits = Partial<Record<LimitKey, number>>

/** プロジェクト設定（.novel/config.json） */
export interface NovelConfig {
  title: string
  genre: string
  theme?: string
  targetWords?: number
  chapterCount?: number
  narrativePerspective?: string
  /** 流派・武芸設定を使うかどうか。未指定ならジャンルから推定する */
  martialArtsSetting?: boolean
  /** 資料読み込みの文字数上限の上書き */
  limits?: NovelLimits
  createdAt: string
  updatedAt: string
  currentPhase: Phase
}

/**
 * config.json の limits を既定値にかぶせて解決する。
 *
 * 整数に丸めたあとで 1 以上かを確かめる。先に 0 より大きいかだけを見ると
 * 0.5 のような値が通り、丸めた結果の 0 が上限として使われてしまう。
 * 上限 0 は takeTailChars で「全文」と同じ意味になるため、
 * 意図せず前章の全文が資料に載る。
 */
export function resolveLimit(config: NovelConfig | null | undefined, key: LimitKey): number {
  const override = config?.limits?.[key]
  if (typeof override === "number" && Number.isFinite(override)) {
    const value = Math.floor(override)
    if (value >= 1) return value
  }
  return LIMITS[key]
}

// ============================================================
// 文字数
// ============================================================

/**
 * 文字数を数える。
 *
 * 空白（半角・全角）と改行を除いた全文字数。仮名・漢字・約物・英数字を
 * 区別せず 1 文字として数えるため、原稿用紙 400 字詰めの換算と一致する。
 * サロゲートペア（一部の漢字や絵文字）を 1 文字として数えるため
 * コードポイント単位で走査する。
 */
export function countWords(text: string): number {
  if (!text) return 0
  let count = 0
  for (const ch of text) {
    if (!isWhitespace(ch)) count++
  }
  return count
}

/** 空白文字（全角スペース・各種 Unicode 空白・改行・タブ）かどうか */
function isWhitespace(ch: string): boolean {
  return /^[\s　 ​﻿]$/u.test(ch)
}

/**
 * 先頭から指定文字数だけ切り出す。打ち切った場合は第2要素が true。
 * コードポイント単位なのでサロゲートペアが割れない。
 */
export function truncateChars(text: string, limit: number): [string, boolean] {
  if (limit <= 0) return ["", text.length > 0]
  const chars = [...text]
  if (chars.length <= limit) return [text, false]
  return [chars.slice(0, limit).join(""), true]
}

/**
 * 末尾から指定文字数だけ切り出す（前章の引き継ぎ用）。
 *
 * limit が 0 以下のときは空文字を返す。slice(-0) は slice(0) と同じで
 * 配列全体を返してしまうため、ここで先に弾く。
 */
export function takeTailChars(text: string, limit: number): string {
  if (limit <= 0) return ""
  const chars = [...text]
  if (chars.length <= limit) return text
  return chars.slice(-limit).join("")
}

// ============================================================
// ジャンル判定
// ============================================================

/**
 * 流派・武芸設定（内部識別子 wuxia）を使うジャンルかどうか。
 *
 * 全角・半角や区切り記号を正規化したうえで、2 文字以上の
 * 固有キーワードだけで判定する。「武士」「武装」「武家」などには反応しない。
 */
export function isMartialArtsGenre(genre: string | undefined | null): boolean {
  if (!genre) return false
  const normalized = genre
    .normalize("NFKC")
    .replace(/[\s　・、\uFF0C,/|()（）【】\[\]「」]/g, "")
  return MARTIAL_ARTS_GENRE_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

/** 設定の明示指定を優先し、なければジャンルから推定する */
export function usesMartialArtsSetting(config: Pick<NovelConfig, "genre" | "martialArtsSetting">): boolean {
  if (typeof config.martialArtsSetting === "boolean") return config.martialArtsSetting
  return isMartialArtsGenre(config.genre)
}

// ============================================================
// 進行状況の判定
// ============================================================

/**
 * 未入力のテンプレート箇所（`[登場人物名]` のような角括弧）を検出する正規表現。
 * Markdown のリンク `[文字](url)` とチェックボックス `[ ] [x] [-]` は除く。
 */
const PLACEHOLDER_PATTERN = /\[(?![ x-]\])[^\]\n]{1,60}\](?!\()/

/**
 * 文書が「書き終わっている」とみなせるかどうか。
 *
 * novel_init は concept.md / world-building.md / characters/profiles.md を
 * 雛形として先に作る。そのためファイルの有無では段階を判定できない。
 * 雛形の角括弧プレースホルダが 1 つも残っていなければ記入済みとみなす。
 */
export function isDocFilled(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    return false
  }
  if (content.trim().length === 0) return false
  return !PLACEHOLDER_PATTERN.test(content)
}

/** 本文として保存済みの章数を数える */
export function countWrittenChapters(projectDir: string): number {
  const dir = getChaptersDir(projectDir)
  if (!existsSync(dir)) return 0
  try {
    return readdirSync(dir).filter((f) => /^chapter-\d+\.md$/.test(f)).length
  } catch {
    return 0
  }
}

/**
 * 現在の進行段階を判定する。
 *
 * 雛形として先に作られる 3 文書は記入済みかどうかで、
 * プロット・シーン一覧はファイルの有無で判定する。
 * 予定章数に達していれば completed を返す。
 */
export function determinePhase(projectDir: string, config?: NovelConfig | null): Phase {
  if (!isDocFilled(getDocPath(projectDir, "concept"))) return "concept"
  if (!isDocFilled(getDocPath(projectDir, "world-building"))) return "world-building"
  if (!isDocFilled(getDocPath(projectDir, "characters"))) return "characters"
  if (!existsSync(getDocPath(projectDir, "outline-brief"))) return "outline"

  // 章別プロットとシーン一覧は、統合ファイルでも章ごとの分割でもよい。
  if (!hasOutlineDetailed(projectDir)) return "outline"
  if (!hasSceneList(projectDir)) return "scenes"

  const written = countWrittenChapters(projectDir)
  const planned = config?.chapterCount ?? DEFAULTS.chapterCount
  if (written > 0 && written >= planned) return "completed"
  return "writing"
}

/** ディレクトリ内の .md ファイル一覧を返す */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  return files.filter((f) => f.endsWith(".md")).sort()
}

// ============================================================
// 表示
// ============================================================

/** 進捗バーを組み立てる */
export function progressBar(completed: number, total: number, width = 20): string {
  if (total === 0) return "[" + "─".repeat(width) + "] 0%"
  const filled = Math.round((completed / total) * width)
  const bar = "█".repeat(filled) + "░".repeat(width - filled)
  const percent = Math.round((completed / total) * 100)
  return `[${bar}] ${percent}% (${completed}/${total})`
}

/** 章見出しや大見出しから章番号を読み取るための数字表記ゆれ対応 */
const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/**
 * 「1」「１」「一」「二十三」などの章番号表記を数値にする。
 * 読み取れない場合は null。
 */
export function parseChapterNumber(raw: string): number | null {
  const text = raw.trim().normalize("NFKC")
  if (/^\d+$/.test(text)) return parseInt(text, 10)

  // 漢数字（千の位まで）
  if (!/^[〇零一二三四五六七八九十百千]+$/.test(text)) return null

  let total = 0
  let section = 0
  let current = 0
  for (const ch of text) {
    if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch]
      continue
    }
    if (ch === "十") {
      section += (current || 1) * 10
      current = 0
      continue
    }
    if (ch === "百") {
      section += (current || 1) * 100
      current = 0
      continue
    }
    if (ch === "千") {
      total += (section + (current || 1)) * 1000
      section = 0
      current = 0
      continue
    }
  }
  const value = total + section + current
  return value > 0 ? value : null
}
