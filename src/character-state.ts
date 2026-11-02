/**
 * opencode-novel-plugin - 人物の状態（章・節ごとの差分と、その時点の状態の組み立て）
 *
 * state.json は章・節ごとに「その節で変わったこと（差分）」だけを持つ。
 *
 *   { "sections": { "chapter-001": { "updates": [ { "name": "レン", "changes": { … } } ] } } }
 *
 * ある節を書くときの状態は、それより前の節の差分を読む順番（compareSections）に重ねて組み立てる。
 * 状態そのもの（スナップショット）を節ごとに保存しないのは、前の章を書き直したときに
 * 後ろの章の記録と食い違わないようにするため。差分なら、その節の差分を差し替えるだけで
 * 後ろの節の状態にも反映される。
 *
 * `"updates": []` の節は「記録済み・変化なし」。
 */
import { compareSections, sectionFromKey } from "./sections.js"
import type { ManuscriptSection } from "./sections.js"
import type { CharacterChanges, CharacterUpdate } from "./records.js"

export interface CharacterStateSection {
  updates: CharacterUpdate[]
}

export interface CharacterStateFile {
  sections: Record<string, CharacterStateSection>
}

export interface CharacterEvent {
  at: ManuscriptSection
  text: string
}

/** 差分を重ねてできた、ある時点の人物の状態 */
export interface ResolvedCharacter {
  name: string
  /** 記録が無ければ active */
  status: string
  physicalState?: string
  mentalState?: string
  attributes: Record<string, string>
  lists: Record<string, string[]>
  relationships: Record<string, string>
  firstPerson?: string
  addressTerms: Record<string, string>
  /** 読む順番の出来事 */
  events: CharacterEvent[]
  /**
   * 欄ごとに、最後に値を変えた節（「死亡（第3章）」「呼び方（第1章で変更）」の表示用）。
   * キーは "status" / "firstPerson" / "addressTerms.相手" のように欄の名前
   */
  changedAt: Record<string, ManuscriptSection>
  /** 初めて記録に出た節 */
  firstSeen: ManuscriptSection
}

export function emptyCharacterStateFile(): CharacterStateFile {
  return { sections: {} }
}

/** 記録のある節を読む順番に並べる（読めないキーは記録の読み込みで断っているので、ここでは飛ばすだけ） */
export function recordedSections(file: CharacterStateFile): Array<{ key: string; section: ManuscriptSection; record: CharacterStateSection }> {
  const out: Array<{ key: string; section: ManuscriptSection; record: CharacterStateSection }> = []
  for (const [key, record] of Object.entries(file.sections)) {
    const section = sectionFromKey(key)
    if (section) out.push({ key, section, record })
  }
  return out.sort((a, b) => compareSections(a.section, b.section))
}

/** target より前の節の差分を重ねた状態（target を書くときの資料） */
export function statesBefore(file: CharacterStateFile, target: ManuscriptSection): ResolvedCharacter[] {
  return resolve(file, (s) => compareSections(s, target) < 0)
}

/** target までの節（target を含む）の差分を重ねた状態（target を書き終えた時点） */
export function statesThrough(file: CharacterStateFile, target: ManuscriptSection): ResolvedCharacter[] {
  return resolve(file, (s) => compareSections(s, target) <= 0)
}

/** target より前で、記録のある最後の節（資料の「〜の終わり時点」）。無ければ null */
export function lastRecordedBefore(file: CharacterStateFile, target: ManuscriptSection): ManuscriptSection | null {
  const before = recordedSections(file).filter((r) => compareSections(r.section, target) < 0)
  return before.length > 0 ? before[before.length - 1].section : null
}

/**
 * 作品の記録で使っている attributes / lists の項目名（初めて出た順）。
 * 項目名は作品ごとに決めるので、「所持品」と「持ち物」のような揺れが出ないよう、
 * 更新の報告・資料・更新用プロンプトでこれを示す。
 * 値が入ったことのある項目名だけを数える（null だけの項目や、空の一覧は使っていないものとみなす。
 * 誤った項目名を null で消したあとも案内し続けないように）
 */
export interface StateKeyNames {
  attributes: string[]
  lists: string[]
}

