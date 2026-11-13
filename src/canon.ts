/**
 * opencode-novel-plugin - 原作の資料（二次創作）
 *
 * config.json の sourceWork（原作名）があれば二次創作として扱い、.novel/canon/ に置いた
 * 原作の資料を執筆用の資料に載せる。モデルの記憶で原作を補わせると、もっともらしい誤りが
 * 混ざる（口調、呼び方、出来事の順番）。書き手が確かめた資料を正として渡すための置き場。
 *
 *   canon/overview.md           原作と扱い方（基準の範囲・種別・分岐点・変えること）。毎回、先に載せる
 *   canon/timeline.md           原作の時系列と分岐
 *   canon/setting.md            原作の設定（canon/setting/{項目}.md などに分けてもよい）
 *   canon/characters/{名前}.md  原作の人物。人物設定と同じ形で、utils.ts の listCharacterDocs が読む
 *
 * 原作から変える設定は world-building.md、造語と固有名詞の表記は glossary.md に書く
 * （同じことを二か所に書くと食い違うため、canon/ は原作の事実だけを持つ）。
 */

import { readDocParts, safeReadFile, getNovelPath, existsSync } from "./utils.js"
import type { DocPart, NovelConfig } from "./utils.js"
import {
  isUntouchedTemplate, CANON_OVERVIEW_TEMPLATE, CANON_TIMELINE_TEMPLATE, CANON_SETTING_TEMPLATE,
} from "./templates.js"

/** 原作の資料を置くディレクトリ（.novel/ からの相対） */
export const CANON_DIR = "canon"
export const CANON_OVERVIEW_FILE = "canon/overview.md"

/** novel_init が先に作る統合ファイルと、その雛形 */
const CANON_TEMPLATES: Record<string, string> = {
  [CANON_OVERVIEW_FILE]: CANON_OVERVIEW_TEMPLATE,
  "canon/timeline.md": CANON_TIMELINE_TEMPLATE,
  "canon/setting.md": CANON_SETTING_TEMPLATE,
}

/** 二次創作なら原作名、そうでなければ null */
export function sourceWorkOf(config: Pick<NovelConfig, "sourceWork"> | null | undefined): string | null {
  const name = typeof config?.sourceWork === "string" ? config.sourceWork.trim() : ""
  return name.length > 0 ? name : null
}

/** ファイル名から、プロットとの照合に使う項目名を取る（canon/setting/魔導書.md → 魔導書） */
function topicOf(label: string): string {
  return label.split("/").pop()!.replace(/\.md$/, "")
}

/**
 * 原作の資料（人物を除く）を集める。
 *
 * 雛形から書き換えていない統合ファイルは載せない（isUntouchedTemplate）。
 * 「原作と扱い方」と、ファイル名がこの章のプロット・シーンに出る分割ファイルに priority を立て、先に枠を配る
 * （項目が増えても、この章に関わる設定が落ちないように）。照合する名前は2文字以上に限る。
 */
export async function readCanonParts(projectDir: string, chapterText: string): Promise<DocPart[]> {
  const all = await readDocParts(projectDir, null, CANON_DIR)
  const parts: DocPart[] = []
  for (const part of all) {
    const label = part.label.replace(/\\/g, "/")
    // 人物は登場人物の枠で載せる
    if (label.startsWith("canon/characters/")) continue
    const template = CANON_TEMPLATES[label]
    if (template && isUntouchedTemplate(part.content, template)) continue
    const topic = topicOf(label)
    const named = !template && [...topic].length >= 2 && chapterText.includes(topic)
    parts.push({ label, content: part.content, ...(label === CANON_OVERVIEW_FILE || named ? { priority: true } : {}) })
  }
  return parts
}

/**
 * 「原作と扱い方」が書かれているか（ファイルがあり、雛形から書き換えてある）。
 * 進行状況で、二次創作なのに土台がまだ無いことを知らせるのに使う
 */
export async function hasCanonOverview(projectDir: string): Promise<boolean> {
  const path = getNovelPath(projectDir, CANON_OVERVIEW_FILE)
  if (!existsSync(path)) return false
  const content = await safeReadFile(path)
  return Boolean(content && content.trim().length > 0 && !isUntouchedTemplate(content, CANON_OVERVIEW_TEMPLATE))
}
