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
| writing | 本文を書いている | `/write-chapter {次の章番号}`（章を分けない短編は `/write-chapter`。続けて何話か書くなら `/write-chapters next 3`） |
| completed | 全章そろった | `/novel-review all` |

本文が1話でも書けていて、投稿の準備（題・キャッチコピー・紹介文・タグ、1話ずつの書き出し）がまだなら、`/novel-publish` も添えて案内します。

短編（`config.json` の `form` が `"short"`）では world-building と章別プロットの工程は出てきません。
コンセプト → 登場人物 → プロット概要（序破急） → シーン → 本文 の順に案内します。

二次創作（`novel_status` に「📚 二次創作」が出る作品）で、記録の点検に「原作の資料がまだありません」と出ていれば、
現在の工程の案内より先に `/novel-canon` を案内します。

連載（`serial: true`）ではシーン設計を省けるので、章別プロットがあれば scenes の工程は出てきません。
記録の点検に「全体の流れが古くなっています」と出ていれば、次の章を書く前に更新するよう案内します。

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
