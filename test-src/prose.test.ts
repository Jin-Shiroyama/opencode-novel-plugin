import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { checkProse, summarizeProse, LONG_SENTENCE_CHARS } from "../src/prose.js"
import { novelCheckExecute } from "../src/tools/check.js"
import { novelSaveChapterExecute } from "../src/tools/save.js"
import { novelExportExecute } from "../src/tools/export.js"

/**
 * 文章の点検の単体テスト。一覧の正本は novel-writing skill の「AI くさい言い回しを避ける」。
 *
 * 拾うべきもの（できあいの言い回し・同じ文末の連続・長い文）を拾うことと、
 * 拾ってはいけないもの（会話の中、ステータス画面、skill の ✅ の作例）を拾わないことの両方を見る。
 */

const found = (text: string) => checkProse(text).map((i) => [i.rule, i.phrase ?? ""])
const rules = (text: string) => checkProse(text).map((i) => i.rule)

describe("できあいの言い回し", () => {
  test("地の文の語を、行と字の位置つきで拾う", () => {
    const [issue] = checkProse("# 第1章 朝\n\n　彼は思わず笑った。")
    assert.equal(issue.rule, "stock-phrase")
    assert.equal(issue.phrase, "思わず")
    assert.deepEqual([issue.line, issue.column], [3, 4])
    assert.match(issue.message, /「思わず」動作をそのまま書く/)
  })

  const cases: Array<[string, string]> = [
    ["　笑わずにはいられなかった。", "思わず"],
    ["　胸が熱くなった。", "胸が熱く・込み上げる"],
    ["　その瞬間、扉が開いた。", "その瞬間"],
    ["　世界が止まったようだった。", "世界が止まった"],
    ["　瞳に一瞬、悲しみの色が浮かんだ。", "目の奥・瞳の色"],
    ["　そうか、と心の中で呟いた。", "心の中で呟く"],
    ["　沈黙が降りた。", "静寂が支配・空気が張り詰める"],
    ["　言うまでもなく、彼は負けた。", "総括の語"],
    ["　ゴクリと喉を鳴らした。", "できあいの擬音"],
    ["　撤退を余儀なくされた。", "硬い漢語調"],
  ]
  for (const [text, phrase] of cases) {
    test(`${phrase}（${text.trim()}）`, () => assert.deepEqual(found(text), [["stock-phrase", phrase]]))
  }

  test("会話の中は見ない（行に挟まった台詞も）", () => {
    assert.deepEqual(checkProse("「思わず笑っちゃった」\n　彼女は「その瞬間に決めたの」と言って席を立つ。"), [])
  })

  test("ルビの記法を外した文で探し、位置は元の行で返す", () => {
    const [issue] = checkProse("　｜彼《かれ》は思わず笑った。")
    assert.equal(issue.column, 9)
    // 読みの中の語は拾わない
    assert.deepEqual(checkProse("　｜咄嗟《思わず》に手が出る。"), [])
  })

  test("回数の決まりがある語は、超えた分だけ拾う", () => {
    // 「まるで・かのよう」は2回まで
    assert.deepEqual(checkProse("　まるで石だ。\n\n「え」\n\n　まるで壁だ。"), [])
    const over = checkProse("　まるで石だ。\n\n「え」\n\n　まるで壁だ。\n\n「は」\n\n　まるで山だ。")
    assert.equal(over.length, 1)
    assert.equal(over[0].line, 9)
    assert.match(over[0].message, /この章に3回（2回まで）/)
    // 「息を呑む」は1回まで
    assert.deepEqual(found("　息を呑んだ。"), [])
    assert.equal(checkProse("　息を呑んだ。\n「え」\n　言葉を失った。").length, 1)
    // 副詞は3回まで
    assert.deepEqual(found("　そっと置く。そっと開く。そっと閉じる。"), [])
    assert.equal(checkProse("　そっと置く。そっと開く。そっと閉じる。そっと出る。").filter((i) => i.rule === "stock-phrase").length, 1)
  })

  test("語りの声として使う「つまり」と、ふつうの過去形の「であった」は拾わない", () => {
    assert.deepEqual(checkProse("　つまり、あの6人の横を通る必要がある。\n　父は教師であった。"), [])
  })
})

