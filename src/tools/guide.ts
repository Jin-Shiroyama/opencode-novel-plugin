import type { ToolContext } from "../index.js"
import { DEFAULTS, CHAPTER_LENGTH, CHAPTER_WORD_TOLERANCE, FORESHADOW_LOOKAHEAD } from "../constants.js"

interface GuideArgs {
  section?: "workflow" | "prompts" | "writing" | "foreshadow" | "characters"
}

export async function novelGuideExecute(
  args: GuideArgs,
  _ctx: ToolContext,
): Promise<string> {
  return getGuideContent(args.section ?? "workflow")
}

const WORKFLOW_GUIDE = `# 📖 長編小説の進め方

## 全体の流れ

\`\`\`
コンセプト → 世界観 → 人物 → プロット概要 → 章別プロット → シーン設計 → 本文
   0          1        2         3              4             5          6
\`\`\`

## 各工程

### 工程0: 作品コンセプト (concept.md)
**目的**: 輪郭のはっきりしない思いつきを、芯のある物語の核にする

**書き上げるもの**:
- ログライン（40文字以内）
- 5行シノプシス（三幕構成／起承転結）
- 中心にある対立（外からのもの＋内側のもの）
- 作品テーマ
- 2つのジレンマ

**ツール**: novel_init（最初だけ）→ concept.md に記入
**プロンプト**: concept

### 工程1: 世界観 (world-building.md)
**目的**: つじつまの合う世界を作る

**書き上げるもの**:
- 時代と舞台
- 社会のしくみ（権力、階層、勢力）
- 能力体系（あれば。必ず制約と代償を付ける）
- 文化と習俗
- この世界の約束ごと

**前提**: concept.md が書き終わっていること
**プロンプト**: world-building

### 工程2: 登場人物 (characters/profiles.md)
**目的**: 生身の手ざわりのある人物をそろえる

**書き上げるもの**:
- 主人公の設定（動機の三角形＋キャラクターアーク）
- 敵役（その人なりの正しさを持たせる）
- 主要な脇役
- 関係図
- 対立表

**前提**: concept.md と world-building.md が書き終わっていること
**プロンプト**: characters

### 工程3: プロット概要 (outline-brief.md)
**目的**: 三幕構成の骨をつくる

**書き上げるもの**:
- 幕ごとの章の割り振り
- 転換点の位置
- 2つのジレンマの位置
- 伏線の計画

**前提**: コンセプト＋世界観＋人物が書き終わっていること
**プロンプト**: outline-brief

### 工程4: 章別プロット (outline-detailed.md)
**目的**: 章ごとの計画に落とす

**書き上げるもの**:
- 各章の出来事（200〜300文字）
- 登場人物と状態の変化
- 伏線の扱い
- 主要なシーンの手がかり
- 章末の引き

**前提**: outline-brief.md が書き終わっていること
**プロンプト**: outline-detailed

### 工程5: シーン設計 (scenes.md)
**目的**: 章を、そのまま書ける大きさのシーンに割る

**書き上げるもの**:
- シーン一覧（行動シーンと反応シーンを交互に）
- 各シーンの _Prompt（執筆の手引き）
- 状態の印（[ ] → [-] → [x]）

**前提**: outline-detailed.md が書き終わっていること
**プロンプト**: scenes

### 工程6: 本文 (chapters/)
**目的**: 1章ずつ書き上げる

**手順**:
1. novel_context で執筆用の資料をそろえる
2. プロットとシーンの手引きに沿って本文を書く
3. novel_save_chapter で保存する
4. novel_update で記録を更新する
5. 次の章へ

**前提**: scenes.md が書き終わっていること
**プロンプト**: chapter-write（第1章）／chapter-continue（第2章以降）

## 守りたいこと

1. **順に進める**: 工程を飛ばさない。前の工程の成果が次の入力になる
2. **節目で確かめる**: 各工程を終えたら書き手に確認を取る
3. **資料をそろえてから書く**: 本文を書く前に必ず novel_context を通す
4. **書いたら記録する**: 1章ごとに人物の状態・あらすじ・伏線を更新する
5. **ときどき通して見る**: 5章ごとに consistency-check でつじつまを確かめる
`

