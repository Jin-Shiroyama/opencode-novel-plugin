# opencode-novel-plugin — 日本語長編小説のための執筆支援プラグイン

## 概要

OpenCode のサーバープラグインです。日本語の長編小説を書くために、
6つのツール（`novel_init` / `novel_status` / `novel_save_chapter` / `novel_context` / `novel_guide` / `novel_update`）、
3つの agent（`novel-planner` / `novel-writer` / `novel-editor`）、
15のRTCOプロンプト、15の文書雛形、5つの skill、11のコマンド、
そしてファイルで持つ作品データの管理を提供します。

本リポジトリは [wmzy/opencode-novel-plugin](https://github.com/wmzy/opencode-novel-plugin) の fork で、
日本語の長編小説執筆向けに全面的に書き直してあります。上流との差分は `README.ja.md` を参照してください。

> 文書の編集には opencode 内蔵の Edit / Write ツールを使います。`.novel/` 配下のファイルはすべて直接編集できます。

## ディレクトリ構成

```
opencode-novel-plugin/
├── src/
│   ├── index.ts              # プラグイン入口。形式: { id, server }
│   ├── constants.ts          # 既定値（DEFAULTS）と資料読み込みの上限（LIMITS）
│   ├── utils.ts              # パス／ファイル／文書解析／進行判定／文字数
│   ├── utils.test.ts         # ユニットテスト（node:test）
│   ├── prompts.ts            # 15のRTCOプロンプト
│   ├── templates.ts          # 15の文書雛形（Markdown 12 + JSON 3）
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
│       └── track.ts          # novel_update — 記録の更新
├── commands/                 # スラッシュコマンド（11本）
├── skills/                   # 執筆用の skill（5本）
│   ├── novel-workflow/       # 6工程の進め方（通し作例つき）
│   ├── novel-writing/        # 本文の書き方【表記規約と反AI一覧の正本】
│   ├── novel-editor/         # 原稿の点検
│   ├── novel-wuxia/          # 時代小説・剣豪小説の設定と書き方
│   └── novel-reality/        # 現実から題材を取る（日本法の注意つき）
├── package.json
├── tsconfig.json             # typecheck / test 用（テストを含む）
└── tsconfig.build.json       # 配布ビルド用（テストを除く）
```

## 作品データ（.novel/）

```
.novel/
├── config.json              # 作品設定（タイトル／ジャンル／文字数／工程／limits）
├── concept.md               # 作品コンセプト
├── world-building.md        # 世界観
├── characters/
│   ├── profiles.md          # 登場人物の一覧（関係図・対立表）
│   ├── {キャラクター名}.md   # 一人ずつの設定（動機の三角形／アーク／章ごとの記録）
│   └── state.json           # 登場人物の現在の状態
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
└── chapters/                # 本文
    ├── chapter-001.md
    ├── chapter-002.md
    └── ...
```

> `wuxia` というディレクトリ名は上流からの互換のために残しています。
> 中身は日本の時代小説・剣豪小説向けの「流派・武芸設定」です。

## ツール

| ツール | 用途 | 主な引数 |
|---|---|---|
| `novel_init` | プロジェクトの作成 | title, genre, targetWords, chapterCount, narrativePerspective, martialArtsSetting |
| `novel_status` | 進行状況 | detailed |
| `novel_save_chapter` | 章の保存 | chapterNumber, title, content |
| `novel_context` | 執筆用の資料 | chapterNumber, includePrompts |
| `novel_guide` | 進め方の手引き | section |
| `novel_update` | 記録の更新 | action, content, chapterNumber |

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
| `/write-chapter` | 1章の本文を書く | `<章番号>` |
| `/novel-status` | 進行状況を見る | なし |
| `/novel-review` | 原稿を点検する | `<章番号\|all>` `--focus=consistency\|style\|pace\|typography\|full` |

## 工程

```
0:コンセプト → 1:世界観 → 2:人物 → 3:プロット → 4:シーン → 5:本文（繰り返し）
```

工程ごとに入力・出力・確認項目があります。前の工程が済んでいることが次の工程の前提です。

進行段階の判定（`determinePhase`）は、`novel_init` が雛形として先に作る3文書
（concept.md / world-building.md / characters/profiles.md）については
**角括弧プレースホルダ（`[…]`）が残っていないか**で記入済みを判断します。
プロット概要・章別プロット・シーン一覧はファイルの有無で判断します。
本文の数が `chapterCount` に達すると `completed` を返します。

## プロンプト

RTCO（Role-Task-Context-Output）の枠組みで書いた15本です。

concept, world-building, characters, outline-brief, outline-detailed, scenes,
chapter-write, chapter-continue, consistency-check, character-state-update, summary-update

流派・武芸設定: wuxia-martial-arts, wuxia-combat

取材: reality-source, character-archetype

## 決めごと

- データファイルはすべて UTF-8
- 人が読む内容は Markdown（コンセプト、世界観、登場人物など）
- プログラムが読み書きする内容は JSON（設定、状態、伏線）
- 本文のファイル名は自動の連番（chapter-001.md、chapter-002.md、…）
- 本文の章見出しは算用数字で保存する（`# 第1章 タイトル`）。
  プロットの解析側は算用数字・全角数字・漢数字のいずれも読み取る
- **文字数は空白（半角・全角）と改行を除いた全文字数**。
  仮名・漢字・約物・英数字を区別せず1文字として数え、コードポイント単位で走査する
  （原稿用紙400字詰めの換算と一致する）
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
pnpm test        # tsc で test-out/ に出力し node:test で実行
pnpm build       # 配布用ビルド（dist/、テストを除く）
```

## 依存

- `@opencode-ai/plugin` >= 1.4.0（peer dependency）
- `zod` ^3.24.0（引数の検証）
- 開発: `typescript`、`@types/node`。テストは Node 24 標準の `node:test` を使い、追加の依存はありません
