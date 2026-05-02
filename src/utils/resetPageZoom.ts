const meta = typeof document !== 'undefined'
  ? document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  : null;
// モジュール初期化時に元の content を1回だけ捕捉する。これで連続呼び出し時にも
// stale な (maximum-scale=1.0 を含む) 値を「original」と誤認することがない。
const ORIGINAL = meta?.getAttribute('content') ?? null;

export function resetPageZoom(): void {
  if (!meta || !ORIGINAL) return;
  // 一瞬 maximum-scale=1.0 を加えて Safari にページズームを 1.0 へ戻させ、
  // 次フレームで元へ戻す。これで以降の検索画面でも再びピンチズーム可能。
  meta.setAttribute('content', `${ORIGINAL}, maximum-scale=1.0`);
  requestAnimationFrame(() => {
    meta.setAttribute('content', ORIGINAL);
  });
}
