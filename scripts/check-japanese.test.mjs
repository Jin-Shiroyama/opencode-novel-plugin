import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  inspectLine,
  isMainModule,
  SIMPLIFIED,
  CHINESE_WORDS,
  SELF_TEST_CASES,
} from "./check-japanese.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-japanese.mjs")

/**
 * iconv で JIS X 0213 に収録されているかを調べる。
 * 収録されている字は日本語の文に正当に現れ得るので、簡体字の一覧に入れてはいけない。
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

/**
 * この環境の iconv が JIS X 0213 の判定に使えるかを確かめる。
 *
 * `iconv --version` が通るだけでは足りない。EUC-JISX0213 に対応していない
 * 環境では変換がすべて失敗し、全字が「未収録」と扱われる。すると
 * 「収録字が混ざっていないこと」の検証が空振りして必ず成功してしまう。
 *
 * そこで両方向を確かめる。
 *   - 収録されている字（瘦・頰・剝・塡）が変換できること
 *   - 収録されていない字（说・这）が変換できないこと
 * どちらかが崩れていれば判定に使えないので、検証を飛ばす。
 */
function jisX0213Usable() {
  try {
    execFileSync("iconv", ["--version"], { stdio: "ignore" })
  } catch {
    return false
  }
  const included = [..."瘦頰剝塡"]
  const excluded = [..."说这"]
  return included.every(inJisX0213) && excluded.every((c) => !inJisX0213(c))
}

const JISX0213_READY = jisX0213Usable()

describe("簡体字の一覧", () => {
  test("空ではない", () => {
    assert.ok(SIMPLIFIED.size > 500, `一覧が ${SIMPLIFIED.size} 字しかない`)
  })

  test("すべて漢字である", () => {
    const bad = [...SIMPLIFIED].filter((c) => !/^[\u4e00-\u9fff]$/u.test(c))
    assert.deepEqual(bad, [], `漢字でないものが混ざっている: ${bad.join("")}`)
  })

  test("JIS X 0213 の収録字を含まない（日本語の文を誤判定しないこと）", {
    skip: JISX0213_READY ? false : "iconv が EUC-JISX0213 を扱えないため判定できない",
  }, () => {
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

describe("JIS X 0213 の判定そのもの", () => {
  test("この環境で判定に使える（使えなければ一覧の検証は飛ばされる）", () => {
    // 判定が使えない環境では一覧の検証が空振りする。使えるかどうかを明示的に残す。
    if (!JISX0213_READY) {
      console.log("  ※ iconv が EUC-JISX0213 を扱えないため、一覧の検証は飛ばされます")
    }
    assert.equal(typeof JISX0213_READY, "boolean")
  })

  test("収録字と未収録字を取り違えない", { skip: !JISX0213_READY }, () => {
    for (const ch of [..."瘦痩頰剝塡"]) {
      assert.ok(inJisX0213(ch), `${ch} は JIS X 0213 の収録字なので変換できるはず`)
    }
    for (const ch of [..."说们这时东门"]) {
      assert.ok(!inJisX0213(ch), `${ch} は JIS X 0213 に無いので変換できないはず`)
    }
  })
})

describe("isMainModule", () => {
  test("同じパスなら true", () => {
    assert.equal(isMainModule("/tmp/a/b.mjs", "file:///tmp/a/b.mjs"), true)
  })

  test("違うパスなら false", () => {
    assert.equal(isMainModule("/tmp/a/b.mjs", "file:///tmp/a/c.mjs"), false)
  })

  test("# を含むパスでも一致する", () => {
    // new URL("file://" + path) では # 以降がフラグメントとして切り落とされ、
    // 一致しなくなる（CLI が走らず無言で終了コード 0 を返す）
    assert.equal(isMainModule("/tmp/a#b/c.mjs", "file:///tmp/a%23b/c.mjs"), true)
  })

  test("? や空白や日本語を含むパスでも一致する", () => {
    assert.equal(isMainModule("/tmp/a?b/c.mjs", "file:///tmp/a%3Fb/c.mjs"), true)
    assert.equal(isMainModule("/tmp/a b/c.mjs", "file:///tmp/a%20b/c.mjs"), true)
    assert.equal(isMainModule("/tmp/作品/c.mjs", "file:///tmp/%E4%BD%9C%E5%93%81/c.mjs"), true)
  })

  test("引数がなければ false（モジュールとして読み込んだとき）", () => {
    assert.equal(isMainModule(undefined, "file:///tmp/a/b.mjs"), false)
    assert.equal(isMainModule("", "file:///tmp/a/b.mjs"), false)
  })
})

describe("CLI", () => {
  /** 一時ディレクトリにスクリプトを置き、与えた本文を検査させる */
  function runIn(dirName, body) {
    const dir = join(mkdtempSync(join(tmpdir(), "ck-")), dirName)
    mkdirSync(dir, { recursive: true })
    copyFileSync(SCRIPT, join(dir, "check-japanese.mjs"))
    writeFileSync(join(dir, "target.md"), body, "utf-8")
    try {
      const stdout = execFileSync(process.execPath, ["check-japanese.mjs", "target.md"], {
        cwd: dir,
        encoding: "utf-8",
      })
      return { code: 0, stdout }
    } catch (e) {
      return { code: e.status, stdout: String(e.stdout ?? "") }
    }
  }

  test("中国語を見つけたら終了コード 1 を返す", () => {
    const r = runIn("plain", "这是中文的句子\n")
    assert.equal(r.code, 1)
    assert.match(r.stdout, /簡体字/)
  })

  test("日本語だけなら終了コード 0 を返す", () => {
    const r = runIn("plain", "彼は瘦せた。店の什器を片付けた。\n")
    assert.equal(r.code, 0)
    assert.match(r.stdout, /残存はありません/)
  })

  for (const dirName of ["a#b", "a b", "作品"]) {
    test(`パスに「${dirName}」が含まれても検査する`, () => {
      // # を含むパスで CLI が走らず、無言で成功していた回帰
      const r = runIn(dirName, "这是中文的句子\n")
      assert.equal(r.code, 1, `検査されずに素通りした（出力: ${JSON.stringify(r.stdout)}）`)
      assert.match(r.stdout, /簡体字/)
    })
  }
})
