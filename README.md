---
title: OpenCode 小说创作插件文档
date: 2026-04-15
tags:
  - opencode
  - plugin
  - novel
  - writing
  - ai
---

# OpenCode 小说创作插件（opencode-novel-plugin）

一个为 OpenCode 设计的 AI 辅助小说创作插件，提供 3 个专用 Agent、7 个工具、5 个 Skill（含武侠专项+现实映射）、4 个命令，以及从故事概念到成稿的完整工作流支持。**对武侠小说创作有专门优化，并支持现实映射功能**。

> [!info] 参考项目与致谢
> 本插件融合了三个优秀开源项目的设计精华：
> - **novel-workflow-mcp** (GPL-3.0) — 模板驱动的项目结构、多阶段工作流、场景 _Prompt 字段格式
> - **AI_NovelGenerator** (AGPL-3.0) — 雪花写作法、角色状态追踪、前文摘要
> - **MuMuAINovel** (GPL-3.0) — RTCO 提示词框架、伏笔追踪、优先级分层上下文（P0/P1/P2）
>
> 本项目中的部分提示词结构和约束条款参考自上述项目。感谢原作者们的杰出工作。

---

## 安装

### 方式一：本地路径加载

在 OpenCode 项目的 `opencode.json` 中添加：

```json
{
  "plugin": ["file:///path/to/opencode-noval"]
}
```

### 方式二：放入插件目录

将项目文件复制到以下任一目录：

- `.opencode/plugins/` — 项目级插件
- `~/.config/opencode/plugins/` — 全局插件

### 方式三：npm 安装

```json
{
  "plugin": ["opencode-novel-plugin"]
}
```

---

## 快速入门

### 1. 配置模型

插件使用 OpenCode 的默认模型。如需指定，在项目 `opencode.json` 中覆盖：

```json
{
  "model": "anthropic/claude-sonnet-4",
  "plugin": ["file:///path/to/opencode-noval"]
}
```

> [!TIP]
> 策划阶段（0.3）建议用 Sonnet 4，写稿阶段（0.7）可用更便宜的模型。编辑阶段（0.1）建议用 Sonnet 4 或 Opus 以保证审稿质量。

### 2. 启动创作

在 OpenCode 中，对 **novel-planner** agent 说：

```
/novel init
```

然后回答几个简单问题（书名、类型、篇幅），插件会自动创建项目结构。

### 3. 选择 Agent

| 场景 | 用哪个 Agent | 怎么调用 |
|------|------------|---------|
| **规划阶段**（概念/世界观/角色/大纲/场景） | `novel-planner` | 主 agent 选择器，或 `/novel` |
| **写章节正文** | `novel-writer` | `/write-chapter <章节号>` |
| **审稿修订** | `novel-editor` | `/novel-review <章节号或all>` |
| **查看进度** | — | `/novel-status` |
| **继续某个阶段** | `novel-planner` | `/novel concept` / `/novel world` 等 |

> [!NOTE]
> 三个 agent 都是 `mode: primary`，出现在主 agent 选择器中。Planner 引导规划，Writer 专注写作，Editor 负责审稿。

### 4. 完整工作流

```
novel-planner（策划） → novel-writer（写作） → novel-editor（审稿）
```

**规划阶段**（6 步）：
`/novel init` → `/novel concept` → `/novel world` → `/novel characters` → `/novel outline` → `/novel scenes`

**写作阶段**（循环）：
`/write-chapter 1` → `/write-chapter 2` → ... → `/novel-review all`

武侠小说会自动创建额外的 `wuxia/` 目录（门派/功法/兵器）。开启现实映射时，Planner 会主动搜索新闻/历史素材。

---

## 项目结构（供了解，详细工具文档见下文）

```
opencode-novel-plugin/
├── src/                        # TypeScript 源码
│   ├── index.ts                # 插件入口（7 工具 + 3 Agent + config hook）
│   ├── utils.ts                # 工具函数
│   ├── prompts.ts              # 15 个 RTCO 提示词模板
│   ├── templates.ts             # 11 个文档模板
│   ├── agents/                  # 3 个 Agent 工厂
│   └── tools/                   # 7 个工具实现
├── commands/                    # 4 个斜杠命令（/novel 等）
├── skills/                      # 5 个创作 Skill
└── dist/                       # 编译输出
```

---

## 工作流概览

