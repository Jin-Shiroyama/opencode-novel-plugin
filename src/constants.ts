/**
 * opencode-novel-plugin - 既定値と上限値
 *
 * 既定値はここだけに置く。各ツール・テンプレートからは必ず本モジュールを参照する。
 * （以前は targetWords / chapterCount / narrativePerspective が 4〜5 箇所に
 *   ハードコードされており、片方だけ直すと食い違う状態だった）
 */

/** プロジェクト既定値 */
export const DEFAULTS = {
  /** 目標総文字数。文庫1冊が 10〜12 万文字なので長編の標準値として 12 万 */
  targetWords: 120000,
  /** 予定章数。120000 / 40 = 1章 3,000 文字 */
  chapterCount: 40,
  /** 叙述の視点 */
  narrativePerspective: "三人称一元視点",
} as const

/**
 * 短編（config.json の form が "short"）の既定値。
 * 2万文字は400字詰め原稿用紙でおよそ50〜60枚。章は分けない（1本の本文。内部では第1章1つ）
 */
export const SHORT_DEFAULTS = {
  targetWords: 20000,
  chapterCount: 1,
} as const

/**
 * novel_context が各資料から読み込む文字数の上限。
 * 単位はコードポイント数（絵文字・サロゲートペアも1文字）。
 * 日本語は仮名を含むため同じ情報量でも中国語より文字数が増える。
 * そのため上流（中国語版）の 1500 / 3000 / 2000 から倍程度に引き上げてある。
 */
export const LIMITS = {
  /** 前章末尾の引き継ぎ分量 */
  previousChapterTail: 1200,
  /** キャラクターシート */
  characterProfiles: 6000,
  /** これまでのあらすじ */
  summary: 4000,
  /** 剣術・技の設定 */
  martialArts: 6000,
  /** 流派・勢力の設定 */
  sects: 4000,
  /** 刀剣の設定 */
  weapons: 4000,
  /** 取材メモ（現実の素材） */
  realitySource: 6000,
  /** この章のシーン一覧（_Prompt を含む） */
  scenes: 4000,
  /** ことばづかいの一覧（一人称・二人称・相手ごとの呼び方） */
  speech: 1500,
  /** プロット概要（短編で章別プロットが無いとき、序破急の骨組みとして載せる） */
  outlineBrief: 4000,
} as const

export type LimitKey = keyof typeof LIMITS

/**
 * 「流派・武芸設定」を使うジャンルの判定キーワード。
 *
 * 上流は `genre.includes("武")` で判定していたため、日本語では
 * 「武士」「武装」「武家」「武闘派」などに軒並み誤爆した。
 * ここでは 2 文字以上かつ他の語に埋もれないキーワードだけを並べる。
 * 「時代小説」は市井物（人情物）も含むため単独では判定に使わない。
 */
export const MARTIAL_ARTS_GENRE_KEYWORDS = [
  "剣豪",
  "剣客",
  "武侠",
  "チャンバラ",
  "時代活劇",
  "剣戟",
] as const

/**
 * 未着手の伏線を知らせはじめる章数。
 *
 * 伏線を知らせるかどうかの決まりは次のとおり。判定は utils.ts の
 * selectForeshadowReminders にある。
 *
 *   resolved / abandoned  知らせない（終わっているため）
 *   planted               回収予定にかかわらず常に知らせる（忘れないため）
 *   pending               回収予定を過ぎた・この章・この章数以内なら知らせる。
 *                         回収予定が未定か、この章数より先なら知らせない
 *
 * 未着手で遠いものを毎章並べると目が滑って、いま扱うべきものが埋もれる。
 */
export const FORESHADOW_LOOKAHEAD = 3

/** 1章あたりの推奨文字数レンジ（プロンプトの表示用） */
export const CHAPTER_LENGTH = {
  min: 3000,
  max: 6000,
  /** 山場の章で許容する上限 */
  peak: 8000,
} as const

/** 1章の目標文字数に許容する振れ幅（比率） */
export const CHAPTER_WORD_TOLERANCE = 0.1
