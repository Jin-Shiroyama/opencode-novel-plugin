---
description: 查看小说项目的当前状态和进度
---

<command-instruction>

查看小说项目的完整状态报告。

## 执行步骤

1. 调用 `novel_status(detailed: true)` 获取详细状态
2. 将结果展示给用户
3. 根据当前阶段给出下一步建议

## 建议逻辑

| 当前阶段 | 建议 |
|---------|------|
| concept | "故事概念尚未完成。使用 `/novel concept` 继续设计。" |
| world-building | "世界观尚未完成。使用 `/novel world` 继续构建。" |
| characters | "角色设计尚未完成。使用 `/novel characters` 继续设计。" |
| outline | "大纲尚未完成。使用 `/novel outline` 继续编写。" |
| scenes | "场景尚未完成。使用 `/novel scenes` 继续设计。" |
| writing | "正在写作中。使用 `/write-chapter {N}` 继续写下一章。" |
| completed | "恭喜！小说已完成。使用 `/novel-review` 进行终审。" |

## 语言

使用中文回复。

</command-instruction>
