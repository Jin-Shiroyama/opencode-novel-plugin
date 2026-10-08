import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  countWords,
  truncateChars,
  takeTailChars,
  isMartialArtsGenre,
  usesMartialArtsSetting,
  parseChapterNumber,
  parseScenes,
  isDocFilled,
  determinePhase,
  resolveLimit,
  countWrittenChapters,
  progressBar,
} from "./utils.js"
import { LIMITS } from "./constants.js"

// ============================================================
// countWords — 空白・改行を除いた全文字数
// ============================================================

describe("countWords", () => {
  test("ひらがなを1文字ずつ数える", () => {
    assert.equal(countWords("あいうえお"), 5)
  })

  test("カタカナを1文字ずつ数える", () => {
    assert.equal(countWords("アイウエオ"), 5)
    assert.equal(countWords("コーヒー"), 4) // 長音符も1文字
  })

  test("漢字を1文字ずつ数える", () => {
    assert.equal(countWords("日本語小説"), 5)
  })

  test("かな・カナ・漢字・記号の混在を正しく数える", () => {
    const text = "「おはよう」と彼は言った。"
    // 「 お は よ う 」 と 彼 は 言 っ た 。 = 13
    assert.equal(countWords(text), 13)
  })

  test("三点リーダとダッシュを数える", () => {
    // 三点リーダ「……」は2文字、ダッシュ「――」は2文字として数える
    assert.equal(countWords("……"), 2)
    assert.equal(countWords("――"), 2)
    assert.equal(countWords("そんな……まさか――"), 10)
  })

  test("約物（句読点・括弧）を数に含める", () => {
    assert.equal(countWords("、。！？「」『』"), 8)
  })

  test("半角英数字を1文字ずつ数える（単語単位ではない）", () => {
    assert.equal(countWords("abc"), 3)
    assert.equal(countWords("Tokyo2026"), 9)
  })

  test("半角スペース・改行・タブを除外する", () => {
    assert.equal(countWords("あ い\tう\nえ\r\nお"), 5)
  })

  test("全角スペース（字下げ）を除外する", () => {
    assert.equal(countWords("　吾輩は猫である"), 7)
  })

  test("ノーブレークスペース・ゼロ幅スペース・BOM を除外する", () => {
    assert.equal(countWords("あ い​う﻿"), 3)
  })

  test("サロゲートペアを1文字として数える", () => {
    assert.equal(countWords("𠮟"), 1) // U+20B9F
    assert.equal(countWords("𩸽を焼く"), 4) // 𩸽 + を + 焼 + く
  })

  test("空文字列と空白のみは0", () => {
    assert.equal(countWords(""), 0)
    assert.equal(countWords("   \n　  "), 0)
  })

  test("日本語の原稿1行を実文字数で数える", () => {
    const line = "　雨は夜半から降りはじめ、駅前のロータリーはすっかり濡れていた。"
    // 字下げの全角スペースを除いた本文の文字数
    assert.equal(countWords(line), [...line].length - 1)
  })

  test("上流実装の弱点が解消されている（仮名が0にならない）", () => {
    const kanaOnly = "そのとき、かれはふりかえった"
    assert.ok(countWords(kanaOnly) > 0)
    assert.equal(countWords(kanaOnly), 14)
  })
})

// ============================================================
// truncateChars / takeTailChars
// ============================================================

describe("truncateChars", () => {
  test("上限以内なら打ち切らない", () => {
    assert.deepEqual(truncateChars("あいう", 5), ["あいう", false])
  })

  test("上限を超えたら先頭から切り出す", () => {
    assert.deepEqual(truncateChars("あいうえお", 3), ["あいう", true])
  })

  test("サロゲートペアを割らない", () => {
    const [cut] = truncateChars("𠮟𠮟𠮟", 2)
    assert.equal([...cut].length, 2)
    assert.equal(cut, "𠮟𠮟")
  })
})

describe("takeTailChars", () => {
  test("末尾から切り出す", () => {
    assert.equal(takeTailChars("あいうえお", 2), "えお")
  })

  test("上限以内ならそのまま返す", () => {
    assert.equal(takeTailChars("あい", 5), "あい")
  })

  test("サロゲートペアを割らない", () => {
    assert.equal(takeTailChars("あ𠮟い𠮟", 2), "い𠮟")
  })
})

// ============================================================
// isMartialArtsGenre — 誤検知しないこと
// ============================================================

