import { join } from "node:path"
import {
  safeReadFile, safeReadJson, safeWriteJson, getDocPath, safeWriteFile, getConfigPath, getChaptersDir,
  listMarkdownFiles, chapterNumberFromFileName, chapterTitleFromHeading,
} from "../utils.js"
import type { ForeshadowEntry, CharacterState } from "../utils.js"
import {
  parseCharacterUpdates, parseForeshadowUpdates, parseSummaryInput, upsertSummarySections,
  summaryChapters, splitForeshadowEntries, formatChapterRanges,
} from "../records.js"
import type { CharacterChanges, SummarySection } from "../records.js"
import type { ToolContext } from "../index.js"

interface UpdateArgs {
  action: "character-state" | "summary" | "foreshadow" | "prompt"
  content: string
  chapterNumber?: number
}

export async function novelUpdateExecute(
  args: UpdateArgs,
  ctx: ToolContext,
): Promise<string> {
  const dir = ctx.directory

  // ツールの引数でも確かめているが、直接呼ばれた場合に備えてここでも弾く。
  // 1.5 や -1 を通すと、読み戻せない見出し（第1.5章）や不正な回収章が保存される
  if (args.chapterNumber !== undefined && !(Number.isInteger(args.chapterNumber) && args.chapterNumber > 0)) {
    return `❌ chapterNumber は1以上の整数で渡してください（受け取ったのは ${args.chapterNumber}）。記録は更新していません。`
  }

  switch (args.action) {
    case "character-state":
      return updateCharacterState(dir, args.content, args.chapterNumber)
    case "summary":
      return updateSummary(dir, args.content, args.chapterNumber)
    case "foreshadow":
      return updateForeshadow(dir, args.content, args.chapterNumber)
    case "prompt":
      return getUpdatePrompt(dir, args.content, args.chapterNumber)
    default:
      return `❌ 対応していない更新種別です: ${args.action}`
  }
}

/**
 * 登場人物の状態を更新する。
 *
 * 形が1か所でも違えば何も書かない（一部だけ反映されると、どこまで
 * 入ったのか分からなくなるため）。
 *
 * 報告するのは入力の件数ではなく、更新前と比べて**実際に変わった**ものにする。
 * 持っている品をもう一度足す、無い品を外す、同じ値を入れ直す、といった
 * 入力は変化として数えない。誰も変わらなければファイルは書かず、そう返す。
 */
async function updateCharacterState(dir: string, content: string, chapterNumber?: number): Promise<string> {
  const parsed = parseCharacterUpdates(content)
  if (!parsed.ok) return parsed.message

  const filePath = getDocPath(dir, "character-state")
  const current = await safeReadJson<{ characters: CharacterState[] }>(filePath)
  const characters = current?.characters ?? []
  const lines: string[] = []
  let added = 0
  let changed = 0
  let unchanged = 0

  for (const { name, changes } of parsed.value) {
    const existing = characters.find((c) => c.name === name)
    if (existing) {
      const applied = applyCharacterChanges(existing, changes, chapterNumber)
      if (applied.length > 0) {
        changed++
        lines.push(`  - ${name}: ${applied.join(", ")}`)
      } else {
        unchanged++
        lines.push(`  - ${name}: 変更なし（記録と同じ内容でした）`)
      }
    } else {
      added++
      const fresh: CharacterState = { name, status: "active", role: "supporting" }
      const applied = applyCharacterChanges(fresh, changes, chapterNumber)
      characters.push(fresh)
      lines.push(`  - ${name}（新規）: ${applied.length > 0 ? applied.join(", ") : "名前のみ"}`)
    }
  }

  if (added === 0 && changed === 0) {
    return `ℹ️ 登場人物の状態は変わりませんでした（渡された内容はすべて記録と同じでした。ファイルは書き換えていません）
${lines.join("\n")}`
  }

  await safeWriteJson(filePath, { characters })
  return `✅ 登場人物の状態を更新しました（新規 ${added}人 / 更新 ${changed}人 / 変更なし ${unchanged}人 / 合計 ${characters.length}人）
${lines.join("\n")}`
}

/**
 * 変更を当て、実際に変わった項目を返す（何も変わらなければ空配列）。
 *
 * events は同じ文言がすでにあれば足さない（同じ更新の送り直しで重複させないため）。
 * 最終更新の章は、ほかに変化があったときだけ書く。章番号だけが動いて
 * 「更新した」ことにならないようにするため。lastUpdatedChapter を明示して
 * 値が変わる場合は、それ自体を変化として扱う。
 */
