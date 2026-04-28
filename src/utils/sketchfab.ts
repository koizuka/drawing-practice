const LAST_SEARCH_STORAGE_KEY = 'sketchfab.lastSearch'

export type SketchfabTimeFilter = 'all' | 'week' | 'month' | 'year'
const TIME_FILTERS: readonly SketchfabTimeFilter[] = ['all', 'week', 'month', 'year']

export const SKETCHFAB_CATEGORIES = [
  { slug: 'animals-pets', labelKey: 'animals' as const },
  { slug: 'cars-vehicles', labelKey: 'vehicles' as const },
  { slug: 'characters-creatures', labelKey: 'characters' as const },
  { slug: 'food-drink', labelKey: 'food' as const },
  { slug: 'furniture-home', labelKey: 'furniture' as const },
  { slug: 'nature-plants', labelKey: 'plants' as const },
  { slug: 'science-technology', labelKey: 'technology' as const },
] as const

export type SketchfabCategorySlug = typeof SKETCHFAB_CATEGORIES[number]['slug']

const CATEGORY_SLUGS: readonly string[] = SKETCHFAB_CATEGORIES.map(c => c.slug)

export interface SketchfabSearchContext {
  query: string
  category?: SketchfabCategorySlug
  timeFilter: SketchfabTimeFilter
}

export interface SketchfabModelMeta {
  uid: string
  title: string
  author: string
  thumbnailUrl: string
}

const UID_PATTERN = /^[A-Za-z0-9]{32}$/

function isValidUid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UID_PATTERN.test(value)
}

/**
 * Extract the Sketchfab model UID from a public Sketchfab URL. Accepts both
 *   https://sketchfab.com/3d-models/<slug>-<uid>
 *   https://sketchfab.com/models/<uid>
 * Locale path prefixes (e.g. `/ja`, `/de`) are ignored. UIDs are 32 chars of
 * hex-ish alphanumeric. Returns null on any deviation so the caller can fall
 * through to a non-Sketchfab loader.
 */
export function parseSketchfabModelUrl(rawUrl: string): { uid: string } | null {
  if (!rawUrl) return null
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'sketchfab.com') return null

  const segments = url.pathname.split('/').filter(Boolean)

  // /3d-models/<slug>-<uid>: UID is the trailing hyphen-segment
  const threeDIndex = segments.indexOf('3d-models')
  if (threeDIndex >= 0 && threeDIndex < segments.length - 1) {
    const tail = segments[threeDIndex + 1]
    const dashIdx = tail.lastIndexOf('-')
    const candidate = dashIdx >= 0 ? tail.slice(dashIdx + 1) : tail
    if (isValidUid(candidate)) return { uid: candidate }
  }

  // /models/<uid>
  const modelsIndex = segments.indexOf('models')
  if (modelsIndex >= 0 && modelsIndex < segments.length - 1) {
    const candidate = segments[modelsIndex + 1]
    if (isValidUid(candidate)) return { uid: candidate }
  }

  return null
}

export function canonicalSketchfabUrl(uid: string): string {
  return `https://sketchfab.com/models/${uid}`
}

export function getSketchfabLastSearch(): SketchfabSearchContext | null {
  try {
    const raw = localStorage.getItem(LAST_SEARCH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const { query, category, timeFilter } = parsed as Record<string, unknown>
    if (typeof query !== 'string') return null
    if (typeof timeFilter !== 'string' || !TIME_FILTERS.includes(timeFilter as SketchfabTimeFilter)) return null
    let cat: SketchfabCategorySlug | undefined
    if (typeof category === 'string') {
      if (!CATEGORY_SLUGS.includes(category)) return null
      cat = category as SketchfabCategorySlug
    } else if (category != null) {
      return null
    }
    const result: SketchfabSearchContext = { query, timeFilter: timeFilter as SketchfabTimeFilter }
    if (cat) result.category = cat
    return result
  } catch {
    return null
  }
}

export function setSketchfabLastSearch(ctx: SketchfabSearchContext): void {
  try {
    localStorage.setItem(LAST_SEARCH_STORAGE_KEY, JSON.stringify(ctx))
  } catch {
    // localStorage disabled / unavailable
  }
}

interface SketchfabModelApiResponse {
  uid?: string
  name?: string
  user?: { displayName?: string; username?: string }
  thumbnails?: { images?: { url?: string; width?: number }[] }
}

/**
 * Resolve a UID to a model summary via the Sketchfab Data API. Used when the
 * user pastes a Sketchfab URL — we need title/author/thumbnail before the
 * iframe finishes loading so the URL-history entry is populated correctly.
 */
export async function getSketchfabModel(uid: string, signal?: AbortSignal): Promise<SketchfabModelMeta> {
  const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}`, { signal })
  if (!res.ok) throw new Error(`Sketchfab model fetch failed: ${res.status}`)
  const data = await res.json() as SketchfabModelApiResponse
  const images = data.thumbnails?.images ?? []
  const thumbnail = images.find(t => (t.width ?? 0) >= 200)?.url ?? images[0]?.url ?? ''
  return {
    uid: data.uid ?? uid,
    title: data.name ?? '',
    author: data.user?.displayName ?? data.user?.username ?? '',
    thumbnailUrl: thumbnail,
  }
}
