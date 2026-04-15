import { safeWriteFile, safeWriteJson, getNovelDir, getDocPath, getChaptersDir, existsSync, getConfigPath } from "../utils.js"
import { fillTemplateVars, CONFIG_TEMPLATE, CONCEPT_TEMPLATE, WORLD_BUILDING_TEMPLATE, CHARACTER_PROFILES_TEMPLATE, SUMMARY_TEMPLATE, FORESHADOW_TEMPLATE, CHARACTER_STATE_TEMPLATE, WUXIA_SECTS_TEMPLATE, WUXIA_MARTIAL_ARTS_TEMPLATE, WUXIA_WEAPONS_TEMPLATE, REALITY_SOURCE_TEMPLATE } from "../templates.js"
import type { ToolContext } from "../index.js"
import { join } from "node:path"

interface InitArgs {
  title: string
  genre: string
  targetWords?: number
  chapterCount?: number
  theme?: string
  narrativePerspective?: string
}

export async function novelInitExecute(
  args: InitArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const novelDir = getNovelDir(dir)

  if (existsSync(novelDir)) {
    return `❌ 小说项目已存在于此目录: ${novelDir}\n如需重新初始化，请先删除 .novel 目录。`
  }

  const title = args.title
  const genre = args.genre
  const targetWords = args.targetWords ?? 200000
  const chapterCount = args.chapterCount ?? 50
  const theme = args.theme ?? ""
  const perspective = args.narrativePerspective ?? "第三人称有限"

  const vars = { title, genre, targetWords, chapterCount, theme, narrativePerspective: perspective }

  const config = { ...CONFIG_TEMPLATE, ...vars, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentPhase: "concept" }
  await safeWriteJson(getConfigPath(dir), config)

  await safeWriteFile(getDocPath(dir, "concept"), fillTemplateVars(CONCEPT_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "world-building"), fillTemplateVars(WORLD_BUILDING_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "characters"), fillTemplateVars(CHARACTER_PROFILES_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "summary"), fillTemplateVars(SUMMARY_TEMPLATE, vars))
  await safeWriteJson(getDocPath(dir, "foreshadow"), FORESHADOW_TEMPLATE)
  await safeWriteJson(getDocPath(dir, "character-state"), CHARACTER_STATE_TEMPLATE)

  // 现实映射素材文件（所有类型通用）
  await safeWriteFile(getDocPath(dir, "reality-source"), fillTemplateVars(REALITY_SOURCE_TEMPLATE, vars))

  // 武侠类型专属文件
  if (genre.includes("武") || genre.includes("功夫") || genre === "武侠") {
    await safeWriteFile(getDocPath(dir, "sect"), fillTemplateVars(WUXIA_SECTS_TEMPLATE, vars))
    await safeWriteFile(getDocPath(dir, "martial-art"), fillTemplateVars(WUXIA_MARTIAL_ARTS_TEMPLATE, vars))
    await safeWriteFile(getDocPath(dir, "weapon"), fillTemplateVars(WUXIA_WEAPONS_TEMPLATE, vars))
  }

  const wuxiaNote = (genre.includes("武") || genre.includes("功夫") || genre === "武侠")
    ? `\n  🗡️ 武侠专属文件:
  wuxia/
  ├── sects.md          (门派势力)
  ├── martial-arts.md   (功法谱)
  └── weapons.md        (兵器谱)`
    : ""

  return `✅ 小说项目「${title}」初始化成功！

📁 项目结构已创建:
  .novel/
  ├── config.json          (项目配置)
  ├── concept.md           (故事概念 - 请先填写)
  ├── world-building.md    (世界观设定)
  ├── characters/          (角色档案)
  │   ├── profiles.md
  │   └── state.json
  ├── summary.md           (前文摘要)
  ├── foreshadow.json      (伏笔追踪)
  ├── reality-source.md      (现实映射素材库)
   └── chapters/            (章节目录，写作时自动创建)${wuxiaNote}

📋 基本信息:
  类型: ${genre}
  目标字数: ${targetWords}字
  预计章节: ${chapterCount}章
  叙事视角: ${perspective}

📝 下一步:
  1. 请用户描述小说创意（故事梗概、主角、核心冲突）
  2. 使用 CONCEPT_PROMPT 提示词协助完善故事概念
  3. 填写 .novel/concept.md
  4. 确认后进入世界观构建阶段`
}
