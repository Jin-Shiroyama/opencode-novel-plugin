import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { inspectLine, SIMPLIFIED, CHINESE_WORDS, SELF_TEST_CASES } from "./check-japanese.mjs"

/**
 * iconv で JIS X 0213 に収録されているかを調べる。
 * 収録されている字は日本語の文に正当に現れ得るので、簡体字の一覧に入れてはいけない。
 * iconv が使えない環境ではこの検証を飛ばす。
 */
function inJisX0213(ch) {
  try {
    execFileSync("iconv", ["-f", "UTF-8", "-t", "EUC-JISX0213"], {
      input: Buffer.from(ch, "utf-8"),
      stdio: ["pipe", "ignore", "ignore"],
    })
    return true
  } catch {
    return false
  }
}

function iconvAvailable() {
  try {
    execFileSync("iconv", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe("簡体字の一覧", () => {
  test("空ではない", () => {
    assert.ok(SIMPLIFIED.size > 500, `一覧が ${SIMPLIFIED.size} 字しかない`)
  })

  test("すべて漢字である", () => {
    const bad = [...SIMPLIFIED].filter((c) => !/^[\u4e00-\u9fff]$/u.test(c))
    assert.deepEqual(bad, [], `漢字でないものが混ざっている: ${bad.join("")}`)
  })

  test("JIS X 0213 の収録字を含まない（日本語の文を誤判定しないこと）", { skip: !iconvAvailable() }, () => {
    const leaked = [...SIMPLIFIED].filter(inJisX0213)
    assert.deepEqual(
      leaked,
      [],
      `日本語で使う字が ${leaked.length} 字混ざっている: ${leaked.join("")}\n` +
        `一覧を更新するときは JIS X 0213 の収録字を除くこと（scripts/check-japanese.mjs の説明を参照）`,
    )
  })

  test("高頻度の簡体字を網羅している", () => {
    for (const ch of [..."说们这时东车门问风马页见观应发节场转对实现"]) {
      assert.ok(SIMPLIFIED.has(ch), `${ch} が一覧に無い`)
    }
  })
})

describe("中国語の語の一覧", () => {
  test("単独の漢字を含まない", () => {
    // 「什」単独では日本語の「什器」に当たってしまう
    const single = CHINESE_WORDS.filter((w) => [...w].length < 2)
    assert.deepEqual(single, [], `単独の漢字が入っている: ${single.join(", ")}`)
  })
})

describe("日本語を誤検知しない", () => {
  const japanese = [
    ["JIS X 0213 の字", "彼は頰を押さえ、包みの薄紙を剝がした。"],
    ["常用漢字の新字", "塡めた駒を見て、剋目した。"],
    ["瘦・痩", "彼は瘦せた。少し痩せたとも書く。"],
    ["什器", "店の什器を片付けた。"],
    ["約物", "「待て！　行くな」――彼は走った……"],
    ["日中で共通の字", "国会の点検で、万事が的を射た。是非とも了解した。"],
    ["区・医・准・叶", "区役所の医師が准教授の願いを叶えた。"],
    ["関・復・開・異・種・確・離・適", "関係を復旧し、開示した異種の確率が離れて適う。"],
    ["毎・沈・歩・卓", "毎朝、沈んだ歩みで卓に向かう。"],
    ["本文の一節", "　放課後の職員室は、暖房を切ったあとの乾いた匂いがした。"],
    ["表記規約の説明", "三点リーダは「……」、ダッシュは「――」（U+2015 を2つ）"],
    ["法律の説明", "名誉毀損（刑法230条）とプライバシー権の侵害を避ける。"],
    ["時代小説の語", "免許皆伝の宗家が、脇差を逆手に抜いて鍔鳴りを立てた。"],
  ]

  for (const [label, text] of japanese) {
    test(label, () => {
      const found = inspectLine(text)
      assert.deepEqual(
        found,
        [],
        `誤検知: ${found.map((f) => `${f.kind}:${f.detail}`).join(", ")}\n  ${text}`,
      )
    })
  }
})

describe("中国語を検知する", () => {
  const chinese = [
    ["簡体字の文", "这是中文的句子，应该被检测出来。"],
    ["上流の文", "小说创作工作流程"],
    ["上流の agent 説明", "小说策划教练。像写作导师一样手把手指导非专业作者"],
    ["中国語式の引用符のみ", "これは“引用”です"],
    ["語のみ", "什么时候"],
    ["全角カンマのみ", "これは誤りです，はい"],
  ]

  for (const [label, text] of chinese) {
    test(label, () => {
      assert.ok(inspectLine(text).length > 0, `検知できていない: ${text}`)
    })
  }
})

describe("--self-test の判定表", () => {
  test("すべて期待どおり", () => {
    for (const [label, text, shouldFlag] of SELF_TEST_CASES) {
      const flagged = inspectLine(text).length > 0
      assert.equal(flagged, shouldFlag, `${label}: ${text}`)
    }
  })
})
