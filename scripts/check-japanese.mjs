#!/usr/bin/env node
/**
 * 中国語の文字列が残っていないかを調べる。
 *
 * ## 判定の根拠
 *
 * 「簡体字であること」を積極的な証拠として判定する。
 * 「日本語の収録表に無い字形だから中国語」という判定はしない。
 * 字形が収録表に無いことは、その字が中国語である証拠にならない。
 * 実際、CP932 に収まらない漢字には頰・剝・塡のような日本語の正字が含まれ、
 * それを根拠にすると正しい日本語で CI が落ちる。
 *
 * ## 一覧の作り方
 *
 * SIMPLIFIED は次の手順で作っている。
 *
 *   1. 上流（ローカライズ前）のソース全体に現れた漢字を集める
 *   2. 高頻度の簡体字を足す
 *   3. **JIS X 0213 に収録されている字をすべて除く**
 *
 * 手順3が肝心である。JIS X 0213 は日本語の文に使う文字を定めた規格なので、
 * そこに収録されている字は日本語の文書に正当に現れ得る。収録字を一覧から
 * 除いておけば、日本語を中国語と誤判定することがない。
 *
 * 判定には iconv を使った。一覧を更新するときは同じ手順を踏むこと。
 *
 *   printf '%s' "<字>" | iconv -f UTF-8 -t EUC-JISX0213 >/dev/null 2>&1
 *   # 成功したら日本語で使う字。一覧に入れてはいけない
 *
 * ## 限界
 *
 * 手順3により、簡体字でありながら JIS X 0213 に収録されている字
 * （关・复・开・异・种・确・离・适 など 64 字）は一覧に入らない。
 * それらだけで書かれた中国語の文は、第一段では捕まらない。
 * これは意図した取り引きである。CI を止める検査が正しい内容を落とす方が、
 * 取りこぼしよりも害が大きい。取りこぼしは第二段・第三段が補う。
 *
 * ## 三段
 *
 *   第一段: SIMPLIFIED の簡体字
 *   第二段: 中国語式の約物
 *   第三段: 日本語の文には現れない中国語の語（単独の漢字は使わない。
 *           「什」は日本語の「什器」に当たるため、「什么」のように語で見る）
 *
 * ## 使い方
 *
 *   node scripts/check-japanese.mjs            # 既定の対象を調べる
 *   node scripts/check-japanese.mjs <path...>  # 対象を指定する（リポジトリ相対）
 *   node scripts/check-japanese.mjs --self-test # 検出器そのものを確かめる
 *
 * 検出器の単体テストは scripts/check-japanese.test.mjs にあり、pnpm test で走る。
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, extname, sep } from "node:path"
import { pathToFileURL } from "node:url"

/** 調べる対象（ディレクトリは再帰的にたどる） */
export const DEFAULT_TARGETS = [
  "src", "commands", "skills", "scripts",
  "README.md", "README.ja.md", "AGENTS.md", "package.json",
]

/** たどらないディレクトリ */
const SKIP_DIRS = new Set(["node_modules", "dist", "test-out", ".git", ".notes"])

/**
 * 検査しないファイル。
 * このスクリプトと、その単体テストは、探す対象そのものを例として持っているため除く。
 */
const SKIP_FILES = new Set([
  "scripts/check-japanese.mjs",
  "scripts/check-japanese.test.mjs",
])

/** 調べる拡張子 */
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".md", ".json", ".yml", ".yaml"])

/**
 * 意図的に残す箇所。
 *
 *   { file, line, reason }     … その行を除く（行がずれると効かなくなる）
 *   { file, contains, reason } … その文字列を含む行を除く（行がずれても効く。こちらを推奨）
 *
 * LICENSE は AGPL-3.0 の原文なので対象に含めていない。
 */
export const ALLOW = [
  {
    file: "README.ja.md",
    contains: "\u2192 プロット\uFF0F",
    reason: "上流との差分を示す用語対応表。何をどう訳したかを記録するため原語を引用している",
  },
  {
    file: "README.ja.md",
    contains: "単独の漢字は使いません",
    reason: "この検査そのものの説明。語の一覧の例として中国語の語を引用している",
  },
]

/**
 * 日本語では使われない簡体字。
 * JIS X 0213 収録字をすべて除いてあるため、この一覧（第一段）が JIS X 0213 の
 * 収録字を誤検知することはない。第二段・第三段の一覧は目で選んだものなので、
 * 同じ保証はない（単独の漢字を入れないなどの約束で防いでいる）。
 */
