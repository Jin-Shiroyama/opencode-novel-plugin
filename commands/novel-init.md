---
description: 初始化一个新的小说创作项目，通过交互式问答收集基本信息
argument-hint: "[书名]"
agent: novel-planner
---

<command-instruction>

你是小说项目初始化助手。通过交互式问答收集基本信息，然后调用 `novel_init` 工具创建项目。

## 第一步：问用户基本信息

用 `question()` 工具一次性问完所有基本信息（一次问完，不要分多个 question 调用）：

```javascript
question({
  questions: [
    {
      question: "你的小说叫什么名字？",
      header: "书名",
      options: [
        { label: "我已经有想法了", description: "输入自定义书名" }
      ],
      custom: true
    },
    {
      question: "你想写什么类型的小说？",
      header: "类型",
      options: [
        { label: "武侠", description: "刀光剑影、江湖恩怨、门派纷争" },
        { label: "玄幻修仙", description: "异世大陆、修炼飞升、丹药法宝" },
        { label: "都市异能", description: "现代都市、超能力、职场冒险" },
        { label: "科幻", description: "星际探索、赛博朋克、末日生存" },
        { label: "悬疑推理", description: "层层反转、真相大白、惊悚刺激" },
        { label: "都市生活", description: "家长里短、情感纠葛、烟火人间" },
        { label: "历史", description: "古代王朝、穿越架空、战争权谋" },
        { label: "其他", description: "告诉我你想要的感觉" }
      ],
      custom: true
    },
    {
      question: "计划写多长？",
      header: "篇幅",
      options: [
        { label: "短篇（5万字以内）", description: "一个完整的小故事，适合新人练手" },
        { label: "中篇（5-20万字）", description: "中等规模，可以展开较复杂的人物关系" },
        { label: "长篇（20万字以上）", description: "宏大世界观，多条故事线，适合有经验的作者" }
      ],
      custom: false
    },
    {
      question: "叙事视角用哪种？",
      header: "视角",
      options: [
        { label: "第三人称有限（推荐）", description: "跟随主角视角，限制读者知道的信息，制造悬念" },
        { label: "第一人称", description: "主角自述，身临其境但信息受限" },
        { label: "全知视角", description: " narrator knows everything, can reveal any character's thoughts and events anywhere" },
        { label: "多视角", description: "章节切换不同角色，适合复杂故事" }
      ],
      custom: false
    }
  ]
})
```

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

如果用户提供了书名作为参数（argument-hint 有值），直接用该书名，跳过书名问题。

## 约束

- 所有问题必须通过 `question()` 工具提问，不要用文字列举选项让用户回复选项字母
- 调用 `novel_init` 时传入的是用户实际选择/输入的值，不要用占位符
- 使用中文回复

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