function applyCharacterChanges(target: CharacterState, changes: CharacterChanges, chapterNumber?: number): string[] {
  const applied: string[] = []
  for (const key of ["status", "role", "physicalState", "mentalState"] as const) {
    const value = changes[key]
    if (value === undefined || target[key] === value) continue
    ;(target as unknown as Record<string, unknown>)[key] = value
    applied.push(key)
  }
  for (const key of ["items", "abilities"] as const) {
    const diff = changes[key]
    if (!diff) continue
    const before = target[key] ?? []
    const toAdd = [...new Set(diff.added ?? [])].filter((x) => !before.includes(x))
    const toRemove = [...new Set(diff.removed ?? [])].filter((x) => before.includes(x))
    if (toAdd.length === 0 && toRemove.length === 0) continue
    target[key] = [...before, ...toAdd].filter((x) => !toRemove.includes(x))
    applied.push(`${key}(+${toAdd.length}/-${toRemove.length})`)
  }
  if (changes.relationships) {
    const before = target.relationships ?? {}
    const keys = Object.keys(changes.relationships).filter((k) => before[k] !== changes.relationships![k])
    if (keys.length > 0) {
      target.relationships = { ...before, ...changes.relationships }
      applied.push(`relationships(${keys.join("・")})`)
    }
  }
  if (changes.events) {
    const before = target.events ?? []
    const fresh = [...new Set(changes.events)].filter((e) => !before.includes(e))
    if (fresh.length > 0) {
      target.events = [...before, ...fresh]
      applied.push(`events(+${fresh.length})`)
    }
  }
  if (changes.lastUpdatedChapter !== undefined && target.lastUpdatedChapter !== changes.lastUpdatedChapter) {
    target.lastUpdatedChapter = changes.lastUpdatedChapter
    applied.push("lastUpdatedChapter")
  } else if (applied.length > 0 && chapterNumber !== undefined && changes.lastUpdatedChapter === undefined) {
    target.lastUpdatedChapter = chapterNumber
  }
  return applied
}

/**
 * あらすじを章ごとの節で更新する。
 *
 * 渡された章の節だけを差し替え、ほかの章の節は残す。
 * 以前は渡された内容でファイルを丸ごと置き換えていたため、
 * その章の分だけが渡されると、前の章のあらすじがすべて消えていた。
 */
async function updateSummary(dir: string, content: string, chapterNumber?: number): Promise<string> {
  const parsed = parseSummaryInput(content, chapterNumber)
  if (!parsed.ok) return parsed.message

  // 見出しの無い本文には、本文ファイルの章タイトルを添える
  const sections: SummarySection[] = []
  for (const s of parsed.value) {
    if (s.chapter !== null && s.heading === `## 第${s.chapter}章`) {
      const title = await chapterTitle(dir, s.chapter)
      sections.push(title ? { ...s, heading: `## 第${s.chapter}章 ${title}` } : s)
    } else {
      sections.push(s)
    }
  }

  const filePath = getDocPath(dir, "summary")
  const current = (await safeReadFile(filePath)) ?? ""
  // 旧形式の記述を移すときの範囲。旧形式は章を書くたびに全体を書き直していたので、
  // 本文のある最後の章までを含みうる。差し込む章の直前のほうが大きければそちらを採る。
  // 既存の章の節の最大章番号は upsertSummarySections の中で必ず加える
  // （本文を退避・削除していても、あらすじに残る章までは含むとみなす）
  const written = (await listMarkdownFiles(getChaptersDir(dir)))
    .map(chapterNumberFromFileName)
    .filter((n): n is number => n !== null)
  const incoming = sections.filter((s) => s.chapter !== null).map((s) => s.chapter as number)
  const legacyCoverage = Math.max(0, ...written, ...incoming.map((n) => n - 1))
  const next = upsertSummarySections(current, sections, legacyCoverage)
  await safeWriteFile(filePath, next)

  const touched = sections.map((s) => (s.chapter !== null ? `第${s.chapter}章` : "全体の流れ")).join("、")
  const recorded = summaryChapters(next)
  return `✅ あらすじを更新しました（${touched}）
   記録のある章: ${recorded.length > 0 ? formatChapterRanges(recorded) : "なし"}`
}

/** 保存済みの本文から章タイトルを読む（`# 第N章 タイトル`） */
async function chapterTitle(dir: string, chapter: number): Promise<string | null> {
  const file = join(getChaptersDir(dir), `chapter-${String(chapter).padStart(3, "0")}.md`)
  const text = await safeReadFile(file)
  return (text && chapterTitleFromHeading(text)) || null
}

/**
 * 伏線の記録を更新する。
 *
 * 既存の伏線は id で指し、渡された項目だけを変える。null を渡した章番号は消す。
 * 形が1か所でも違えば何も書かない。
 */
