/**
 * opencode-novel-plugin - 記録（人物の状態・伏線・あらすじ）の形式
 *
 * novel_update が受け取る JSON の検証と、あらすじを章ごとの節で持つための処理。
 *
 * 以前は受け取った JSON を確かめずに保存していた。モデルが status を
 * 「回収済み」のように日本語で渡したり、`changes` の中に `state` / `inner` など
 * 知らないキーを入れたりしても「更新しました」と返していたため、
 * 記録が壊れたまま、あるいは何も反映されないまま章が進んでいた。
 * ここでは形を厳密に確かめ、外れていれば何も書かずに理由を返す。
 */

import { readFile } from "node:fs/promises"
import { z } from "zod"
import { parseChapterNumber } from "./utils.js"
import { parseSectionLabel, sectionLabel, compareSections, sectionFromKey, sectionKey } from "./sections.js"
import type { ManuscriptSection } from "./sections.js"
import type { ForeshadowEntry } from "./utils.js"
import type { CharacterStateFile } from "./character-state.js"

// ============================================================
// 検証エラーの表示
// ============================================================

/** zod の検証結果を、モデルが直しやすい日本語の行に直す */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "（最上位）"
    switch (issue.code) {
      case "unrecognized_keys":
        return `${path}: 使えないキー ${issue.keys.map((k) => `"${k}"`).join(", ")}`
      case "invalid_enum_value":
        return `${path}: ${JSON.stringify(issue.received)} は使えません。使える値: ${issue.options.map((o) => `"${String(o)}"`).join(" / ")}`
      case "invalid_type":
        return issue.received === "undefined"
          ? `${path}: 必須です`
          : `${path}: ${issue.expected} で渡してください（受け取ったのは ${issue.received}）`
      default:
        return `${path}: ${issue.message}`
    }
  })
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) }
  } catch {
    return { ok: false }
  }
}

// ============================================================
// 登場人物の状態
// ============================================================

export const CHARACTER_STATUSES = ["active", "deceased", "missing", "retired"] as const

const chapterNo = z.number().int().positive()
/**
 * 出来事のあった章。0 はプロローグ（sections.ts の recordChapterOf）。
 * 回収の予定（targetChapter）は 0 にしない（プロローグで回収する予定は立てない）
 */
const eventChapterNo = z.number().int().nonnegative()

/** 人物の状態の欄の値。null はその欄を消す（伏線の章番号と同じ書き方） */
const stateText = z.string().min(1)
const stateTextOrNull = stateText.nullable()
const addRemove = z
  .object({ added: z.array(stateText).optional(), removed: z.array(stateText).optional() })
  .strict()
  .superRefine((v, ctx) => {
    const both = (v.added ?? []).filter((x) => (v.removed ?? []).includes(x))
    if (both.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `同じものを added と removed の両方に入れています: ${both.join("、")}` })
    }
  })

const speechChangesSchema = z
  .object({
    firstPerson: stateTextOrNull.optional(),
    addressTerms: z.record(stateTextOrNull).optional(),
  })
  .strict()

const characterChangesSchema = z
  .object({
    status: z.enum(CHARACTER_STATUSES).optional(),
    physicalState: stateTextOrNull.optional(),
    mentalState: stateTextOrNull.optional(),
    attributes: z.record(stateTextOrNull).optional(),
    lists: z.record(addRemove).optional(),
    relationships: z.record(stateTextOrNull).optional(),
    speech: speechChangesSchema.optional(),
    events: z.array(stateText).optional(),
  })
  .strict()

const characterUpdateEntrySchema = z.object({ name: stateText, changes: characterChangesSchema }).strict()

/**
 * novel_update(character-state) の content。updates が空なら「この節は変化なし」。
 * replace を立てると、その節の記録を渡した内容で置き換える（章を書き直したとき）
 */
const characterUpdateSchema = z
  .object({
    updates: z.array(characterUpdateEntrySchema),
    replace: z.boolean().optional(),
  })
  .strict()

export type CharacterChanges = z.infer<typeof characterChangesSchema>
export type CharacterUpdate = z.infer<typeof characterUpdateEntrySchema>
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>

/** novel_update(character-state) の正しい形。ツールの説明と誤りの案内で使う */
export const CHARACTER_STATE_EXAMPLE = `{
  "updates": [
    {
      "name": "レン",
      "changes": {
        "physicalState": "肋を一本折った。熱がある",
        "mentalState": "「自分で選んだから立つ」と初めて口にする",
        "attributes": { "現在地": "北の砦" },
        "lists": { "所持品": { "added": ["古い剣"], "removed": ["父の剣"] } },
        "relationships": { "ドルガ": "撤退を拒んだドルガを信頼する" },
        "speech": { "addressTerms": { "ドルガ": "ドルガ（「隊長」と呼ぶのをやめた）" } },
        "events": ["魔王の波に吹き飛ばされ、剣を失う"]
      }
    }
  ]
}`

export const CHARACTER_STATE_KEYS =
  "status（active / deceased / missing / retired）, physicalState, mentalState, " +
  "attributes（{ 項目: 値 }。現在地・服装など、作品に合わせて名前を決める）, " +
  "lists（{ 一覧の名前: { added, removed } }。所持品・できることなど）, relationships（{ 相手: 関係 }）, " +
  "speech（{ firstPerson, addressTerms: { 相手: いまの呼び方 } }。人物設定から変わったときだけ）, " +
  "events（この章・節の出来事。文字列の配列）。値に null を渡すとその欄を消す"

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

