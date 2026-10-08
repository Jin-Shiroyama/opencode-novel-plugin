#!/usr/bin/env node
/**
 * 中国語の文字列が残っていないかを調べる。
 *
 * 判定は「簡体字であること」を根拠にする。
 * 「日本語に無い字形だから中国語」という判定はしない。CP932 や JIS X 0208 に
 * 収まらない漢字には頰・剝・塡のような日本語の正字が含まれるため、それを根拠に
 * すると正しい日本語が落ちる（CI が落ちる）。字形が収録表に無いことは、
 * その字が中国語であることの証拠にならない。
 *
 * 三段で見る。
 *
 *  第一段（主）: SIMPLIFIED に挙げた簡体字
 *    日本語では使われない字形だけを列挙してある。したがって日本語を誤検知しない。
 *    一覧の作り方は次のとおり。
 *      - 上流（ローカライズ前）のソース全体に実際に現れた、日本語に無い字形 583 字
 *      - これに高頻度の簡体字を足した。足すときは EUC-JP（JIS X 0208 +
 *        JIS X 0212）に含まれる字を機械的に除いているため、日本語の字は入らない
 *      - 合計 773 字
 *
 *  第二段: 中国語式の約物
 *    “ ” ‘ ’（日本語は「」『』）、全角カンマ、全角セミコロンなど。
 *
 *  第三段: 日本語では使わない語
 *    簡体字を含まない中国語の語を、短い一覧で突き合わせる。
 *
 * 限界: 一覧に無い簡体字だけで書かれた文は第一段では捕まらない。実際に起こり得る
 *       崩れ方（上流の文が戻る、中国語を貼り込む）では第二段・第三段が補う。
 *       逆向きの誤り（正しい日本語を中国語と判定する）は起こらない設計にしてある。
 *
 * 意図的に残す箇所は ALLOW に書く。
 *
 * 使い方:
 *   node scripts/check-japanese.mjs            # 既定の対象を調べる
 *   node scripts/check-japanese.mjs <path...>  # 対象を指定する（リポジトリ相対）
 *   node scripts/check-japanese.mjs --self-test # 検出器そのものを確かめる
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, extname, sep } from "node:path"

const ROOT = process.cwd()

/** 調べる対象（ディレクトリは再帰的にたどる） */
const DEFAULT_TARGETS = ["src", "commands", "skills", "scripts", "README.md", "README.ja.md", "AGENTS.md", "package.json"]

/** たどらないディレクトリ */
const SKIP_DIRS = new Set(["node_modules", "dist", "test-out", ".git", ".notes"])

/**
 * 検査しないファイル。
 * このスクリプト自身は、探す対象そのものを一覧として持っているため除く。
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
 */
const ALLOW = [
  {
    file: "README.ja.md",
    contains: "\u2192 プロット\uFF0F",
    reason: "上流との差分を示す用語対応表。何をどう訳したかを記録するため原語を引用している",
  },
]

/**
 * 日本語では使われない簡体字。
 * ここに挙げた字が見つかれば、それは中国語である。
 */
const SIMPLIFIED = new Set([...(
  "专业东丝丢两严丧丰临为丽举么义乐习乡书买亚产亲亿仅仑仓们份仿众优伙伟传伤你侧侨俩债值倾偷偿储兑兰关兴兽军净减凑凤击划则刚" +
  "创删别剑剧劝办务动劲劳势华协单卖卡卢卤卧卫厅历厉压厌县发变叠另叵叹吓吕吗吧启吱吵呐呗员呢响哎哑哗哪唢唤啊啦啧啸喻嗓嗬嗯嘎" +
  "团园围图圆圣圹场块坚坠垄垒垦垫埙堑塌墙壳处备复够头夺奋奖她妆妇姗婴婶嫒实宠审宪宫对寻导尔层屿岁岛巅帅师帐带帮庆庐庑库应废" +
  "开异弈张弹强归录彻徕忆怀态怅怆总怼恶您悬悯惊惩惫惯愣愤懂戆戏战户扦执扩扪扫扬扭扰抚抢护报拎拖拟拢拥拨择拼挖挚挡挣挤挥挪捞" +
  "损捡换捣掐掳揪揭揽搅搞摄摅摆摇摊摔撑撺攒攥敌敛斋斓时旷昙显晕晖晚暂暧术朵杀杂权杨极构枪枫柜查柽标栈树样桌桥桩检棱椭榇榈槛" +
  "槠檩欢步歧歼殁殇毁每毙氢汇汉汤沉沥沪泞泽洁洇浆测济浑浓涉涝润渎渐渔渗渴溃溅满滥潍濒灭灵灾灿炼烂烛烤烦烧烩热焕爱爷牍牺犊狱" +
  "玑玮环现玺琼瑷电畅疗疤疮疯痨瘗瘦癣癫皑盐盯眯睁睐瞒瞩瞪矾码砖砸础确碛碰祸离种积稣稳穑穷窜窥竖竞笔笼筛筷签简箨篓簌簖籁类粜" +
  "粪紧纠红约级纬纯纲纳纵纷纸纹线练组细织终绊绍经绑结绕给络绝绞统绥继绪续维绵绸综绽缎缓编缘缚缝缠缢缩罚罢羁翎翘翱耸职联聩肃" +
  "肠肤胁胜胫胶脍脏脑脸腻膑臜舆舱艰艳艺节苇苏茏茧茬荆荡荣药获萝营萧蒺蕴虏虽蚀蛊蜕衔补袄袭裆见观规视览觉觐计订认讨让讫训议记" +
  "讲讳讷许论讽设诀证评诅识诉词译试诗诙诚诛话诡询该详语误诲说请诺读诽课谁调谋谌谎谐谓谙谛谜谢谣谤谬谱豮负贡财责败账货质贩贪" +
  "贯贴贵费赃资赋赎赐赖赘赛赢赵趋趟跃踌踩踮蹭躲车转轮软轻载较辅辈辊辑输辖辗边达迁过运还这进远违连迟适选递逻遗邓郓酿释鉴针钞" +
  "钠钨钩钰钱铁铃铜铡铬银铸铺链销锁锈锋锐错锤锦键镁镇镐镖镜长门闪闭问闯闰闲间闷闹闻阀阁阅队阳阴阵阶际陆陇陈陡陨险隐难雏霉靥" +
  "鞑韧页顶项顺须顽顾顿颁颂预领颈频颖题额颠颤风飒飘飞饭饿馅馆馈馒马驰驱驳验骏骑骗骤髅鱼鲁鲜鳗鸡鸣鹅鹤黾齐龄龙"
)])