const PROMPTS_GUIDE = `# 📝 プロンプトの使い方

## 使えるプロンプト

| 名前 | 用途 | 使う工程 |
|---|---|---|
| concept | 作品コンセプト | 工程0 |
| world-building | 世界観 | 工程1 |
| characters | 登場人物 | 工程2 |
| outline-brief | プロット概要 | 工程3 |
| outline-detailed | 章別プロット | 工程4 |
| scenes | シーン設計 | 工程5 |
| chapter-write | 第1章の本文 | 工程6（第1章） |
| chapter-continue | 第2章以降の本文 | 工程6（第2章〜） |
| consistency-check | つじつま確認 | いつでも |
| character-state-update | 人物の状態の更新 | 1章書き終えるごと |
| summary-update | あらすじの更新 | 1章書き終えるごと |
| wuxia-martial-arts | 剣術・武芸の体系 | 時代小説・剣豪小説の世界観づくり |
| wuxia-combat | 剣戟の場面 | 立ち合いを書くとき |
| reality-source | 取材素材の読み解き | 企画の段階（ジャンルを問わず） |
| character-archetype | 人物の型の取り出し | 人物づくりの段階 |

## RTCO という組み立て

すべてのプロンプトは次の4層でできています。

- **R**ole（\`<system>\`）: 立ち位置と専門
- **T**ask（\`<task>\`）: やることと条件
- **C**ontext/Organize（\`<outline>\` \`<characters>\` など）: 資料とその並べ方
- **O**utput（\`<output>\`）: 出力してほしい形

## 資料の優先度

本文を書くときに資料を読む順番です。

- **P0（必ず従う）**: この章のプロット、作品の基本設定
- **P1（重要）**: 登場人物、前章とのつなぎ、人物の現在の状態
- **P2（参考）**: 伏線の確認、これまでのあらすじ

## 手順

1. novel_guide でプロンプトの一覧を見る
2. 使うプロンプトの中身を読む
3. \`{変数}\` を作品の情報で埋める
4. 埋めたプロンプトを執筆の指針にする
`

const WRITING_GUIDE = `# ✍️ 文章の書きかた

> AI くさい文章を避けるための全一覧と、表記のきまりは \`novel-writing\` skill が正本です。
> ここでは要点だけを示します。

## シーンの2種類

### 行動シーン（Goal → Conflict → Disaster）
- **目的**: 人物に手に入れたいものがある
- **障害**: それをはばむものに当たる
- **つまずき**: 思っていたより事態が悪くなる

### 反応シーン（Reaction → Dilemma → Decision）
- **受け止め**: 前のシーンへの感情の反応
- **板挟み**: どちらを選んでも代償がある
- **決断**: 決めて、話を先へ押す

### 交互に置いて緩急をつくる

\`\`\`
行動 → 反応 → 行動 → 反応 → …
張る → ゆるむ → 張る → ゆるむ → …
\`\`\`

## 表記のきまり（要点）

- 会話は「」。会話中の引用は『』。会話文末に句点は打たない
- 三点リーダは「……」、ダッシュは「――」。必ず2つ重ね、偶数個
- 感嘆符・疑問符は全角。直後に全角スペース1つ。閉じ括弧の直前と行末には入れない
- 段落頭は全角スペース1字下げ。「」で始まる会話行は字下げしない
- 地の文の数量は原則漢数字

## AI くさい文章を避ける（要点8つ）

❌ 「思わず」「〜せずにはいられなかった」
❌ 「胸が熱くなった」「込み上げてきた」などのできあいの感情表現
❌ 「その瞬間」「次の瞬間」で場面をつなぐ
❌ 同じ文末を3文以上続ける
❌ 「まるで〜のようだった」の多用（比喩は1,000文字に1つまで）
❌ 「！！」「？！」の連打、単独の「…」「―」
❌ 全員が同じ語尾で話す
❌ 設定を台詞で説明する

✅ 感情は身ぶりと場の描写で見せる
✅ 抽象ではなく具体を書く
✅ 一人ずつに話し方の癖を持たせる
✅ 緊迫は短文と体言止め、落ち着きは長文
✅ 重要な場面は五感を3種以上
✅ 視点人物は1シーンに1人

## 文字数の目安

- 1章の目標 = 目標総文字数 ÷ 予定章数
- 振れ幅は ±${Math.round(CHAPTER_WORD_TOLERANCE * 100)}% まで
- 既定では ${DEFAULTS.targetWords.toLocaleString("ja-JP")}文字 ÷ 全${DEFAULTS.chapterCount}章 = 1章 ${Math.round(DEFAULTS.targetWords / DEFAULTS.chapterCount).toLocaleString("ja-JP")}文字
- 日本語の長編は1章 ${CHAPTER_LENGTH.min.toLocaleString("ja-JP")}〜${CHAPTER_LENGTH.max.toLocaleString("ja-JP")}文字が読みやすい範囲（山場の章は ${CHAPTER_LENGTH.peak.toLocaleString("ja-JP")}文字まで）
- 文字数は空白と改行を除いた全文字数で数えます（仮名も約物も1文字）
`