export function parseCharacterUpdates(content: string): ParseResult<CharacterUpdateInput> {
  const json = parseJson(content)
  if (!json.ok) {
    return { ok: false, message: characterStateError(["content が JSON として読めません"]) }
  }
  const result = characterUpdateSchema.safeParse(json.value)
  if (!result.success) {
    return { ok: false, message: characterStateError(formatIssues(result.error)) }
  }
  const empty = result.data.updates.filter((u) => Object.keys(u.changes).length === 0)
  if (empty.length > 0) {
    const names = empty.map((u) => `「${u.name}」`).join("、")
    return { ok: false, message: characterStateError([`${names}の changes が空です（この節で変化が無いなら "updates": [] を渡します）`]) }
  }
  return {
    ok: true,
    value: { ...result.data, updates: result.data.updates.map((u) => ({ name: u.name, changes: compactChanges(u.changes) })) },
  }
}

/**
 * 中身の無い欄を外す（{ "added": [], "removed": [] } の一覧、空の対応表、空の events など）。
 *
 * モデルは例にある欄を空のまま書き写しがちで、そのまま残すと、使っていない項目名
 * （「できること」など）が記録の項目名として案内され続ける。断ると、同じ更新にある
 * 正しい変化まで書けなくなるので、外して受け付ける。外した結果 changes が空になった人物は
 * 「変更なし」として扱う（applySectionUpdates が記録に入れない）
 */
export function compactChanges(changes: CharacterChanges): CharacterChanges {
  const out: CharacterChanges = { ...changes }
  if (out.lists) {
    const lists: NonNullable<CharacterChanges["lists"]> = {}
    for (const [name, diff] of Object.entries(out.lists)) {
      const d: { added?: string[]; removed?: string[] } = {}
      if (diff.added && diff.added.length > 0) d.added = diff.added
      if (diff.removed && diff.removed.length > 0) d.removed = diff.removed
      if (d.added || d.removed) lists[name] = d
    }
    out.lists = lists
  }
  if (out.speech) {
    const speech = { ...out.speech }
    if (speech.addressTerms && Object.keys(speech.addressTerms).length === 0) delete speech.addressTerms
    out.speech = speech
  }
  if (out.events && out.events.length === 0) delete out.events
  for (const key of ["lists", "attributes", "relationships", "speech"] as const) {
    const value = out[key]
    if (value && Object.keys(value).length === 0) delete out[key]
  }
  return out
}

function characterStateError(problems: string[]): string {
  return `❌ 登場人物の状態は更新していません（1件も書き込んでいません）。
${problems.map((p) => `  - ${p}`).join("\n")}

changes で使えるキー: ${CHARACTER_STATE_KEYS}

正しい形の例:
${CHARACTER_STATE_EXAMPLE}`
}

// ============================================================
// 伏線
// ============================================================

export const FORESHADOW_STATUSES = ["pending", "planted", "resolved", "abandoned"] as const

const nullableChapter = chapterNo.nullable().optional()
const nullableEventChapter = eventChapterNo.nullable().optional()

const foreshadowFields = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: z.string().optional(),
  status: z.enum(FORESHADOW_STATUSES).optional(),
  plantChapter: nullableEventChapter,
  targetChapter: nullableChapter,
  resolvedChapter: nullableEventChapter,
  notes: z.string().optional(),
})

/** 伏線の記録で使えるキー */
export const FORESHADOW_ENTRY_KEYS: ReadonlySet<string> = new Set(Object.keys(foreshadowFields.shape))

/**
 * 更新で渡す1件。removeKeys は、以前の保存で入った独自のキー（detail など）を
 * 外すための明示的な指定。通常の更新では独自のキーに触れない（そこにしか
 * 書かれていない内容があるため）。中身を content や notes へ移したうえで指定する。
 */
const foreshadowItemSchema = foreshadowFields.extend({ removeKeys: z.array(z.string().min(1)).min(1).optional() }).strict()

const foreshadowUpdateSchema = z.object({ items: z.array(foreshadowItemSchema).min(1) }).strict()

/** 保存済みの1件。資料と集計に使う項目がそろい、型も正しいこと */
const storedForeshadowSchema = foreshadowFields
  .extend({
    id: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
    status: z.enum(FORESHADOW_STATUSES),
  })
  .strict()

export type ForeshadowUpdate = z.infer<typeof foreshadowItemSchema>

export const FORESHADOW_EXAMPLE = `{
  "items": [
    { "id": "F1", "status": "resolved", "notes": "第12章で花の分布を作戦の地図にして回収" },
    {
      "title": "城の方角の青白い光",
      "content": "夜半、城の方角の空が青白く光り、消えない",
      "category": "mystery",
      "status": "planted",
      "plantChapter": 8,
      "targetChapter": 13
    }
  ]
}`

export const FORESHADOW_KEYS =
  "id, title, content, category, status（pending / planted / resolved / abandoned）, " +
  "plantChapter（プロローグは 0）, targetChapter, resolvedChapter（エピローグは本文のある最後の章の番号）, notes"

/**
 * 日本語で書かれがちな状態と、近い値の手がかり。
 *
 * 自動では読み替えない。「補強済み」のように対応する値が無いものがあり、
 * 機械的に寄せると意図と違う状態が保存されるため。案内に添えるだけにする。
 */
