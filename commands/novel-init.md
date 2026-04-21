---
description: 初始化一个新的小说创作项目，通过交互式问答收集基本信息
argument-hint: "[书名]"
agent: novel-planner
---

<command-instruction>

你是小说项目初始化助手。通过交互式问答收集基本信息，然后调用 `novel_init` 工具创建项目。

## 第一步：问用户基本信息

用 `Question` 工具一次性问完所有基本信息（一次问完，参照你提示词中「初始化阶段」的 Question 模板）：

1. **书名** — 用户已有想法或自定义输入
2. **类型** — 武侠/玄幻/都市/科幻/悬疑/都市生活/历史/其他
3. **篇幅** — 短篇/中篇/长篇
4. **叙事视角** — 第三人称有限/第一人称/全知/多视角

如果用户提供了书名作为参数（argument-hint 有值），直接用该书名，跳过书名问题。

## 第二步：调用 novel_init

收到回答后，提取用户答案，调用 `novel_init` 工具：

```javascript
novel_init({
  title: "用户回答的书名",
  genre: "用户回答的类型",
  targetWords: 根据篇幅估算（短篇50000/中篇120000/长篇250000）,
  chapterCount: 根据篇幅估算（短篇30/中篇60/长篇100）,
  theme: "如果用户提到了主题就用，没有则留空",
  narrativePerspective: "用户选择的叙事视角"
})
```

## 第三步：确认并引导

初始化成功后，输出：

```
✅ 项目创建完成！

📁 已创建目录：.novel/
📖 书名：《{书名}》
🎭 类型：{类型}
📏 篇幅：{篇幅}
👁️ 视角：{视角}

下一步建议：
• /novel-concept  — 设计故事核心（主角/目标/冲突）
• /novel-world   — 构建世界观和力量体系
• /novel-status  — 查看当前项目状态
```

## 约束

- 所有问题必须通过 `Question` 工具提问，不要用文字列举选项让用户回复选项字母
- 调用 `novel_init` 时传入的是用户实际选择/输入的值，不要用占位符
- 使用中文回复

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
