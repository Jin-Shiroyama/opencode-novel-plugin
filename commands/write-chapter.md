---
description: 1章の本文を書き、資料をそろえて保存する
argument-hint: "<章番号 | prologue | interlude <章番号> [何番目] | epilogue>"
agent: novel-writer
---

<command-instruction>

あなたは本文を書く役です。1章を書き上げます。

## 必ず守ること：章番号

**章番号の指定が必要です。** 渡されていなければ尋ねます。

> 「書く章の番号を教えてください（例：1、3、12）」

プロローグ・幕間・エピローグは章の数に入らない「節」です。引数を次のように読み替え、
以下の手順のツール呼び出しで `chapterNumber: {N}` の代わりに使います。

| 引数 | 書くもの | ツールに渡す引数 |
|---|---|---|
| `3` | 第3章 | `chapterNumber: 3` |
| `prologue`／`プロローグ` | プロローグ | `section: "prologue"` |
| `interlude 5`／`幕間 5` | 第5章のあとの幕間 | `section: "interlude", chapterNumber: 5` |
| `interlude 5 2`／`幕間 5 2` | 第5章のあとの2つ目の幕間 | `section: "interlude", chapterNumber: 5, interludeIndex: 2` |
| `epilogue`／`エピローグ` | エピローグ | `section: "epilogue"` |

節を書くときの違い：
- プロットは章別プロットの「## プロローグ」「## 幕間（第5章のあと）」「## エピローグ」の節（または `outline/prologue.md` など）から読まれます。シーンIDは振りません
- 分量は章の目安に縛られません。プロットに従います
- 記録（人物の状態・伏線）は、プロローグは第0章、幕間は直前の章、エピローグは最後の章として残ります（`section` を渡せば自動でそうなります）
- シーンの状態を直す手順（六の二）は飛ばします

## 進めかた

<write-flow>

### 一、skill を読み込む

`novel-writing` skill を読み込みます。表記規約と、AI くさい言い回しを避けるための一覧があります。
**この skill が表記と文章の正本です。**

### 二、資料をそろえる

```
novel_context(chapterNumber: {N}, includePrompts: true)
```

返ってくるもの：
- この章のプロット（P0 — 必ず従う）
- この章のシーンと `_Prompt`（P0 — 執筆の手引き）
- 登場人物と現在の状態（P1。この章に出る人物は個別の設定も付きます）
- これまでのあらすじと前章の末尾（P1／P2）
- 伏線の確認（P2）
- 執筆プロンプト

前の本文の末尾は、読む順番ですぐ前のもの（前に幕間があれば幕間、第1章ならプロローグ）が載ります。

特定のシーンだけを書くときは `sceneId` を渡します。そのシーンに印が付きます。

```
novel_context(chapterNumber: {N}, sceneId: "2.1", includePrompts: true)
```

### 三、資料を読む

書き出す前に確かめます。
- この章で起きる出来事
- この章で扱う伏線
- 登場人物の現在の状態
- 前章とのつなぎ目
- この章の視点人物

プロットが未作成、またはプロジェクトが未作成であれば、ここで止めて書き手に伝えます。

### 四、本文を書く

**本文だけを出します。**

必ず守ること：
- プロットの筋から外れない
- 人物の性格と話し方を保つ
- 一人称・二人称・相手の呼び方・敬語は、資料の「🗣️ ことばづかい」どおりにする（変えるなら理由になる出来事を書く）
- 目標文字数の範囲に収める（±10%）
- 場面に画を持たせる
- 台詞をその人らしく書く
- 視点人物は1シーンに1人だけ
- `novel-writing` skill の**表記規約**を守る
  - 会話は「」、会話文末に句点を打たない
  - 三点リーダは「……」、ダッシュは「――」（いずれも2つ重ね）
  - 感嘆符・疑問符は全角。直後に全角スペース1つ（閉じ括弧の直前と行末は除く）
  - 段落頭は全角スペース1字下げ（会話行は字下げしない）
  - 地の文の数量は原則漢数字
  - ルビは `｜親文字《ルビ》`、傍点は `《《傍点》》`（1行の中で閉じる）
- `novel-writing` skill の**AI くさい言い回しの一覧**をすべて避ける

### 五、保存する

```
novel_save_chapter(
  chapterNumber: {N},
  title: "本文またはプロットから取った章タイトル",
  content: "本文（章見出しの行は含めない）",
  updateState: true
)
```

保存の報告に「📝 表記」の点検結果が出ます。❌ があれば `novel_check(chapterNumber: {N})` で全件を見て、
本文を直して保存し直します（⚠️ は意図したものなら残してよい）。

### 六、記録を更新する

3つとも、この章で変わったことだけを渡します。形はツールの説明にある例のとおりにします。
形が違うと何も書き込まれず ❌ と理由が返るので、案内どおりに直して渡し直します。
**`.novel/characters/state.json` や `.novel/foreshadow.json` を Edit で直接書き換えて済ませない**でください
（形の確認を通らず、後の章の資料が崩れます）。

```
novel_update(action: "character-state", chapterNumber: {N}, content: '{"updates":[{"name":"人物名","changes":{"mentalState":"…","events":["…"]}}]}')
novel_update(action: "summary", chapterNumber: {N}, content: "この章だけのあらすじ（300〜600文字。前の章の分は書かない）")
novel_update(action: "foreshadow", chapterNumber: {N}, content: '{"items":[{"id":"F1","status":"resolved"}]}')
```

- 人物の `changes` で使えるキーは status / role / physicalState / mentalState / items / abilities / relationships / firstPerson / addressTerms / events / lastUpdatedChapter だけ
- この章で一人称や呼び方が変わったら（苗字から名前へ、敬語からため口へ）、`firstPerson` や `addressTerms`（`{ "相手": "いまの呼び方" }`）で残す
- 伏線の status は `pending` / `planted` / `resolved` / `abandoned` だけ。補強しただけなら status は変えず `notes` に書く
- 新しい伏線は `title` と `content` を付けて渡す（id は省略できる）
- 節のときは3つとも `section`（と幕間の `chapterNumber`）を渡す。あらすじは「## プロローグ」などの節として残る

### 六の二、シーンの状態を直す

シーン一覧（`.novel/scenes/chapter-{NNN}.md`、無ければ `.novel/scenes.md`）で、
この章で**実際に書いた**シーンの状態を `[x]` に直します。
書かなかった・途中で終わったシーンは `[ ]` や `[-]` のまま残し、報告で触れます。

### 七、報告する

```
✅ 第{N}章「{タイトル}」を書き上げました
📊 文字数：{N}文字（目標 {N}文字）
📁 保存先：chapters/chapter-{NNN}.md
🎯 伏線：張った {N} / 回収した {N}
👤 状態を更新した人物：{N}人

💡 次にやること：/write-chapter {N+1}（プロットで次に幕間やエピローグが来るならそちら）
```

</write-flow>

## 資料がそろわないとき

| 状況 | どうするか |
|---|---|
| プロジェクトが未作成 | `/novel-init` を先に実行してもらう |
| プロットが未作成 | `/novel-outline` を先に実行してもらう |
| 登場人物が未記入 | `/novel-characters` を先に実行してもらう |
| 前の章がまだ | 知らせたうえで続行してよい（第1章を除く） |

## 言語

日本語で書き、日本語で答えます。

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