/** 日本語では使わない語（簡体字を含まないもの） */
const CHINESE_WORDS = [
  "没有", "什", "咱", "俺们", "甚麼", "怎麽", "為什", "哪里", "哪兒",
  "一下子", "的话", "之后", "不要紧", "有点儿",
  "請問", "謝謝", "再見", "對不起",
]

/** 中国語式の約物 */
const PUNCTUATION = [
  { ch: "\u201C", name: "“（左二重引用符）", fix: "「" },
  { ch: "\u201D", name: "”（右二重引用符）", fix: "」" },
  { ch: "\uFF0C", name: "，（全角カンマ）", fix: "、" },
  { ch: "\uFF1B", name: "；（全角セミコロン）", fix: "。または、" },
]

function collectFiles(target) {
  const relTarget = target.split(sep).join("/")
  const abs = join(ROOT, target)
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
      out.push(...collectFiles(join(target, entry.name)))
    } else if (EXTENSIONS.has(extname(entry.name))) {
      const p = join(target, entry.name).split(sep).join("/")
      if (!SKIP_FILES.has(p)) out.push(join(abs, entry.name))
    }
  }
  return out
}

function isAllowed(file, line, lineText) {
  return ALLOW.some((a) => {
    if (a.file !== file) return false
    if (a.line !== undefined) return a.line === line
    if (a.contains !== undefined) return lineText.includes(a.contains)
    return false
  })
}

/** 1行を調べ、見つかったものを返す */
function inspectLine(lineText) {
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

// ============================================================
// 検出器そのものの確認
// ============================================================

function selfTest() {
  const cases = [
    // [説明, 本文, 検出されるべきか]
    ["日本語（JIS X 0213 の字を含む）", "彼は頰を押さえ、包みの薄紙を剝がした。", false],
    ["日本語（常用漢字の新字）", "塡めた駒を見て、剋目した。", false],
    ["日本語（約物）", "「待て！　行くな」――彼は走った……", false],
    ["日本語（日中で共通の字）", "国会の点検で、万事が的を射た。是非とも了解した。", false],
    ["日本語（区・医・准・叶）", "区役所の医師が准教授の願いを叶えた。", false],
    ["中国語（簡体字）", "这是中文的句子，应该被检测出来。", true],
    ["中国語（上流の文）", "小说创作工作流程", true],
    ["中国語（約物のみ）", "これは“引用”です", true],
    ["中国語（語のみ）", "没有问题", true],
  ]

  let failed = 0
  console.log("検出器の確認\n")
  for (const [label, text, shouldFlag] of cases) {
    const found = inspectLine(text)
    const flagged = found.length > 0
    const ok = flagged === shouldFlag
    if (!ok) failed++
    const mark = ok ? "✅" : "❌"
    const what = flagged ? found.map((f) => `${f.kind}:${f.detail}`).join(", ") : "検出なし"
    console.log(`  ${mark} ${shouldFlag ? "検出する " : "検出しない"}  ${label}`)
    console.log(`       ${text}`)
    console.log(`       → ${what}`)
  }
  console.log(`\n簡体字の一覧: ${SIMPLIFIED.size} 字`)
  if (failed > 0) {
    console.log(`\n❌ ${failed} 件が期待と違います`)
    process.exit(1)
  }
  console.log("\n✅ すべて期待どおりです")
  process.exit(0)
}

// ============================================================
// 実行
// ============================================================

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()

const targets = (args.length > 0 ? args : DEFAULT_TARGETS).flatMap(collectFiles)

const findings = []
for (const abs of targets) {
  const rel = relative(ROOT, abs)
  const lines = readFileSync(abs, "utf-8").split("\n")
  lines.forEach((lineText, i) => {
    const lineNo = i + 1
    if (isAllowed(rel, lineNo, lineText)) return
    for (const f of inspectLine(lineText)) {
      findings.push({ file: rel, line: lineNo, ...f, text: lineText.trim() })
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
{ file, contains, reason } を追記してください。`)
process.exit(1)