describe("同じ文末の連続", () => {
  test("「〜た。」が4文続いたら、始まりの文の位置で1件拾う", () => {
    const issues = checkProse("　森田は立ち上がった。窓の外を見た。雨が降っていた。傘を持ってこなかったことを思い出した。ため息をついた。")
    assert.equal(issues.length, 1)
    assert.equal(issues[0].rule, "repeated-ending")
    assert.deepEqual([issues[0].line, issues[0].column], [1, 2])
    assert.match(issues[0].message, /「〜た。」で終わる文が5文続いています/)
  })

  test("3文までは拾わない。体言止め・違う文末・感嘆符で切れる", () => {
    assert.deepEqual(rules("　立ち上がった。窓の外を見た。雨が降っていた。"), [])
    assert.deepEqual(rules("　立ち上がった。窓の外を見た。雨。傘は家に置いてきた。ため息が出た。"), [])
    assert.deepEqual(rules("　立ち上がった。窓の外を見た。雨が降っている。傘を忘れた。ため息が出た。"), [])
    assert.deepEqual(rules("　立ち上がった。窓の外を見た。嘘だろ！　傘を忘れた。ため息が出た。"), [])
  })

  test("1文だけの段落が続く書き方でも拾う（空行では切らない）", () => {
    assert.deepEqual(rules("　扉を開けた。\n\n　中に入った。\n\n　誰もいなかった。\n\n　帰ることにした。"), ["repeated-ending"])
  })

  test("会話行・区切りの行・ステータス画面の行で切る", () => {
    assert.deepEqual(rules("　扉を開けた。中に入った。\n「誰だ」\n　誰もいなかった。帰ることにした。"), [])
    assert.deepEqual(rules("　扉を開けた。中に入った。\n◇\n　誰もいなかった。帰ることにした。"), [])
    assert.deepEqual(rules("　扉を開けた。中に入った。\n【ステータス】\n名前：ミナト\n　誰もいなかった。帰ることにした。"), [])
  })
})

describe("長い文", () => {
  const long = `　${"彼は歩き、".repeat(16)}止まった。`

  test(`${LONG_SENTENCE_CHARS}文字を超える文を拾う`, () => {
    const [issue] = checkProse(long)
    assert.equal(issue.rule, "long-sentence")
    assert.match(issue.message, /1文が84文字あります/)
  })

  test("ちょうど80文字は拾わない。会話行と画面の行は見ない", () => {
    assert.deepEqual(checkProse(`　${"あ".repeat(80)}。`), [])
    assert.deepEqual(checkProse(`「${"あ".repeat(120)}」`), [])
    assert.deepEqual(checkProse(`説明：${"あ".repeat(120)}`), [])
  })
})

describe("まとめ", () => {
  test("種類ごとの件数と、言い回しの内訳（多い順）", () => {
    const issues = checkProse("　思わず笑った。思わず泣いた。その瞬間、扉が開く。")
    assert.deepEqual(summarizeProse(issues), [{ rule: "stock-phrase", count: 3, detail: "思わず 2、その瞬間 1" }])
  })
})

describe("skill の作例", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const skill = (name: string) => readFileSync(join(here, "..", "skills", name, "SKILL.md"), "utf-8")
  const quoted = (md: string, mark: string) =>
    [...md.matchAll(new RegExp(`${mark}[^\\n]*\\n((?:> [^\\n]*\\n)+)`, "g"))].map((m) => m[1].replace(/^> /gm, ""))

  test("✅ の作例と、書き出しの作例からは何も拾わない", () => {
    for (const name of ["novel-writing", "novel-webnovel"]) {
      for (const text of quoted(skill(name), "✅")) assert.deepEqual(checkProse(text), [], text)
    }
    // 字下げした地の文で始まるコードブロック（書き出しの一例、通し作例の本文、書式の作例）
    for (const name of ["novel-writing", "novel-webnovel", "novel-workflow"]) {
      for (const m of skill(name).matchAll(/```(?:text)?\n(　[\s\S]*?)```/g)) assert.deepEqual(checkProse(m[1]), [], m[1])
    }
  })

  test("❌ の「AI くさい書き方」の作例からは拾う", () => {
    const bad = quoted(skill("novel-writing"), "❌")
    assert.ok(checkProse(bad[0]).some((i) => i.phrase === "思わず"))
    // 例4：同じ文末が続いている
    assert.ok(checkProse(bad[3]).some((i) => i.rule === "repeated-ending"))
    const web = quoted(skill("novel-webnovel"), "❌")
    assert.ok(checkProse(web[2]).some((i) => i.phrase === "その瞬間"))
  })
})

