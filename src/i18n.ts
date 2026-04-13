const messages = {
  en: {
    // DrawingPanel
    'pen': 'Pen',
    'eraser': 'Eraser',
    'undo': 'Undo',
    'redo': 'Redo',
    'clearAll': 'Clear all & reset timer',
    'compare': 'Compare with reference',
    'resetZoom': 'Reset zoom',
    'flipHorizontal': 'Flip horizontal',
    'saveDrawing': 'Save drawing',
    'saved': 'Saved!',
    'gallery': 'Gallery',
    'delete': 'Delete',
    'cancel': 'Cancel',

    // ReferencePanel
    'sketchfab': 'Sketchfab',
    'image': 'Image File',
    'changeAngle': 'Change Angle',
    'addGuideLine': 'Add guide line',
    'deleteGuideLine': 'Delete guide line',
    'clearGuideLines': 'Clear all guide lines',
    'cycleGrid': 'Cycle grid (off / normal / large)',
    'fullscreen': 'Fullscreen',
    'exitFullscreen': 'Exit fullscreen',
    'selectReference': 'Select a reference source above',

    // SketchfabViewer
    'searchModels': 'Search models...',
    'search': 'Search',
    'modelUid': 'Model UID...',
    'load': 'Load',
    'loadingModel': 'Loading model...',
    'loadingApi': 'Loading Sketchfab API...',
    'back': 'Back',
    'fixThisAngle': 'Fix This Angle',
    'failedLoadModel': 'Failed to load model',
    'failedScreenshot': 'Failed to capture screenshot',
    'searchFailed': 'Search failed. Try again.',
    'failedFetchModels': 'Failed to fetch models',
    'allTime': 'All Time',
    'thisWeek': 'This Week',
    'thisMonth': 'This Month',
    'thisYear': 'This Year',
    'loadMore': 'Load More',
    'animals': 'Animals',
    'vehicles': 'Vehicles',
    'characters': 'Characters',
    'food': 'Food',
    'furniture': 'Furniture',
    'plants': 'Plants',
    'technology': 'Technology',

    // Gallery
    'galleryTitle': 'Gallery',
    'loading': 'Loading...',
    'noDrawings': 'No saved drawings yet.',
    'loadReference': 'Use this reference',
    'buildDate': 'Build',
    'url': 'URL',
    'urlPlaceholder': 'Image or YouTube URL...',
    'loadUrl': 'Load',
    'urlLoadFailed': 'Failed to load image from URL.',
    'autosaveDisabled': 'Autosave is disabled because another tab is active. Changes in this tab will not be saved automatically.',
  },
  ja: {
    // DrawingPanel
    'pen': 'ペン',
    'eraser': '消しゴム',
    'undo': '元に戻す',
    'redo': 'やり直し',
    'clearAll': '全消去・タイマーリセット',
    'compare': 'お手本と重ねて比較',
    'resetZoom': 'ズームリセット',
    'flipHorizontal': '左右反転',
    'saveDrawing': '保存',
    'saved': '保存しました！',
    'gallery': 'ギャラリー',
    'delete': '削除',
    'cancel': 'キャンセル',

    // ReferencePanel
    'sketchfab': 'Sketchfab',
    'image': '画像ファイル',
    'changeAngle': '角度変更',
    'addGuideLine': '補助線を追加',
    'deleteGuideLine': '補助線を削除',
    'clearGuideLines': '補助線を全削除',
    'cycleGrid': 'グリッド切替（なし／通常／大）',
    'fullscreen': '全画面',
    'exitFullscreen': '全画面を終了',
    'selectReference': 'お手本を選んでください',

    // SketchfabViewer
    'searchModels': 'モデルを検索...',
    'search': '検索',
    'modelUid': 'モデルUID...',
    'load': '読込',
    'loadingModel': 'モデルを読み込み中...',
    'loadingApi': 'Sketchfab APIを読み込み中...',
    'back': '戻る',
    'fixThisAngle': 'この角度で固定',
    'failedLoadModel': 'モデルの読み込みに失敗しました',
    'failedScreenshot': 'スクリーンショットの取得に失敗しました',
    'searchFailed': '検索に失敗しました。もう一度お試しください。',
    'failedFetchModels': 'モデルの取得に失敗しました',
    'allTime': '全期間',
    'thisWeek': '今週',
    'thisMonth': '今月',
    'thisYear': '今年',
    'loadMore': 'もっと見る',
    'animals': '動物',
    'vehicles': '乗り物',
    'characters': 'キャラクター',
    'food': '食べ物',
    'furniture': '家具',
    'plants': '植物',
    'technology': 'テクノロジー',

    // Gallery
    'galleryTitle': 'ギャラリー',
    'loading': '読み込み中...',
    'noDrawings': '保存された絵はまだありません。',
    'loadReference': 'このお手本で練習',
    'buildDate': 'ビルド',
    'url': 'URL',
    'urlPlaceholder': '画像またはYouTubeのURL...',
    'loadUrl': '読込',
    'urlLoadFailed': 'URLからの画像の読み込みに失敗しました。',
    'autosaveDisabled': '別のタブが開いているため、オートセーブが無効です。このタブの変更は自動保存されません。',
  },
} as const

type MessageKey = keyof typeof messages.en

function detectLanguage(): 'ja' | 'en' {
  const lang = navigator.language
  return lang.startsWith('ja') ? 'ja' : 'en'
}

const currentLang = detectLanguage()

export function t(key: MessageKey): string {
  return messages[currentLang][key] ?? messages.en[key]
}