export const SIMPLIFIED = new Set([...(
    "专业东丝丢两严丧临为丽举义乐习乡书买亚产亲亿仅仑仓们众优伙伟传伤侧侨俩债值倾偷偿储兑兰兴兽军净减凑凤击则刚创删别剑剧" +
    "劝办务动劲劳势华协单卖卢卤卫厅历厉压厌县发变叠另叹吓吕吗启吱吵呐呗员响哎哑哗哪唢唤啦啧啸喻嗓嗬嗯团园围图圆圹场块坚坠" +
    "垄垒垦垫埙堑墙处备够头夺奋奖她妆妇姗婴婶嫒实宠审宪宫对寻导尔层屿岁岛巅帅师帐带庆庐庑库应废张弹强归录彻徕忆怀态怅怆总" +
    "怼恶悬悯惊惩惫惯愣愤懂戆戏战户扦执扩扪扫扬扰抚抢护报拎拟拢拥拨择挖挚挡挣挤挥挪捞损捡换捣掐掳揪揽搅摄摅摆摇摊摔撺攒攥" +
    "敌敛斋斓时旷昙显晕晖暂暧术朵杀杂权杨构枪枫柜查柽标栈树样桥桩检椭榇榈槛槠檩欢歼殇毁毙氢汇汉汤沥泞泽洁洇浆测济浑浓涝润" +
    "渎渐渔溃溅满滥潍濒灭灿炼烂烛烦烧烩热焕爱爷牍牺犊狱玑玮环现玺琼瑷电畅疗疤疮疯痨瘗癣癫皑盐盯眯睁睐瞒矾码砖砸础碛祸积稣" +
    "稳穑穷窜窥竖竞笔笼筛筷签简箨篓簌簖籁类粜粪紧纠红约级纬纯纲纳纵纷纸纹线练组细织终绊绍经绑结绕给络绝绞统绥继绪续维绵绸" +
    "综绽缎缓编缘缚缝缠缢缩罚罢羁翘翱耸职联聩肃肠胁胜胫胶脏脑脸腻膑臜舆舱艰艳艺节苇苏茏茧茬荆荡药获萝营萧蕴虏虽蚀蛊蜕衔补" +
    "袄袭裆见观规视览觉觐计订认讨让讫训议记讲讳讷许论讽设诀证评诅识诉词译试诗诙诚诛话诡询该详语误诲说请诺读诽课谁调谋谌谎" +
    "谐谓谙谛谜谢谣谤谬谱豮负贡财责败账货质贩贪贯贴贵费赃资赋赎赐赖赘赛赢赵趋趟跃踩踮躲车转轮软轻载较辅辈辊辑输辖辗边达过" +
    "运还这进远违连迟选递逻遗邓郓酿释鉴针钞钠钨钩钰钱铁铃铜铡铬银铸铺链销锁锈锋锐错锤锦键镁镇镐镖镜长门闪闭问闯闰闲间闷闹" +
    "闻阀阁阅队阵阶际陆陇陈陨险隐难雏霉靥鞑韧页顶项顺须顽顾顿颁颂预领颈频颖题额颠颤风飒飘飞饭饿馅馆馈馒马驰驱驳验骏骑骗骤" +
    "髅鱼鲁鲜鳗鸡鸣鹅鹤黾齐龄龙"
)])

/**
 * 日本語の文には現れない中国語の語。
 * 単独の漢字は入れない（日本語の熟語に当たってしまう）。
 */
export const CHINESE_WORDS = [
  "什么",
  "什麼",
  "甚麼",
  "怎么",
  "怎麽",
  "咱们",
  "咱們",
  "没有",
  "沒有",
  "哪里",
  "哪裡",
  "哪儿",
  "哪兒",
  "为什么",
  "為什麼",
  "一下子",
  "的话",
  "的時候",
  "的时候",
  "不要紧",
  "有点儿",
  "有點兒",
]

/** 中国語式の約物 */
export const PUNCTUATION = [
  { ch: "\u201C", name: "“（左二重引用符）", fix: "「" },
  { ch: "\u201D", name: "”（右二重引用符）", fix: "」" },
  { ch: "\uFF0C", name: "，（全角カンマ）", fix: "、" },
  { ch: "\uFF1B", name: "；（全角セミコロン）", fix: "。または、" },
]

/** 1行を調べ、見つかったものを返す */
export function inspectLine(lineText) {
  const found = []

  const glyphs = new Set()
  for (const ch of lineText) if (SIMPLIFIED.has(ch)) glyphs.add(ch)
  if (glyphs.size > 0) found.push({ kind: "簡体字", detail: [...glyphs].join("") })

  for (const p of PUNCTUATION) {
    if (lineText.includes(p.ch)) found.push({ kind: "約物", detail: `${p.name} → ${p.fix}` })
  }

  for (const w of CHINESE_WORDS) {
    if (lineText.includes(w)) found.push({ kind: "語", detail: w })
  }

  return found
}

