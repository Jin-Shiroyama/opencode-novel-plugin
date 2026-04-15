import type { ToolContext } from "../index.js"

interface GuideArgs {
  section?: "workflow" | "prompts" | "writing" | "foreshadow" | "characters"
}

export async function novelGuideExecute(
  args: GuideArgs,
  _ctx: ToolContext,
): Promise<string> {
  const section = args.section ?? "workflow"

  switch (section) {
    case "workflow":
      return WORKFLOW_GUIDE
    case "prompts":
      return PROMPTS_GUIDE
    case "writing":
      return WRITING_GUIDE
    case "foreshadow":
      return FORESHADOW_GUIDE
    case "characters":
      return CHARACTERS_GUIDE
    default:
      return WORKFLOW_GUIDE
  }
}

const WORKFLOW_GUIDE = `# 📖 小说创作工作流指南

## 工作流概览

\`\`\`
概念 → 世界观 → 角色 → 简要大纲 → 详细大纲 → 场景设计 → 正文创作
 0       1        2        3           4          5          6
\`\`\`

## 各阶段详细说明

### 阶段 0: 故事概念 (concept.md)
**目标**: 将模糊创意转化为清晰的故事核心

**输出**:
- 一句话概括（25字以内）
- 五句话梗概（三幕式结构）
- 核心冲突（外部+内部）
- 道德前提
- 两次两难抉择

**工具**: novel_init (初始化) → 填写 concept.md
**提示词**: 使用 "concept" 提示词模板

### 阶段 1: 世界观构建 (world-building.md)
**目标**: 创建自洽的世界设定

**输出**:
- 时代背景与地理环境
- 社会结构（权力、阶层、势力）
- 力量体系（如适用）
- 文化风俗
- 世界规则

**依赖**: concept.md 已完成
**提示词**: 使用 "world-building" 提示词模板

### 阶段 2: 角色设计 (characters/profiles.md)
**目标**: 创建立体丰满的角色群

**输出**:
- 主角完整档案（驱动力三角 + 人物弧线）
- 对手角色设计
- 重要配角
- 人物关系图谱
- 角色冲突矩阵

**依赖**: concept.md + world-building.md 已完成
**提示词**: 使用 "characters" 提示词模板

### 阶段 3: 简要大纲 (outline-brief.md)
**目标**: 规划三幕式结构的骨架

**输出**:
- 各幕章节分配
- 关键转折点标记
- 两次两难抉择位置
- 伏笔规划表

**依赖**: 概念 + 世界观 + 角色已完成
**提示词**: 使用 "outline-brief" 提示词模板

### 阶段 4: 详细大纲 (outline-detailed.md)
**目标**: 逐章详细规划

**输出**:
- 每章核心情节（200-300字）
- 涉及角色与状态变化
- 伏笔操作
- 关键场景提示
- 章节结尾钩子

**依赖**: outline-brief.md 已完成
**提示词**: 使用 "outline-detailed" 提示词模板

### 阶段 5: 场景设计 (scenes.md)
**目标**: 将章节分解为可执行的场景

**输出**:
- 场景列表（主动/被动交替）
- 每个场景的 _Prompt 写作指导
- 场景状态追踪 ([ ] → [-] → [x])

**依赖**: outline-detailed.md 已完成
**提示词**: 使用 "scenes" 提示词模板

### 阶段 6: 正文创作 (chapters/)
**目标**: 逐章撰写正文

**流程**:
1. 使用 novel_context 获取写作上下文
2. 根据大纲和场景指导撰写正文
3. 使用 novel_save_chapter 保存章节
4. 使用 novel_update 更新追踪文件
5. 重复直到所有章节完成

**依赖**: scenes.md 已完成
**提示词**: 使用 "chapter-write" 或 "chapter-continue" 提示词模板

## 关键原则

1. **阶段顺序**: 严格按顺序推进，每阶段完成后再进入下一阶段
2. **用户确认**: 每个阶段完成后，请用户确认再继续
3. **上下文管理**: 写作时始终使用 novel_context 构建完整上下文
4. **状态追踪**: 每章完成后更新角色状态、摘要、伏笔
5. **一致性检查**: 定期使用 "consistency-check" 提示词检查一致性
`

