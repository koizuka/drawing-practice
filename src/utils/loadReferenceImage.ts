/**
 * Load a reference image the way every reference renderer must: first
 * WITHOUT CORS (so hosts that don't send `Access-Control-Allow-Origin` still
 * display), then try to upgrade to a CORS-clean copy (so the canvas it is
 * drawn onto stays untainted when the host allows it). If the upgrade fails
 * the plain image is used — the image still renders, the canvas is just
 * tainted.
 *
 * Shared by `ImageViewer` (the reference panel) and `DrawingCanvas` (the
 * reference underlay) so the two never diverge on which bitmap they draw.
 *
 * Resolves with the loaded element. Rejects when the plain load fails, or
 * with an `AbortError` DOMException when `signal` aborts first — callers in
 * effect cleanups abort and then ignore the rejection.
 */
export function loadReferenceImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Image load aborted', 'AbortError');
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    let corsImg: HTMLImageElement | null = null;
    // Cancel the in-flight request on abort: detach the handlers (so the
    // emptied src can't fire them) and clear src on every image still loading.
    const cancel = (el: HTMLImageElement | null) => {
      if (!el) return;
      el.onload = null;
      el.onerror = null;
      el.src = '';
    };
    const onAbort = () =>
      settle(() => {
        cancel(img);
        cancel(corsImg);
        reject(abortError());
      });
    signal?.addEventListener('abort', onAbort);

    const img = new Image();
    img.onload = () => {
      if (settled) return;
      const upgrade = new Image();
      corsImg = upgrade;
      upgrade.crossOrigin = 'anonymous';
      upgrade.onload = () => settle(() => resolve(upgrade));
      upgrade.onerror = () => settle(() => resolve(img));
      upgrade.src = url;
    };
    img.onerror = () => settle(() => reject(new Error(`Failed to load image: ${url}`)));
    img.src = url;
  });
}
