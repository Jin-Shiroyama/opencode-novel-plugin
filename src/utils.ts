/**
 * opencode-novel-plugin - 共通ユーティリティ
 *
 * パス解決・ファイル入出力・文書解析・進行状況の判定をまとめたモジュール。
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { existsSync, readdirSync, readFileSync } from "node:fs"
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

/** config.json の limits を既定値にかぶせて解決する */
export function resolveLimit(config: NovelConfig | null | undefined, key: LimitKey): number {
  const override = config?.limits?.[key]
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override)
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
  const chars = [...text]
  if (chars.length <= limit) return [text, false]
  return [chars.slice(0, limit).join(""), true]
}

/** 末尾から指定文字数だけ切り出す（前章の引き継ぎ用） */
export function takeTailChars(text: string, limit: number): string {
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
  if (!existsSync(getDocPath(projectDir, "outline-detailed"))) return "outline"
  if (!existsSync(getDocPath(projectDir, "scenes"))) return "scenes"

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