const STATUS_HINTS: Record<string, string> = {
  未着手: `まだ張っていないなら "pending"`,
  張った: `張ったなら "planted"`,
  張り済み: `張ったなら "planted"`,
  回収済み: `回収したなら "resolved"`,
  回収: `回収したなら "resolved"`,
  取り下げ: `取り下げたなら "abandoned"`,
  補強済み: `補強しただけなら status は変えず（"planted" のまま）、notes に補強した内容を書く`,
  維持: `変化が無いなら status を渡さない`,
}

function statusHint(value: unknown): string | null {
  if (typeof value !== "string") return null
  for (const [word, hint] of Object.entries(STATUS_HINTS)) {
    if (value.includes(word)) return `「${value}」→ ${hint}`
  }
  return null
}

export function parseForeshadowUpdates(
  content: string,
  existingIds: ReadonlySet<string>,
): ParseResult<ForeshadowUpdate[]> {
  const json = parseJson(content)
  if (!json.ok) return { ok: false, message: foreshadowError(["content が JSON として読めません"]) }

  const result = foreshadowUpdateSchema.safeParse(json.value)
  if (!result.success) {
    const problems = formatIssues(result.error)
    for (const issue of result.error.issues) {
      if (issue.code === "invalid_enum_value") {
        const hint = statusHint(issue.received)
        if (hint) problems.push(hint)
      }
    }
    return { ok: false, message: foreshadowError(problems) }
  }

  // 新しく足す伏線には、資料に出す題と中身が要る
  const problems: string[] = []
  result.data.items.forEach((item, i) => {
    if (item.removeKeys) {
      if (!item.id || !existingIds.has(item.id)) {
        problems.push(`items.${i}: removeKeys は記録にある伏線（id で指定）にだけ使えます`)
      }
      const standard = item.removeKeys.filter((k) => FORESHADOW_ENTRY_KEYS.has(k))
      if (standard.length > 0) {
        problems.push(`items.${i}: ${standard.join(", ")} は removeKeys では外せません。消すときは null を渡します`)
      }
    }
    if (item.id && existingIds.has(item.id)) return
    const missing = (["title", "content"] as const).filter((k) => !item[k])
    if (missing.length > 0) {
      const label = item.id ? `items.${i}（${item.id} は記録に無いので新規）` : `items.${i}（新規）`
      problems.push(`${label}: ${missing.join(", ")} が必要です`)
    }
  })
  if (problems.length > 0) return { ok: false, message: foreshadowError(problems) }

  return { ok: true, value: result.data.items }
}

function foreshadowError(problems: string[]): string {
  return `❌ 伏線の記録は更新していません（1件も書き込んでいません）。
${problems.map((p) => `  - ${p}`).join("\n")}

使えるキー: ${FORESHADOW_KEYS}
既存の伏線は id だけで指し、変える項目だけを渡します。
以前の保存で入った独自のキー（detail など）は、中身を content や notes に移したうえで
"removeKeys": ["detail"] のように指定して外します。

正しい形の例:
${FORESHADOW_EXAMPLE}`
}

/**
 * 保存済みの伏線1件の形を確かめ、問題を返す（問題が無ければ空配列）。
 *
 * 検証を入れる前に保存された記録には、status が日本語のものや、
 * targetChapter の代わりに独自のキーを使ったものが残っている。
 * これらは回収済みでも「未回収」として知らされてしまうため、別に示す。
 */
export function checkForeshadowEntry(item: unknown): string[] {
  if (typeof item !== "object" || item === null) return ["オブジェクトではありません"]
  // 入力と同じスキーマで確かめる。章番号が "十二" のような文字列だと
  // 期限の判定を誤るため、型の誤りも崩れた記録として扱う
  const result = storedForeshadowSchema.safeParse(item)
  if (result.success) return []
  return formatIssues(result.error).map((p) => p.replace(/^（最上位）: /, ""))
}

/** 保存済みの伏線を、形の正しいものと崩れているものに分ける */
export function splitForeshadowEntries(items: unknown[]): {
  valid: ForeshadowEntry[]
  invalid: Array<{ id: string; problems: string[] }>
} {
  const valid: ForeshadowEntry[] = []
  const invalid: Array<{ id: string; problems: string[] }> = []
  items.forEach((item, i) => {
    const problems = checkForeshadowEntry(item)
    if (problems.length === 0) {
      valid.push(item as ForeshadowEntry)
    } else {
      const id = (item as { id?: unknown })?.id
      invalid.push({ id: typeof id === "string" && id ? id : `#${i + 1}`, problems })
    }
  })
  return { valid, invalid }
}

// ============================================================
// あらすじ（章ごとの節）
// ============================================================

/**
 * summary.md は章ごとの節で持つ。
 *
 *   # 『タイトル』これまでのあらすじ
 *   > 説明
 *   ## 全体の流れ（第8章まで）
 *   （任意。古い章が資料の枠から落ちても筋を追えるようにする要約。
 *     見出しに何章までの要約かを残し、それより前の章を書くときは載せない）
 *   ## 第1章 タイトル
 *   （この章のあらすじ）
 *
 * 以前は novel_update が渡された内容でファイルを丸ごと置き換えていた。
 * モデルは毎回その章の分だけを渡すため、前の章のあらすじが消え続けた。
 * 節ごとに差し替えることで、渡し方に関わらず過去の章が残るようにする。
 */