```mermaid
graph LR
    A[概念] --> B[世界观]
    B --> C[角色]
    C --> D[简要大纲]
    D --> E[详细大纲]
    E --> F[场景设计]
    F --> G[正文创作]
    G --> H[状态追踪]
    H --> G
```

| 阶段 | 文档 | 提示词模板 | 核心任务 |
|------|------|-----------|---------|
| 0 | `concept.md` | `concept` | 将模糊创意转化为故事核心 |
| 1 | `world-building.md` | `world-building` | 构建自洽的世界设定 |
| 2 | `characters/profiles.md` | `characters` | 创建立体的角色群 |
| 3 | `outline-brief.md` | `outline-brief` | 规划三幕式结构骨架 |
| 4 | `outline-detailed.md` | `outline-detailed` | 逐章详细规划 |
| 5 | `scenes.md` | `scenes` | 将章节分解为可执行场景 |
| 6 | `chapters/*.md` | `chapter-write` / `chapter-continue` | 逐章撰写正文 |

---

## 工具详解

### `novel_init` — 项目初始化

创建 `.novel/` 目录和所有必要的模板文件。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 小说标题 |
| `genre` | string | ✅ | 类型（如：玄幻、都市、科幻、悬疑等） |
| `targetWords` | number | ❌ | 目标总字数，默认 200000 |
| `chapterCount` | number | ❌ | 预计章节数，默认 50 |
| `theme` | string | ❌ | 核心主题（如：成长、复仇、救赎） |
| `narrativePerspective` | string | ❌ | 叙事视角，默认"第三人称有限" |

**创建的文件结构：**

```
.novel/
├── config.json            # 项目配置
├── concept.md             # 故事概念
├── world-building.md      # 世界观设定
├── characters/
│   ├── profiles.md        # 角色档案
│   └── state.json         # 角色状态追踪
├── summary.md             # 前文摘要
├── foreshadow.json        # 伏笔追踪
└── chapters/              # 章节目录（写作时自动创建）
```

**使用示例：**

> [!example] 对 AI 说
> "帮我初始化一部玄幻小说，标题是《星辰变》，目标50万字，200章"

---

### `novel_status` — 状态报告

获取当前小说项目的完整状态。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `detailed` | boolean | ❌ | 是否显示详细信息 |

**返回内容包括：**

- 📖 书名、类型、目标字数
- 📍 当前工作流阶段
- 📋 各文档完成情况（✅/⬜）
- 🎬 场景进度条
- 📊 已写章节字数统计
- 🎯 伏笔追踪状态

> [!example] 对 AI 说
> "看看我的小说项目进度"

---

### `novel_save` — 保存文档

保存小说项目的各类文档。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `documentType` | enum | ✅ | 文档类型（见下表） |
| `content` | string | ✅ | 文档内容（Markdown 或 JSON） |
| `chapterNumber` | number | ❌ | 保存章节时指定编号 |
| `chapterTitle` | string | ❌ | 章节标题 |

**支持的文档类型：**

| documentType | 格式 | 说明 |
|-------------|------|------|
| `concept` | Markdown | 故事概念 |
| `world-building` | Markdown | 世界观设定 |
| `characters` | Markdown | 角色档案 |
| `character-state` | JSON | 角色状态数据 |
| `outline-brief` | Markdown | 简要大纲 |
| `outline-detailed` | Markdown | 详细大纲 |
| `scenes` | Markdown | 场景列表 |
| `summary` | Markdown | 前文摘要 |
| `foreshadow` | JSON | 伏笔追踪数据 |
| `sect` | Markdown | 门派势力（武侠专属） |
| `martial-art` | Markdown | 功法谱（武侠专属） |
| `weapon` | Markdown | 兵器谱（武侠专属） |
| `reality-source` | Markdown | 现实映射素材库（所有类型通用） |

---

### `novel_save_chapter` — 保存章节

保存完成的章节到 `chapters/` 目录，自动编号和统计字数。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapterNumber` | number | ✅ | 章节编号（从1开始） |
| `title` | string | ✅ | 章节标题 |
| `content` | string | ✅ | 章节正文内容 |
| `updateState` | boolean | ❌ | 是否提示更新追踪文件，默认 true |

**自动行为：**

- 文件自动命名为 `chapter-001.md`、`chapter-002.md`...
- 自动在文件头部添加 `# 第X章 标题`
- 自动统计字数（中文字符 + 英文单词）