describe("ツールへの組み込み", () => {
  const config = JSON.stringify({
    title: "迷宮の街", genre: "異世界ファンタジー", targetWords: 120000, chapterCount: 40,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", currentPhase: "writing",
  })
  function makeProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "novel-prose-"))
    for (const [rel, body] of Object.entries({ "config.json": config, ...files })) {
      const path = join(dir, ".novel", rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body, "utf-8")
    }
    return dir
  }
  const ctx = (dir: string) => ({ directory: dir }) as any
  const BAD = "　彼は思わず笑った。その瞬間、扉が開いた。"

  test("novel_check は表記のあとに、文章の点検を別の節で並べる", async () => {
    const dir = makeProject({ "chapters/chapter-001.md": `# 第1章 朝\n\n${BAD}\n「行こう。」\n` })
    const out = await novelCheckExecute({ chapterNumber: 1 }, ctx(dir))
    assert.match(out, /📝 表記の点検（第1章）: ❌ 規約違反 1件 \/ ⚠️ 確認 0件/)
    assert.match(out, /✍️ 文章の点検（第1章）: ⚠️ 確認 2件/)
    assert.match(out, /- ⚠️ できあいの言い回し: 2件（思わず 1、その瞬間 1）/)
    assert.match(out, /⚠️ 3行4字目［できあいの言い回し］「思わず」/)
    assert.ok(out.indexOf("📝 表記の点検") < out.indexOf("✍️ 文章の点検"))
  })

  test("表記に問題が無くても、文章で拾ったものは出す。どちらも無ければこれまでどおり", async () => {
    const dir = makeProject({
      "chapters/chapter-001.md": `# 第1章 朝\n\n${BAD}\n`,
      "chapters/chapter-002.md": "# 第2章 昼\n\n　扉が開く。風が入った。\n",
    })
    const one = await novelCheckExecute({ chapterNumber: 1 }, ctx(dir))
    assert.match(one, /^✅ 表記の点検（第1章）: 規約から外れた箇所はありません。\n\n✍️ 文章の点検（第1章）: ⚠️ 確認 2件/)
    assert.equal(await novelCheckExecute({ chapterNumber: 2 }, ctx(dir)), "✅ 表記の点検（第2章）: 規約から外れた箇所はありません。")
  })

  test("maxIssues は文章の点検にも効き、件数はすべて数える", async () => {
    const dir = makeProject({ "chapters/chapter-001.md": `# 第1章 朝\n\n${BAD}\n` })
    const out = await novelCheckExecute({ chapterNumber: 1, maxIssues: 1 }, ctx(dir))
    assert.match(out, /確認 2件/)
    assert.match(out, /…ほか1件/)
  })

  test("novel_save_chapter は、拾ったときだけ1行で添える", async () => {
    const dir = makeProject({})
    const bad = await novelSaveChapterExecute({ chapterNumber: 1, title: "朝", content: BAD } as any, ctx(dir))
    assert.match(bad, /📝 表記: 規約から外れた箇所はありません/)
    assert.match(bad, /✍️ 文章: ⚠️ 確認 2件（できあいの言い回し 2：思わず 1、その瞬間 1）/)
    assert.match(bad, /novel_check\(chapterNumber: 1\)/)
    const good = await novelSaveChapterExecute({ chapterNumber: 2, title: "昼", content: "　扉が開く。風が入った。" } as any, ctx(dir))
    assert.doesNotMatch(good, /✍️ 文章/)
  })

  test("novel_export の報告には影響しない（数えるのは表記の規約違反だけ）", async () => {
    const dir = makeProject({ "chapters/chapter-001.md": `# 第1章 朝\n\n${BAD}\n` })
    assert.doesNotMatch(await novelExportExecute({}, ctx(dir)), /規約違反|文章/)
  })
})
