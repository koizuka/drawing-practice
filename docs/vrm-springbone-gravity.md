# VRM spring bone と髪の重力（逆立ちで髪が下りない問題）

## 症状

ポーズ手本（`PoseSourcePanel`）で逆立ちなどの倒立ポーズを生成しても、髪が重力方向（地面側）に垂れ下がらず、直立時と同じ「頭に対して垂れた形」のまま＝ワールドでは上向きになる。

## 結論: モデルの仕様であり、コードの問題ではない

`PoseViewer.tsx` のレンダループは毎フレーム `vrm.update(delta)` を呼んでおり、spring bone 物理シミュレーションは正常に動作している（ポーズ適用後 ~1 秒で髪が落ち着くのがそれ）。

VRM の spring bone には 2 種類の力がある:

- **stiffness** — ボーンを**レストポーズ（頭基準の初期形状）**に戻そうとする力
- **gravityPower** — **ワールド空間の gravityDir（通常は真下）**に引く力

バンドルの `public/mannequin.vrm` の `VRMC_springBone` を実測したところ、髪（`Hair` スプリング群）は:

| パラメータ | 値 |
|---|---|
| stiffness | 0.4〜0.7 |
| gravityPower | 大半が未指定（= 0）、最大でも 0.1 |
| dragForce | 0.4〜0.5 |

つまりこのモデルの髪は実質 **stiffness だけ**で動いている。レストポーズが「垂れ下がった髪」なので直立時は重力落下に見えるが、実際は頭基準の形状に戻っているだけ。倒立させると「頭基準の垂れ髪」＝ワールド上向きになり、gravity 0.1 では stiffness 0.5 に勝てず髪は下りない。

## ユーザーロードの .vrm にも同じことが当てはまる

これは mannequin.vrm 固有ではなく、**多くの VRM モデルが同様の調整**（gravity 弱め・stiffness 主体。直立時の髪型維持を優先し、倒立姿勢は想定外）になっている。ユーザーが `poseAssets` 経由でロードしたモデルでも、そのモデルの spring bone 設定次第で同じ症状が出る。逆に gravity が強く設定されたモデルなら倒立で髪が垂れる。

## 対処するなら（未実装）

three-vrm はロード後に各 joint の設定を書き換えられる:

```ts
for (const joint of vrm.springBoneManager?.joints ?? []) {
  joint.settings.gravityPower = 1.0;  // 例
  joint.settings.stiffness *= 0.5;
}
```

髪系スプリングだけ gravityPower を上げ stiffness を下げれば倒立で髪が垂れるようになるが、**直立時の髪型が崩れる（ボリュームが潰れる）副作用**があるトレードオフ。ポーズ手本という用途では現状維持で問題ないと判断し、未実装。実装する場合はスプリング名（`Hair` など）でのフィルタと、モデルごとの効き方の差に注意。

## 検証方法

GLB の JSON チャンクから直接読める:

```bash
node -e "
const buf = require('fs').readFileSync('public/mannequin.vrm');
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
for (const s of json.extensions.VRMC_springBone.springs)
  console.log(s.name, s.joints.map(j => ({g: j.gravityPower, stiff: j.stiffness})));
"
```