const PROMPTS_GUIDE = `# 📝 提示词使用指南

## 可用提示词模板

| 模板名 | 用途 | 何时使用 |
|--------|------|---------|
| concept | 故事概念创建 | 阶段0 |
| world-building | 世界观构建 | 阶段1 |
| characters | 角色设计 | 阶段2 |
| outline-brief | 简要大纲 | 阶段3 |
| outline-detailed | 详细大纲 | 阶段4 |
| scenes | 场景设计 | 阶段5 |
| chapter-write | 第一章写作 | 阶段6（第1章）|
| chapter-continue | 后续章节续写 | 阶段6（第2章+）|
| consistency-check | 一致性检查 | 任意阶段 |
| character-state-update | 角色状态更新 | 阶段6（每章后）|
| summary-update | 摘要更新 | 阶段6（每章后）|

## RTCO 框架说明

所有提示词采用 RTCO 结构：
- **R**ole (system): 角色定位和专长
- **T**ask: 具体创作任务和要求
- **C**ontext/Organize: 上下文信息和组织结构
- **O**utput: 期望的输出格式

## 优先级分层

写作时的上下文优先级：
- **P0 (必须)**: 本章大纲、基本设定
- **P1 (重要)**: 角色档案、前章衔接、角色状态
- **P2 (参考)**: 伏笔提醒、前文摘要、写作技巧

## 使用方法

1. 使用 novel_guide 查看提示词列表
2. 读取对应提示词模板内容
3. 用项目具体信息填充模板中的 {变量}
4. 将填充后的提示词作为写作指导
`

const WRITING_GUIDE = `# ✍️ 写作技巧指南

## 场景类型

### 主动场景 (Goal → Conflict → Disaster)
- **Goal**: 角色有明确的目标
- **Conflict**: 遇到阻碍或对抗
- **Disaster**: 结果出乎意料，比之前更糟

### 被动场景 (Reaction → Dilemma → Decision)
- **Reaction**: 对上一场景的情绪反应
- **Dilemma**: 面临艰难的选择
- **Decision**: 做出决定，推动情节

## 主动/被动场景交替创造节奏

\`\`\`
主动 → 被动 → 主动 → 被动 → ...
紧张 →  反思 → 紧张 →  反思 → ...
\`\`\`

## 避免 AI 写作常见问题

❌ 使用"总之"、"综上所述"、"不禁"等总结性词汇
❌ 过度使用感叹号和省略号
❌ 对话过于书面化和正式
❌ 用大段内心独白替代行为描写
❌ 角色情绪过于理性清晰
❌ 场景描写过于抽象缺乏画面感

✅ Show, Don't Tell（通过行为展示情感）
✅ 使用具体细节而非抽象描述
✅ 让对话自然，加入语气词和口头禅
✅ 通过小动作展现紧张情绪
✅ 五感描写营造沉浸感
✅ 短句加速节奏，长句放慢节奏

## 字数控制

- 每章目标字数 = 总目标字数 / 章节数
- 允许 ±200 字浮动
- 中文小说通常每章 3000-5000 字
`

const FORESHADOW_GUIDE = `# 🎯 伏笔管理指南

## 伏笔生命周期

\`\`\`
pending → planted → resolved
                  → abandoned
\`\`\`

- **pending**: 计划中的伏笔，尚未写入正文
- **planted**: 已在正文中埋设
- **resolved**: 已在正文中回收
- **abandoned**: 放弃回收（标记原因）

## 伏笔分类

| 类型 | 说明 | 示例 |
|------|------|------|
| identity | 身份相关 | 隐藏的真实身份 |
| mystery | 悬念谜团 | 未解的谜题 |
| item | 物品道具 | 关键道具的暗示 |
| relationship | 关系线索 | 隐藏的血缘关系 |
| event | 事件伏笔 | 即将发生的重大事件 |
| ability | 能力伏笔 | 未觉醒的能力 |
| prophecy | 预言暗示 | 预言或梦境 |

## 伏笔提醒策略

写作时按距离分层提醒：
- **本章必须回收**: targetChapter == 当前章节 → 必须处理
- **即将到期**: 未来3章内 → 可以开始铺垫
- **远期伏笔**: 超过3章 → 不发送，避免干扰

## 使用方法

1. 在 foreshadow.json 中登记伏笔
2. 写作时使用 novel_context 自动获取提醒
3. 回收伏笔后更新状态为 "resolved"
4. 定期检查是否有长期未回收的伏笔
`

const CHARACTERS_GUIDE = `# 👤 角色管理指南

## 角色状态追踪维度

1. **存活状态**: active / deceased / missing / retired
2. **心理状态**: 情绪变化、心理创伤、认知转变
3. **物品变化**: 获得/失去的重要物品
4. **能力变化**: 新习得/失去的技能
5. **关系变化**: 与其他角色关系的变化
6. **重要事件**: 影响角色的关键事件

## 角色驱动力三角

每个核心角色必须有：
- **外在目标**: 角色想要什么（具体的）
- **内在需求**: 角色真正需要什么（深层的）
- **核心缺陷**: 阻碍成长的弱点（源于过去）

## 人物弧线设计

| 阶段 | 状态 | 作用 |
|------|------|------|
| 起点 | 初始信念 | 建立基线 |
| 发展 | 开始动摇 | 接受挑战 |
| 低谷 | 最黑暗 | 核心缺陷暴露 |
| 成长 | 新的认知 | 跨越障碍 |
| 终点 | 全新状态 | 完成转变 |

## 更新频率

- 每章完成后: 更新涉及角色的状态
- 重大事件后: 更新关系变化
- 每卷结束后: 回顾所有角色弧线进度
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
