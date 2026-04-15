/**
 * opencode-novel-plugin - Shared Utilities
 * 
 * 文件路径处理、文档解析、状态管理等通用工具函数
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { join, resolve, relative } from "node:path"
import { existsSync } from "node:fs"

export { existsSync } from "node:fs"

// ============================================================
// 常量
// ============================================================

/** 小说项目数据目录 */
export const NOVEL_DIR = ".novel"

/** 文档类型 */
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

/** 工作流阶段 */
export type Phase = "concept" | "world-building" | "characters" | "outline" | "scenes" | "writing" | "completed"

/** 场景状态 */
export type SceneStatus = "pending" | "in-progress" | "completed"

/** 伏笔状态 */
export type ForeshadowStatus = "pending" | "planted" | "resolved" | "abandoned"

/** 角色状态 */
export type CharacterStatus = "active" | "deceased" | "missing" | "retired"

/** 角色类型 */
export type CharacterRole = "protagonist" | "supporting" | "antagonist" | "minor"

// ============================================================
// 路径工具
// ============================================================

/** 获取小说数据目录路径 */
export function getNovelDir(projectDir: string): string {
  return join(projectDir, NOVEL_DIR)
}

/** 获取项目配置文件路径 */
export function getConfigPath(projectDir: string): string {
  return join(getNovelDir(projectDir), "config.json")
}

/** 获取文档路径 */
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

/** 获取章节目录 */
export function getChaptersDir(projectDir: string): string {
  return join(getNovelDir(projectDir), "chapters")
}

// ============================================================
// 文件工具
// ============================================================

/** 安全读取文件，不存在返回 null */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8")
  } catch {
    return null
  }
}

/** 安全写入文件，自动创建目录 */
export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const dir = resolve(filePath, "..")
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(filePath, content, "utf-8")
}

/** 安全读取 JSON 文件 */
export async function safeReadJson<T>(filePath: string): Promise<T | null> {
  const content = await safeReadFile(filePath)
  if (!content) return null
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/** 安全写入 JSON 文件 */
export async function safeWriteJson<T>(filePath: string, data: T): Promise<void> {
  await safeWriteFile(filePath, JSON.stringify(data, null, 2))
}

// ============================================================
// 解析工具
// ============================================================

/** 解析场景列表，返回带状态的场景 */
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
    // 匹配场景标题，如 "### 1.1 场景标题" 或 "### 场景1.1 - 标题"
    const sceneMatch = line.match(/^###\s+(?:(?:场景|Scene)\s*)?(\d+(?:\.\d+)?)\s*[-–—]?\s*(.*)/)
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

    // 匹配 checkbox 状态
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

/** 解析伏笔 JSON */
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

/** 解析角色状态 JSON */
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

/** 解析项目配置 */
export interface NovelConfig {
  title: string
  genre: string
  theme?: string
  targetWords?: number
  chapterCount?: number
  narrativePerspective?: string
  createdAt: string
  updatedAt: string
  currentPhase: Phase
}

// ============================================================
// 状态判断工具
// ============================================================

/** 判断当前工作流阶段 */
export function determinePhase(projectDir: string): Phase {
  const concept = existsSync(getDocPath(projectDir, "concept"))
  const world = existsSync(getDocPath(projectDir, "world-building"))
  const chars = existsSync(getDocPath(projectDir, "characters"))
  const outlineBrief = existsSync(getDocPath(projectDir, "outline-brief"))
  const outlineDetailed = existsSync(getDocPath(projectDir, "outline-detailed"))
  const scenes = existsSync(getDocPath(projectDir, "scenes"))

  if (scenes) {
    // 检查是否有已完成的章节
    const chaptersDir = getChaptersDir(projectDir)
    if (existsSync(chaptersDir)) {
      return "writing"
    }
    return "scenes"
  }
  if (outlineDetailed) return "scenes"
  if (outlineBrief) return "outline"
  if (chars && world) return "outline"
  if (concept) return "world-building"
  return "concept"
}

/** 获取目录下所有 .md 文件列表 */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  return files.filter((f) => f.endsWith(".md")).sort()
}

/** 统计章节字数 */
export function countWords(text: string): number {
  // 中文字符
  const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  // 英文单词
  const english = text.match(/[a-zA-Z]+/g)?.length ?? 0
  return chinese + english
}

/** 格式化进度条 */
export function progressBar(completed: number, total: number, width = 20): string {
  if (total === 0) return "[" + "─".repeat(width) + "] 0%"
  const filled = Math.round((completed / total) * width)
  const bar = "█".repeat(filled) + "░".repeat(width - filled)
  const percent = Math.round((completed / total) * 100)
  return `[${bar}] ${percent}% (${completed}/${total})`
}
