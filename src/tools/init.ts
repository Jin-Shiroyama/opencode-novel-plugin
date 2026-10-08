import {
  safeWriteFile,
  safeWriteJson,
  getNovelDir,
  getDocPath,
  existsSync,
  getConfigPath,
  isMartialArtsGenre,
} from "../utils.js"
import {
  fillTemplateVars,
  CONFIG_TEMPLATE,
  CONCEPT_TEMPLATE,
  WORLD_BUILDING_TEMPLATE,
  CHARACTER_PROFILES_TEMPLATE,
  SUMMARY_TEMPLATE,
  FORESHADOW_TEMPLATE,
  CHARACTER_STATE_TEMPLATE,
  WUXIA_SECTS_TEMPLATE,
  WUXIA_MARTIAL_ARTS_TEMPLATE,
  WUXIA_WEAPONS_TEMPLATE,
  REALITY_SOURCE_TEMPLATE,
} from "../templates.js"
import { DEFAULTS } from "../constants.js"
import type { ToolContext } from "../index.js"

interface InitArgs {
  title: string
  genre: string
  targetWords?: number
  chapterCount?: number
  theme?: string
  narrativePerspective?: string
  martialArtsSetting?: boolean
}

export async function novelInitExecute(
  args: InitArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory
  const novelDir = getNovelDir(dir)

  if (existsSync(novelDir)) {
    return `❌ このディレクトリにはすでに作品データがあります: ${novelDir}
作り直す場合は .novel ディレクトリを削除してください。`
  }

  const title = args.title
  const genre = args.genre
  const targetWords = args.targetWords ?? DEFAULTS.targetWords
  const chapterCount = args.chapterCount ?? DEFAULTS.chapterCount
  const theme = args.theme ?? ""
  const perspective = args.narrativePerspective ?? DEFAULTS.narrativePerspective

  // 明示指定があればそれに従い、なければジャンルから推定する。
  // 「武士」「武装」などに誤爆しないよう isMartialArtsGenre を使う。
  const useMartialArts = args.martialArtsSetting ?? isMartialArtsGenre(genre)

  const vars = { title, genre, targetWords, chapterCount, theme, narrativePerspective: perspective }

  const config = {
    ...CONFIG_TEMPLATE,
    ...vars,
    martialArtsSetting: useMartialArts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentPhase: "concept",
  }
  await safeWriteJson(getConfigPath(dir), config)

  await safeWriteFile(getDocPath(dir, "concept"), fillTemplateVars(CONCEPT_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "world-building"), fillTemplateVars(WORLD_BUILDING_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "characters"), fillTemplateVars(CHARACTER_PROFILES_TEMPLATE, vars))
  await safeWriteFile(getDocPath(dir, "summary"), fillTemplateVars(SUMMARY_TEMPLATE, vars))
  await safeWriteJson(getDocPath(dir, "foreshadow"), FORESHADOW_TEMPLATE)
  await safeWriteJson(getDocPath(dir, "character-state"), CHARACTER_STATE_TEMPLATE)

  // 取材メモはジャンルを問わず作る
  await safeWriteFile(getDocPath(dir, "reality-source"), fillTemplateVars(REALITY_SOURCE_TEMPLATE, vars))

  // 流派・武芸設定（内部識別子 wuxia）
  if (useMartialArts) {
    await safeWriteFile(getDocPath(dir, "sect"), fillTemplateVars(WUXIA_SECTS_TEMPLATE, vars))
    await safeWriteFile(getDocPath(dir, "martial-art"), fillTemplateVars(WUXIA_MARTIAL_ARTS_TEMPLATE, vars))
    await safeWriteFile(getDocPath(dir, "weapon"), fillTemplateVars(WUXIA_WEAPONS_TEMPLATE, vars))
  }

  const martialNote = useMartialArts
    ? `
  🗡️ 流派・武芸設定:
  wuxia/
  ├── sects.md          (流派・勢力)
  ├── martial-arts.md   (剣術・技)
  └── weapons.md        (刀剣)`
    : ""

  const perChapter = Math.round(targetWords / chapterCount)

  return `✅ 作品『${title}』の準備ができました。

📁 作成したファイル:
  .novel/
  ├── config.json          (作品設定)
  ├── concept.md           (作品コンセプト ← まずここから)
  ├── world-building.md    (世界観)
  ├── characters/          (登場人物)
  │   ├── profiles.md
  │   └── state.json
  ├── summary.md           (これまでのあらすじ)
  ├── foreshadow.json      (伏線の管理)
  ├── reality-source.md    (取材メモ)
  └── chapters/            (本文。執筆時に自動で作られます)${martialNote}

📋 作品の基本情報:
  ジャンル: ${genre}
  目標文字数: ${targetWords.toLocaleString("ja-JP")}文字
  予定章数: 全${chapterCount}章（1章あたり約${perChapter.toLocaleString("ja-JP")}文字）
  視点: ${perspective}

📝 次にやること:
  1. 書きたい話の種を聞かせてください（あらすじ、主人公、中心にある対立）
  2. concept プロンプトを使ってコンセプトを固めます
  3. .novel/concept.md に書き込みます
  4. 固まったら世界観づくりへ進みます`
}