export function isAllowed(file, line, lineText) {
  return ALLOW.some((a) => {
    if (a.file !== file) return false
    if (a.line !== undefined) return a.line === line
    if (a.contains !== undefined) return lineText.includes(a.contains)
    return false
  })
}

export function collectFiles(target, root) {
  const relTarget = target.split(sep).join("/")
  const abs = join(root, target)
  let st
  try {
    st = statSync(abs)
  } catch {
    return []
  }
  if (st.isFile()) {
    if (SKIP_FILES.has(relTarget)) return []
    return EXTENSIONS.has(extname(abs)) ? [abs] : []
  }
  const out = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...collectFiles(join(target, entry.name), root))
    } else if (EXTENSIONS.has(extname(entry.name))) {
      const p = join(target, entry.name).split(sep).join("/")
      if (!SKIP_FILES.has(p)) out.push(join(abs, entry.name))
    }
  }
  return out
}

/** ファイル一式を調べ、見つかったものを返す */
export function inspectFiles(targets, root) {
  const findings = []
  for (const abs of targets) {
    const rel = relative(root, abs)
    const lines = readFileSync(abs, "utf-8").split("\n")
    lines.forEach((lineText, i) => {
      const lineNo = i + 1
      if (isAllowed(rel, lineNo, lineText)) return
      for (const f of inspectLine(lineText)) {
        findings.push({ file: rel, line: lineNo, ...f, text: lineText.trim() })
      }
    })
  }
  return findings
}

// ============================================================
// 検出器そのものの確認
// ============================================================

/** [説明, 本文, 検出されるべきか] */
export const SELF_TEST_CASES = [
  ["日本語（JIS X 0213 の字）", "彼は頰を押さえ、包みの薄紙を剝がした。", false],
  ["日本語（常用漢字の新字）", "塡めた駒を見て、剋目した。", false],
  ["日本語（瘦・痩）", "彼は瘦せた。少し痩せたとも書く。", false],
  ["日本語（什器）", "店の什器を片付けた。", false],
  ["日本語（約物）", "「待て！　行くな」――彼は走った……", false],
  ["日本語（日中で共通の字）", "国会の点検で、万事が的を射た。是非とも了解した。", false],
  ["日本語（区・医・准・叶）", "区役所の医師が准教授の願いを叶えた。", false],
  ["日本語（関・復・開・異・種・確・離・適の正字）", "関係を復旧し、開示した異種の確率が離れて適う。", false],
  ["日本語（毎・沈・歩・卓・桌）", "毎朝、沈んだ歩みで卓に向かう。", false],
  ["中国語（簡体字）", "这是中文的句子，应该被检测出来。", true],
  ["中国語（上流の文）", "小说创作工作流程", true],
  ["中国語（約物のみ）", "これは“引用”です", true],
  ["中国語（語のみ）", "什么时候", true],
]

export function selfTest() {
  let failed = 0
  console.log("検出器の確認\n")
  for (const [label, text, shouldFlag] of SELF_TEST_CASES) {
    const found = inspectLine(text)
    const flagged = found.length > 0
    const ok = flagged === shouldFlag
    if (!ok) failed++
    const what = flagged ? found.map((f) => `${f.kind}:${f.detail}`).join(", ") : "検出なし"
    console.log(`  ${ok ? "✅" : "❌"} ${shouldFlag ? "検出する " : "検出しない"}  ${label}`)
    console.log(`       ${text}`)
    console.log(`       → ${what}`)
  }
  console.log(`\n簡体字の一覧: ${SIMPLIFIED.size} 字 / 語の一覧: ${CHINESE_WORDS.length} 語`)
  if (failed > 0) {
    console.log(`\n❌ ${failed} 件が期待と違います`)
    return 1
  }
  console.log("\n✅ すべて期待どおりです")
  return 0
}

// ============================================================
// 実行（モジュールとして読み込んだときは走らせない）
// ============================================================

/**
 * このファイルが直接実行されているかを判定する。
 *
 * `new URL("file://" + path)` では、パスに # や ? が含まれるときに
 * それ以降がフラグメントやクエリとして切り落とされ、import.meta.url と
 * 一致しなくなる。その場合 CLI の処理が走らず、何も出力せずに終了コード 0 を
 * 返してしまう（検査したつもりで素通りする）。
 * pathToFileURL はこれらを百分率符号化するため、正しく一致する。
 */
export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false
  try {
    return pathToFileURL(argv1).href === moduleUrl
  } catch {
    return false
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes("--self-test")) process.exit(selfTest())

  const root = process.cwd()
  const targets = (args.length > 0 ? args : DEFAULT_TARGETS).flatMap((t) => collectFiles(t, root))
  const findings = inspectFiles(targets, root)

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
{ file, contains, reason } を追記してください。`)
  process.exit(1)
}
