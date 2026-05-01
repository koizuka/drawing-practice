export function resetPageZoom(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  const original = meta.getAttribute('content') ?? ''
  if (!original) return
  // 一瞬 maximum-scale=1.0 を加えて Safari にページズームを 1.0 へ戻させ、
  // 次フレームで元へ戻す。これで以降の検索画面でも再びピンチズーム可能。
  meta.setAttribute('content', `${original}, maximum-scale=1.0`)
  requestAnimationFrame(() => {
    meta.setAttribute('content', original)
  })
}