export const OVERVIEW_HEADING = "全体の流れ"

const SUMMARY_CHAPTER_HEADING = /^##\s+第\s*([0-9０-９〇零一二三四五六七八九十百千]+)\s*章/
const SECTION_HEADING = /^##\s+(.*)$/

export interface SummarySection {
  /** 章の節なら章番号。それ以外は null */
  chapter: number | null
  /** プロローグ・幕間・エピローグの節なら、その節（sections.ts）。章の節には付けない */
  section?: ManuscriptSection
  /** 見出しの行（`## …`） */
  heading: string
  /** 見出しを除いた本文 */
  body: string
}

export interface ParsedSummary {
  /** 最初の `## ` より前（題と説明） */
  head: string
  sections: SummarySection[]
}

export function parseSummary(text: string): ParsedSummary {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const headLines: string[] = []
  const sections: SummarySection[] = []
  let current: { chapter: number | null; section?: ManuscriptSection; heading: string; lines: string[] } | null = null

  const flush = () => {
    if (current) {
      const { lines: body, ...rest } = current
      sections.push({ ...rest, body: body.join("\n").trim() })
    }
  }

  for (const line of lines) {
    const heading = line.match(SECTION_HEADING)
    if (heading) {
      flush()
      const m = line.match(SUMMARY_CHAPTER_HEADING)
      // 章以外の節（「## プロローグ」「## 幕間（第5章のあと）」「## エピローグ」）
      const section = m ? null : parseSectionLabel(heading[1], parseChapterNumber)
      current = section
        ? { chapter: null, section, heading: line.trim(), lines: [] }
        : { chapter: m ? parseChapterNumber(m[1]) : null, heading: line.trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else headLines.push(line)
  }
  flush()

  return { head: headLines.join("\n").trim(), sections }
}

const OVERVIEW_PATTERN =
  /^全体の流れ(?:\s*[（(]\s*第\s*([0-9０-９〇零一二三四五六七八九十百千]+)\s*章まで\s*[）)])?$/

/** 章か、章以外の節（プロローグ・幕間・エピローグ）のあらすじか */
function isEntry(section: SummarySection): boolean {
  return section.chapter !== null || section.section !== undefined
}

/** 節が指す章・節。章の節なら章として返す */
function entrySection(s: SummarySection): ManuscriptSection | null {
  if (s.section) return s.section
  return s.chapter !== null ? { kind: "chapter", chapter: s.chapter } : null
}

/** 「全体の流れ（第N章まで）」や旧形式の範囲 N が、target より前だけを要約しているか */
function coverageBefore(coverage: number, target: ManuscriptSection): boolean {
  switch (target.kind) {
    case "prologue":
      return false
    case "chapter":
      return coverage < target.chapter
    case "interlude":
      // 第N章までの要約は、第N章のあとの幕間も含むとみなす
      return coverage < target.chapter
    case "epilogue":
      return true
  }
}

function isOverview(section: SummarySection): boolean {
  return !isEntry(section) && OVERVIEW_PATTERN.test(section.heading.replace(/^##\s+/, "").trim())
}

/** 「全体の流れ」が何章までの要約か。見出しに書かれていなければ null */
function overviewCoverage(section: SummarySection): number | null {
  const m = section.heading.replace(/^##\s+/, "").trim().match(OVERVIEW_PATTERN)
  return m?.[1] ? parseChapterNumber(m[1]) : null
}

function overviewHeading(coverage: number): string {
  return `## ${OVERVIEW_HEADING}（第${coverage}章まで）`
}

/**
 * 章ごとの節にする前の、旧形式のあらすじ（「## 物語の進み」など）を収める節。
 *
 * 旧形式の記述には何章までの要約かが書かれていない。読み込むたびに推定すると
 * （たとえば最初の章の節から）、過去の章の節を足しただけで範囲が縮み、
 * 先の出来事が資料へ混ざる。そこで初めて章の節を足すときに、この節へ移して
 * 範囲を見出しに固定する。
 */
export const LEGACY_HEADING = "以前の形式のあらすじ"

const LEGACY_PATTERN = /^以前の形式のあらすじ(?:\s*[（(]\s*第\s*(\d+)\s*章まで\s*[）)])?$/

function isLegacyBlock(section: SummarySection): boolean {
  return !isEntry(section) && LEGACY_PATTERN.test(section.heading.replace(/^##\s+/, "").trim())
}

/** 旧形式の節が何章までの要約か。範囲が書かれていなければ 0（本文より前の記述とみなす） */
function legacyCoverage(section: SummarySection): number {
  const m = section.heading.replace(/^##\s+/, "").trim().match(LEGACY_PATTERN)
  return m?.[1] ? parseInt(m[1], 10) : 0
}

/** 題と説明の引用だけを残した頭書き */
function headWithoutBody(head: string): string {
  return head
    .split("\n")
    .filter((l) => /^#\s/.test(l) || /^>/.test(l) || l.trim() === "")
    .join("\n")
    .trim()
}

/** まだ旧形式の節に移していない旧形式の記述（頭書きの地の文と、章でも全体の流れでもない節） */
function unmarkedLegacyText(parsed: ParsedSummary): string {
  return [
    headBody(parsed.head),
    ...parsed.sections
      .filter((s) => !isEntry(s) && !isOverview(s) && !isLegacyBlock(s) && s.body && !isPlaceholderOnly(s.body))
      .map((s) => `${s.heading.replace(/^##/, "###")}\n\n${s.body}`),
  ]
    .filter((t) => t.length > 0)
    .join("\n\n")
}

/** 題の行と説明の引用を除いた地の文（旧形式では、ここにあらすじが書かれていた） */
function headBody(head: string): string {
  return head
    .split("\n")
    .filter((l) => !/^#\s/.test(l) && !/^>/.test(l))
    .join("\n")
    .trim()
}

/** 雛形の角括弧だけが並んだ本文（未記入）かどうか */
export function isPlaceholderOnly(body: string): boolean {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  return lines.length > 0 && lines.every((l) => /^\[[^\]]*\]$/.test(l))
}

/**
 * 渡されたあらすじを節に分ける。
 *
 *   - `## 第N章` の見出しがあれば、その節ごとに扱う（複数章をまとめて渡せる）
 *   - `## プロローグ` `## 幕間（第5章のあと）` `## エピローグ` も節として扱う
 *   - 見出しが無く target（章番号か節）があれば、その章・節の節として扱う
 *   - `## 全体の流れ` の節があれば、全体の要約として扱う
 *
 * 見出しの前に地の文があると、どの章のものか決められない。黙って捨てずに断る。
 */
export function parseSummaryInput(
  content: string,
  target: number | ManuscriptSection | undefined,
): ParseResult<SummarySection[]> {
  const { head, sections } = parseSummary(content)
  const targetSection: ManuscriptSection | undefined =
    typeof target === "number" ? { kind: "chapter", chapter: target } : target
  // `# これまでのあらすじ` のような題の行は捨ててよい
  const strayHead = headBody(head)

  if (sections.length === 0) {
    if (!strayHead) return { ok: false, message: summaryError("あらすじが空です") }
    if (targetSection === undefined) {
      return {
        ok: false,
        message: summaryError(
          "どの章のあらすじか分かりません。chapterNumber を渡すか、本文の先頭に `## 第N章 タイトル` の見出しを付けてください",
        ),
      }
    }
    return { ok: true, value: [{ ...summaryEntryOf(targetSection), body: strayHead }] }
  }

  if (strayHead) {
    return {
      ok: false,
      message: summaryError("最初の `## ` 見出しより前に本文があります。どの章のものか決められないため、見出しの下へ移してください"),
    }
  }

  const zero = sections.filter((s) => s.chapter !== null && s.chapter < 1)
  if (zero.length > 0) {
    return { ok: false, message: summaryError(`章番号は1以上にしてください: ${zero.map((s) => s.heading).join(" / ")}`) }
  }

  const unknown = sections.filter((s) => !isEntry(s) && !isOverview(s))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: summaryError(
        `章でも「${OVERVIEW_HEADING}」でもない見出しがあります: ${unknown.map((s) => s.heading).join(" / ")}`,
      ),
    }
  }

  const entries = sections.filter(isEntry)
  if (targetSection !== undefined) {
    const expected = sectionLabel(targetSection)
    const mismatched = entries.filter((s) => sectionLabel(entrySection(s)!) !== expected)
    if (mismatched.length > 0) {
      const found = entries.map((s) => sectionLabel(entrySection(s)!)).join("、")
      const given = targetSection.kind === "chapter" ? `chapterNumber は ${targetSection.chapter}` : `指定は${expected}`
      return {
        ok: false,
        message: summaryError(`${given}ですが、見出しは ${found} です。どちらかに揃えてください`),
      }
    }
  }

  const empty = sections.filter((s) => !s.body)
  if (empty.length > 0) {
    return { ok: false, message: summaryError(`本文が空の節があります: ${empty.map((s) => s.heading).join(" / ")}`) }
  }

  // 全体の流れは、何章までの要約かを見出しに残す。
  // 残さないと、前の章を書き直すときに先の出来事が資料へ混ざる。
  // 幕間を指したときは、直前の章までの要約とみなす
  const targetChapter =
    targetSection?.kind === "chapter" || targetSection?.kind === "interlude" ? targetSection.chapter : null
  const value: SummarySection[] = []
  for (const s of sections) {
    if (isEntry(s)) {
      value.push(s)
      continue
    }
    const coverage = overviewCoverage(s) ?? targetChapter
    if (coverage === null) {
      return {
        ok: false,
        message: summaryError(
          `「${OVERVIEW_HEADING}」が何章までの要約か分かりません。chapterNumber にその章番号を渡すか、見出しを「## ${OVERVIEW_HEADING}（第N章まで）」にしてください`,
        ),
      }
    }
    value.push({ ...s, heading: overviewHeading(coverage) })
  }
  return { ok: true, value }
}

/** 見出しだけの節（本文はあとで入れる）。章なら `## 第N章`、節なら `## プロローグ` など */
export function summaryEntryOf(target: ManuscriptSection): Omit<SummarySection, "body"> {
  return target.kind === "chapter"
    ? { chapter: target.chapter, heading: `## 第${target.chapter}章` }
    : { chapter: null, section: target, heading: `## ${sectionLabel(target)}` }
}

function summaryError(problem: string): string {
  return `❌ あらすじは更新していません。
  - ${problem}

あらすじは章ごとの節で残します。渡すのは**この章の分だけ**で、前の章の節はそのまま残ります。
  novel_update(action: "summary", chapterNumber: 12, content: "峠を下りた三人は…（この章のあらすじ）")
プロローグ・幕間・エピローグは section で指します（幕間は chapterNumber に直前の章）。
  novel_update(action: "summary", section: "prologue", content: "…")
全体の要約を書き直すときは、content を「## ${OVERVIEW_HEADING}」の見出しで始め、
chapterNumber に何章までの要約かを渡してください。`
}

/**
 * あらすじに節を差し込む。同じ章・同じ「全体の流れ」があれば置き換える。
 *
 * 並びは 題 → 全体の流れ → 旧形式の節 → 章と節（読む順番。プロローグ・幕間・エピローグも含む）に整える。
 * 雛形の角括弧だけが残った節（旧形式の雛形）は捨てる。
 *
 * 旧形式の記述が残っていれば「以前の形式のあらすじ（第N章まで）」の節へ移し、
 * 範囲を固定する。N は次のうち最も大きいもの。
 *   - 呼び手が渡す範囲（本文のある最後の章など）
 *   - 移す前のファイルにある章の節の最大章番号
 *     （移す前は読み込み時にこの章までを含むとみなしていた。これより小さくすると、
 *       移しただけで範囲が縮み、先の出来事が資料へ混ざる）
 *   - 差し込む章の節のうち最も小さい章の直前
 */
export function upsertSummarySections(
  current: string,
  incoming: SummarySection[],
  legacyCoverageAtMigration?: number,
): string {
  const parsed = parseSummary(current)
  let overview = parsed.sections.find(isOverview) ?? null
  let legacy = parsed.sections.find(isLegacyBlock) ?? null
  // 章と節は呼び名（「第3章」「幕間（第5章のあと）」）で同じものを判定する
  const entries = new Map<string, { at: ManuscriptSection; section: SummarySection }>()
  const put = (s: SummarySection) => {
    const at = entrySection(s)!
    entries.set(sectionLabel(at), { at, section: s })
  }
  for (const s of parsed.sections) if (isEntry(s)) put(s)

  for (const s of incoming) {
    if (isEntry(s)) put(s)
    else overview = s
  }

  let head = parsed.head
  const unmarked = unmarkedLegacyText(parsed)
  if (unmarked) {
    if (legacy) {
      // すでに移した節があれば、範囲はそのままにして書き足す（範囲を縮めない）
      legacy = { ...legacy, body: `${legacy.body}\n\n${unmarked}`.trim() }
    } else {
      const incomingChapters = incoming.filter((s) => s.chapter !== null).map((s) => s.chapter as number)
      const existingChapters = parsed.sections.filter((s) => s.chapter !== null).map((s) => s.chapter as number)
      const coverage = Math.max(
        0,
        legacyCoverageAtMigration ?? 0,
        ...existingChapters,
        ...(incomingChapters.length > 0 ? [Math.min(...incomingChapters) - 1] : []),
      )
      legacy = {
        chapter: null,
        heading: coverage > 0 ? `## ${LEGACY_HEADING}（第${coverage}章まで）` : `## ${LEGACY_HEADING}`,
        body: unmarked,
      }
    }
    head = headWithoutBody(parsed.head)
  }

  const blocks: string[] = []
  if (head) blocks.push(head)
  if (overview) blocks.push(`${overview.heading}\n\n${overview.body}`.trim())
  if (legacy) blocks.push(`${legacy.heading}\n\n${legacy.body}`.trim())
  for (const { section: s } of [...entries.values()].sort((a, b) => compareSections(a.at, b.at))) {
    blocks.push(`${s.heading}\n\n${s.body}`.trim())
  }
  return blocks.join("\n\n") + "\n"
}

/** あらすじに節がある、章以外の節（プロローグ・幕間・エピローグ。読む順番） */
export function summarySections(text: string): ManuscriptSection[] {
  return parseSummary(text)
    .sections.flatMap((s) => (s.section ? [s.section] : []))
    .sort(compareSections)
}

/** あらすじに節がある章の番号（昇順） */
export function summaryChapters(text: string): number[] {
  return parseSummary(text)
    .sections.filter((s) => s.chapter !== null)
    .map((s) => s.chapter as number)
    .sort((a, b) => a - b)
}

/**
 * 執筆用の資料に載せるあらすじを組み立てる。
 *
 * 先頭から切ると、章が増えるほど新しい章（いちばん要る部分）が落ちる。
 * そこで、書こうとしている章より前の節を**直前の章から**順に枠へ詰め、
 * 古い章から落とす。落ちた章の筋は「全体の流れ」で補う。
 * 「全体の流れ」と旧形式の記述には枠の3分の1までを先に取っておき、章の節で余った分も回す。
 *
 * 書こうとしている章以降の内容は載せない（前の章を書き直すときに先の筋が混ざらないように）。
 * 「前」は読む順番で判定する（target には章番号か節を渡す。sections.ts）。
 *   - 章と節: 書く章・節より前のものだけ（第5章のあとの幕間を書くなら、第5章までと、その前の幕間）
 *   - 全体の流れ: 見出しの「第N章まで」が書く章より前のときだけ。見出しに無ければ、
 *     記録のある最後の章までの要約とみなす
 *   - 旧形式の記述（章の節にする前の「## 物語の進み」など）: 章の節より前に書かれたものなので、
 *     最初の章の節の直前までの要約とみなす
 * 章の節も「全体の流れ」も無い古い形式のファイルは、従来どおり先頭から切って載せる。
 *
 * lastChapter は、記録の無い章を知らせるときにどの章まで見るか（エピローグを書くときに使う。
 * 省くと記録のある最後の章まで）。
 */
export function buildSummaryContext(
  text: string,
  target: number | ManuscriptSection,
  limit: number,
  lastChapter?: number,
): string {
  const at: ManuscriptSection = typeof target === "number" ? { kind: "chapter", chapter: target } : target
  const parsed = parseSummary(text)
  const overview = parsed.sections.find(isOverview)
  const chapterSections = parsed.sections.filter(isEntry)
  const legacyBlock = parsed.sections.find(isLegacyBlock)
  const unmarked = unmarkedLegacyText(parsed)

  if (!overview && !legacyBlock && chapterSections.length === 0) {
    // 章の節も「全体の流れ」も無い。旧形式（丸ごと書き換えていたころのもの）として扱う
    return clipHead(unmarked, limit)
  }

  const recordedChapters = chapterSections.flatMap((s) => (s.chapter !== null ? [s.chapter] : []))
  const lastRecorded = recordedChapters.length > 0 ? Math.max(...recordedChapters) : 0

  // 全体の流れと旧形式の記述。書く章より先を含むものは載せず、その旨を残す
  const notes: string[] = []
  const lead: string[] = []
  if (overview && overview.body && !isPlaceholderOnly(overview.body)) {
    const coverage = overviewCoverage(overview) ?? lastRecorded
    if (coverageBefore(coverage, at)) {
      lead.push(`### ${OVERVIEW_HEADING}（第${coverage}章まで）\n${overview.body}`)
    } else {
      notes.push(`（${OVERVIEW_HEADING}は第${coverage}章までの要約で、この章より先を含むため載せていません）`)
    }
  }
  // 旧形式の記述。移した節は見出しに固定した範囲で判定する。
  // まだ移していない記述（手で書き足したものなど）は範囲が分からないので、
  // 範囲の無い全体の流れと同じく、記録のある最後の章までの要約とみなす
  const legacyParts: Array<{ body: string; coverage: number }> = []
  if (legacyBlock?.body && !isPlaceholderOnly(legacyBlock.body)) {
    legacyParts.push({ body: legacyBlock.body, coverage: legacyCoverage(legacyBlock) })
  }
  if (unmarked) legacyParts.push({ body: unmarked, coverage: lastRecorded })
  for (const part of legacyParts) {
    if (coverageBefore(part.coverage, at)) {
      const range = part.coverage > 0 ? `（第${part.coverage}章まで）` : ""
      lead.push(`### ${LEGACY_HEADING}${range}\n${part.body}`)
    } else {
      notes.push(`（${LEGACY_HEADING}は第${part.coverage}章までを含むため載せていません）`)
    }
  }
  const leadText = lead.join("\n\n")

  const past = chapterSections
    .filter((s) => compareSections(entrySection(s)!, at) < 0)
    .sort((a, b) => compareSections(entrySection(a)!, entrySection(b)!))

  const len = (s: string) => [...s].length
  const reserve = Math.min(len(leadText), Math.floor(limit / 3))
  let budget = limit - reserve

  // 直前の章から詰める
  const picked: SummarySection[] = []
  for (let i = past.length - 1; i >= 0; i--) {
    const block = `${past[i].heading}\n${past[i].body}`
    if (len(block) <= budget) {
      picked.unshift(past[i])
      budget -= len(block)
      continue
    }
    // 直前の章だけは、入りきらなくても頭から入る分を載せる
    if (picked.length === 0 && budget > 0) {
      picked.unshift({ ...past[i], body: clipHead(past[i].body, Math.max(0, budget - len(past[i].heading) - 1)) })
      budget = 0
    }
    break
  }

  const out: string[] = []
  if (leadText) out.push(clipHead(leadText, reserve + budget))
  out.push(...notes)

  const pickedSet = new Set(picked.map((s) => s.heading))
  const dropped = past.filter((s) => !pickedSet.has(s.heading))
  if (dropped.length > 0) {
    const first = dropped[0]
    const last = dropped[dropped.length - 1]
    const range =
      first === last
        ? sectionLabel(entrySection(first)!)
        : first.chapter !== null && last.chapter !== null
          ? `第${first.chapter}〜${last.chapter}章`
          : `${sectionLabel(entrySection(first)!)}〜${sectionLabel(entrySection(last)!)}`
    out.push(`（${range}のあらすじは枠に収まらないため省略。全文は .novel/summary.md を参照）`)
  }
  for (const s of picked) out.push(`${s.heading.replace(/^##/, "###")}\n${s.body}`)

  // 記録の無い章（この章・節より前の章だけを見る）
  const recorded = new Set(past.map((s) => s.chapter))
  const lastBefore =
    at.kind === "chapter" ? at.chapter - 1
      : at.kind === "interlude" ? at.chapter
        : at.kind === "epilogue" ? (lastChapter ?? lastRecorded)
          : 0
  const missing: number[] = []
  for (let n = 1; n <= lastBefore; n++) if (!recorded.has(n)) missing.push(n)
  if (missing.length > 0) {
    out.push(`⚠️ あらすじの記録が無い章: ${missing.map((n) => `第${n}章`).join("、")}`)
  }

  return out.join("\n\n")
}

/** [1,2,3,5] → 「第1〜3章、第5章」 */
export function formatChapterRanges(nums: number[]): string {
  const out: string[] = []
  let start = nums[0]
  let prev = nums[0]
  for (const n of [...nums.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    out.push(start === prev ? `第${start}章` : `第${start}〜${prev}章`)
    start = n
    prev = n
  }
  return out.join("、")
}

function clipHead(text: string, limit: number): string {
  const chars = [...text]
  if (chars.length <= limit) return text
  return chars.slice(0, limit).join("") + "\n…（以下省略。全文は .novel/summary.md を参照）"
}

// ============================================================
// 記録ファイルの読み込み（更新と点検用）
// ============================================================

/**
 * 記録ファイルを読んだ結果。
 *
 *   ok       読めて、形も確かめた
 *   missing  ファイルが無い（空の記録として扱ってよい）
 *   broken   読み込めない／JSON として読めない／形が違う
 *
 * 共通の safeReadJson は、ファイルが無いときも壊れているときも null を返す。
 * 更新処理がそれを空の記録とみなすと、壊れたファイルを新しい1件だけで
 * 上書きし、記録が丸ごと消える（id も F1 から振り直される）。
 * 更新の前には必ずこちらで読み、broken なら書かずに断る。
 */
export type RecordFile<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing" }
  | { kind: "broken"; reason: "unreadable" | "syntax" | "structure"; detail: string }

/** 読めないときのファイルの状態を、直し方の案内つきで1文にする */
export function describeBrokenRecord(file: string, state: Extract<RecordFile<unknown>, { kind: "broken" }>): string {
  switch (state.reason) {
    case "unreadable":
      return `${file} を読み込めません（${state.detail}）。ファイルの権限や、ディレクトリになっていないかを確かめてください`
    case "syntax":
      return `${file} が JSON として読めません（${state.detail}）。ファイルを開いて構文を直してください（末尾の余計なカンマ、括弧や引用符の閉じ忘れなど）`
    case "structure":
      return `${file} の形が違います（${state.detail}）`
  }
}

async function readRaw(path: string): Promise<{ ok: true; text: string } | { ok: false; missing: boolean; detail: string }> {
  try {
    return { ok: true, text: await readFile(path, "utf-8") }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return { ok: false, missing: code === "ENOENT", detail: code ?? String(e) }
  }
}

/** 文章の記録（summary.md）を読む。中身の形は問わない */
export async function readTextRecord(path: string): Promise<RecordFile<string>> {
  const raw = await readRaw(path)
  if (raw.ok) return { kind: "ok", value: raw.text }
  return raw.missing ? { kind: "missing" } : { kind: "broken", reason: "unreadable", detail: raw.detail }
}

async function readJsonRecord<T>(path: string, schema: z.ZodType<T>): Promise<RecordFile<T>> {
  const raw = await readRaw(path)
  if (!raw.ok) return raw.missing ? { kind: "missing" } : { kind: "broken", reason: "unreadable", detail: raw.detail }
  let json: unknown
  try {
    json = JSON.parse(raw.text)
  } catch (e) {
    return { kind: "broken", reason: "syntax", detail: e instanceof Error ? e.message : String(e) }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    return { kind: "broken", reason: "structure", detail: formatIssues(result.error).slice(0, 5).join(" / ") }
  }
  return { kind: "ok", value: result.data }
}

/**
 * 伏線の記録（foreshadow.json）の形。
 *
 * 確かめるのは、更新処理が安全に動くのに要る形だけ（最上位の items 配列と、
 * 各項目がオブジェクトであること）。項目ごとの不正（日本語の status や
 * 独自のキー）はここでは断らない。断ると、novel_update で渡し直して直す
 * 経路まで塞いでしまうため。項目ごとの不正は splitForeshadowEntries で別に示す。
 */
const foreshadowFileSchema = z.object({
  items: z.array(z.record(z.unknown())),
}).passthrough()

export function readForeshadowRecord(path: string): Promise<RecordFile<{ items: Array<Record<string, unknown>> }>> {
  return readJsonRecord(path, foreshadowFileSchema)
}

/**
 * 登場人物の状態（state.json）の形。
 *
 * 章・節のキー（sectionKey）ごとに、その節で変わったこと（novel_update の updates と同じ形）を持つ。
 * 状態はここから組み立てる（character-state.ts）。差分の欄の型まで確かめるのは、
 * 形の崩れた差分を重ねると誤った状態ができる（文字列を一覧として展開すると一文字ずつに割れる）ため。
 * status の値の誤りは断らない（その節を replace で渡し直して直せるようにするため）。
 * 節のキーは読み戻せる形に限る（chapter-5 と chapter-005 が同じ節を二重に指さないように）。
 */
const storedSectionSchema = z
  .object({
    updates: z.array(
      z.object({ name: stateText, changes: characterChangesSchema.extend({ status: z.string().optional() }).passthrough() }).passthrough(),
    ),
  })
  .passthrough()

const characterFileSchema = z
  .object({ sections: z.record(storedSectionSchema) })
  .passthrough()
  .superRefine((v, ctx) => {
    for (const key of Object.keys(v.sections)) {
      const section = sectionFromKey(key)
      if (!section || sectionKey(section) !== key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", key],
          message: "節のキーとして読めません（chapter-001 / prologue / interlude-001-1 / epilogue の形）",
        })
      }
    }
  })

export function readCharacterStateRecord(path: string): Promise<RecordFile<CharacterStateFile>> {
  return readJsonRecord(path, characterFileSchema) as Promise<RecordFile<CharacterStateFile>>
}
