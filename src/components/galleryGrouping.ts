import type { DrawingRecord } from '../storage'
import { referenceKey, type ReferenceInfo } from '../types'

export type GroupMode = 'date' | 'ref-first' | 'ref-recent'

export const GROUP_MODE_STORAGE_KEY = 'gallery.groupMode'
export const LEGACY_GROUP_KEY = '__legacy__'

export function loadGroupMode(): GroupMode {
  try {
    const v = localStorage.getItem(GROUP_MODE_STORAGE_KEY)
    if (v === 'date' || v === 'ref-first' || v === 'ref-recent') return v
  } catch { /* ignore */ }
  return 'date'
}

export function persistGroupMode(mode: GroupMode): void {
  try { localStorage.setItem(GROUP_MODE_STORAGE_KEY, mode) } catch { /* ignore */ }
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' })

export function formatYearMonth(date: Date): string {
  return monthFormatter.format(date)
}

export function refLabelOf(ref: ReferenceInfo | undefined, fallback: string): string {
  if (!ref) return fallback
  const parts = [ref.title]
  if (ref.author) parts.push(ref.author)
  const joined = parts.join(' - ')
  return joined || fallback
}

export function canLoadReference(ref: ReferenceInfo | undefined): boolean {
  if (!ref) return false
  if (ref.source === 'sketchfab' && ref.sketchfabUid) return true
  if (ref.source === 'url' && ref.imageUrl) return true
  if (ref.source === 'youtube' && ref.youtubeVideoId) return true
  if (ref.source === 'pexels' && ref.pexelsImageUrl) return true
  // Local images are reloadable as long as the drawing has a history key
  // recorded. The actual availability of the Blob in URL history is checked
  // lazily at load time (the entry may have been evicted by the 10-cap, in
  // which case SplitLayout surfaces the error).
  if (ref.source === 'image' && ref.url) return true
  return false
}

/**
 * Sync thumbnail URL for non-image references. Image references resolve
 * asynchronously via the imageThumbs cache populated from urlHistory blobs.
 */
export function syncThumbUrl(ref: ReferenceInfo): string | null {
  switch (ref.source) {
    case 'sketchfab': return ref.imageUrl ?? null
    case 'url': return ref.imageUrl
    case 'youtube': return `https://i.ytimg.com/vi/${ref.youtubeVideoId}/default.jpg`
    case 'pexels': return ref.pexelsImageUrl
    case 'image': return null
  }
}

export interface Group {
  key: string
  label: string
  reference?: ReferenceInfo
  firstUsedAt: Date
  lastUsedAt: Date
  drawings: DrawingRecord[]
}

export function buildGroups(
  drawings: DrawingRecord[],
  mode: GroupMode,
  legacyLabel: string,
): Group[] {
  if (drawings.length === 0) return []
  const buckets = new Map<string, Group>()

  for (const d of drawings) {
    const date = new Date(d.createdAt)
    let key: string
    let label: string
    let reference: ReferenceInfo | undefined

    if (mode === 'date') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      label = formatYearMonth(date)
    } else {
      const ref = d.reference
      reference = ref
      if (ref) {
        key = referenceKey(ref)
        label = refLabelOf(ref, legacyLabel)
      } else {
        key = LEGACY_GROUP_KEY
        label = legacyLabel
      }
    }

    let g = buckets.get(key)
    if (!g) {
      g = { key, label, reference, firstUsedAt: date, lastUsedAt: date, drawings: [] }
      buckets.set(key, g)
    }
    g.drawings.push(d)
    if (date < g.firstUsedAt) g.firstUsedAt = date
    if (date > g.lastUsedAt) g.lastUsedAt = date
  }

  const groups = Array.from(buckets.values())
  for (const g of groups) {
    g.drawings.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  }
  if (mode === 'date') {
    groups.sort((a, b) => b.key.localeCompare(a.key))
  } else if (mode === 'ref-first') {
    groups.sort((a, b) => +b.firstUsedAt - +a.firstUsedAt)
  } else {
    groups.sort((a, b) => +b.lastUsedAt - +a.lastUsedAt)
  }
  return groups
}
