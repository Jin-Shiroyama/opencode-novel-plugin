#!/usr/bin/env node
/**
 * 中国語の文字列が残っていないかを調べる。
 *
 * 三段で見る。
 *
 *  第一段（主）: 日本語に存在しない字形
 *    漢字を一文字ずつ CP932（日本語のレガシー符号化）へ変換してみて、
 *    変換できない字を「日本語では使われない字形」として挙げる。
 *    簡体字のうち日本の新字体・旧字体と形が違うもの（说 们 这 时 东 车 门 问 风 马
 *    页 见 观 应 発→发 节 场 转 对 实 现 など）がここで捕まる。
 *    中国語の一文がこれを一字も含まない確率は実務上ゼロに近い。
 *    逆に、日本語でも使う字（国 会 点 万 的 是 了 など）は CP932 に収まるので
 *    誤検知しない。
 *
 *  第二段: 中国語式の約物
 *    “ ” ‘ ’（日本語は「」『』）、，（日本語は、）、；など。
 *
 *  第三段: 日本語では使わない語
 *    CP932 に収まる字だけでできた中国語の語を、短い一覧で突き合わせる。
 *    第一段の網をすり抜けるわずかな場合に備えた保険。
 *
 * 意図的に残す箇所は ALLOW に書く。
 *
 * 使い方:
 *   node scripts/check-japanese.mjs            # 既定の対象を調べる
 *   node scripts/check-japanese.mjs <path...>  # 対象を指定する
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, extname, sep } from "node:path"

const ROOT = process.cwd()

/** 調べる対象（ディレクトリは再帰的にたどる） */
const DEFAULT_TARGETS = ["src", "commands", "skills", "scripts", "README.md", "README.ja.md", "AGENTS.md", "package.json"]

/** たどらないディレクトリ */
const SKIP_DIRS = new Set(["node_modules", "dist", "test-out", ".git"])

/**
 * 検査しないファイル。
 * このスクリプト自身は、探す対象そのものを例として本文に持っているため除く。
 */
const SKIP_FILES = new Set(["scripts/check-japanese.mjs"])

/** 調べる拡張子 */
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".md", ".json", ".yml", ".yaml"])

/**
 * 意図的に残す箇所。
 *
 *   { file, line, reason }     … その行を除く（行がずれると効かなくなる）
 *   { file, contains, reason } … その文字列を含む行を除く（行がずれても効く。こちらを推奨）
 *
 * LICENSE は AGPL-3.0 の原文なので対象に含めていない。
 * 上流プロジェクト名（novel-workflow-mcp / AI_NovelGenerator / MuMuAINovel）と
 * 作者名はいずれも ASCII なので、謝辞を日本語で書けば除外は要らない。
 */
const ALLOW = [
  {
    file: "README.ja.md",
    contains: "\u2192 プロット\uFF0F",
    reason: "上流との差分を示す用語対応表。何をどう訳したかを記録するため原語を引用している",
  },
]

/** 日本語では使わない語（CP932 に収まる字だけでできているもの） */
const CHINESE_WORDS = [
  "没有", "什", "咱", "俺们", "甚麼", "怎麽", "為什", "哪里", "哪兒",
  "一下子", "的话", "之后", "之前就", "不要紧", "有点儿",
  "請問", "謝謝", "再見", "對不起",
]

/** 中国語式の約物 */
const PUNCTUATION = [
  { ch: "“", name: "“（左二重引用符）", fix: "「" },
  { ch: "”", name: "”（右二重引用符）", fix: "」" },
  { ch: "，", name: "，（全角カンマ）", fix: "、" },
  { ch: "；", name: "；（全角セミコロン）", fix: "。または、" },
  { ch: "、、", name: "、、（読点の重複）", fix: "、" },
]

function collectFiles(target) {
  const abs = join(ROOT, target)
  let st
  try {
    st = statSync(abs)
  } catch {
    return []
  }
  const relTarget = target.split(sep).join("/")
  if (st.isFile()) {
    if (SKIP_FILES.has(relTarget)) return []
    return EXTENSIONS.has(extname(abs)) ? [abs] : []
  }
  const out = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...collectFiles(join(target, entry.name)))
    } else if (EXTENSIONS.has(extname(entry.name))) {
      const relPath = join(target, entry.name).split(sep).join("/")
      if (!SKIP_FILES.has(relPath)) out.push(join(abs, entry.name))
    }
  }
  return out
}

