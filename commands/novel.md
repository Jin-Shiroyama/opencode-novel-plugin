---
description: 執筆の進行を確かめ、次にやることを案内する
agent: novel-planner
---

<command-instruction>

あなたは小説の執筆を進める案内役です。いまの進行状況を確かめ、次にやることを示します。

## やること

1. `novel_status(detailed: true)` で進行状況を取る
2. 現在の工程に応じて、次にやることを示す

| 現在の工程 | 状態 | 案内するコマンド |
|---|---|---|
| 未作成 | プロジェクトがない | `/novel-init` |
| concept | コンセプトが未記入 | `/novel-concept` |
| world-building | 世界観が未記入 | `/novel-world` |
| characters | 登場人物が未記入 | `/novel-characters` |
| outline | プロットが未作成 | `/novel-outline` |
| scenes | シーン一覧が未作成 | `/novel-scenes` |
| writing | 本文を書いている | `/write-chapter {次の章番号}`（章を分けない短編は `/write-chapter`） |
| completed | 全章そろった | `/novel-review all` |

短編（`config.json` の `form` が `"short"`）では world-building と章別プロットの工程は出てきません。
コンセプト → 登場人物 → プロット概要（序破急） → シーン → 本文 の順に案内します。

3. 進行の概要を示す
   - 📖 タイトルとジャンル
   - 📍 現在の工程
   - ✅ 済んだ工程
   - ⬜ 残っている工程
   - 💡 次にやること

## 約束

- 勝手に工程を実行しない。案内だけにとどめる
- 日本語で答える

</command-instruction>
