import { join } from "node:path"
import {
  safeReadFile, safeReadJson, safeWriteJson, getDocPath, safeWriteFile, getConfigPath, getChaptersDir,
  listMarkdownFiles, chapterNumberFromFileName, chapterTitleFromHeading,
} from "../utils.js"
import type { ForeshadowEntry, NovelConfig } from "../utils.js"
import { DEFAULTS } from "../constants.js"
import {
  sectionFromArgs, recordChapterOf, sectionFileName, sectionLabel, sectionKey, compareSections, listManuscriptFiles, lastChapterForRecords,
} from "../sections.js"
import type { ManuscriptSection, SectionKind } from "../sections.js"
import {
  parseCharacterUpdates, parseForeshadowUpdates, parseSummaryInput, upsertSummarySections,
  summaryChapters, summarySections, splitForeshadowEntries, formatChapterRanges,
} from "../records.js"
import { readCharacterStateRecord, readForeshadowRecord, readTextRecord, describeBrokenRecord } from "../records.js"
import { summaryEntryOf } from "../records.js"
import type { SummarySection, RecordFile } from "../records.js"
import {
  applySectionUpdates, describeStateChange, emptyCharacterStateFile, recordedNames, recordedSections, statesThrough,
  stateKeyNames, formatStateKeyNames,
} from "../character-state.js"
import type { CharacterStateFile } from "../character-state.js"
import type { ToolContext } from "../index.js"

interface UpdateArgs {
  action: "character-state" | "summary" | "foreshadow" | "prompt"
  content: string
  /** プロローグ・幕間・エピローグの記録のとき（sections.ts）。省くと章 */
  section?: SectionKind
  chapterNumber?: number
  interludeIndex?: number
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

  // プロローグ・幕間・エピローグを指されたとき。あらすじと人物の状態はその節に書き、
  // 伏線には記録用の章番号（プロローグは 0、幕間は直前の章、エピローグは本文のある最後の章）を使う
  let target: ManuscriptSection | undefined
  if (args.section !== undefined || args.interludeIndex !== undefined) {
    const resolved = sectionFromArgs(args)
    if ("error" in resolved) return `❌ ${resolved.error}。記録は更新していません。`
    target = resolved.section
  } else if (args.chapterNumber !== undefined) {
    target = { kind: "chapter", chapter: args.chapterNumber }
  }
  let chapterNumber = args.chapterNumber
  if (target && target.kind !== "chapter") {
    const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
    const files = await listManuscriptFiles(dir)
    chapterNumber = recordChapterOf(target, lastChapterForRecords(files, config?.chapterCount ?? DEFAULTS.chapterCount))
  }

  switch (args.action) {
    case "character-state":
      return updateCharacterState(dir, args.content, target)
    case "summary":
      return updateSummary(dir, args.content, target)
    case "foreshadow":
      return updateForeshadow(dir, args.content, chapterNumber)
    case "prompt":
      return getUpdatePrompt(dir, args.content, chapterNumber)
    default:
      return `❌ 対応していない更新種別です: ${args.action}`
  }
}

/**
 * 記録ファイルが壊れているときの断り。元のファイルには触れない。
 *
 * 空の記録として続けると、壊れたファイルを新しい内容だけで上書きして
 * それまでの記録がすべて消える。直してから渡し直してもらう。
 */
function refuseBroken(label: string, file: string, state: Extract<RecordFile<unknown>, { kind: "broken" }>): string {
  return `❌ ${label}は更新していません（元のファイルはそのまま残しています）。
  - ${describeBrokenRecord(file, state)}
直してから、同じ内容をもう一度渡してください。`
}

/**
 * 登場人物の状態を、章・節ごとの差分として記録する（character-state.ts）。
 *
 * どの章・節の変化かを必ず指してもらう（差分を重ねる順番が決まらないため）。
 * 同じ節への再送はその節の差分に重ね、replace なら置き換える（章を書き直したとき）。
 * 形が1か所でも違えば何も書かない（一部だけ反映されると、どこまで入ったのか分からなくなるため）。
 *
 * 報告するのは入力の件数ではなく、その節を書き終えた時点の状態が更新前と比べて
 * **実際に変わった**ものにする。持っている品をもう一度足す、同じ値を入れ直す、といった
 * 入力は変化として数えない。すでに記録のある節で何も変わらなければファイルは書かず、そう返す。
 */
