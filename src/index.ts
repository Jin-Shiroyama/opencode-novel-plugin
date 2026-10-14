import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { novelInitExecute } from "./tools/init.js"
import { novelStatusExecute } from "./tools/status.js"
import { novelSaveChapterExecute } from "./tools/save.js"
import { novelContextExecute } from "./tools/context.js"
import { novelGuideExecute } from "./tools/guide.js"
import { novelUpdateExecute } from "./tools/track.js"
import { novelCheckExecute } from "./tools/check.js"
import { novelExportExecute } from "./tools/export.js"
import { CHARACTER_STATE_EXAMPLE, CHARACTER_STATE_KEYS, FORESHADOW_EXAMPLE, FORESHADOW_KEYS } from "./records.js"
import { createNovelPlannerAgent } from "./agents/novel-planner.js"
import { createNovelWriterAgent } from "./agents/novel-writer.js"
import { createNovelEditorAgent } from "./agents/novel-editor.js"
import { DEFAULT_MODEL } from "./constants.js"
import { mergeAgentConfig } from "./agent-config.js"
import { loadCommands } from "./commands.js"

const z = tool.schema

const __dirname = dirname(fileURLToPath(import.meta.url))

const pluginRoot = join(__dirname, "..")
const commandsDir = join(pluginRoot, "commands")
const skillsDir = join(pluginRoot, "skills")

const cachedCommands = loadCommands(commandsDir)

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
}

const NovelPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      "novel_init": tool({
        description: `日本語の長編小説プロジェクトを新規に作る。.novel ディレクトリと、コンセプト・世界観・登場人物などの雛形ファイルを一式用意する。
使う場面: これから新しい作品を書きはじめるとき。`,
        args: {
          title: z.string().describe("作品タイトル"),
          genre: z.string().describe("ジャンル（例: 現代ドラマ、ミステリ、異世界ファンタジー、時代小説、SF、ホラー、恋愛、青春、ライト文芸）"),
          targetWords: z.number().optional().describe("目標総文字数。既定 120000（文庫1冊相当）"),
          chapterCount: z.number().optional().describe("予定章数。既定 40"),
          theme: z.string().optional().describe("作品テーマ（例: 成長、復讐、赦し、喪失と再生）"),
          narrativePerspective: z.string().optional().describe("視点。既定「三人称一元視点」"),
          martialArtsSetting: z.boolean().optional().describe("流派・刀剣・剣術の設定ファイルを作るかどうか。省略時はジャンルから判断する（剣豪・剣客・武侠・チャンバラ・時代活劇・剣戟を含む場合のみ有効）"),
        },
        async execute(args, context) {
          return novelInitExecute(args as any, context as ToolContext)
        },
      }),

      "novel_status": tool({
        description: `いまの作品の進行状況をまとめて返す。現在の工程、各資料の有無、シーンと章の進捗、文字数、伏線の状態を含む。
使う場面: 全体の進み具合を確かめたいとき、執筆を再開する前の状況確認。`,
        args: {
          detailed: z.boolean().optional().describe("章ごとの文字数まで出すかどうか"),
        },
        async execute(args, context) {
          return novelStatusExecute(args as any, context as ToolContext)
        },
      }),

      "novel_save_chapter": tool({
        description: `書き上げた1章を chapters ディレクトリに保存する。ファイル名の連番付けと文字数の計算を自動で行う。
使う場面: 1章を書き終えたとき（例「第3章が書けたので保存して」）。`,
        args: {
          chapterNumber: z.number().int().positive().describe("章番号（1から数える）"),
          title: z.string().describe("章タイトル"),
          content: z.string().describe("本文。章見出しの行は含めない"),
          updateState: z.boolean().optional().describe("保存後に記録更新の案内を出すかどうか。既定 true"),
        },
        async execute(args, context) {
          return novelSaveChapterExecute(args as any, context as ToolContext)
        },
      }),

      "novel_context": tool({
        description: `指定した章を書くための資料を一式そろえる。この章のプロットとシーン、登場人物とその現在の状態、これまでのあらすじ、前章の末尾、伏線の確認、執筆プロンプトを返す。章ごとに分割保存された資料（outline/chapter-002.md など）も読む。
使う場面: ある章の執筆にとりかかる直前。優先度は P0(プロット) > P1(人物・前章とのつなぎ) > P2(伏線・あらすじ) の順。`,
        args: {
          chapterNumber: z.number().int().positive().describe("これから書く章の番号"),
          sceneId: z.string().optional().describe("シーンID（例 1.1、2.3）。渡すとそのシーンに印が付く"),
          includePrompts: z.boolean().optional().describe("執筆プロンプトを含めるかどうか。既定 true"),
        },
        async execute(args, context) {
          return novelContextExecute(args as any, context as ToolContext)
        },
      }),

      "novel_guide": tool({
        description: `執筆の進め方の手引きを返す。全体の流れ、プロンプトの使い方、文章の書き方、伏線の扱い、人物の管理を収めている。
使う場面: 初めてこのプラグインを使うとき、またはある工程のやり方を確かめたいとき。section には workflow / prompts / writing / foreshadow / characters を指定できる。`,
        args: {
          section: z.enum(["workflow", "prompts", "writing", "foreshadow", "characters"]).optional()
            .describe("読みたい手引きの章。既定は全体の流れ"),
        },
        async execute(args, context) {
          return novelGuideExecute(args as any, context as ToolContext)
        },
      }),

      "novel_update": tool({
        // 形を外すと何も書かずに理由を返す。モデルが最初から正しい形で渡せるよう、
        // 説明に形と例を載せる（以前は「JSON文字列」としか書いておらず、独自の形が多発した）
        description: `作品の記録を更新する。登場人物の状態(character-state)、これまでのあらすじ(summary)、伏線(foreshadow)の更新と、更新用プロンプトの取得(prompt)に対応。
使う場面: 1章を書き終えたあと、人物の変化・あらすじ・伏線の回収状況を書き残すとき。
形が違うと何も書き込まずに ❌ と理由を返す。そのときは案内どおりに直して渡し直す。

■ character-state（content は JSON。変わった項目だけを渡す）
changes で使えるキー: ${CHARACTER_STATE_KEYS}
${CHARACTER_STATE_EXAMPLE}

■ summary（content は**この章だけ**のあらすじ。chapterNumber を必ず渡す）
章ごとの節として残り、前の章の節は消えない。content を「## 全体の流れ」で始めると全体の要約を差し替える
（そのときの chapterNumber は「何章までの要約か」。それより前の章を書くときは資料に載らない）。

■ foreshadow（content は JSON。既存の伏線は id で指し、変える項目だけを渡す）
使えるキー: ${FORESHADOW_KEYS}
status は英語の4値のみ。補強しただけなら status は変えず notes に書く。
以前の保存で入った独自のキー（detail など）は通常の更新では残る。外すときは中身を content か notes に移し、"removeKeys": ["detail"] を添える。
${FORESHADOW_EXAMPLE}`,
        args: {
          action: z.enum(["character-state", "summary", "foreshadow", "prompt"]).describe("更新の種別"),
          content: z
            .string()
            .describe("更新内容。character-state / foreshadow は説明にある形の JSON 文字列、summary はこの章のあらすじ、prompt はプロンプト名"),
          chapterNumber: z.number().int().positive().optional().describe("対象の章番号（1以上の整数）。summary では必須"),
        },
        async execute(args, context) {
          return novelUpdateExecute(args as any, context as ToolContext)
        },
      }),

      "novel_check": tool({
        description: `本文の表記を点検し、規約から外れた箇所を行と字の位置つきで返す。規約の正本は novel-writing skill。
見るもの: 括弧の対応（「」の中で改行しない）、会話文末の句点、三点リーダ（……・偶数個）、ダッシュ（――・偶数個、— や ーー で代用しない）、三点リーダ・ダッシュのあとの空白、半角の ! ?、感嘆符・疑問符のあとの全角スペース（閉じ括弧の直前・行末・約物の連続では空けない。！？ などの組み合わせは可）、段落頭の字下げ（地の文は全角1字、会話行は字下げしない）、全角の算用数字、地の文の算用数字（確認）、日本語と英数字のあいだの半角スペース（確認）。
❌ は規約違反、⚠️ は確かめてほしい箇所。
使う場面: 章を保存したあと（保存の報告にも件数が出る）、原稿の点検で表記を見るとき、書き出しの前。`,
        args: {
          chapterNumber: z.number().int().positive().optional().describe("点検する章。省くと書いた章すべて"),
          maxIssues: z.number().int().positive().optional().describe("1章あたりに並べる箇所の上限。既定 30（件数は上限に関わらずすべて数える）"),
        },
        async execute(args, context) {
          return novelCheckExecute(args as any, context as ToolContext)
        },
      }),

      "novel_export": tool({
        description: `書いた章を章番号順に繋ぎ、原稿を1ファイルに書き出す。本文は書き換えない。
format: text（既定。投稿サイトや縦書きエディタに貼る形。見出しは「第一章　タイトル」、Markdown の記号なし）／markdown（作品タイトルを #、章を ## にする）。
numerals: 章見出しの数字。text は既定で漢数字、markdown は既定で算用数字。
書き出し先は既定で .novel/export/{作品タイトル}.txt（.md）。outputPath で作品のディレクトリ内の別の場所を指定できる。
使う場面: 書き上げた原稿をまとめて読みたい、投稿したい、人に渡したいとき。`,
        args: {
          format: z.enum(["text", "markdown"]).optional().describe("書き出す形式。既定 text"),
          numerals: z.enum(["kanji", "arabic"]).optional().describe("章見出しの数字。既定は text なら kanji、markdown なら arabic"),
          fromChapter: z.number().int().positive().optional().describe("この章から書き出す。既定 1"),
          toChapter: z.number().int().positive().optional().describe("この章まで書き出す。既定は最後の章"),
          outputPath: z.string().optional().describe("書き出し先（作品のディレクトリからの相対パス）"),
        },
        async execute(args, context) {
          return novelExportExecute(args as any, context as ToolContext)
        },
      }),
    },
    config: async (config) => {
      const model = config.model ?? DEFAULT_MODEL
      const planner = createNovelPlannerAgent(model)
      const writer = createNovelWriterAgent(model)
      const editor = createNovelEditorAgent(model)
      // 3つの agent はいずれも主 agent セレクタに出す。
      // 各ファクトリは mode: "subagent" を返すのでここで上書きする。
      planner.mode = "primary"
      writer.mode = "primary"
      editor.mode = "primary"
      // opencode.json 側で agent ごとの設定（model など）が書かれていれば、それを優先する。
      // permission などは中身ごと重ねる（OpenCode が利用者の設定に足す空の permission で
      // プラグインの権限が消えないように。mergeAgentConfig を参照）
      const userAgents = (config.agent ?? {}) as Record<string, Record<string, unknown>>
      config.agent = {
        ...userAgents,
        "novel-planner": mergeAgentConfig(planner, userAgents["novel-planner"]),
        "novel-writer": mergeAgentConfig(writer, userAgents["novel-writer"]),
        "novel-editor": mergeAgentConfig(editor, userAgents["novel-editor"]),
      } as typeof config.agent
      config.command = {
        ...config.command,
        ...cachedCommands,
      }
      ;(config as any).skills = {
        ...(config as any).skills,
        paths: [...((config as any).skills?.paths ?? []), skillsDir],
      }
    },
  }
}

export default {
  id: "opencode-novel-plugin",
  server: NovelPlugin,
}