async function updateForeshadow(dir: string, content: string, chapterNumber?: number): Promise<string> {
  const filePath = getDocPath(dir, "foreshadow")
  const current = await safeReadJson<{ items: ForeshadowEntry[] }>(filePath)
  const items = current?.items ?? []

  const parsed = parseForeshadowUpdates(content, new Set(items.map((f) => f.id)))
  if (!parsed.ok) return parsed.message

  let added = 0
  let changed = 0
  let unchanged = 0
  const unchangedIds: string[] = []
  for (const update of parsed.value) {
    const existing = update.id ? items.find((f) => f.id === update.id) : undefined
    // 回収した章が書かれていなければ、いま書いている章とみなす。
    // ただし補うのは「この更新で回収済みになった」ときだけ。すでに回収済みのものに
    // 同じ状態を伝え直しただけで、記録済みの回収章を書き換えないようにする
    const newlyResolved = update.status === "resolved" && existing?.status !== "resolved"
    if (
      newlyResolved &&
      update.resolvedChapter === undefined &&
      existing?.resolvedChapter == null &&
      chapterNumber !== undefined
    ) {
      update.resolvedChapter = chapterNumber
    }
    const target = existing ?? ({ id: update.id ?? nextForeshadowId(items), status: "pending" } as ForeshadowEntry)
    const record = target as unknown as Record<string, unknown>
    const before = JSON.stringify(record)
    const { removeKeys, ...fields } = update
    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || value === undefined) continue
      if (value === null) delete record[key]
      else record[key] = value
    }
    // 以前の保存で入った独自のキーは、removeKeys で明示されたときだけ外す。
    // 通常の更新で外すと、そこにしか書かれていない内容（detail など）が消える
    for (const key of removeKeys ?? []) delete record[key]

    if (!existing) {
      added++
      items.push(target)
    } else if (JSON.stringify(record) !== before) {
      changed++
    } else {
      unchanged++
      unchangedIds.push(target.id)
    }
  }

  if (added === 0 && changed === 0) {
    return `ℹ️ 伏線の記録は変わりませんでした（${unchangedIds.join("、")} は渡された内容と同じでした。ファイルは書き換えていません）`
  }

  await safeWriteJson(filePath, { items })

  const { valid, invalid } = splitForeshadowEntries(items)
  const count = (s: string) => valid.filter((f) => f.status === s).length
  let report = `✅ 伏線の記録を更新しました
   新規 ${added} / 更新 ${changed}${unchanged > 0 ? ` / 変更なし ${unchanged}（${unchangedIds.join("、")}）` : ""} / 合計 ${items.length}
   内訳: 未着手 ${count("pending")} / 張り済み ${count("planted")} / 回収済み ${count("resolved")} / 取り下げ ${count("abandoned")}`
  if (invalid.length > 0) {
    report += `\n⚠️ 形の崩れた記録が残っています（以前の保存によるもの）: ${invalid.map((x) => `${x.id}（${x.problems.join("、")}）`).join(" / ")}`
    report += `\n   id を指して title・content・status を正しい値で渡し直してください。独自のキーは、中身を content や notes に移してから "removeKeys": ["detail"] のように指定して外します。`
  }
  return report
}

/** 使われていない次の id（F1, F2, …） */
function nextForeshadowId(items: ForeshadowEntry[]): string {
  const used = new Set(items.map((f) => f.id))
  let n = items.length + 1
  while (used.has(`F${n}`)) n++
  return `F${n}`
}

async function getUpdatePrompt(dir: string, promptType: string, chapterNumber?: number): Promise<string> {
  const { getPromptTemplate, listPromptTemplates } = await import("../prompts.js")
  const template = getPromptTemplate(promptType)
  if (!template) {
    return `❌ そのプロンプトは見つかりません: ${promptType}
使えるもの: ${listPromptTemplates().join(", ")}`
  }

  const config = await safeReadJson<any>(getConfigPath(dir))
  const characters = await safeReadFile(getDocPath(dir, "characters"))

  let filled = template
  if (config) {
    filled = filled.replace(/\{title\}/g, config.title)
    filled = filled.replace(/\{genre\}/g, config.genre)
  }
  if (chapterNumber) {
    filled = filled.replace(/\{chapterNumber\}/g, String(chapterNumber))
  }
  if (characters) {
    filled = filled.replace(/\{charactersToTrack\}/g, "この章に出てきた全員")
  }

  return `📝 プロンプト「${promptType}」:

${filled}

💡 このプロンプトと章の本文を合わせて使い、得られた結果を novel_update で保存してください。`
}
