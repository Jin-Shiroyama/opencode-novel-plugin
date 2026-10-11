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
import { createNovelPlannerAgent } from "./agents/novel-planner.js"
import { createNovelWriterAgent } from "./agents/novel-writer.js"
import { createNovelEditorAgent } from "./agents/novel-editor.js"
import { DEFAULT_MODEL } from "./constants.js"
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
          chapterNumber: z.number().describe("章番号（1から数える）"),
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
          chapterNumber: z.number().describe("これから書く章の番号"),
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
        description: `作品の記録を更新する。登場人物の状態(character-state)、これまでのあらすじ(summary)、伏線(foreshadow)の更新と、更新用プロンプトの取得(prompt)に対応。
使う場面: 1章を書き終えたあと、人物の変化・あらすじ・伏線の回収状況を書き残すとき。`,
        args: {
          action: z.enum(["character-state", "summary", "foreshadow", "prompt"]).describe("更新の種別"),
          content: z.string().describe("更新内容（JSON文字列または Markdown テキスト）"),
          chapterNumber: z.number().optional().describe("対象の章番号"),
        },
        async execute(args, context) {
          return novelUpdateExecute(args as any, context as ToolContext)
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
      config.agent = {
        ...config.agent,
        "novel-planner": planner,
        "novel-writer": writer,
        "novel-editor": editor,
      }
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