describe("isMartialArtsGenre", () => {
  for (const genre of ["剣豪小説", "剣客商売もの", "武侠", "チャンバラ時代劇", "時代活劇", "剣戟アクション"]) {
    test(`判定する: ${genre}`, () => {
      assert.equal(isMartialArtsGenre(genre), true)
    })
  }

  for (const genre of [
    "時代小説",
    "武士の家計簿風",
    "武装戦記",
    "武闘派サラリーマン",
    "武家の人情物",
    "文武両道の学園もの",
    "現代ドラマ",
    "ミステリ",
    "異世界ファンタジー",
    "功夫映画のような",
  ]) {
    test(`誤検知しない: ${genre}`, () => {
      assert.equal(isMartialArtsGenre(genre), false)
    })
  }

  test("全角・区切り記号を正規化して判定する", () => {
    assert.equal(isMartialArtsGenre("時代小説・剣豪"), true)
    assert.equal(isMartialArtsGenre("［剣豪］"), true)
    assert.equal(isMartialArtsGenre("時代小説（剣　豪）"), true) // 区切りの空白は除去して判定する
    assert.equal(isMartialArtsGenre("時代小説（人情物）"), false)
  })

  test("未指定・空文字は false", () => {
    assert.equal(isMartialArtsGenre(undefined), false)
    assert.equal(isMartialArtsGenre(null), false)
    assert.equal(isMartialArtsGenre(""), false)
  })
})

describe("usesMartialArtsSetting", () => {
  test("明示指定が最優先される", () => {
    assert.equal(usesMartialArtsSetting({ genre: "現代ドラマ", martialArtsSetting: true }), true)
    assert.equal(usesMartialArtsSetting({ genre: "剣豪小説", martialArtsSetting: false }), false)
  })

  test("未指定ならジャンルから推定する", () => {
    assert.equal(usesMartialArtsSetting({ genre: "剣豪小説" }), true)
    assert.equal(usesMartialArtsSetting({ genre: "武装戦記" }), false)
  })
})

// ============================================================
// parseChapterNumber — 算用数字・全角数字・漢数字
// ============================================================

describe("parseChapterNumber", () => {
  test("算用数字", () => {
    assert.equal(parseChapterNumber("1"), 1)
    assert.equal(parseChapterNumber("12"), 12)
    assert.equal(parseChapterNumber(" 40 "), 40)
  })

  test("全角数字", () => {
    assert.equal(parseChapterNumber("１"), 1)
    assert.equal(parseChapterNumber("２３"), 23)
  })

  test("漢数字", () => {
    assert.equal(parseChapterNumber("一"), 1)
    assert.equal(parseChapterNumber("十"), 10)
    assert.equal(parseChapterNumber("十二"), 12)
    assert.equal(parseChapterNumber("二十"), 20)
    assert.equal(parseChapterNumber("二十三"), 23)
    assert.equal(parseChapterNumber("百"), 100)
    assert.equal(parseChapterNumber("百五"), 105)
    assert.equal(parseChapterNumber("三百二十一"), 321)
    assert.equal(parseChapterNumber("千"), 1000)
    assert.equal(parseChapterNumber("一千二百三十四"), 1234)
  })

  test("読み取れないものは null", () => {
    assert.equal(parseChapterNumber("序章"), null)
    assert.equal(parseChapterNumber(""), null)
    assert.equal(parseChapterNumber("あ"), null)
  })
})

// ============================================================
// parseScenes
// ============================================================

describe("parseScenes", () => {
  const content = [
    "## 第一幕",
    "### 1.1 雨の駅",
    "- [x] **状態**：完了",
    "- **種別**：行動シーン",
    "### 1.2 置き忘れた傘",
    "- [-] **状態**：執筆中",
    "### シーン2.1 聞き込み",
    "- [ ] **状態**：未着手",
    "### Scene 2.2 - 市役所",
    "- [ ] **状態**：未着手",
  ].join("\n")

  test("日本語・英語いずれの見出し表記でも拾う", () => {
    const scenes = parseScenes(content)
    assert.deepEqual(
      scenes.map((s) => s.id),
      ["1.1", "1.2", "2.1", "2.2"],
    )
  })

  test("タイトルを取り出す", () => {
    const scenes = parseScenes(content)
    assert.equal(scenes[0].title, "雨の駅")
    assert.equal(scenes[3].title, "市役所")
  })

  test("チェックボックスから状態を読む", () => {
    const scenes = parseScenes(content)
    assert.deepEqual(
      scenes.map((s) => s.status),
      ["completed", "in-progress", "pending", "pending"],
    )
  })
})

// ============================================================
// isDocFilled / determinePhase
// ============================================================

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-test-"))
  mkdirSync(join(dir, ".novel", "characters"), { recursive: true })
  return dir
}

function writeDoc(dir: string, relative: string, body: string): void {
  const path = join(dir, ".novel", relative)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, body, "utf-8")
}

describe("isDocFilled", () => {
  test("存在しないファイルは未記入", () => {
    const dir = makeProject()
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), false)
  })

  test("空ファイルは未記入", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", "   \n\n")
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), false)
  })

  test("角括弧のプレースホルダが残っていれば未記入", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", "# コンセプト\n\n## ログライン\n[ここに書く]\n")
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), false)
  })

  test("記入済みなら true", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", "# コンセプト\n\n## ログライン\n雨の夜、教師が生徒の嘘に気づく。\n")
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), true)
  })

  test("チェックボックスはプレースホルダと見なさない", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", "# コンセプト\n\n- [ ] 推敲する\n- [x] 初稿\n- [-] 保留\n")
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), true)
  })

  test("Markdown リンクはプレースホルダと見なさない", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", "# コンセプト\n\n参考: [取材メモ](reality-source.md)\n")
    assert.equal(isDocFilled(join(dir, ".novel", "concept.md")), true)
  })
})