export function stateKeyNames(file: CharacterStateFile): StateKeyNames {
  const names: StateKeyNames = { attributes: [], lists: [] }
  for (const { record } of recordedSections(file)) {
    for (const { changes } of record.updates) {
      const used = {
        attributes: Object.entries(changes.attributes ?? {}).filter(([, v]) => v !== null).map(([k]) => k),
        lists: Object.entries(changes.lists ?? {})
          .filter(([, d]) => (d.added?.length ?? 0) + (d.removed?.length ?? 0) > 0)
          .map(([k]) => k),
      }
      for (const field of ["attributes", "lists"] as const) {
        for (const k of used[field]) if (!names[field].includes(k)) names[field].push(k)
      }
    }
  }
  return names
}

/** 項目名の一覧を1行にする（使っていなければ空文字） */
export function formatStateKeyNames(names: StateKeyNames): string {
  const parts: string[] = []
  if (names.attributes.length > 0) parts.push(`attributes = ${names.attributes.join("、")}`)
  if (names.lists.length > 0) parts.push(`lists = ${names.lists.join("、")}`)
  return parts.join(" ／ ")
}

/** 記録に出てくる人物の名前（初めて出た順） */
export function recordedNames(file: CharacterStateFile): string[] {
  return resolve(file, () => true).map((c) => c.name)
}

function resolve(file: CharacterStateFile, include: (s: ManuscriptSection) => boolean): ResolvedCharacter[] {
  const characters: ResolvedCharacter[] = []
  for (const { section, record } of recordedSections(file)) {
    if (!include(section)) continue
    for (const { name, changes } of record.updates) {
      let c = characters.find((x) => x.name === name)
      if (!c) {
        c = { name, status: "active", attributes: {}, lists: {}, relationships: {}, addressTerms: {}, events: [], changedAt: {}, firstSeen: section }
        characters.push(c)
      }
      applyChanges(c, changes, section)
    }
  }
  return characters
}

/** 1つの節の差分を状態に当てる。値が変わった欄だけ changedAt を進める */
function applyChanges(c: ResolvedCharacter, changes: CharacterChanges, at: ManuscriptSection): void {
  const setValue = (key: "status" | "physicalState" | "mentalState" | "firstPerson", value: string | null | undefined) => {
    if (value === undefined) return
    const record = c as unknown as Record<string, unknown>
    if (value === null) {
      if (record[key] === undefined || key === "status") return
      delete record[key]
    } else if (record[key] === value) {
      return
    } else {
      record[key] = value
    }
    c.changedAt[key] = at
  }
  const setMap = (field: "attributes" | "relationships" | "addressTerms", incoming: Record<string, string | null> | undefined) => {
    for (const [k, v] of Object.entries(incoming ?? {})) {
      const map = c[field]
      if (v === null ? !(k in map) : map[k] === v) continue
      if (v === null) delete map[k]
      else map[k] = v
      c.changedAt[`${field}.${k}`] = at
    }
  }

  setValue("status", changes.status)
  setValue("physicalState", changes.physicalState)
  setValue("mentalState", changes.mentalState)
  setValue("firstPerson", changes.speech?.firstPerson)
  setMap("attributes", changes.attributes)
  setMap("relationships", changes.relationships)
  setMap("addressTerms", changes.speech?.addressTerms)

  for (const [listName, diff] of Object.entries(changes.lists ?? {})) {
    const before = c.lists[listName] ?? []
    const removed = diff.removed ?? []
    const after = [...before.filter((x) => !removed.includes(x))]
    for (const x of diff.added ?? []) if (!after.includes(x)) after.push(x)
    if (after.length === before.length && after.every((x, i) => x === before[i])) continue
    if (after.length > 0) c.lists[listName] = after
    else delete c.lists[listName]
    c.changedAt[`lists.${listName}`] = at
  }

  for (const text of changes.events ?? []) c.events.push({ at, text })
}

/**
 * 同じ節に重ねて送られた差分を1つにまとめる（あとから送られたほうが勝つ）。
 *
 * 値と対応表は欄・キーごとに上書きする。一覧は、あとで外したものを前の added から除き、
 * あとで足したものを前の removed から除く。出来事は同じ文言を足さない（同じ節の中だけで判定）。
 */
