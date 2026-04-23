import Dexie, { type EntityTable } from 'dexie'
import type { Stroke } from '../drawing/types'
import type { GuideLine, GridSettings } from '../guides/types'
import type { ReferenceInfo, ReferenceSource } from '../types'

export interface DrawingRecord {
  id?: number
  strokes: Stroke[]
  thumbnail: string  // data URL (PNG)
  referenceInfo: string  // legacy: plain string description
  reference?: ReferenceInfo  // structured reference info (v2)
  createdAt: Date
  elapsedMs: number  // drawing time in milliseconds
}

export interface SessionDraft {
  id: 1  // singleton
  strokes: Stroke[]
  redoStack: Stroke[]
  elapsedMs: number
  source: ReferenceSource
  referenceInfo: ReferenceInfo | null
  referenceImageData: string | null  // base64 data URL for images that don't survive reload
  guideState: {
    grid: GridSettings
    lines: GuideLine[]
  }
  updatedAt: Date
}

export type UrlHistoryType = 'youtube' | 'pexels' | 'url' | 'image'

export interface UrlHistoryEntry {
  url: string
  type: UrlHistoryType
  title?: string
  lastUsedAt: Date
  /** Display name for 'image' entries (original file name). */
  fileName?: string
  /** Resized reference bytes for 'image' entries; see resizeImageForHistory. */
  imageBlob?: Blob
}

// Scope database name by deploy path so PR previews don't share data.
// Keep the original name for the main deployment to preserve existing data.
const DB_BASE_NAME = 'DrawingPracticeDB'
const PR_DB_PREFIX = `${DB_BASE_NAME}_`
const basePath = import.meta.env.BASE_URL ?? '/'
const isMainDeployment = basePath === '/' || basePath === '/drawing-practice/'
const dbName = isMainDeployment ? DB_BASE_NAME : `${PR_DB_PREFIX}${basePath}`

const db = new Dexie(dbName) as Dexie & {
  drawings: EntityTable<DrawingRecord, 'id'>
  session: EntityTable<SessionDraft, 'id'>
  urlHistory: EntityTable<UrlHistoryEntry, 'url'>
}

db.version(1).stores({
  drawings: '++id, createdAt',
})

db.version(2).stores({
  drawings: '++id, createdAt',
})

db.version(3).stores({
  drawings: '++id, createdAt',
  session: 'id',
})

db.version(4).stores({
  drawings: '++id, createdAt',
  session: 'id',
  urlHistory: 'url, lastUsedAt',
})

// v5: no index change — anchors the additive fileName/imageBlob fields on
// UrlHistoryEntry so future schema diffs are easy to track.
db.version(5).stores({
  drawings: '++id, createdAt',
  session: 'id',
  urlHistory: 'url, lastUsedAt',
})

export { db }

/**
 * Delete IndexedDB databases left behind by closed PR previews.
 * Called on main deployment startup only.
 */
export async function cleanupStalePrDatabases(): Promise<void> {
  if (!isMainDeployment) return
  if (typeof globalThis.indexedDB === 'undefined') return
  if (typeof indexedDB.databases !== 'function') return

  try {
    const allDbs = await indexedDB.databases()
    for (const { name } of allDbs) {
      if (name && name.startsWith(PR_DB_PREFIX)) {
        indexedDB.deleteDatabase(name)
      }
    }
  } catch {
    // indexedDB.databases() may not be available in all browsers
  }
}
