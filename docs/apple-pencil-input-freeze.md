# Apple Pencil 入力フリーズ（描画中に突然ストロークが無視される）

## 症状

iPad + Apple Pencil で描画中、**突然ストロークが一切登録されなくなる**。ブラウザのタブを切り替えて戻る、または**ペンを 2 秒ほど離す**と復活する。長時間の高頻度な短ストローク連打（書き取りのような動き）を続けたあとに発生しやすい。

## 確定した機序

`?diag=touch` 診断ハーネス（`src/drawing/touchDiagnostics.ts` + `TouchDiagnosticsOverlay.tsx`）の実機計測で、フリーズ"中"を直接捕捉して確定した:

**フリーズ＝ WebKit/iPadOS がページ全体への入力配信（touch・pointer の両方）を停止しているだけ。rAF・メインスレッド・コンポジッタは 60fps で完全に生存している。**

決定的な証拠（during-freeze tick、261 秒連続描画後の onset を含むキャプチャ）:

- フリーズ中も毎秒 `raf: 60〜61` / `sinceRaf: 5〜16ms`（requestAnimationFrame コールバックは新鮮に回り続けている）。
- 同時に `move / append / doc / ptr / pen` がすべて 0（**touch も pointer も同時に死ぬ**）、`redraw: 0`。
- ＝ rAF 死でも、メインスレッド停止でも、コンポジッタが新フレームを提示しない問題でもない。OS/WebKit がページへの**全入力配信を止めている**。

復旧は **入力を ~2 秒止める**（実測: ある onset は 2016ms で自己復帰）か、visibility 変化（タブ切替）のみ。JS から強制復旧する API は無い。

## トリガ

連続した高頻度の短ストローク連打。**間欠的で閾値は可変**（8 分以上描いても出ない回もあれば、同一セッション内で何度も起きる回もある）。「2 秒以上止めずに描き続けた継続時間（streak）」が長いほど起きやすいが、**streak の長さは一定しない**: あるセッションでは onset 直前 streak が 150〜261 秒、別のセッションでは 15〜62 秒で頻発（10 分弱で 18 回、うち 10 秒・14 秒級の長いフリーズも）。フリーズ時間も ~2 秒の自己復帰から 14 秒超までばらつく。既知の WebKit 報告と同類:

- 高速タップで touch/pointer が発火しなくなる（Apple Developer Forums 664108）。
- 排他タッチタイプ認識器（`requiresExclusiveTouchType` 相当、OS パームリジェクト。Forums 773213 / FB16411500）。

## 反証した仮説（すべて計測で否定）

| 仮説 | 反証 |
|---|---|
| stylus フィルタが Pencil を誤分類して破棄 | フリーズ中は canvas の `touchmove` 自体がゼロ。破棄ではなく未着信。 |
| stale pinch 誤認 | 同上。pinch カウンタ非増。 |
| backpressure（非passive の preventDefault でメインスレッドが詰まる） | `latMax`（`performance.now() - touchmove.timeStamp`）が密な連続描画でも終始 8〜23ms フラット、一度も増大せず。 |
| canvas がイベントターゲット/リスナを喪失 | document レベル観測でも canvas ターゲットの touch がゼロ。ref-bridge 健全。 |
| メインスレッド/rAF 停止 | during-freeze tick で `raf` 60 維持。 |
| コンポジッタが新 bitmap を提示しない | rAF 生存かつ `redraw` は入力駆動なので「描くものが無い＝当然 0」。提示問題ではない。前回「画面の診断ドットが止まった」も入力途絶による redraw 停止で説明でき、提示死の証拠ではない。 |
| lost-touchend（touchend ロスト → 接触中と誤認 → 排他ロック） | クリーンな onset で `open`(=touchstart−touchend−touchcancel) も `active`(canvas のライブ接触数) も 0。孤立接触は我々の観測層には無い。 |

過去の未検証修正 #166（コンポジッタ層昇格 `translateZ(0)`）/ #191（stale touch/pinch リセット）は **canvas 内部対策のため原理的に効かない**（入力がそもそもページに届いていない）。これが再発し続けた理由を説明できた。

## 採用した緩和策

OS バグ自体は web から修正できない。だが**ページは 60fps で生存しており、フリーズをページ内で検出できる**。そこで:

- 入力が一定時間途絶し、かつ直前の連続描画 streak が十分長い（フリーズが起きやすい領域）ときに、**「ペンを 2 秒ほど離すと復帰します」というヒントを、最後に描画していた位置の近く**（集中時の視線位置）に非ブロッキングで表示する。入力が再開したら即座に消える。

実装: `src/components/DrawingFreezeHint.tsx`（検出ロジック `evaluateFreezeHint` は純関数でテスト可能）、`DrawingCanvas` が入力タイムスタンプ・streak・最後の描画スクリーン座標を提供。`pointerEvents:'none'` で描画は一切妨げない。touch 由来の信号のみに依存するため desktop マウスでは発火しない。

注意: フリーズと「意図的な休憩」は、どちらもページから見ると「イベントの不在」で**原理的に区別できない**。そのため誤検出を完全には消せないが、(1) 長い streak の後に限定、(2) 非ブロッキングで入力再開時に即消灯、(3) 一定時間で自動消灯、により実用上無害なヒントに抑えている。さらに、クリア/Undo/Redo/削除・ズームリセット・反転などの**離散的な UI 操作では判定 streak をリセット**する（ボタン操作の前後の間を「描いているのにフリーズ」と誤認しないため）。

## 根本修正

OS/WebKit 側。during-freeze ログを証拠に Apple Feedback / WebKit Bugzilla へ報告するのが筋（別タスク）。

## 診断ハーネス（撤去済み）

調査完了に伴い、`?diag=touch` の診断ハーネス（`touchDiagnostics.ts` + `TouchDiagnosticsOverlay.tsx`、キャンバス上の赤ドット heartbeat を含む）は撤去した。再調査が必要になったら git 履歴から復元できる。
