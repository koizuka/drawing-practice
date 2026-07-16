# ポーズ生成のヘッドレス検証ループ

ポーズ機能(プロンプト・IK・検証器・レシピ)の改善サイクルを、ブラウザ/実機なしで
ターミナルだけで回すための仕組み。膝抱えストレッチ事故(レシピが検証器に恒常的に
弾かれる → 補正ループがポーズを壊す)の再発防止として導入した。

## 構成

```
scripts/extract-pose-rig.mjs        .vrm → 骨格フィクスチャ抽出(npm run extract-pose-rig)
src/pose/__fixtures__/mannequinRig.json   bundled mannequin の rest 骨格(実比率)
src/pose/poseTestHarness.ts         フィクスチャから実比率スケルトンを組み
                                    applyPose → 計測 → diagnosePose を vitest で実行
src/pose/poseTestHarness.test.ts    レシピ↔検証器のロック(全レシピが実 rig で検証通過)
src/pose/poseLlmLoop.manual.test.ts 実 LLM を含む end-to-end ループ(要 API キー)
```

## 決定論部分(API 不要・常時 CI 実行)

`makeMannequinHarness()` が `PoseViewer.rigOf` / `measurePose` と同じセマンティクスを
実マネキンの比率で再現する。**posePrompt.ts のレシピ座標を変えたら
poseTestHarness.test.ts の対応レシピも更新して `npm run test` で機械検証する** —
検証器に弾かれるレシピは、生成のたびに補正ラウンドを浪費し、モデルに「正しいポーズの
修正」を強要して壊させる。

なぜ実比率が必要か: bundled mannequin は太もも 0.353m に対しすね 0.415m + 足首高
0.10m と脚が長く、名目比率(1.6m 人体)でチューニングした座標が床貫通や膝逆折れを
起こす。名目スケルトンでの検証は通っても実機で落ちる(膝抱え事故がまさにこれ)。

モデル(.vrm)を差し替えたら `npm run extract-pose-rig` でフィクスチャを再抽出する。

## LLM 込みの end-to-end ループ(手動・メモ化)

```bash
# .env.local(gitignore 済み)にキーを書く
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env.local

npx vitest run src/pose/poseLlmLoop.manual.test.ts --silent=false --disable-console-intercept
```

- 実際の generatePose → refinePoseUntilValid をハーネスの計測で回し、
  最終ポーズに床貫通が残らないことを検証する。
- 成功レスポンスは `.cache/pose-llm/`(gitignore 済み)にリクエストボディの
  ハッシュをキーとして永続メモ化 — プロンプトとシナリオが変わらない限り再実行は
  API を一切呼ばない。プロンプトを変えるとハッシュが変わり自動で再取得。
  強制再取得は該当キャッシュファイルの削除で。
- キーが無い環境(CI 含む)では自動スキップ。
- シナリオ追加は `SCENARIOS` 配列に hint を足すだけ。
