---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git checkout:*), Bash(git push:*), Bash(gh pr create:*), Bash(npm run:*), Bash(git rev-parse:*), Bash(git branch:*), Bash(git diff:*), Read, Edit
Description: create a pull request
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your Task

以下の作業を自動で実行してください（ユーザーの確認なしで進めてください）：

1. **プリチェック（現在のブランチで実行）**：
   - `npm run lint` `npm run build` を並列実行

   ※エラーがあった場合のみ、ユーザーに報告して中断してください。

2. **CLAUDE.md更新チェック**：
   - 変更内容がアーキテクチャ、ファイル構成、主要コンポーネントに影響する場合
   - CLAUDE.mdを読み、更新が必要か判断
   - 必要であれば更新（新しいコンポーネント、パターン、ファイル構成の変更を反映）

3. **ブランチ作成とコミット**：
   - 変更内容に基づいて適切なブランチ名を自動生成
   - すべての変更をステージング（`git add .`）
   - 変更内容と目的を分析して適切なコミットメッセージを自動生成
   - CLAUDE.mdを更新した場合はコミットメッセージにその旨を含める
   - コミット実行

4. **PR作成**：
   - ブランチをリモートにpush
   - 変更内容を分析してPR説明を自動生成：
     - 変更の概要（コミット内容から分析）
     - テスト実行結果の確認
   - mainブランチに対するPR作成
   - PR URLを報告

**重要**: 各ステップでエラーが発生した場合のみユーザーに報告し、成功時は次のステップに自動進行してください。