---

### `novel_context` — 写作上下文构建

为写作指定章节构建完整的上下文信息，这是写作时最重要的工具。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapterNumber` | number | ✅ | 要写作的章节编号 |
| `sceneId` | string | ❌ | 场景ID（如 1.1, 2.3） |
| `includePrompts` | boolean | ❌ | 是否包含提示词模板，默认 true |

**返回的上下文按优先级分层：**

| 优先级 | 内容 | 说明 |
|--------|------|------|
| **P0** | 本章大纲 | 必须遵循的核心情节规划 |
| **P1** | 角色档案、角色当前状态、前章衔接 | 重要参考信息 |
| **P2** | 前文摘要、伏笔提醒 | 辅助参考信息 |

**对于第2章及以后，额外包含：**
- 上一章剧情概要
- 上一章末尾500字内容（用于自然衔接）

> [!tip] 最佳实践
> 每次开始写新章节前，先调用 `novel_context` 获取完整上下文，然后基于上下文中的提示词模板进行创作。

---

### `novel_guide` — 工作流指南

获取小说创作的详细指南文档。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `section` | enum | ❌ | 指南部分（默认 workflow） |

**可选的 section：**

| section | 内容 |
|---------|------|
| `workflow` | 完整工作流说明（默认） |
| `prompts` | 提示词使用指南 |
| `writing` | 写作技巧指南 |
| `foreshadow` | 伏笔管理指南 |
| `characters` | 角色管理指南 |

---

### `novel_update` — 状态追踪更新

更新小说项目的各类追踪数据，每章写作完成后使用。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | enum | ✅ | 更新类型 |
| `content` | string | ✅ | 更新内容 |
| `chapterNumber` | number | ❌ | 相关章节编号 |

**支持的 action：**

| action | content 格式 | 说明 |
|--------|-------------|------|
| `character-state` | JSON | 更新角色状态（存活/心理/物品/关系） |
| `summary` | Markdown | 更新前文摘要 |
| `foreshadow` | JSON | 更新伏笔追踪 |
| `prompt` | string | 获取指定类型的提示词模板 |

**角色状态更新 JSON 格式：**

```json
{
  "updates": [
    {
      "name": "张三",
      "changes": {
        "status": "active",
        "mentalState": "震惊、愤怒",
        "items": {
          "added": ["青锋剑"],
          "removed": []
        },
        "relationships": {
          "李四": "关系破裂，从信任变为敌对"
        },
        "events": ["目睹师父被暗害"]
      }
    }
  ]
}
```

**伏笔更新 JSON 格式：**

```json
{
  "items": [
    {
      "id": "F1",
      "title": "神秘玉佩",
      "content": "主角捡到的玉佩中隐藏着古老力量",
      "category": "item",
      "status": "planted",
      "plantChapter": 1,
      "targetChapter": 15
    }
  ]
}
```

**伏笔状态流转：**

```
pending → planted → resolved
                  → abandoned
