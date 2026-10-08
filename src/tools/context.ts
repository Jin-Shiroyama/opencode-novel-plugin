import {
  safeReadFile, safeReadJson, getDocPath, getChaptersDir, getConfigPath,
  resolveLimit, truncateChars, takeTailChars, parseChapterNumber,
} from "../utils.js"
import type { ForeshadowEntry, CharacterState, NovelConfig } from "../utils.js"
import { DEFAULTS, CHAPTER_WORD_TOLERANCE } from "../constants.js"
import type { LimitKey } from "../constants.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

interface ContextArgs {
  chapterNumber: number
  sceneId?: string
  includePrompts?: boolean
}

export async function novelContextExecute(
  args: ContextArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const chapterNum = args.chapterNumber
  const includePrompts = args.includePrompts !== false

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))

  /** config.json の limits を反映して資料を切り出す */
  const clip = (text: string, key: LimitKey): string => {
    const [body, truncated] = truncateChars(text, resolveLimit(config, key))
    return truncated ? `${body}\n…（以下省略。全文は該当ファイルを直接参照してください）` : body
  }

  let context = `📝 執筆用の資料 — 第${chapterNum}章\n${"=".repeat(50)}\n\n`

  if (config) {
    const targetWords = config.targetWords ?? DEFAULTS.targetWords
    const chapterCount = config.chapterCount ?? DEFAULTS.chapterCount
    context += `## 📖 作品情報\n`
    context += `タイトル: ${config.title}\n`
    context += `ジャンル: ${config.genre}\n`
    if (config.theme) context += `テーマ: ${config.theme}\n`
    context += `視点: ${config.narrativePerspective ?? DEFAULTS.narrativePerspective}\n`
    context += `目標文字数: ${targetWords.toLocaleString("ja-JP")}文字（全${chapterCount}章）\n`
    context += `この章の目安: ${Math.round(targetWords / chapterCount).toLocaleString("ja-JP")}文字 ±${Math.round(CHAPTER_WORD_TOLERANCE * 100)}%\n\n`
  }

  const outline = await safeReadFile(getDocPath(dir, "outline-detailed"))
  if (outline) {
    const chapterSection = extractChapterSection(outline, chapterNum)
    if (chapterSection) {
      context += `## 📋 この章のプロット (P0 — 必ず従う)\n${chapterSection}\n\n`
    }
  }

  const characters = await safeReadFile(getDocPath(dir, "characters"))
  if (characters) {
    context += `## 👤 登場人物 (P1 — 重要)\n`
    context += clip(characters, "characterProfiles") + "\n\n"
  }

  const charState = await safeReadJson<{ characters: CharacterState[] }>(getDocPath(dir, "character-state"))
  if (charState && charState.characters.length > 0) {
    context += `## 🔄 登場人物の現在の状態 (P1 — 重要)\n`
    for (const c of charState.characters) {
      context += `**${c.name}**（${c.role}）: ${c.mentalState ?? "平常"}\n`
      if (c.physicalState) context += `  体調: ${c.physicalState}\n`
      if (c.items && c.items.length > 0) context += `  所持品: ${c.items.join("、")}\n`
      if (c.abilities && c.abilities.length > 0) context += `  できること: ${c.abilities.join("、")}\n`
    }
    context += "\n"
  }

  if (chapterNum > 1) {
    const summary = await safeReadFile(getDocPath(dir, "summary"))
    if (summary) {
      context += `## 📚 これまでのあらすじ (P2 — 参考)\n${clip(summary, "summary")}\n\n`
    }

    const prevPadded = String(chapterNum - 1).padStart(3, "0")
    const prevChapterPath = join(getChaptersDir(dir), `chapter-${prevPadded}.md`)
    const prevChapter = await safeReadFile(prevChapterPath)
    if (prevChapter) {
      const limit = resolveLimit(config, "previousChapterTail")
      const tail = takeTailChars(prevChapter, limit)
      context += `## 📖 前章の末尾${limit.toLocaleString("ja-JP")}文字 (P1 — つなぎ)\n${tail}\n\n`
    }
  }

  const foreshadow = await safeReadJson<{ items: ForeshadowEntry[] }>(getDocPath(dir, "foreshadow"))
  if (foreshadow && foreshadow.items.length > 0) {
    const relevant = foreshadow.items.filter(
      (f) => f.status === "planted" || (f.targetChapter && f.targetChapter <= chapterNum + 3)
    )
    if (relevant.length > 0) {
      context += `## 🎯 伏線の確認 (P2 — 参考)\n`
      for (const f of relevant) {
        const icon = f.status === "planted" ? "🌱" : "⏰"
        context += `${icon} [${f.id}] ${f.title}: ${f.content}\n`
        if (f.targetChapter) {
          const when = f.targetChapter === chapterNum ? "← この章で回収" : `第${f.targetChapter}章で回収予定`
          context += `   ${when}\n`
        }
      }
      context += "\n"
    }
  }

  const martialArts = await safeReadFile(getDocPath(dir, "martial-art"))
  if (martialArts) {
    context += `## ⚔️ 剣術・技 (P1 — 流派・武芸設定)\n`
    context += clip(martialArts, "martialArts") + "\n\n"
  }

  const sects = await safeReadFile(getDocPath(dir, "sect"))
  if (sects) {
    context += `## 🏯 流派・勢力 (P1 — 流派・武芸設定)\n`
    context += clip(sects, "sects") + "\n\n"
  }

  const weapons = await safeReadFile(getDocPath(dir, "weapon"))
  if (weapons) {
    context += `## 🗡️ 刀剣 (P2 — 流派・武芸設定)\n`
    context += clip(weapons, "weapons") + "\n\n"
  }

  const realitySource = await safeReadFile(getDocPath(dir, "reality-source"))
  if (realitySource) {
    context += `## 🌍 取材メモ (P1 — 題材の手がかり)\n`
    context += clip(realitySource, "realitySource") + "\n\n"
  }

  if (includePrompts) {
    const { getPromptTemplate, fillPrompt } = await import("../prompts.js")
    const templateKey = chapterNum === 1 ? "chapter-write" : "chapter-continue"
    const template = getPromptTemplate(templateKey)
    if (template && config) {
      const targetWords = config.targetWords ?? DEFAULTS.targetWords
      const chapterCount = config.chapterCount ?? DEFAULTS.chapterCount
      const prompt = fillPrompt(template, {
        projectTitle: config.title,
        genre: config.genre,
        chapterNumber: String(chapterNum),
        chapterTitle: `第${chapterNum}章`,
        targetWordCount: String(Math.round(targetWords / chapterCount)),
        narrativePerspective: config.narrativePerspective ?? DEFAULTS.narrativePerspective,
        chapterOutline: "［上の「この章のプロット」から書き写してください］",
        charactersInfo: "［上の「登場人物」から該当者を抜き出してください］",
        previousContext: chapterNum > 1 ? "［上の「これまでのあらすじ」を参照］" : "",
        foreshadowReminders: "［上の「伏線の確認」を参照］",
        globalSummary: "［上の「これまでのあらすじ」を参照］",
        previousChapterSummary: chapterNum > 1 ? "［あらすじから前章の要点を抜き出してください］" : "",
        previousChapterTail: chapterNum > 1 ? "［上の「前章の末尾」を参照］" : "",
      })
      context += `## ✍️ 執筆プロンプト\n\`\`\`\n${prompt}\n\`\`\`\n`
    }
  }

  return context
}

/**
 * 章別プロットから該当章の記述を抜き出す。
 *
 * 見出しの章番号は算用数字・全角数字・漢数字のいずれでも読み取る
 * （「## 第一章」と書かれていても拾えるようにするため）。
 */
function extractChapterSection(outline: string, chapterNum: number): string | null {
  const lines = outline.split("\n")
  let collecting = false
  const collected: string[] = []

  for (const line of lines) {
    const chapterHeader = line.match(/^##\s+第\s*([0-9０-９〇零一二三四五六七八九十百千]+)\s*章/)
    if (chapterHeader) {
      if (collecting) break
      const num = parseChapterNumber(chapterHeader[1])
      if (num === chapterNum) {
        collecting = true
      }
    }
    if (collecting) collected.push(line)
  }

  return collected.length > 0 ? collected.join("\n") : null
}