async function updateCharacterState(dir: string, content: string, target?: ManuscriptSection): Promise<string> {
  if (!target) {
    return `❌ 登場人物の状態は更新していません。どの章・節の変化かが分かりません。chapterNumber（プロローグ・幕間・エピローグなら section）を渡してください。`
  }
  const parsed = parseCharacterUpdates(content)
  if (!parsed.ok) return parsed.message

  const filePath = getDocPath(dir, "character-state")
  const current = await readCharacterStateRecord(filePath)
  if (current.kind === "broken") return refuseBroken("登場人物の状態", ".novel/characters/state.json", current)
  const file: CharacterStateFile = current.kind === "ok" ? current.value : emptyCharacterStateFile()

  const key = sectionKey(target)
  const label = sectionLabel(target)
  const existed = key in file.sections
  const next: CharacterStateFile = {
    ...file,
    sections: { ...file.sections, [key]: applySectionUpdates(file.sections[key], parsed.value.updates, parsed.value.replace ?? false) },
  }

  const before = statesThrough(file, target)
  const after = statesThrough(next, target)
  const names = [...new Set([...parsed.value.updates.map((u) => u.name), ...before.map((c) => c.name), ...after.map((c) => c.name)])]
  const lines: string[] = []
  let added = 0
  let changed = 0
  let unchanged = 0
  for (const name of names) {
    const b = before.find((c) => c.name === name)
    const a = after.find((c) => c.name === name)
    const applied = describeStateChange(b, a, target)
    const requested = parsed.value.updates.some((u) => u.name === name)
    if (applied.length === 0) {
      if (requested) {
        unchanged++
        lines.push(`  - ${name}: 変更なし（記録と同じ内容でした）`)
      }
    } else if (!b) {
      added++
      lines.push(`  - ${name}（新規）: ${applied.join(", ")}`)
    } else if (!a) {
      changed++
      lines.push(`  - ${name}: ${label}の記録を外しました`)
    } else {
      changed++
      lines.push(`  - ${name}: ${applied.join(", ")}`)
    }
  }

  if (existed && added === 0 && changed === 0) {
    return `ℹ️ 登場人物の状態は変わりませんでした（${label}の記録と同じ内容でした。ファイルは書き換えていません）
${lines.join("\n")}`.trimEnd()
  }

  await safeWriteJson(filePath, next)
  const total = statesThrough(next, target).length
  let report = added === 0 && changed === 0
    ? `✅ ${label}の人物の状態を記録しました（状態の変化はありません。${label}まで登場 ${total}人）`
    : `✅ ${label}の人物の状態を更新しました（新規 ${added}人 / 更新 ${changed}人 / 変更なし ${unchanged}人 / ${label}まで登場 ${total}人）`
  if (lines.length > 0) report += `\n${lines.join("\n")}`
  const later = recordedSections(next).filter((r) => compareSections(r.section, target) > 0)
  if (later.length > 0) {
    report += `\n💡 ${sectionLabel(later[0].section)}以降の記録があります。この変化は、それより後の章・節の資料にも反映されます。`
  }
  // 新しい項目名を使ったときは、すでにある項目名を並べて揺れに気づけるようにする
  const known = stateKeyNames(file)
  const fresh: string[] = []
  for (const field of ["attributes", "lists"] as const) {
    for (const { changes } of parsed.value.updates) {
      for (const k of Object.keys(changes[field] ?? {})) {
        if (known[field].length > 0 && !known[field].includes(k) && !fresh.includes(`${field}.${k}`)) fresh.push(`${field}.${k}`)
      }
    }
  }
  if (fresh.length > 0) {
    report += `\nℹ️ 新しい項目名を使いました: ${fresh.join("、")}。すでに使っている項目名: ${formatStateKeyNames(known)}（同じものを指すなら名前をそろえてください）`
  }
  return report
}