const FORESHADOW_GUIDE = `# 🎯 伏線の扱い

## 伏線の移り変わり

\`\`\`
pending → planted → resolved
                  → abandoned
\`\`\`

- **pending**: 計画しただけで、まだ本文に書いていない
- **planted**: 本文に張った
- **resolved**: 本文で回収した
- **abandoned**: 回収をやめた（理由を notes に書く）

## 伏線の種類

| 種類 | 説明 | 例 |
|---|---|---|
| identity | 身元 | 隠している素性 |
| mystery | 謎 | まだ解けていない疑問 |
| item | 品物 | 鍵になる道具のほのめかし |
| relationship | 関係 | 伏せられた血縁 |
| event | 出来事 | これから起きる大きな事 |
| ability | 能力 | まだ目覚めていない力 |
| prophecy | 予言 | 予言や夢 |

## 知らせ方

本文を書くとき、\`novel_context\` が伏線を知らせます。知らせるかどうかと、
どう添え書きするかは次のとおりです。

**知らせないもの**

- **回収済み**（resolved）／**取り下げ済み**（abandoned）
  終わった伏線を知らせると、済んだものをもう一度回収しようとしてしまいます

**知らせるもの**

| 状況 | 印 | 添え書き |
|---|---|---|
| 回収予定の章を過ぎている | ⚠️ | 回収予定の第N章を過ぎています |
| この章が回収予定 | 🎯 | ← この章で回収 |
| 回収予定が ${FORESHADOW_LOOKAHEAD}章以内 | ⏰ | 第N章で回収予定 |
| 張り済みで回収予定が先 | ⏰ | 第N章で回収予定（忘れないよう常に知らせます） |
| 張り済みで回収の章が未定 | 🌱 | 回収の章は未定 |

回収予定が${FORESHADOW_LOOKAHEAD}章より先で、まだ張っていないものは知らせません
（毎章すべてを並べると、いま扱うべきものが埋もれるため）。

並び順は急ぐものから。過ぎたものどうしは予定が古い順です。

添え書きには「張り済み」か「まだ張っていません」も付きます。張る前に回収しようと
しないためです。

## 手順

1. foreshadow.json に伏線を登録する
2. 本文を書くとき novel_context が自動で知らせる
3. 回収したら status を "resolved" にする（しないと、済んだものが知らされ続けます）
4. 使わないことにしたら status を "abandoned" にして、理由を notes に書く
5. ときどき、⚠️ が付いたまま残っている伏線がないか見直す
`

const CHARACTERS_GUIDE = `# 👤 登場人物の管理

## 記録する項目

1. **生存状態**: active / deceased / missing / retired
2. **心のありよう**: 感情の変化、傷、見方の転換
3. **持ち物**: 手に入れたもの、失ったもの
4. **できること**: 身につけたこと、失ったこと
5. **関係**: ほかの人物との関係の変化
6. **出来事**: その人物に起きた重要なこと

## 動機の三角形

主要人物には必ず3つをそろえます。

- **表の目的**: 本人が口にする、達成したいこと（具体的に）
- **真の欲求**: 本当に必要としているもの（本人は気づいていないことが多い）
- **致命的欠点**: 成長をはばむ弱点（過去の経験から来ている）

この3つが互いに食い違っているほど、物語に張りが生まれます。

## キャラクターアーク

| 段階 | 状態 | 働き |
|---|---|---|
| 起点 | はじめの信念 | 基準を示す |
| 発展 | 揺らぎはじめる | 試練を受ける |
| 底 | 最も暗いところ | 致命的欠点が露わになる |
| 成長 | 新しい見方 | 壁を越える |
| 終点 | 変わったあと | 変化を見せる |

## 書き分けのこつ

一人ずつに「話し方の癖」を1つ決めてください。口癖、語尾、文の長さ、言いよどみ方の
どれでもかまいません。名前を隠して台詞だけ読んだとき、誰の発言か分かるのが目標です。

## 更新のタイミング

- 1章書き終えたら: 出番のあった人物の状態を更新する
- 大きな出来事のあと: 関係の変化を書き残す
- 1巻（または1部）の終わり: すべての人物のアークの進み具合を見直す
`

export function getGuideContent(section: string): string {
  switch (section) {
    case "workflow": return WORKFLOW_GUIDE
    case "prompts": return PROMPTS_GUIDE
    case "writing": return WRITING_GUIDE
    case "foreshadow": return FORESHADOW_GUIDE
    case "characters": return CHARACTERS_GUIDE
    default: return WORKFLOW_GUIDE
  }
}