/** 漢字1文字が CP932 で表せるか */
const encoder = new TextEncoder()
function isJapaneseGlyph(ch) {
  // Node に CP932 のエンコーダはないため、JIS X 0208 を含む EUC-JP / Shift_JIS の
  // 範囲を判定する代わりに、CP932 に変換できるかを TextDecoder の往復で確かめる。
  try {
    const bytes = cp932Encode(ch)
    return bytes !== null
  } catch {
    return false
  }
}

/**
 * CP932 へ変換できるかを調べる。
 * 変換表を持たずに済ませるため、CP932 の全二バイト領域を一度だけ復号して
 * 「CP932 で表せる文字」の集合を作る。
 */
let cp932Set = null
function buildCp932Set() {
  const set = new Set()
  const decoder = new TextDecoder("shift_jis", { fatal: false })
  const buf = new Uint8Array(2)
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead >= 0xa0 && lead <= 0xdf) continue // 半角カナ領域
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue
      buf[0] = lead
      buf[1] = trail
      const s = decoder.decode(buf)
      if (s.length === 1 && s !== "�") set.add(s)
    }
  }
  return set
}
function cp932Encode(ch) {
  if (cp932Set === null) cp932Set = buildCp932Set()
  return cp932Set.has(ch) ? ch : null
}

function isAllowed(file, line, lineText) {
  return ALLOW.some((a) => {
    if (a.file !== file) return false
    if (a.line !== undefined) return a.line === line
    if (a.contains !== undefined) return lineText.includes(a.contains)
    return false
  })
}

const files = DEFAULT_TARGETS.flatMap(collectFiles)
const argTargets = process.argv.slice(2)
const targets = argTargets.length > 0 ? argTargets.flatMap((t) => collectFiles(t)) : files

const findings = []

for (const abs of targets) {
  const rel = relative(ROOT, abs)
  const text = readFileSync(abs, "utf-8")
  const lines = text.split("\n")

  lines.forEach((lineText, i) => {
    const lineNo = i + 1
    if (isAllowed(rel, lineNo, lineText)) return

    // 第一段: 日本語に存在しない字形
    const glyphs = new Set()
    for (const ch of lineText) {
      if (ch >= "一" && ch <= "鿿" && !isJapaneseGlyph(ch)) glyphs.add(ch)
    }
    if (glyphs.size > 0) {
      findings.push({ file: rel, line: lineNo, kind: "字形", detail: [...glyphs].join(""), text: lineText.trim() })
    }

    // 第二段: 中国語式の約物
    for (const p of PUNCTUATION) {
      if (lineText.includes(p.ch)) {
        findings.push({ file: rel, line: lineNo, kind: "約物", detail: `${p.name} → ${p.fix}`, text: lineText.trim() })
      }
    }

    // 第三段: 日本語では使わない語
    for (const w of CHINESE_WORDS) {
      if (lineText.includes(w)) {
        findings.push({ file: rel, line: lineNo, kind: "語", detail: w, text: lineText.trim() })
      }
    }
  })
}

const trim = (s, n = 90) => ([...s].length > n ? [...s].slice(0, n).join("") + "…" : s)

if (findings.length === 0) {
  console.log(`✅ 中国語の残存はありません（${targets.length} ファイルを検査）`)
  process.exit(0)
}

console.log(`❌ ${findings.length} 件見つかりました（${targets.length} ファイルを検査）\n`)
let current = ""
for (const f of findings) {
  if (f.file !== current) {
    current = f.file
    console.log(`── ${current}`)
  }
  console.log(`  ${String(f.line).padStart(5)}  [${f.kind}] ${f.detail}`)
  console.log(`         ${trim(f.text)}`)
}
console.log(`
意図的に残す箇所があれば scripts/check-japanese.mjs の ALLOW に
{ file, line, reason } を追記してください。`)
process.exit(1)
