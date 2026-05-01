import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { readFileSync, readdirSync } from "node:fs"
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

const z = tool.schema

const __dirname = dirname(fileURLToPath(import.meta.url))

const pluginRoot = join(__dirname, "..")
const commandsDir = join(pluginRoot, "commands")
const skillsDir = join(pluginRoot, "skills")

function loadCommandsFromDir(): Record<string, { template: string; description?: string }> {
  const commands: Record<string, { template: string; description?: string }> = {}
  try {
    const files = readdirSync(commandsDir).filter(f => f.endsWith(".md"))
    for (const file of files) {
      const name = file.replace(/\.md$/, "")
      const raw = readFileSync(join(commandsDir, file), "utf-8")
      const descMatch = raw.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---\n/)
      const body = raw.replace(/^---\n[\s\S]*?---\n/, "").trim()
      commands[name] = {
        template: body,
        description: descMatch?.[1]?.trim(),
      }
    }
  } catch {}
  return commands
}

const cachedCommands = loadCommandsFromDir()

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
        description: `初始化一个新的小说创作项目。创建 .novel 目录和所有必要的模板文件（故事概念、世界观、角色档案等）。
使用场景：用户想要开始一部新小说的创作时。`,
        args: {
          title: z.string().describe("小说标题"),
          genre: z.string().describe("类型（如：玄幻、都市、科幻、悬疑等）"),
          targetWords: z.number().optional().describe("目标总字数，默认200000"),
          chapterCount: z.number().optional().describe("预计章节数，默认50"),
          theme: z.string().optional().describe("核心主题（如：成长、复仇、救赎等）"),
          narrativePerspective: z.string().optional().describe("叙事视角，默认第三人称有限"),
        },
        async execute(args, context) {
          return novelInitExecute(args as any, context as ToolContext)
        },
      }),

      "novel_status": tool({
        description: `获取当前小说项目的状态报告。包括：当前工作流阶段、各文档完成情况、场景/章节进度、字数统计、伏笔追踪状态。
使用场景：用户想了解小说项目的整体进度，或在开始写作前检查当前状态。`,
        args: {
          detailed: z.boolean().optional().describe("是否显示详细信息"),
        },
        async execute(args, context) {
          return novelStatusExecute(args as any, context as ToolContext)
        },
      }),

      "novel_save_chapter": tool({
        description: `保存一个完成的章节到 chapters 目录，自动编号和统计字数。
使用场景：完成一章的写作后保存，如"第3章写完了，保存一下"。`,
        args: {
          chapterNumber: z.number().describe("章节编号（从1开始）"),
          title: z.string().describe("章节标题"),
          content: z.string().describe("章节正文内容"),
          updateState: z.boolean().optional().describe("是否同时更新角色状态和摘要，默认true"),
        },
        async execute(args, context) {
          return novelSaveChapterExecute(args as any, context as ToolContext)
        },
      }),

      "novel_context": tool({
        description: `为写作指定章节构建完整的上下文信息。包括：本章大纲、角色档案、角色当前状态、前文摘要、上一章末尾、伏笔提醒、写作提示词模板。
使用场景：在开始写作某一章之前调用，获取所有必要的参考信息。优先级分层：P0(大纲) > P1(角色/衔接) > P2(伏笔/摘要)。`,
        args: {
          chapterNumber: z.number().describe("要写作的章节编号"),
          sceneId: z.string().optional().describe("场景ID（如 1.1, 2.3）"),
          includePrompts: z.boolean().optional().describe("是否包含提示词模板，默认true"),
        },
        async execute(args, context) {
          return novelContextExecute(args as any, context as ToolContext)
        },
      }),

      "novel_guide": tool({
        description: `获取小说创作工作流指南。包含：完整工作流说明、提示词使用指南、写作技巧、伏笔管理、角色管理等。
使用场景：用户第一次使用插件时，或需要了解工作流的某个方面。可选 section: workflow, prompts, writing, foreshadow, characters。`,
        args: {
          section: z.enum(["workflow", "prompts", "writing", "foreshadow", "characters"]).optional()
            .describe("要查看的指南部分，默认显示完整工作流"),
        },
        async execute(args, context) {
          return novelGuideExecute(args as any, context as ToolContext)
        },
      }),

      "novel_update": tool({
        description: `更新小说项目的追踪数据。支持：角色状态更新(character-state)、前文摘要更新(summary)、伏笔追踪更新(foreshadow)、获取更新用提示词(prompt)。
使用场景：每章写作完成后，更新角色状态变化、前文摘要、伏笔回收情况。也可用于获取特定更新操作的提示词模板。`,
        args: {
          action: z.enum(["character-state", "summary", "foreshadow", "prompt"]).describe("更新类型"),
          content: z.string().describe("更新内容（JSON字符串或Markdown文本）"),
          chapterNumber: z.number().optional().describe("相关章节编号"),
        },
        async execute(args, context) {
          return novelUpdateExecute(args as any, context as ToolContext)
        },
      }),
    },
    config: async (config) => {
      const model = config.model ?? "anthropic/claude-sonnet-4"
      const planner = createNovelPlannerAgent(model)
      const writer = createNovelWriterAgent(model)
      const editor = createNovelEditorAgent(model)
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
