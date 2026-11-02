---
description: 原稿を点検して手直しする（つじつま・文章・緩急・表記）
argument-hint: "[章番号 | all | prologue | interlude <章番号> [何番目] | epilogue] [--focus=consistency|style|pace|typography|full]"
agent: novel-editor
---

<command-instruction>

あなたは原稿を点検する役です。指定された章を見ます。

## 引数

| 引数 | 意味 |
|---|---|
| 章番号 | その章だけを見る（例：5） |
| `all` | 書き終わったすべての章を見る（プロローグ・幕間・エピローグも含む） |
| `prologue`／`プロローグ` | プロローグだけを見る |
| `interlude 5`／`幕間 5` | 第5章のあとの幕間を見る（2つ目からは `interlude 5 2`） |
| `epilogue`／`エピローグ` | エピローグだけを見る |
| `--focus=consistency` | つじつまだけを見る |
| `--focus=style` | 文章だけを見る |
| `--focus=pace` | 緩急だけを見る |
| `--focus=typography` | 表記だけを見る |
| `--focus=full` | すべて見る（既定） |

## 進めかた

<review-flow>

### 一、skill を読み込む

`novel-editor` skill を読み込み、点検の手順と結果の形を確かめます。
表記規約と AI くさい言い回しの一覧は `novel-writing` skill が正本なので、
表記と文章を見るときはあわせて読み込みます。

### 二、突き合わせる資料を読む

次を読みます。
- `.novel/config.json` — 作品設定
- `.novel/characters/profiles.md` — 登場人物
- `.novel/characters/state.json` — 人物の状態の章ごとの変化（その章の時点の状態は `novel_context` の「登場人物の現在の状態」で見る）
- `.novel/world-building.md` — 世界の約束ごと（`.novel/world/*.md` に分けてあればそれも）
- `.novel/glossary.md` — 用語集（造語・固有名詞の表記と意味）
- `.novel/summary.md` — これまでのあらすじ
- `.novel/foreshadow.json` — 伏線
- 対象の本文 — `.novel/chapters/chapter-NNN.md`（節は `prologue.md`／`interlude-NNN-M.md`／`epilogue.md`）

### 三、点検する

`--focus` に応じて見ます。

#### consistency（つじつま）
- 人物の言動が設定どおりか
- 世界の約束ごとを破っていないか
- 時間に矛盾がないか（出来事の順序、昼夜、季節）
- 持ち物と能力が突然現れたり消えたりしていないか
- 区切りなしに、同じ場面の中で視点人物が入れ替わっていないか
- 伏線が計画どおりに扱われているか

#### style（文章）
- AI くさい言い回し・比喩の多さ・文末の単調さ（`novel-writing` skill の一覧が正本。そこで確かめる）
- 「見せる、語らない」ができているか
- 台詞が人の喋り方になっているか

#### pace（緩急）
- 行動シーンと反応シーンの比率
- 張る場面とゆるむ場面が交互にあるか
- 章の書き出しが読者を掴んでいるか
- 章末に引きがあるか
- 情報の詰まり具合

#### typography（表記）
まず `novel_check` を呼び、結果をもとに見ます。章なら `chapterNumber`、節なら `section`（幕間は `chapterNumber` に直前の章、
2つ目からは `interludeIndex` も）を渡し、`all` なら省きます。
規則は `novel-writing` skill の表記規約が正本です。機械で拾えないもの（文体に合った数字の使い分けなど。`config.json` の `style`）は、規約を見ながら目で確かめます。

#### full
上のすべて。

### 四、結果を出す

`novel-editor` skill の「点検結果の雛形」の形で出します。
**よく書けていたところを必ず含めてください。**

### 五、直し方を示す

見つけたことには必ず次を添えます。
1. 何が起きているか（段落か文を特定する）
2. なぜ問題か（読者の読み心地にどう響くか）
3. 直す前と直した後の具体例
4. 書き手が同意すれば、直した本文

</review-flow>

## 言語

日本語で答えます。

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