/**
 * あらすじを章ごとの節で更新する。
 *
 * 渡された章の節だけを差し替え、ほかの章の節は残す。
 * 以前は渡された内容でファイルを丸ごと置き換えていたため、
 * その章の分だけが渡されると、前の章のあらすじがすべて消えていた。
 */
async function updateSummary(dir: string, content: string, target?: ManuscriptSection): Promise<string> {
  const parsed = parseSummaryInput(content, target)
  if (!parsed.ok) return parsed.message

  // 見出しの無い本文には、本文ファイルの章タイトルを添える
  const sections: SummarySection[] = []
  for (const s of parsed.value) {
    const at: ManuscriptSection | null = s.section ?? (s.chapter !== null ? { kind: "chapter", chapter: s.chapter } : null)
    const bare = at ? summaryEntryOf(at).heading : null
    if (at && s.heading === bare) {
      const title = await chapterTitle(dir, at)
      sections.push(title ? { ...s, heading: `${bare} ${title}` } : s)
    } else {
      sections.push(s)
    }
  }

  const filePath = getDocPath(dir, "summary")
  const read = await readTextRecord(filePath)
  if (read.kind === "broken") return refuseBroken("あらすじ", ".novel/summary.md", read)
  const current = read.kind === "ok" ? read.value : ""
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

  const touched = sections
    .map((s) => (s.section ? sectionLabel(s.section) : s.chapter !== null ? `第${s.chapter}章` : "全体の流れ"))
    .join("、")
  const recorded = summaryChapters(next)
  const recordedExtras = summarySections(next).map(sectionLabel)
  return `✅ あらすじを更新しました（${touched}）
   記録のある章: ${recorded.length > 0 ? formatChapterRanges(recorded) : "なし"}${recordedExtras.length > 0 ? `（ほかに ${recordedExtras.join("、")}）` : ""}`
}

/** 保存済みの本文から章・節のタイトルを読む（`# 第N章 タイトル`、`# プロローグ タイトル`） */
async function chapterTitle(dir: string, section: ManuscriptSection): Promise<string | null> {
  const file = join(getChaptersDir(dir), sectionFileName(section))
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
  const current = await readForeshadowRecord(filePath)
  if (current.kind === "broken") return refuseBroken("伏線の記録", ".novel/foreshadow.json", current)
  // 項目ごとの不正（日本語の status など）はここでは断らない。id を指して渡し直せば直せる
  const items = (current.kind === "ok" ? current.value.items : []) as unknown as ForeshadowEntry[]

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
  const { getPromptTemplate, listPromptTemplates, buildPromptVars, fillPrompt, remainingPlaceholders } = await import("../prompts.js")
  const template = getPromptTemplate(promptType)
  if (!template) {
    return `❌ そのプロンプトは見つかりません: ${promptType}
使えるもの: ${listPromptTemplates().join(", ")}`
  }

  const config = await safeReadJson<NovelConfig>(getConfigPath(dir))
  // 追う人物は、状態の記録にいる人物の名前。記録が無いか読めなければ、この章に出た全員を見てもらう
  const state = await readCharacterStateRecord(getDocPath(dir, "character-state"))
  const names = state.kind === "ok" ? recordedNames(state.value) : []
  const keyNames = state.kind === "ok" ? formatStateKeyNames(stateKeyNames(state.value)) : ""
  const vars = buildPromptVars(config, {
    // プロローグは記録の章番号が 0。真偽で判定すると 0 が埋まらない
    chapterNumber,
    charactersToTrack: names.length > 0 ? `${names.join("、")}（この章に出てこない人物は省く）` : "この章に出てきた全員",
  })
  const filled = fillPrompt(template, vars)
  const left = remainingPlaceholders(filled)
  const leftNote = left.length > 0
    ? `\n\n📌 資料から埋めて使う差し込み: ${left.map((k) => `{${k}}`).join("、")}`
    : ""

  const keyNote = promptType === "character-state-update" && keyNames
    ? `\n\n📌 この作品の記録で使っている項目名: ${keyNames}（同じものはこの名前で書く）`
    : ""

  return `📝 プロンプト「${promptType}」:

${filled}${leftNote}${keyNote}

💡 このプロンプトと章の本文を合わせて使い、得られた結果を novel_update で保存してください。`
}
