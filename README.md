# Drawing Practice

iPad + Apple Pencil を使ったドローイング練習ツール。お手本（Sketchfabの3Dモデルやローカル画像）を見ながら線画を描く練習ができます。

**Live**: https://koizuka.github.io/drawing-practice/

## Features

- **2分割レイアウト**: お手本画面とドロー画面を横/縦自動切替で表示
- **Sketchfab連携**: 3Dモデルを検索・表示し、好きな角度でスクリーンショットを固定
- **ローカル画像**: 手持ちの画像ファイルをお手本として読み込み
- **描画ツール**: ペン、消しゴム（ストローク単位）、Undo/Redo
- **補助線**: 両画面同期のグリッド（中央太線付き）、お手本画面でドラッグして任意の線分を配置
- **ズーム/パン**: 2本指ピンチ（iPad）/ トラックパッド（Mac）対応
- **全画面モード**: Fullscreen API対応ブラウザで画面を最大限活用
- **答え合わせ**: ドロー画面の線画をお手本画面にグリッド座標で重ねて比較
- **タイマー**: 描画時間を自動計測、バックグラウンド一時停止対応
- **保存・ギャラリー**: IndexedDBに蓄積、サムネイル・お手本情報付き一覧表示、同じお手本で再練習

## Development

```bash
npm install
npm run dev        # Development server
npm run build      # Build for production
npm run test       # Run tests
npm run lint       # Lint
```

## Tech Stack

- React + TypeScript + Vite
- Material-UI
- Vitest + React Testing Library
- Dexie.js (IndexedDB)
- Sketchfab Viewer API / Data API
- GitHub Pages
