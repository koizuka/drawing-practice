import type { ReferenceInfo } from '../types';

const PEXELS_API_BASE = 'https://api.pexels.com/v1';
const API_KEY_STORAGE_KEY = 'pexelsApiKey';
const LAST_SEARCH_STORAGE_KEY = 'pexels.lastSearch';

export type PexelsOrientationFilter = 'all' | 'landscape' | 'portrait' | 'square';
const ORIENTATION_FILTERS: readonly PexelsOrientationFilter[] = ['all', 'landscape', 'portrait', 'square'];

export interface PexelsLastSearch {
  query: string;
  orientation: PexelsOrientationFilter;
}

interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  small: string;
  portrait: string;
  landscape: string;
  tiny: string;
}

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  alt: string;
  src: PexelsPhotoSrc;
}

export interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  next_page?: string;
  page: number;
  per_page: number;
  total_results: number;
}

export interface PexelsSearchParams {
  query: string;
  page?: number;
  perPage?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
}

export class PexelsKeyMissingError extends Error {
  constructor() {
    super('Pexels API key is not set');
    this.name = 'PexelsKeyMissingError';
  }
}

export class PexelsAuthError extends Error {
  constructor() {
    super('Pexels API key is invalid');
    this.name = 'PexelsAuthError';
  }
}

export class PexelsRateLimitError extends Error {
  readonly resetTimestamp: number | null;
  constructor(resetTimestamp: number | null) {
    super('Pexels rate limit reached');
    this.name = 'PexelsRateLimitError';
    this.resetTimestamp = resetTimestamp;
  }
}

export class PexelsNetworkError extends Error {
  constructor(message?: string) {
    super(message ?? 'Pexels network error');
    this.name = 'PexelsNetworkError';
  }
}

export function getPexelsApiKey(): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null;
    if (stored && stored.length > 0) return stored;
  }
  catch {
    // localStorage disabled / unavailable
  }
  return '';
}

export function setPexelsApiKey(key: string): void {
  try {
    if (key === '') {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    else {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    }
  }
  catch {
    // localStorage disabled / unavailable
  }
}

export function getPexelsLastSearch(): PexelsLastSearch | null {
  try {
    const raw = localStorage.getItem(LAST_SEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { query, orientation } = parsed as Record<string, unknown>;
    if (typeof query !== 'string' || typeof orientation !== 'string') return null;
    if (!ORIENTATION_FILTERS.includes(orientation as PexelsOrientationFilter)) return null;
    return { query, orientation: orientation as PexelsOrientationFilter };
  }
  catch {
    return null;
  }
}

export function setPexelsLastSearch(query: string, orientation: PexelsOrientationFilter): void {
  try {
    localStorage.setItem(LAST_SEARCH_STORAGE_KEY, JSON.stringify({ query, orientation }));
  }
  catch {
    // localStorage disabled / unavailable
  }
}

async function pexelsFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const key = getPexelsApiKey();
  if (!key) throw new PexelsKeyMissingError();

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: key }, signal });
  }
  catch (e) {
    // Propagate AbortError so callers can distinguish cancellations from real failures.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new PexelsNetworkError(e instanceof Error ? e.message : undefined);
  }

  if (res.status === 401 || res.status === 403) throw new PexelsAuthError();
  if (res.status === 429) {
    const resetHeader = res.headers.get('X-Ratelimit-Reset');
    const reset = resetHeader ? Number(resetHeader) : NaN;
    throw new PexelsRateLimitError(Number.isFinite(reset) ? reset : null);
  }
  if (!res.ok) throw new PexelsNetworkError(`HTTP ${res.status}`);
  return res;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Map a Pexels error to the i18n key used for user-facing messages. Returns
 * null for cases where the caller should suppress error text (e.g. missing /
 * invalid key — the API-key banner already communicates the problem).
 */
export function mapPexelsErrorKey(e: unknown):
  | 'pexelsKeyRequired'
  | 'pexelsKeyInvalid'
  | 'pexelsRateLimit'
  | 'pexelsNetworkError' {
  if (e instanceof PexelsKeyMissingError) return 'pexelsKeyRequired';
  if (e instanceof PexelsAuthError) return 'pexelsKeyInvalid';
  if (e instanceof PexelsRateLimitError) return 'pexelsRateLimit';
  return 'pexelsNetworkError';
}

export async function searchPhotos(params: PexelsSearchParams, signal?: AbortSignal): Promise<PexelsSearchResponse> {
  const search = new URLSearchParams({
    query: params.query,
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 24),
  });
  if (params.orientation) search.set('orientation', params.orientation);
  const res = await pexelsFetch(`${PEXELS_API_BASE}/search?${search.toString()}`, signal);
  return res.json();
}

export async function getPhoto(id: number, signal?: AbortSignal): Promise<PexelsPhoto> {
  const res = await pexelsFetch(`${PEXELS_API_BASE}/photos/${id}`, signal);
  return res.json();
}

export function parsePexelsPhotoUrl(rawUrl: string): { id: number } | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  }
  catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'pexels.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  // Accept paths like:
  //   /photo/slug-12345
  //   /photo/12345
  //   /ja-jp/photo/slug-12345
  //   /en-us/photo/12345
  const photoIndex = segments.indexOf('photo');
  if (photoIndex < 0 || photoIndex === segments.length - 1) return null;
  const tail = segments[photoIndex + 1];
  const match = /^(?:[a-z0-9-]*-)?(\d+)$/i.exec(tail);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { id };
}

export function buildPexelsReferenceInfo(photo: PexelsPhoto): Extract<ReferenceInfo, { source: 'pexels' }> {
  const title = photo.alt?.trim() || `Photo #${photo.id}`;
  return {
    title,
    author: photo.photographer,
    source: 'pexels',
    pexelsPhotoId: photo.id,
    pexelsPhotographerUrl: photo.photographer_url,
    pexelsPageUrl: photo.url,
    pexelsImageUrl: photo.src.large2x,
  };
}