```

---

## 专用 Agent

插件通过 `config` hook 注册 3 个专用创作 Agent，每个 Agent 有独立的系统提示词、温度设置和工具权限，可通过 `task(subagent_type="...")` 调用。

### `novel-planner` — 小说策划师

负责从故事概念到场景设计的全部前期规划工作，**支持网络搜索以发掘现实素材**。

| 属性 | 值 |
|------|------|
| 模式 | `subagent` |
| 温度 | `0.3`（偏理性，保证规划一致性） |
| 工具 | `novel_init`、`novel_save`、`novel_status`、`novel_guide`、`websearch`、`webfetch` |

**核心能力：**

- 六阶段工作流推进（概念→世界观→角色→简要大纲→详细大纲→场景）
- 三幕式结构规划（开端25%→上升25%→危机25%→高潮结局25%）
- 角色驱动力三角设计（外在目标×内在需求×核心缺陷）
- 现实素材发掘（通过 websearch/webfetch 搜索新闻、历史事件，提取人物原型）
- 伏笔规划和追踪
- 每阶段完成后需用户确认才推进

> [!example] 调用方式
> `task(subagent_type="novel-planner", load_skills=["novel-workflow"], prompt="帮我设计一个玄幻小说的故事概念...")`

---

### `novel-writer` — 小说作者

负责章节正文创作，追求自然流畅、真实感强的文风。

| 属性 | 值 |
|------|------|
| 模式 | `subagent` |
| 温度 | `0.7`（偏创造，保证文风多样性） |
| 工具 | `novel_context`、`novel_save_chapter`、`novel_update` |

**核心能力：**

- 每章自动调用 `novel_context` 获取完整写作上下文
- 遵守反 AI 套话规则（禁用"总之"、"不禁"、"一股XX涌上心头"等）
- Show, Don't Tell 原则（通过行为和细节展现情感）
- 五感描写策略（视觉为基础，关键场景叠加多种感官）
- 主动/被动场景交替控制节奏
- 输出纯小说正文，不含元信息

> [!example] 调用方式
> `task(subagent_type="novel-writer", load_skills=["novel-writing"], prompt="写第3章正文...")`

---

### `novel-editor` — 小说编辑

负责审稿修订、一致性检查和风格润色，严格但建设性。

| 属性 | 值 |
|------|------|
| 模式 | `subagent` |
| 温度 | `0.1`（最精确，保证审稿准确性） |
| 工具 | `novel_update`、`novel_status`、`novel_context` |

**核心能力：**

- 六维度一致性检查（角色、世界观、时间线、因果、物品/能力、伏笔）
- 六稿修改法（结构→角色→风格→节奏→细节→一致性，每轮只关注一个维度）
- Show, Don't Tell 检查
- 结构化审稿报告（🔴致命/🟡警告/🟢建议 三级分类）
- 每个问题附带具体修改建议和示例文本

> [!example] 调用方式
> `task(subagent_type="novel-editor", load_skills=["novel-editor"], prompt="审稿第5章，重点检查一致性...")`

---

## Skill 清单

| Skill | 用途 | 加载时机 |
|-------|------|---------|
| `novel-workflow` | 完整 6 阶段工作流，含检查点和阶段门控 | 规划阶段 |
| `novel-writing` | 章节写作指导、反 AI 套话规则、感官描写指南 | 写正文时 |
| `novel-editor` | 审稿修订、一致性检查、六稿修改法、审稿报告模板 | 审稿时 |
| `novel-wuxia` | 武侠专项：功法体系设计、门派架构、战斗写法、经典桥段库、兵器谱 | 武侠创作时 |
| `novel-reality` | 现实映射：批判现实主义方法论、陌生化技法库、人物原型提取、合规指南 | 现实映射时 |

Skill 存放在插件根目录的 `skills/` 目录下，通过 `config.skills.paths` 注册，使用 YAML frontmatter 格式，通过 `load_skills` 参数加载到 Agent 上下文中。

---

## 命令清单

| 命令 | 用途 | 参数 |
|------|------|------|
| `/novel` | 启动/继续小说创作工作流 | `init`/`concept`/`world`/`characters`/`outline`/`scenes`/`status` |
| `/write-chapter` | 写一章完整的小说正文 | `<章节编号>` |
| `/novel-status` | 查看当前项目状态和进度 | 无 |
| `/novel-review` | 审稿修订 | `<章节编号|all>` `--focus=consistency|style|pace|full` |

命令存放在插件根目录的 `commands/` 目录下，通过 `config.command` 注册，使用 YAML frontmatter + `<command-instruction>` 格式。

> [!tip] 快速开始
> 1. `/novel init` — 初始化新小说项目
> 2. 按提示逐步完成概念→世界观→角色→大纲→场景
> 3. `/write-chapter 1` — 开始写第一章
> 4. `/novel-review 1` — 审稿第一章

---

## 提示词模板体系

插件包含 15 个采用 **RTCO 框架**（Role-Task-Context-Output）设计的提示词模板。

### 可用模板

| 模板名 | 用途 | 使用阶段 |
|--------|------|---------|
| `concept` | 故事概念创建 | 阶段 0 |
| `world-building` | 世界观构建 | 阶段 1 |
| `characters` | 角色设计 | 阶段 2 |
| `outline-brief` | 简要大纲 | 阶段 3 |
| `outline-detailed` | 详细大纲 | 阶段 4 |
| `scenes` | 场景设计 | 阶段 5 |
| `chapter-write` | 第一章写作 | 阶段 6（第1章） |
| `chapter-continue` | 后续章节续写 | 阶段 6（第2章+） |
| `consistency-check` | 一致性检查 | 任意阶段 |
| `character-state-update` | 角色状态更新 | 每章完成后 |
| `summary-update` | 摘要更新 | 每章完成后 |
| `wuxia-martial-arts` | 功法体系设计 | 武侠世界观阶段 |
| `wuxia-combat` | 战斗场景写作 | 武侠战斗场景 |
| `reality-source` | 现实素材提取 | 策划阶段（任意类型） |
| `character-archetype` | 人物原型提取 | 角色设计阶段 |

### RTCO 框架说明

每个提示词包含四个层次：

- **Role**（`<system>` 标签）— 角色定位和专长
- **Task**（`<task>` 标签）— 具体创作任务和核心要求
- **Context/Organize**（`<outline>`/`<characters>` 等标签）— 上下文信息和组织结构
- **Output**（`<output>` 标签）— 期望的输出格式

### 获取提示词

提示词在以下场景自动提供：
1. 调用 `novel_context` 时自动包含对应的写作提示词
2. 调用 `novel_update` 的 `prompt` action 可获取特定提示词

---

## 武侠小说专属功能

当 `genre` 设为"武侠"或包含"武"/"功夫"时，插件自动启用武侠专属功能。

### 自动创建武侠数据文件

初始化武侠项目时，自动在 `.novel/wuxia/` 下创建三个专属文件：

| 文件 | 用途 | 保存命令 |
|------|------|---------|
| `wuxia/sects.md` | 门派势力（正派/邪派/中立/隐世） | `novel_save(documentType: "sect", ...)` |
| `wuxia/martial-arts.md` | 功法谱（内功/外功/轻功/特殊） | `novel_save(documentType: "martial-art", ...)` |
| `wuxia/weapons.md` | 兵器谱（剑/刀/枪/鞭/暗器） | `novel_save(documentType: "weapon", ...)` |

### 写作上下文自动整合

调用 `novel_context` 时，自动加载武侠专属上下文：

- ⚔️ **功法体系**（P1）— 当前功法设定、克制关系
- 🏯 **门派势力**（P1）— 门派格局、势力关系
- 🗡️ **兵器谱**（P2）— 重要兵器信息

### 武侠专属提示词模板

| 模板名 | 用途 |
|--------|------|
| `wuxia-martial-arts` | 功法体系设计（分层/限制/克制关系） |
| `wuxia-combat` | 战斗场景写作（节奏/招式/内力/兵器） |

### 武侠创作引导流程

**策划师 Agent** 在武侠项目中会额外引导：

1. **江湖格局设计** — 选择格局模式（正邪对立/多极争霸/门派林立/隐世+显世）
2. **功法体系设计** — 选择风格（金庸/古龙/现代网文），设计功法层次和克制关系
3. **武侠角色原型** — 6种经典原型（少侠成长/魔教教主/隐世高人/侠女/叛徒/复仇者）
4. **武侠情节线** — 5种经典模式（拜师学艺/夺宝争锋/正邪大战/复仇/武林大会）

**作者 Agent** 在武侠战斗场景中会使用专属技法：

- 招式描写节奏（快→慢→快→慢）
- 动词链代替形容词堆砌
- 环境反馈展现内力
- 兵器特色写法（剑-轻灵/刀-霸道/枪-凌厉）
- 以弱胜强五种套路

### 武侠 Skill

加载 `novel-wuxia` Skill 获取完整武侠创作参考，包括：
- 功法体系设计指南（分层/代价/克制）
- 门派架构模板（4种阵营 + 5个原型）
- 战斗场景写法（节奏/内力/兵器/群战）
- 15+ 经典武侠桥段库
- 兵器谱模板
- 江湖规矩速查

> [!example] 武侠创作示例
> `task(subagent_type="novel-planner", load_skills=["novel-workflow", "novel-wuxia"], prompt="帮我设计一个武侠小说的江湖格局...")`

---

## 现实映射功能

插件内置**现实映射**能力，支持从新闻、历史事件中提取人物原型和社会议题，融入小说创作，让虚构故事映照现实、引发思考。

### 核心理念

- **批判现实主义** — 小说不只是消遣，也是观察和反思现实的透镜
- **陌生化技法** — 将熟悉的现实以陌生的方式呈现，让读者重新审视
- **人物原型提取** — 从真实人物中提取性格、动机、行为模式，创造可信的角色
- **法律合规** — 严格避免对真实人物的可识别映射，确保创作安全

### 现实映射素材库

所有类型小说均可使用现实映射功能。通过 `novel_save(documentType: "reality-source", ...)` 保存素材到 `.novel/reality-source.md`。

素材库包含：

| 板块 | 内容 |
|------|------|
| 新闻事件 | 社会热点、人物故事、权力关系 |
| 历史素材 | 历史事件、人物命运、时代特征 |
| 原型提取 | 8种人物原型（权力者/反抗者/旁观者/受害者/投机者/理想主义者/世故者/隐逸者） |
| 议题清单 | 社会不公、权力压迫、人性挣扎等议题 |

### 策划师 Agent 的现实素材发掘

`novel-planner` Agent 拥有 `websearch` 和 `webfetch` 权限，可在策划阶段主动搜索：

1. **概念阶段** — 发掘社会议题，确定故事要反映的现实主题
2. **世界观阶段** — 将现实权力结构映射到虚构世界
3. **角色阶段** — 从新闻/历史中提取人物原型，生成角色雏形
4. **大纲阶段** — 嵌入社会议题线索，规划批判性情节

### 陌生化写作技法

`novel-writer` Agent 在写作时应用陌生化技法：

| 技法 | 说明 | 示例 |
|------|------|------|
| 延迟命名 | 先描述特征再揭示身份 | 先写"枯瘦的手翻动账本"再说是掌柜 |
| 感官转译 | 用非日常感官描述日常 | "权力的味道像发霉的绸缎" |
| 比例变形 | 放大/缩小关键细节 | 把一顿饭的浪费写满一页 |
| 儿童视角 | 用天真眼光看成人世界 | 小徒弟问"为什么师父收的银子比给的多？" |
| 重复暴露 | 重复同一行为揭示本质 | 每章开头都数一遍铜板，数目渐少 |

### 专属提示词模板

| 模板名 | 用途 |
|--------|------|
| `reality-source` | 从新闻/历史中提取素材、人物原型、社会议题 |
| `character-archetype` | 基于现实原型设计虚构角色（含模糊化处理） |

### 现实映射 Skill

加载 `novel-reality` Skill 获取完整现实映射创作参考：
- 批判现实主义方法论（三种形态：镜像式/折射式/寓言式）
- 陌生化技法库（10个技巧含武侠示例）
- 人物原型提取框架（4步法 + 8原型 + 6种模糊化手段）
- 现实→虚构映射模板（5维度映射表 + 检查清单）
- 法律合规指南（5条红线）
- 新闻/历史素材搜索指南

> [!example] 现实映射示例
> `task(subagent_type="novel-planner", load_skills=["novel-workflow", "novel-reality"], prompt="帮我从最近的社会新闻中提取素材，设计一个反映底层人民挣扎的故事概念...")`

> [!warning] 法律合规提醒
> 创作时严格遵守以下红线：
> - 不直接影射可识别的真实人物
> - 不编造未经验证的事件细节
> - 虚构角色至少经过3层模糊化处理（职业/时代/性别/地域中至少3项不同）
> - 避免可能引发社会不稳定的内容
> - 明确标注作品为虚构

---

## 完整使用流程

### 第一步：初始化项目

> [!example] 对 AI 说
> "使用 novel_init 初始化一部都市异能小说，标题《觉醒者》，目标30万字，100章，主题是'力量的代价与责任'"

### 第二步：创建故事概念

> [!example] 对 AI 说
> "帮我完善故事概念文档。这是一个关于普通大学生意外获得时间回溯能力的故事..."

AI 会使用 `concept` 提示词模板协助创作，完成后用 `novel_save` 保存到 `concept.md`。

### 第三步：构建世界观

> [!example] 对 AI 说
> "基于我的故事概念，帮我构建世界观设定。这个世界中觉醒者是隐藏在社会中的..."

完成后用 `novel_save` 保存到 `world-building.md`。

### 第四步：设计角色

> [!example] 对 AI 说
> "帮我设计主要角色。主角是一个内向但坚韧的计算机系大三学生..."

完成后用 `novel_save` 保存到 `characters` 文档。

### 第五步：创建大纲

> [!example] 对 AI 说
> "帮我创建简要大纲，规划三幕式结构..."

先创建简要大纲（`outline-brief`），确认后再扩展为详细大纲（`outline-detailed`）。

### 第六步：设计场景

> [!example] 对 AI 说
> "帮我将大纲分解为场景列表，设计每个场景的写作指导..."

完成后用 `novel_save` 保存到 `scenes.md`。

### 第七步：开始写作（循环）

> [!example] 每章写作流程
> 1. "用 novel_context 获取第1章的写作上下文"
> 2. 基于上下文和大纲创作章节正文
> 3. "用 novel_save_chapter 保存第1章，标题是'觉醒之夜'"
> 4. "用 novel_update 更新角色状态和前文摘要"
> 5. 重复步骤1-4直到所有章节完成

### 第八步（可选）：一致性检查

> [!example] 对 AI 说
> "用 consistency-check 提示词检查第5章与整体设定的一致性"

---

## 写作技巧参考

### 场景类型交替

主动场景和被动场景交替创造节奏：

```
主动（Goal→Conflict→Disaster）→ 被动（Reaction→Dilemma→Decision）→ 主动 → ...
紧张                              反思                           紧张
```

### 三幕式结构比例

| 幕 | 占比 | 核心任务 |
|----|------|---------|
| 第一幕：开端 | 25% | 常态世界→触发事件→跨越门槛 |
| 第二幕前半：上升 | 25% | 探索→盟友→中点转折 |
| 第二幕后半：危机 | 25% | 敌人逼近→第一次两难→黑暗时刻 |
| 第三幕：高潮结局 | 25% | 顿悟→第二次两难→最终对决 |

### 两次两难抉择

- **第一次两难**（约50-60%处）— 外部选择，两个都有代价
- **第二次两难**（约75-85%处）— 内部选择，价值观冲突

### 避免 AI 写作常见问题

| ❌ 避免 | ✅ 应该 |
|---------|---------|
| "总之"、"综上所述" | 自然过渡 |
| 过多感叹号和省略号 | 克制使用 |
| 角色对话过于书面化 | 加入语气词和口头禅 |
| 大段内心独白 | 通过行为展现情感（Show, Don't Tell） |
| 情绪过于理性清晰 | 让情绪混乱、矛盾 |
| 场景描写过于抽象 | 五感描写，具体细节 |

---

## 伏笔管理

### 伏笔分类

| 类型 | 说明 | 示例 |
|------|------|------|
| `identity` | 身份相关 | 隐藏的真实身份 |
| `mystery` | 悬念谜团 | 未解的谜题 |
| `item` | 物品道具 | 关键道具的暗示 |
| `relationship` | 关系线索 | 隐藏的血缘关系 |
| `event` | 事件伏笔 | 即将发生的重大事件 |
| `ability` | 能力伏笔 | 未觉醒的能力 |
| `prophecy` | 预言暗示 | 预言或梦境 |

### 伏笔提醒策略

写作时按距离分层提醒：

| 距离 | 处理方式 |
|------|---------|
| 本章必须回收 | ✅ 必须处理 |
| 未来3章内 | ⚠️ 可以开始铺垫 |
| 超过3章 | 🔇 不发送，避免干扰 |

---

## 角色状态追踪

每章完成后更新以下维度：

| 维度 | 说明 |
|------|------|
| 存活状态 | `active` / `deceased` / `missing` / `retired` |
| 心理状态 | 情绪变化、心理创伤、认知转变 |
| 物品变化 | 获得/失去的重要物品 |
| 能力变化 | 新习得/失去的技能 |
| 关系变化 | 与其他角色关系的变化 |
| 重要事件 | 影响角色的关键事件 |

### 驱动力三角

每个核心角色必须有：
- **外在目标** — 角色想要什么（具体的、可衡量的）
- **内在需求** — 角色真正需要什么（深层的）
- **核心缺陷** — 阻碍成长的弱点（源于过去）

---

## 数据文件说明

### `config.json` — 项目配置

```json
{
  "title": "觉醒者",
  "genre": "都市异能",
  "theme": "力量的代价与责任",
  "targetWords": 300000,
  "chapterCount": 100,
  "narrativePerspective": "第三人称有限",
  "currentPhase": "writing",
  "createdAt": "2026-04-15T00:00:00.000Z",
  "updatedAt": "2026-04-15T12:00:00.000Z"
}
```

### `foreshadow.json` — 伏笔追踪

```json
{
  "items": [
    {
      "id": "F1",
      "title": "神秘玉佩",
      "content": "主角捡到的玉佩中隐藏着古老力量",
      "category": "item",
      "status": "planted",
      "plantChapter": 1,
      "targetChapter": 15,
      "resolvedChapter": null,
      "notes": "在第1章结尾时主角在古玩市场捡到"
    }
  ]
}
```

### `character-state.json` — 角色状态

```json
{
  "characters": [
    {
      "name": "林风",
      "status": "active",
      "role": "protagonist",
      "physicalState": "右臂受伤，已包扎",
      "mentalState": "震惊、困惑，开始接受现实",
      "items": ["神秘玉佩", "父亲遗留的笔记本"],
      "abilities": ["时间回溯（3秒）"],
      "relationships": {
        "苏晴": "青梅竹马，互有好感但未表白",
        "陈教授": "亦师亦友，似乎知道更多秘密"
      },
      "events": ["第一次无意识触发时间回溯", "在古玩市场捡到玉佩"],
      "lastUpdatedChapter": 1
    }
  ]
}
```

---

## 技术架构

### 插件注册

插件采用 OpenCode 的 Server Plugin 格式，通过 `tool` hook 注册工具，通过 `config` hook 注册 Agent：

```typescript
export default {
  id: "opencode-novel",
  server: NovelPlugin,
}