describe("determinePhase", () => {
  const filled = (name: string) => `# ${name}\n\n書き終えた内容。\n`
  const blank = (name: string) => `# ${name}\n\n[ここに書く]\n`

  test("雛形のまま（novel_init 直後）は concept", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", blank("コンセプト"))
    writeDoc(dir, "world-building.md", blank("世界観"))
    writeDoc(dir, "characters/profiles.md", blank("人物"))
    assert.equal(determinePhase(dir), "concept")
  })

  test("コンセプトだけ記入済みなら world-building", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", blank("世界観"))
    writeDoc(dir, "characters/profiles.md", blank("人物"))
    assert.equal(determinePhase(dir), "world-building")
  })

  test("世界観まで記入済みなら characters を返す", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", blank("人物"))
    assert.equal(determinePhase(dir), "characters")
  })

  test("人物まで記入済みなら outline", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", filled("人物"))
    assert.equal(determinePhase(dir), "outline")
  })

  test("プロット概要だけでは outline のまま", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", filled("人物"))
    writeDoc(dir, "outline-brief.md", filled("プロット概要"))
    assert.equal(determinePhase(dir), "outline")
  })

  test("章別プロットまで揃えば scenes", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", filled("人物"))
    writeDoc(dir, "outline-brief.md", filled("プロット概要"))
    writeDoc(dir, "outline-detailed.md", filled("章別プロット"))
    assert.equal(determinePhase(dir), "scenes")
  })

  test("シーン一覧ができたら writing（本文未着手でも）", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", filled("人物"))
    writeDoc(dir, "outline-brief.md", filled("プロット概要"))
    writeDoc(dir, "outline-detailed.md", filled("章別プロット"))
    writeDoc(dir, "scenes.md", filled("シーン一覧"))
    assert.equal(determinePhase(dir), "writing")
  })

  test("予定章数に達したら completed を返す", () => {
    const dir = makeProject()
    writeDoc(dir, "concept.md", filled("コンセプト"))
    writeDoc(dir, "world-building.md", filled("世界観"))
    writeDoc(dir, "characters/profiles.md", filled("人物"))
    writeDoc(dir, "outline-brief.md", filled("プロット概要"))
    writeDoc(dir, "outline-detailed.md", filled("章別プロット"))
    writeDoc(dir, "scenes.md", filled("シーン一覧"))
    writeDoc(dir, "chapters/chapter-001.md", "# 第1章 雨\n\n本文。\n")
    writeDoc(dir, "chapters/chapter-002.md", "# 第2章 傘\n\n本文。\n")

    const base = {
      title: "テスト",
      genre: "現代ドラマ",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      currentPhase: "writing" as const,
    }
    assert.equal(determinePhase(dir, { ...base, chapterCount: 2 }), "completed")
    assert.equal(determinePhase(dir, { ...base, chapterCount: 40 }), "writing")
  })
})

describe("countWrittenChapters", () => {
  test("chapter-NNN.md だけを数える", () => {
    const dir = makeProject()
    writeDoc(dir, "chapters/chapter-001.md", "本文")
    writeDoc(dir, "chapters/chapter-002.md", "本文")
    writeDoc(dir, "chapters/メモ.md", "メモ")
    assert.equal(countWrittenChapters(dir), 2)
  })

  test("ディレクトリがなければ0", () => {
    const dir = makeProject()
    assert.equal(countWrittenChapters(dir), 0)
  })
})

// ============================================================
// resolveLimit
// ============================================================

describe("resolveLimit", () => {
  const base = {
    title: "テスト",
    genre: "現代ドラマ",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPhase: "writing" as const,
  }

  test("config に指定がなければ既定値", () => {
    assert.equal(resolveLimit(null, "previousChapterTail"), LIMITS.previousChapterTail)
    assert.equal(resolveLimit({ ...base }, "characterProfiles"), LIMITS.characterProfiles)
  })

  test("config.limits で上書きできる", () => {
    assert.equal(resolveLimit({ ...base, limits: { previousChapterTail: 500 } }, "previousChapterTail"), 500)
  })

  test("不正な値は無視して既定値を使う", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        resolveLimit({ ...base, limits: { previousChapterTail: bad } }, "previousChapterTail"),
        LIMITS.previousChapterTail,
      )
    }
  })

  test("小数は切り捨てる", () => {
    assert.equal(resolveLimit({ ...base, limits: { summary: 1234.9 } }, "summary"), 1234)
  })
})

// ============================================================
// progressBar
// ============================================================

describe("progressBar", () => {
  test("総数0でも落ちない", () => {
    assert.match(progressBar(0, 0), /0%/)
  })

  test("割合を表示する", () => {
    assert.match(progressBar(1, 4), /25% \(1\/4\)/)
  })
})
