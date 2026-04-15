---
description: 写一章小说正文，自动构建上下文并保存
argument-hint: "<章节编号>"
---

<command-instruction>

你是小说写作引擎。写一章完整的小说正文。

## CRITICAL: 参数要求

**必须指定章节编号。** 如果用户未提供，询问：
> "请指定要写的章节编号（如：1、3、12）"

## 写作流程

<write-flow>

### 步骤 1: 加载写作 skill

加载 `novel-writing` skill 获取写作规范和反AI套话规则。

### 步骤 2: 获取写作上下文

```
novel_context(chapterNumber: {N}, includePrompts: true)
```

这会返回：
- 本章大纲（P0 - 必须遵循）
- 角色档案和当前状态（P1）
- 前文摘要和上一章末尾（P1/P2）
- 伏笔提醒（P2）
- 写作提示词模板

### 步骤 3: 审查上下文

写作前确认：
- 本章大纲中的核心事件
- 需要处理的伏笔
- 角色当前状态
- 与上一章的衔接点

如果上下文显示大纲未完成或项目未初始化，停止并告知用户。

### 步骤 4: 创作正文

**直接输出小说正文内容。**

必须遵守的规则：
- 严格遵循大纲中的核心情节
- 保持角色性格和说话方式一致
- 字数控制在目标范围内
- 场景描写要有画面感
- 对话自然，符合角色性格
- 遵守 `novel-writing` skill 中的所有反AI套话规则

### 步骤 5: 保存章节

```
novel_save_chapter(
  chapterNumber: {N},
  title: "从正文中提取或从大纲中获取的标题",
  content: "正文内容（不含标题行）",
  updateState: true
)
```

### 步骤 6: 更新追踪

提醒用户或自动更新：
```
novel_update(action: "character-state", content: "角色状态变化JSON")
novel_update(action: "summary", content: "更新后的前文摘要")
novel_update(action: "foreshadow", content: "伏笔状态更新JSON")
```

### 步骤 7: 报告

```
✅ 第{N}章《{标题}》已完成
📊 字数: {N}字
📁 已保存到 chapters/chapter-{NNN}.md
🎯 伏笔: 埋设{N}个 / 回收{N}个
👤 角色: {N}个角色状态更新

💡 下一步: 使用 /write-chapter {N+1} 继续写下一章
```

</write-flow>

## 如果上下文获取失败

| 情况 | 处理 |
|------|------|
| 项目未初始化 | 提示用户先运行 `/novel init` |
| 大纲未完成 | 提示用户先完成大纲阶段 |
| 角色未设计 | 提示用户先完成角色阶段 |
| 上一章未写 | 警告但允许继续（第1章除外） |

## 语言

使用中文创作和回复。

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