// NovelPlugin 返回:
{
  tool: {
    novel_init: tool({ ... }),
    novel_status: tool({ ... }),
    novel_save: tool({ ... }),
    novel_save_chapter: tool({ ... }),
    novel_context: tool({ ... }),
    novel_guide: tool({ ... }),
    novel_update: tool({ ... }),
  },
  config: async (config) => {
    config.agent = {
      ...config.agent,
      "novel-planner": createNovelPlannerAgent(model),
      "novel-writer": createNovelWriterAgent(model),
      "novel-editor": createNovelEditorAgent(model),
    }
  },
}
```

### 数据存储

所有数据以文件形式存储在项目目录的 `.novel/` 下：
- **Markdown 文档** — 适合人类阅读和 AI 处理的内容（概念、世界观、角色等）
- **JSON 数据** — 适合程序化读写和状态追踪（配置、伏笔、角色状态）

### 类型系统

核心类型定义在 `utils.ts` 中：

| 类型 | 说明 |
|------|------|
| `DocType` | 文档类型枚举 |
| `Phase` | 工作流阶段（concept → world-building → ... → completed） |
| `SceneStatus` | 场景状态（pending / in-progress / completed） |
| `ForeshadowEntry` | 伏笔条目结构 |
| `CharacterState` | 角色状态结构 |
| `NovelConfig` | 项目配置结构 |

---

## 常见问题

### Q: 如何在中途修改世界观设定？

直接修改 `.novel/world-building.md` 文件，或通过 `novel_save` 覆盖保存。

### Q: 如何跳过某些阶段？

按顺序推进是推荐的，但如果已有成熟的设定，可以用 `novel_save` 直接保存对应文档，系统会自动检测已存在的文档并更新阶段。

### Q: 角色太多，状态追踪文件变得很大怎么办？

`novel_context` 工具会自动截取角色档案（最多3000字），只包含与当前章节相关的信息。

### Q: 如何备份我的小说数据？

`.novel/` 目录包含所有数据，直接复制该目录即可备份。配合 Git 可以实现版本控制。

### Q: 可以同时创作多部小说吗？

每个项目目录有独立的 `.novel/` 数据。在不同项目目录下工作即可管理多部小说。

---

## 更新日志

### v1.0.0 (2026-04-15)

- 初始版本发布
- 7 个核心工具
- 3 个专用 Agent（策划师/作者/编辑）
- 15 个 RTCO 提示词模板（含武侠专属 2 个 + 现实映射 2 个）
- 11 个文档模板（含武侠专属 3 个 + 现实映射 1 个）
- 5 个 Skill（工作流/写作/审稿/武侠/现实映射）
- 4 个命令（novel/write-chapter/novel-status/novel-review）
- 武侠类型专属优化（功法体系/门派势力/兵器谱/战斗技法）
- 现实映射功能（批判现实主义/陌生化技法/人物原型提取/法律合规）
- 策划师 Agent 支持网络搜索（websearch/webfetch）
- 完整的伏笔追踪系统
- 角色状态追踪系统
- 前文摘要自动管理
