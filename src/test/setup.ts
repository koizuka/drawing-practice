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
  get: () => () => {},
  set: () => true,
});
HTMLCanvasElement.prototype.getContext = function getContext(type: string) {
  return type === '2d' ? noopCtx : null;
} as HTMLCanvasElement['getContext'];
HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
  return 'data:image/png;base64,';
};
HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback, type?: string) {
  queueMicrotask(() => cb(new Blob([], { type: type ?? 'image/png' })));
};
