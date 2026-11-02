# opencode-novel-plugin — 日本語長編小説のための執筆支援プラグイン

## 概要

OpenCode のサーバープラグインです。日本語の長編小説を書くために、
8つのツール（`novel_init` / `novel_status` / `novel_save_chapter` / `novel_context` / `novel_guide` / `novel_update` / `novel_check` / `novel_export`）、
3つの agent（`novel-planner` / `novel-writer` / `novel-editor`）、
16のRTCOプロンプト、17の文書雛形、5つの skill、11のコマンド、
そしてファイルで持つ作品データの管理を提供します。

本リポジトリは [wmzy/opencode-novel-plugin](https://github.com/wmzy/opencode-novel-plugin) の fork で、
日本語の長編小説執筆向けに全面的に書き直してあります。上流との差分は `README.ja.md` を参照してください。

> 文書の編集には opencode 内蔵の Edit / Write ツールを使います。`.novel/` 配下のファイルはすべて直接編集できます。

## ディレクトリ構成

```
opencode-novel-plugin/
├── src/
│   ├── index.ts              # プラグイン入口。形式: { id, server }
│   ├── commands.ts           # commands/*.md の読み込みと frontmatter の解析
│   ├── constants.ts          # 既定値（DEFAULTS）と資料読み込みの上限（LIMITS）
│   ├── utils.ts              # パス／ファイル／文書解析／進行判定／文字数
│   ├── records.ts            # 記録（人物の状態・伏線・あらすじ）の形の検証と、あらすじの節の扱い
│   ├── character-state.ts    # 人物の状態（章・節ごとの差分と、その時点の状態の組み立て）
│   ├── typography.ts         # 表記の点検（表記規約のうち機械で見られるもの）
│   ├── ruby.ts               # ルビと傍点（読み取り・記法を外す・書き出し先の記法への変換）
│   ├── manuscript.ts         # 原稿用紙の枚数換算（書式を指定したときだけ使う）
│   ├── sections.ts           # 本文の節（プロローグ・幕間・エピローグ）と部
│   ├── doc-sections.ts       # 世界観とコンセプトを節に分け、大事な節に先に枠を配る
│   ├── glossary.ts           # 用語集（表の読み取りと、この章に出る用語の選び出し）
│   ├── prompts.ts            # 16のRTCOプロンプト
│   ├── templates.ts          # 17の文書雛形（Markdown 14 + JSON 3）
│   ├── agent-config.ts       # opencode.json の agent 設定とプラグインの既定の重ね方（mergeAgentConfig）
│   ├── agents/
│   │   ├── novel-planner.ts  # 企画を手伝うコーチ
│   │   ├── novel-writer.ts   # 本文を手伝うコーチ
│   │   └── novel-editor.ts   # 原稿を見る編集コーチ
│   └── tools/
│       ├── init.ts           # novel_init — プロジェクトの作成
│       ├── status.ts         # novel_status — 進行状況
│       ├── save.ts           # novel_save_chapter — 章の保存
│       ├── context.ts        # novel_context — 執筆用の資料
│       ├── guide.ts          # novel_guide — 進め方の手引き
│       ├── track.ts          # novel_update — 記録の更新
│       ├── check.ts          # novel_check — 表記の点検
│       └── export.ts         # novel_export — 原稿の書き出し
├── test-src/                 # テスト（node:test）。src/ と同じ並びで置く
│   ├── *.test.ts             # src/*.ts のテスト
│   ├── tools/*.test.ts       # src/tools/*.ts のテスト
│   ├── scripts/              # scripts/check-japanese.mjs のテスト
│   └── prepare-test-out.mjs  # test-out/ に commands/ と skills/ を写す
├── scripts/
│   └── check-japanese.mjs    # 中国語の残存チェック
├── commands/                 # スラッシュコマンド（11本）
├── skills/                   # 執筆用の skill（5本）
│   ├── novel-workflow/       # 6工程の進め方（通し作例つき）
│   ├── novel-writing/        # 本文の書き方【表記規約と反AI一覧の正本】
│   ├── novel-editor/         # 原稿の点検
│   ├── novel-wuxia/          # 時代小説・剣豪小説の設定と書き方
│   └── novel-reality/        # 現実から題材を取る（日本法の注意つき）
├── package.json
├── tsconfig.json             # typecheck / test 用（src と test-src。出力は test-out/）
└── tsconfig.build.json       # 配布ビルド用（src だけ。出力は dist/）
```

## 作品データ（.novel/）

```
.novel/
├── config.json              # 作品設定（タイトル／ジャンル／文字数／工程／limits）
├── concept.md               # 作品コンセプト
├── world-building.md        # 世界観（world/{項目}.md に分割も可）
├── glossary.md              # 用語集（造語・固有名詞の読み・意味・使わない表記）
├── characters/
│   ├── profiles.md          # 登場人物の一覧（関係図・対立表）
│   ├── {キャラクター名}.md   # 一人ずつの設定（動機の三角形／アーク／ことばづかい）
│   └── state.json           # 登場人物の状態（章・節ごとの変化）
├── outline-brief.md         # プロット概要
├── outline-detailed.md      # 章別プロット（outline/chapter-001.md に分割も可）
├── scenes.md                # シーン一覧（scenes/chapter-001.md に分割も可）
├── summary.md               # これまでのあらすじ（章ごとに更新）
├── foreshadow.json          # 伏線
├── wuxia/                   # 流派・武芸設定（martialArtsSetting が true のとき作成）
│   ├── sects.md             # 流派・勢力（sects/{流派名}.md に分割も可）
│   ├── martial-arts.md      # 剣術・技
│   └── weapons.md           # 刀剣（weapons/{刀剣名}.md に分割も可）
├── reality-source.md        # 取材メモ（reality/events/ などに分割も可）
├── chapters/                # 本文
│   ├── prologue.md          # プロローグ（置くときだけ）
│   ├── chapter-001.md
│   ├── interlude-001-1.md   # 第1章のあとの1つ目の幕間（置くときだけ）
│   ├── chapter-002.md
│   ├── ...
│   └── epilogue.md          # エピローグ（置くときだけ）
└── drafts/                  # 旧稿（保存し直したときに前の原稿を残す）
    └── chapter-001-20261031-153012.md
```

> `wuxia` というディレクトリ名は上流からの互換のために残しています。
> 中身は日本の時代小説・剣豪小説向けの「流派・武芸設定」です。

## ツール

| ツール | 用途 | 主な引数 |
|---|---|---|
| `novel_init` | プロジェクトの作成 | title, genre, targetWords, chapterCount, narrativePerspective, martialArtsSetting, form, serial, style |
| `novel_status` | 進行状況 | detailed |
| `novel_save_chapter` | 章の保存 | section, chapterNumber, interludeIndex, title, content |
| `novel_context` | 執筆用の資料 | section, chapterNumber, interludeIndex, sceneId, includePrompts |
| `novel_guide` | 進め方の手引き | section |
| `novel_update` | 記録の更新 | action, content, section, chapterNumber, interludeIndex |
| `novel_check` | 表記の点検 | section, chapterNumber, interludeIndex, maxIssues |
| `novel_export` | 原稿の書き出し | format, numerals, fromChapter, toChapter, outputPath |

> コンセプト・世界観・登場人物・プロット・シーンなどの文書は、opencode 内蔵の Edit / Write ツールで編集します。
> パスの対応は各 agent のプロンプトにあります。

## agent

| agent | 用途 | mode | temperature |
|---|---|---|---|
| `novel-planner` | 企画（コンセプト／世界観／人物／プロット／シーン）＋取材 | primary | 0.3 |
| `novel-writer` | 本文の執筆 | primary | 0.7 |
| `novel-editor` | 原稿の点検（つじつま／文章／緩急／表記） | primary | 0.1 |

> 各ファクトリは `mode: "subagent"` を返しますが、`src/index.ts` の `config` フックで
> `primary` に上書きしています。3つとも主 agent セレクタに出ます。
>
> プラグインは agent に `model` を書きません（既定のモデルを持たない）。書くと、その agent に
> 切り替えた時点で OpenCode の画面で選んだモデルから書いたモデルへ切り替わるためです。
> `opencode.json` 全体の `model` も agent に写しません。agent ごとに固定したいときは、
> 利用者が `agent.<名前>.model` に書きます。
>
> `opencode.json` の `agent` に同じ名前で設定を書けば、そちらが**キー単位で**勝ちます
> （`model` だけ書いてもプロンプトや温度は残ります）。`permission` / `options` / `tools` は
> **中身ごと重ねます**（`src/agent-config.ts` の `mergeAgentConfig`）。利用者が書いたキーだけが勝ち、
> 書いていないキーはプラグインの既定（`novel-writer` / `novel-editor` の `webfetch: "deny"` など）が残ります。
>
> OpenCode は config フックに渡す前に、利用者の agent 設定へ `options: {}` と `permission: {}` を足します
> （`model` しか書いていなくても）。キー単位で上書きするだけだと、この空の `permission` が
> プラグインの権限を消し、OpenCode の既定（すべて許可）で動いてしまいます。
> 解決後の設定は `opencode debug agent <名前>` で確かめられます。

## skill

| skill | 用途 | 読み込む場面 |
|---|---|---|
| `novel-workflow` | 6工程の進め方（『九月の忘れもの』の通し作例つき） | 企画の段階 |
| `novel-writing` | **表記規約と反AI一覧の正本**、五感、緩急 | 本文を書くとき |
| `novel-editor` | つじつま確認、六回に分けて見る手順、点検結果の雛形 | 原稿を見るとき |
| `novel-wuxia` | 流派・武芸の設定、立ち合いの書き方、筋立ての型、刀剣、作法 | 時代小説・剣豪小説のとき |
| `novel-reality` | 三つの手法、異化の技法、人物の型、**日本法の注意** | 現実から題材を取るとき |

## コマンド

| コマンド | 用途 | 引数 |
|---|---|---|
| `/novel` | 進行を確かめ、次にやることを案内する | なし |
| `/novel-init` | プロジェクトを作る | `[タイトル]` |
| `/novel-concept` | 作品の核を決める | なし |
| `/novel-world` | 世界観を組み立てる | なし |
| `/novel-characters` | 登場人物を設計する | なし |
| `/novel-outline` | プロットを作る | なし |
| `/novel-scenes` | 各章をシーンに割る | なし |
| `/novel-reality` | 現実から題材を取る | なし |
| `/write-chapter` | 1章の本文を書く | `<章番号 \| prologue \| interlude <章番号> [何番目] \| epilogue>`（章を分けない短編は省ける） |
| `/novel-status` | 進行状況を見る | なし |
| `/novel-review` | 原稿を点検する | `<章番号\|all>` `--focus=consistency\|style\|pace\|typography\|full` |

各コマンドは frontmatter の `agent` で動かす agent を指定します。`/novel-status`
以外はすべて指定があり、実行すると専用のプロンプト・温度・権限に切り替わります。

`src/commands.ts` が frontmatter を読み、`config.command` に渡します。
渡すのは `COMMAND_CONFIG_KEYS`（`description` / `agent` / `model` / `subtask`）と
本文から作る `template` だけです。OpenCode の `Config` 型が受け付けるのは
この5つなので、`argument-hint` のような他のキーは渡しません
（人が読む情報として frontmatter に置くのはかまいません）。

## 工程

```
0:コンセプト → 1:世界観 → 2:人物 → 3:プロット → 4:シーン → 5:本文（繰り返し）
```

工程ごとに入力・出力・確認項目があります。前の工程が済んでいることが次の工程の前提です。

進行段階の判定（`determinePhase`）は、`novel_init` が雛形として先に作る3文書
（concept.md / world-building.md / characters/profiles.md）については
**角括弧プレースホルダ（`[…]`）が残っていないか**で記入済みを判断します。
プロット概要・章別プロット・シーン一覧はファイルの有無で判断します。
章別プロットとシーン一覧は、統合ファイル（`outline-detailed.md` / `scenes.md`）でも
章ごとの分割（`outline/chapter-*.md` / `scenes/chapter-*.md`）でも可とします。
本文の数が `chapterCount` に達すると `completed` を返します。

**短編**（`config.json` の `form` が `"short"`）は世界観と章別プロットの判定を飛ばし、
concept → characters → outline（`outline-brief.md` があるか）→ scenes → writing と進みます。
`Phase` の型は変えず、world-building という段階が短編では出てこないだけです。

**連載**（`config.json` の `serial` が `true`）は、章数で `completed` にしません。
`chapters/epilogue.md` があれば `completed`、無ければ `writing` です（`chapterCount` は目安）。

## 分割保存

長編では文書が大きくなるため、agent とコマンドは章ごと・項目ごとの分割保存を
案内しています。`novel_context` は統合ファイルと分割の両方を読み、分割が
あればそちらを優先します。

| 資料 | 統合ファイル | 分割 | 両方ある場合 |
|---|---|---|---|
| 章別プロット | `outline-detailed.md` | `outline/chapter-NNN.md` | 分割を使う |
| シーン一覧 | `scenes.md` | `scenes/chapter-NNN.md` | 分割を使う |
| 世界観 | `world-building.md` | `world/**/*.md` | 両方を載せる |
| 一人ずつの人物設定 | `characters/profiles.md` | `characters/{キャラクター名}.md` | 両方を載せる |
| 流派・勢力 | `wuxia/sects.md` | `wuxia/sects/*.md` | 両方を載せる |
| 剣術・技 | `wuxia/martial-arts.md` | `wuxia/martial-arts/*.md` | 両方を載せる |
| 刀剣 | `wuxia/weapons.md` | `wuxia/weapons/*.md` | 両方を載せる |
| 取材メモ | `reality-source.md` | `reality/**/*.md` | 両方を載せる |

章別プロットとシーン一覧はその章の記述が一箇所に収まるため分割を優先します。
設定の資料は統合ファイルを概観として残す使い方ができるため両方を載せます。

人物の個別設定は、この章のプロットとシーンに名前が現れたものだけを載せます
（`selectCharacterDocs`）。照合は二段です。2文字以上の手がかり（フルネーム・姓・名・
呼称）で照合し、当たらなかった人物だけ1文字の手がかりで再照合します。
一段目で誰かが当たっても二段目を省きません（省くと一文字姓などが落ちる）。
名前から切り出す1文字は漢字のときだけ手がかりにします（`characterNameKeys`。仮名1文字の「ン」などはほとんどの文に当たる）。
1文字の名前そのものと、書かれた呼称は仮名でも使います。
人物設定に `呼称` を書けば、推定に頼らず明示できます（雛形のままの行は読まない。`isPlaceholderValue`）。
誰も特定できなければ全員を載せます。

複数ファイルから集めた資料は `clipDocParts` / `allocateCharBudget` で
`limits` の枠を短いものから順に満たす形で配分します。連結してから先頭で切ると
前のファイルが長いだけで後ろが丸ごと落ちるためです。
`sceneId` で指定したシーンは `priority` を立てて先に枠を配ります（表示順だけ
変えても、単独なら収まる長さが切られてしまう）。

`novel_status` の工程表示は `hasOutlineDetailed` / `hasSceneList` を使い、
`determinePhase` と同じ基準で分割保存を見ます。シーン進捗は `collectScenes` を
使い、同じ章が統合ファイルと分割の両方にあるときは分割側だけを数えます
（単純に連結すると、分割へ移したあとも統合側に残る古い記述を二重に数える）。

`novel_status` の本文の集計は `listManuscriptFiles`（下の「本文の節」）で本文のファイルの一覧を一度だけ取り、
返されたパスを読んだ1つの集計値を、章数・累計・平均・分量の不足表示に使う。章数と1章平均は章だけ、
累計と原稿用紙換算は節も含める。`chapters/` の本文以外の `.md` は数えない
（以前は累計だけ全 `.md` を数え、同じ画面で数字が食い違っていた）。
読み込めない章があるときは、章数を「章ファイル N章 ／ 集計できた本文 M章」と分けて示す
（章ファイルの数は `determinePhase` と同じ。累計と平均は読めた M 章から出す）。

章ファイルと認めるのは、`scenes/` や `outline/` の**直下**にある
`chapter-<数字>.md` だけです（`utils.ts` の `CHAPTER_FILE_PATTERN`）。
`backup-chapter-002.md`、`chapter-002.md.bak`、`scenes/old/chapter-002.md` は
章ファイルとみなしません。読み込み（`readChapterDoc` / `listChapterDocs`）、
存在判定（`hasChapterDocs`）、集計の除外判定（`collectScenes` / `chapterDocNumber`）が
すべてこの定義を共有します。条件がずれると、読まないファイルを根拠に統合ファイルを
集計から外し、執筆資料と進捗が食い違います。

## 本文の節（プロローグ・幕間・エピローグ）と部

`src/sections.ts`。章のほかに、章の数に入らない「節」を3種類置けます。

| 節 | ファイル | 読む順番 | 記録の章番号（`recordChapterOf`） |
|---|---|---|---|
| プロローグ | `chapters/prologue.md` | 第1章の前 | 0 |
| 幕間 | `chapters/interlude-005-1.md`（第5章のあとの1つ目） | 第5章のあと（同じ章のあとは番号順） | 直前の章（5） |
| エピローグ | `chapters/epilogue.md` | 最後の章のあと | 本文のある最後の章（`lastChapterForRecords`。1章も無ければ `chapterCount`） |

- **節は章の数に入れない**。`determinePhase` / `countWrittenChapters` / `listChapterFiles` / シーンIDは章だけで動く。
  原稿全体を扱うところ（累計・原稿用紙換算・`novel_check`・`novel_export`・前の本文の末尾）だけが
  `listManuscriptFiles` で章と節を読む順番（`compareSections`）に並べて使う
- 正式な本文ファイルは `CHAPTER_FILE_PATTERN` と `sectionFromFileName`（`prologue.md` / `epilogue.md` /
  `interlude-<数字>-<数字>.md`）の2つで決まる。先頭と末尾を固定し、`chapters/` の直下だけを見る
- ツールは `section`（chapter / prologue / interlude / epilogue）・`chapterNumber`・`interludeIndex` で節を指す
  （`sectionFromArgs`）。章と幕間では `chapterNumber` が要る
- 保存する見出しは `# プロローグ タイトル` / `# 幕間 タイトル` / `# エピローグ タイトル`。幕間の位置はファイル名が持つ。
  `stripChapterHeading` / `chapterTitleFromHeading` はこれらも見出しとして扱う
- 呼び名は `sectionLabel`（「幕間（第5章のあと）」、2つ目からは「幕間（第5章のあと・2）」）。章別プロットの見出しと
  あらすじの見出しはこの形で、`parseSectionLabel` で読み戻す。位置の無い「幕間」だけの見出しは読まない
- 前の本文の末尾は `previousManuscriptFile`。読む順番ですぐ前の本文を選び、間が欠けていれば載せない
- **あらすじは節も持つ**（`## プロローグ …` など。`SummarySection.section`）。資料には読む順番で前のものだけを載せる。
  「全体の流れ（第N章まで）」は第N章のあとの幕間まで含むとみなす
- **伏線は章番号のまま**。`plantChapter` / `resolvedChapter` は 0（プロローグ）を
  受け付ける。`targetChapter` は1以上のまま。`novel_update` に `section` を渡すと `recordChapterOf` の章番号で記録する
- **人物の状態は節のキー（`sectionKey`：`prologue` / `chapter-001` / `interlude-001-1` / `epilogue`）で持つ**。
  `recordChapterOf` / `lastChapterForRecords` は使わない（伏線と違い、節そのものの位置で前後が決まるため）
- **部は `config.json` の `parts`**（`[{ title, fromChapter }]`。章番号は部をまたいで通し）。`parseParts` で読み、
  昇順でない・題が空などの形の誤りは `novel_status` で ⚠️、`novel_export` は書き出さずに断る。
  書き出しでは部の最初の章の前に部の見出しを置き（幕間は直前の章の部に残る）、markdown では部を `##`、章と節を `###` にする

## プロンプト

RTCO（Role-Task-Context-Output）の枠組みで書いた16本です。

concept, world-building, characters, outline-brief, outline-short（短編・序破急）, outline-detailed, scenes,
chapter-write, chapter-continue, consistency-check, character-state-update, summary-update

流派・武芸設定: wuxia-martial-arts, wuxia-combat

取材: reality-source, character-archetype

## 決めごと

- データファイルはすべて UTF-8
- 人が読む内容は Markdown（コンセプト、世界観、登場人物など）
- プログラムが読み書きする内容は JSON（設定、状態、伏線）
- 本文のファイル名は自動の連番（chapter-001.md、chapter-002.md、…）。節は prologue.md / interlude-NNN-M.md / epilogue.md
- 本文の章見出しは算用数字で保存する（`# 第1章 タイトル`）。
  プロットの解析側は算用数字・全角数字・漢数字のいずれも読み取る
- **文字数は本文だけを、空白（半角・全角）と改行を除いた全文字数で数える**。
  保存ファイルの先頭にある `# 第N章 タイトル` の見出し行は数に入れない
  （`stripChapterHeading` で外す）。保存時（`novel_save_chapter`）と
  進行状況（`novel_status`）で同じ数が出るようにするため。
- **章見出しは必ず1行に収める**。`novel_save_chapter` は `title` を
  `normalizeChapterTitle` で1行に直してから見出しを作る。改行をそのまま
  埋めると見出しが2行以上になり、`stripChapterHeading` は先頭の1行しか
  外さないため、2行目以降が本文として数えられる。
  本文の行を余分に削るのではなく、見出しを作る側で条件を保証する。
  仮名・漢字・約物・英数字を区別せず1文字として数え、コードポイント単位で走査する。
  ルビと傍点は記法を外して親文字だけを数える（`｜十七《じゅうしち》` は2文字）。
  原稿用紙の枚数とは一致しない（改行で余るマスや字下げを数えないため）
- **記録ファイルは更新の前に厳密に読み直す**（`readForeshadowRecord` / `readCharacterStateRecord` /
  `readTextRecord`）。「無い」「読み込めない」「構文エラー」「形の異常」を区別し、後ろ3つでは元のファイルに
  触れず更新を断る。共通の `safeReadJson` は無いときも壊れているときも null を返すので、更新処理では使わない
  （空とみなすと、壊れたファイルを新しい1件だけで上書きして記録が消える）。形として確かめるのは、更新処理が
  安全に動くのに要るものだけ。伏線の項目ごとの不正は断らない（渡し直して直す経路を塞がないため）。
  `novel_status` / `novel_context` も同じ読み込みを使い、壊れた記録を空と区別して示す
- **`novel_update` は形を確かめてから保存し、外れていれば何も書かない**（`src/records.ts`）。
  人物の `changes` と伏線の項目は zod の `strict` で、知らないキーも断る。伏線の `status` を
  日本語から読み替えることはしない（「補強済み」のように対応する値が無いものがあるため）。
  ツールの説明に形と例を載せ、断るときも正しい形の例を返す。
  検証を入れる前に保存された崩れた伏線は `splitForeshadowEntries` で分け、
  `novel_context` と `novel_status` で別に示す（回収済みを「未回収」と知らせないため）。
  保存済みの記録も入力と同じスキーマで確かめる（章番号の型の誤りは期限の判定を誤らせる）
- 独自のキー（以前の保存で入った `detail` など）は通常の更新では消さない。`removeKeys` で
  明示されたときだけ外す。題と中身がそろっていても、独自のキーの内容を移し終えた証拠にはならない
- 更新の報告は入力の件数ではなく、更新前と比べて実際に変わったもの。変化が無ければ書かずに `ℹ️` で返す
- 伏線の回収章（`resolvedChapter`）を `chapterNumber` で補うのは、その更新で回収済みに変わったときだけ。
  回収済みのものへの送り直しで回収章を書き換えない
- 章番号はツールの引数（`novel_update` / `novel_save_chapter` / `novel_context`）でも、あらすじの見出しでも
  1以上の整数に限る。`1.5` を通すと読み戻せない見出し（第1.5章）が保存される
- **あらすじは章ごとの節で持つ**（`## 第N章 タイトル` と `## 全体の流れ`）。
  `novel_update(summary)` は渡された章の節だけを差し替える。丸ごと置き換えると、
  モデルが毎回その章の分だけを渡すため前の章が消え続ける。
  `novel_context` は直前の章から順に枠へ詰める（先頭から切ると新しい章が落ちる）。
  書く章以降の内容は載せない。「全体の流れ」は見出しに `（第N章まで）` を残してそれで判定し、
  旧形式の記述（`## 物語の進み` など）は、初めて書き込むときに `## 以前の形式のあらすじ（第N章まで）` へ移して
  範囲を固定する（読み込むたびに推定すると、過去の章を足しただけで範囲が縮み先の出来事が混ざる）。
  範囲は、本文のある最後の章・移す前の章の節の最大章番号・差し込む章の直前のうち最大のもの。
  移す前の章の節は `upsertSummarySections` の中で必ず加える（移しただけで範囲が縮まないように）
- 取材メモ・流派・武芸設定の統合ファイルは、**雛形から一文字も変えていなければ**資料に載せない
  （`isUntouchedTemplate`）。角括弧が残っているだけでは除かない（一部だけ書いたメモまで落ちるため）
- `novel_status` は「完結」（予定の章数がそろった）とは別に、あらすじの欠け、
  本文があるのに完了になっていないシーンが残る章（一部だけのものはシーンIDも）、
  形の崩れた伏線、分量の不足を「記録の点検」として示す
- **表記の点検（`src/typography.ts`）は `novel-writing` skill の表記規約を写したもの**。規約を変えたら両方を直す。
  感嘆符・疑問符の重ねや組み合わせ（`！！` `！？` `？！`）は許し、続けたものを1つの約物として扱う。
  会話行（「『で始まる行）は字下げしない。`novel_save_chapter` は保存したファイルをそのまま点検して
  件数を報告に添える（行番号が保存ファイルと一致するように）
- **原稿用紙換算は、書式を指定したときだけ出す**（`config.json` の `manuscript: "20x20"`、または
  `novel_status` / `novel_export` の引数 `manuscript`。引数が優先）。指定が無ければどの出力も変えない。
  目標・平均・分量の不足の判定は常に文字数で行い、枚数で置き換えない（Web 小説の文字数で書く使い方を邪魔しないため）。
  数え方は `src/manuscript.ts`（段落ごとに改行、字下げも1マス、行頭の句読点・閉じ括弧はぶら下げ、
  ルビの記法は外す、空行と章見出しは数えない、全体の行数を切り上げで枚数にする）
- **ルビと傍点はカクヨムの記法で持つ**（`｜親文字《ルビ》`・`漢字《ルビ》`・`《《傍点》》`・`｜《` で《そのもの）。
  読み取りは `src/ruby.ts` の `parseRubyLine` だけで行い、文字数（`countWords` は記法を外して親文字だけを数える）、
  表記の点検（記法の崩れは元の行で拾い、ほかの規則は `stripRubyLine` で記法を外した行で見て、字の位置を元の行に戻す）、
  書き出し（`convertRuby`）が同じ解釈を共有する。漢字の続かない《…》は括弧として残す
- `novel_export` は本文を書き換えない。保存ファイルの見出しは算用数字のままにし、書き出すときに
  漢数字へ直す。書き出し先は作品のディレクトリの中に限り、`.novel/chapters/` には書かない。
  パスの文字列だけで判定せず、書き出し先がリンクなら断り、親ディレクトリは実体（realpath）で判定する
  （リンク経由で章ファイルや作品の外を上書きしないため）
- **`novel_save_chapter` はすでにある章を黙って上書きしない**。内容が変わるときは、前の原稿を
  `.novel/drafts/chapter-NNN-YYYYMMDD-HHMMSS.md` に残してから書く（同じ秒なら `-2` を付ける）。
  旧稿は chapters/ の外に置き、名前も章ファイルの形から外す（章として数えないため）。
  いまの章ファイルを読み込めないときは、旧稿を残せないので保存を断る
- 読み込めない章（`safeReadFile` が null）は空の本文と区別する。`novel_export` は何も書かずに断り、
  `novel_check` は点検できなかった章として示す（空として扱うと欠落が「成功」「問題なし」になる）
- **人物の状態（`state.json`）は章・節ごとの差分で持つ**（`src/character-state.ts`）。形は
  `{ "sections": { "chapter-001": { "updates": [{ name, changes }] } } }`。状態そのもの（スナップショット）は保存しない。
  ある節を書くときの状態は、それより前の節の差分を読む順番（`compareSections`）に重ねて組み立てる（`statesBefore`）。
  前の章を書き直したとき、その節の差分を差し替えるだけで後ろの節の資料に反映させるため（スナップショットだと後ろの記録と食い違う）
  - `changes` のキーは status / physicalState / mentalState / attributes（`{ 項目: 値 }`）/ lists（`{ 一覧: { added, removed } }`）/
    relationships / speech（firstPerson・addressTerms）/ events。`null` で欄を消す。`role` は持たない（群像劇で章ごとに主役が替わるため）。
    attributes と lists の項目名は作品ごとに決める。揺れを防ぐため、すでに使っている項目名を更新の報告・資料・更新用プロンプトで示す（`stateKeyNames`）
  - `novel_update(character-state)` は章・節の指定が必須。同じ節への再送はその節の差分に重ね（`mergeChanges`）、`"replace": true` で置き換える。
    `{"updates": []}` は「記録済み・変化なし」。報告はその節を書き終えた時点の状態の前後の差（`describeStateChange`）で、
    すでに記録のある節で変化が無ければ書かない。出来事の重複は同じ節の中だけで判定する
  - `novel_context` は書く章より前の記録だけを載せる。この章のプロット・シーンに出る人物を上に詳しく、ほかを下に1行で並べ、
    死亡・行方不明・退場は変わった節とともに示す。出来事は直近5件まで。枠は `limits.characterState`（コードポイントで数え、
    1人目を途中で切ったときも省略を示す）
  - 記録の名前とプロット・人物設定の照合は `characterNameKeys` の手がかりで行う（記録がフルネームでプロットが姓だけ、
    記録が下の名前でファイルがフルネーム、のどちらでも結ぶ。`docMatchesName` / `statesInText`）。1文字の手がかりの扱いは
    人物設定の選び方と同じ（名前から切り出す1文字は漢字だけ）。誰も特定できなければ全員を上に置く
  - 中身の無い欄（`{ "added": [], "removed": [] }`、空の対応表、空の events）は保存前に外す（`compactChanges`）。
    外して何も残らない人物は「変更なし」として記録に入れない。項目名の案内（`stateKeyNames`）は値の入ったことがある項目名だけを数える
  - `novel_status` は本文があるのに記録の無い章・節を「記録の点検」で示す
  - 人物設定（`characters/{名前}.md`）は変わらない設定の正本で、章ごとの記録の表は持たない
- **ことばづかい（一人称・二人称・敬語・相手ごとの呼び方）は、初めの設定を人物設定に、途中の変化を `state.json` の `speech` に置く**。
  人物設定の `## ことばづかい` と `### 相手ごとの呼び方` の表を `extractSpeechProfile` が読み、
  `novel_context` が書く章より前の記録の `firstPerson` / `addressTerms` を上に重ねて「🗣️ ことばづかい」として載せる。
  人物設定の全文とは別に載せ、`clipDocParts` に入れない（人物設定が長いと切られて、ぶれやすい部分が落ちるため）。
  枠は `limits.speech`。雛形の項目名に「呼称」「別名」などを使わない（`extractNameAliases` に別名として拾われる）
- **コンセプト・世界観・用語集は執筆用の資料に載せる**（`novel_context`）。コンセプトは `conceptParts`（`src/doc-sections.ts`）で節に分け、
  ログライン・作品テーマ・文体と手ざわりに先に枠を配る（`limits.concept`）。「基本情報」は作品情報（config.json）と同じなので載せない。
  雛形の差し込み箇所（`{genre}` など）は、何が入っていても雛形の行とみなす。
  世界観は `worldBuildingParts`（同じファイル。共通の処理は `templateDocParts`）で `## ` の節に分け、
  見出しに「約束ごと」「能力体系」を含む節に `priority` を立てて先に枠を配る（`limits.worldBuilding`）。雛形から書き換えていない節は載せず、
  書きかけの節からは雛形のままの記入欄の行（雛形と同じ行で角括弧を含むもの）だけを外し、それで中身の無くなった小見出しと表も外す。
  節の中の見出しは1段下げる（資料では節の見出しを `###` で付けるため）。題の行（`# 『題』世界観`）は載せない。
  `world/**/*.md` の分割は節に分けずにファイルごとに載せる
- **用語集は `.novel/glossary.md` の表**（`| 用語 | 読み | 意味 | 使わない表記 |`。`src/glossary.ts`）。`novel_init` が長編・短編とも雛形を作る
  （造語は世界観の工程を省いても出てくるため）。列は名前で読み、ほかの列は「名前：値」で添える。「用語」の列の無い表は読まない。
  直前の `##` 以下の見出しを分類にする。この章のプロット・シーン（人物の照合と同じ `chapterText`）に用語・読み・使わない表記のどれかが出るものを先に、
  残りをあとに、1行単位で `limits.glossary` に詰める。1文字の手がかりは漢字だけ。表が1つも読めなければ文書をそのまま載せる。
  用語集を `world-building.md` の中にも置ける形にはしない（二か所に書くと食い違うため）
- **用語集の「使わない表記」は表記の点検で ⚠️ として拾う**（`checkTypography` の `glossary`。材料は `readGlossaryCheck`）。`novel_check` と
  `novel_save_chapter` の報告の両方に出る。⚠️ にとどめるのは、人物がわざと言い間違える台詞があるため。ルビの記法を外した親文字で見る
  （ルビの読みは見ない）。正しい表記の中に含まれる箇所（「魔素結晶」の中の「魔素」）は拾わず、同じ位置では長い表記を採る。
  1文字の使わない表記は漢字だけ使う。`novel_export` は ❌ だけを数えるので影響しない
- **短編は `config.json` の `form: "short"`**（未指定は長編。既存の作品はそのまま動く）。既定値は `SHORT_DEFAULTS`
  （20,000文字・1章＝章なし）。`novel_init` は短編では `world-building.md` を作らない。プロット概要は三幕ではなく
  序破急で組み（`outline-short` / `SHORT_OUTLINE_BRIEF_TEMPLATE`）、章別プロットを作らないので、`novel_context` は
  章別プロットが無ければプロット概要を載せる（`limits.outlineBrief`）。`novel_export` は、作品に章が1つしか無ければ
  章見出しを付けず、2つ以上なら「一」「二」にする（保存ファイルの見出しは `# 第1章 …` のまま）
- **序破急は緩急（速さ）の原理として扱う**。序＝ゆるやかに短く、破＝細部を重ねて速さを上げる（いちばん長い）、
  急＝山場と決着を速く短く。**「破」を山場と取り違えない**（山場は急の中）。起承転結の「転」を危機と取り違えるのと
  同じ型のずれ。三幕との対応は 序＝第一幕、破＝第二幕、急＝第三幕。長編の骨組みは三幕のままで、序破急は
  場面や章の緩急を見直す物差しとして案内する
- **連載（結末未定）は `config.json` の `serial: true`**。`chapterCount` と `targetWords` は目安で、超えて書いても崩れない。
  完結はエピローグがあるかで判定し、`novel_status` は分量の不足を知らせず、次の章の章別プロットを足すよう案内する。
  `novel_context` は章別プロットの無い章で ⚠️ を出す（連載では章別プロットを章ごとに足していくため）
- **エピローグの伏線の記録の章番号は、本文のある最後の章**（`lastChapterForRecords`。1章も無ければ `chapterCount`）。
  人物の状態はエピローグそのものの節（`epilogue`）として記録するので、この章番号を使わない。
  予定章数を使うと、予定を超えて書いた作品でエピローグの回収章が張った章より前になり、伏線の期限も予定章数で切れる。
  あらすじの基準（`lastWritten`）とも揃う。部の最後の範囲も `max(chapterCount, 書いた最後の章)` で示す。これは連載でなくても同じ
- **文体の既定はライトノベル寄り**（`config.json` の `style` なし）。文芸寄りは `style: "literary"`。正本は `novel-writing` skill の
  「文体の寄せ方」の表。ライトノベル寄りでは、単位付きの数やステータスは算用数字でよく、間の1行あけも可、語り手の軽口の比喩も可。
  機械の点検で変わるのは地の文の算用数字だけ（`checkTypography` の `style`。文芸寄りでだけ ⚠️）。
  比喩の回数の上限は置かない（型の直喩の連発を避ける）。視点は「同じ場面の中で入れ替えない。替えるなら区切りで場面を分ける」
- **工程の番号は0〜5の6工程**（0 コンセプト、1 世界観、2 人物、3 プロット＝段A 概要・段B 章別、4 シーン、5 本文）。
  手引き・プロンプトのコメント・README もこの数え方にそろえる
- **`/write-chapter` は一括で書く**（候補出し・二通りの書き比べ・技法の注記を挟まず、本文だけを保存して報告する）。
  候補や注記を挟むコーチの進め方は、コマンドを使わずに `novel-writer` と話すとき（または頼まれたとき）だけ。
  1章の分量は `novel_context` の「この章の目安」（目標文字数÷章数）に従い、3,000〜6,000文字は設定が無いときの目安
- **`novel_context` の末尾は「書くときの条件」だけ**（分量・視点・書き出しか続きか）。プロンプトの全文は写し直さない
  （上の資料と二重になり、表記規約と言い回しの一覧も skill と重なるため）。`chapter-write` などは `novel_update(prompt)` で引ける
- **`novel_update(prompt)` の差し込みは `buildPromptVars` で作品設定から埋める**（三幕は25%ずつ、序破急は 2:6:2、幕の章数は
  合計が章数と一致するように境界の差で出す）。章番号は 0（プロローグ）も埋める。書き手の材料（`{protagonistName}` など）は
  埋めずに一覧で示す
- **点検結果の形の正本は `novel-editor` skill の「点検結果の雛形」**。agent とつじつま確認のプロンプトはそれを指し、
  つじつまだけを見るときは skill の「つじつまの確認」の表で返す（JSON は使わない）
- 既定値は `src/constants.ts` の `DEFAULTS` に一元化する。
  目標文字数 120,000／章数 40／視点「三人称一元視点」
- 資料読み込みの上限は `src/constants.ts` の `LIMITS` が既定値。
  `.novel/config.json` の `limits` で作品ごとに上書きできる
- 流派・武芸設定の有無は `config.json` の `martialArtsSetting`。
  未指定ならジャンルから推定する（「剣豪」「剣客」「武侠」「チャンバラ」「時代活劇」「剣戟」のみ。
  「武士」「武装」「武家」などには反応しない）

## 開発

```bash
pnpm install
pnpm typecheck   # 型検査（テストも含む）
pnpm test        # node:test で実行（test-src/ の *.test.ts と *.test.mjs、624件）
pnpm build       # 配布用ビルド（dist/、テストを除く）
pnpm check:ja    # 中国語の文字列が残っていないか調べる
```

テストは `src/` に置かず `test-src/` にまとめます（`src/` は配布する本体だけ）。
`test-src/` は `src/` と同じ並びにし、本体を `../src/…` で import します。
`pnpm test` は `tsc` で `src/` と `test-src/` を `test-out/` に出力してから走らせます。
本体は `test-out/src/` に入り、`src/index.ts` は自分の位置から `../commands` と `../skills` を読むため、
`test-src/prepare-test-out.mjs` が実物を `test-out/` の直下に写します（本体をテストに合わせて変えない）。

リリースは自動では走りません。GitHub の Actions 画面から Release ワークフローを
手動で実行します（既定は試し実行）。詳しくは `README.ja.md` の「公開」を参照。

## 依存

- `@opencode-ai/plugin` >= 1.4.0（peer dependency）
- `zod` ^3.24.0（引数の検証）
- 開発: `typescript`、`@types/node`。テストは Node 24 標準の `node:test` を使い、追加の依存はありません
