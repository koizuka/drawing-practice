import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for jsdom
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;

// jsdom doesn't implement Canvas 2D — return a no-op context so call sites
// (generateThumbnail, imageResize) don't spam "Not implemented" warnings.
const noopCtx = new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'canvas') return undefined;
    return () => {};
  },
  set: () => true,
});
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string) {
  if (type === '2d') {
    (noopCtx as { canvas?: HTMLCanvasElement }).canvas = this;
    return noopCtx;
  }
  return null;
} as HTMLCanvasElement['getContext'];
HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
  return 'data:image/png;base64,';
};
HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback, type?: string) {
  queueMicrotask(() => cb(new Blob([], { type: type ?? 'image/png' })));
};