export function mergeChanges(base: CharacterChanges, extra: CharacterChanges): CharacterChanges {
  const out: CharacterChanges = { ...base }
  for (const key of ["status", "physicalState", "mentalState"] as const) {
    if (extra[key] !== undefined) (out as Record<string, unknown>)[key] = extra[key]
  }
  for (const key of ["attributes", "relationships"] as const) {
    if (extra[key]) out[key] = { ...base[key], ...extra[key] }
  }
  if (extra.speech) {
    const speech = { ...base.speech }
    if (extra.speech.firstPerson !== undefined) speech.firstPerson = extra.speech.firstPerson
    if (extra.speech.addressTerms) speech.addressTerms = { ...base.speech?.addressTerms, ...extra.speech.addressTerms }
    out.speech = speech
  }
  if (extra.lists) {
    const lists = { ...base.lists }
    for (const [name, diff] of Object.entries(extra.lists)) {
      const prev = lists[name] ?? {}
      const added = (prev.added ?? []).filter((x) => !(diff.removed ?? []).includes(x))
      const removed = (prev.removed ?? []).filter((x) => !(diff.added ?? []).includes(x))
      for (const x of diff.added ?? []) if (!added.includes(x)) added.push(x)
      for (const x of diff.removed ?? []) if (!removed.includes(x)) removed.push(x)
      const merged: { added?: string[]; removed?: string[] } = {}
      if (added.length > 0) merged.added = added
      if (removed.length > 0) merged.removed = removed
      if (merged.added || merged.removed) lists[name] = merged
      else delete lists[name]
    }
    out.lists = lists
  }
  if (extra.events) out.events = [...new Set([...(base.events ?? []), ...extra.events])]
  return out
}

/**
 * 節の記録に updates を当てた新しい記録を返す（元の記録は変えない）。
 * replace なら渡した内容で置き換え、そうでなければ人物ごとに mergeChanges で重ねる。
 * 同じ人物が updates に2回出てきても1つにまとめる。
 */
export function applySectionUpdates(
  current: CharacterStateSection | undefined,
  updates: CharacterUpdate[],
  replace: boolean,
): CharacterStateSection {
  const entries: CharacterUpdate[] = replace ? [] : (current?.updates ?? []).map((u) => ({ name: u.name, changes: u.changes }))
  for (const { name, changes } of updates) {
    // 中身の無い欄を外した結果、変化が残らなかった人物は記録に入れない（compactChanges）
    if (Object.keys(changes).length === 0) continue
    const existing = entries.find((e) => e.name === name)
    if (existing) existing.changes = mergeChanges(existing.changes, changes)
    else entries.push({ name, changes })
  }
  return { updates: entries }
}

/**
 * 更新の前後で、ある人物の状態のどこが変わったかを短い語で返す（変わらなければ空配列）。
 * 「持っている品をもう一度足す」「同じ値を入れ直す」は変化に数えない。
 * 出来事は、その節（at）の出来事の増減だけを見る。
 */
export function describeStateChange(before: ResolvedCharacter | undefined, after: ResolvedCharacter | undefined, at: ManuscriptSection): string[] {
  const out: string[] = []
  const b = before
  const a = after
  for (const key of ["status", "physicalState", "mentalState", "firstPerson"] as const) {
    if (b?.[key] !== a?.[key] && !(key === "status" && (b?.status ?? "active") === (a?.status ?? "active"))) out.push(key)
  }
  for (const key of ["attributes", "relationships", "addressTerms"] as const) {
    const bm = b?.[key] ?? {}
    const am = a?.[key] ?? {}
    const keys = [...new Set([...Object.keys(bm), ...Object.keys(am)])].filter((k) => bm[k] !== am[k])
    if (keys.length > 0) out.push(`${key}(${keys.join("・")})`)
  }
  const listNames = [...new Set([...Object.keys(b?.lists ?? {}), ...Object.keys(a?.lists ?? {})])]
  for (const name of listNames) {
    const bl = b?.lists[name] ?? []
    const al = a?.lists[name] ?? []
    const plus = al.filter((x) => !bl.includes(x)).length
    const minus = bl.filter((x) => !al.includes(x)).length
    if (plus > 0 || minus > 0) out.push(`lists.${name}(+${plus}/-${minus})`)
  }
  const eventsAt = (c?: ResolvedCharacter) => (c?.events ?? []).filter((e) => compareSections(e.at, at) === 0).map((e) => e.text)
  const be = eventsAt(b)
  const ae = eventsAt(a)
  const plus = ae.filter((x) => !be.includes(x)).length
  const minus = be.filter((x) => !ae.includes(x)).length
  if (plus > 0 || minus > 0) out.push(minus > 0 ? `events(+${plus}/-${minus})` : `events(+${plus})`)
  return out
}
