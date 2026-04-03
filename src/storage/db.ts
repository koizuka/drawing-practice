import Dexie, { type EntityTable } from 'dexie'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from '../components/SketchfabViewer'
import type { GuideLine, GridSettings } from '../guides/types'
import type { ReferenceSource } from '../types'

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

const db = new Dexie('DrawingPracticeDB') as Dexie & {
  drawings: EntityTable<DrawingRecord, 'id'>
  session: EntityTable<SessionDraft, 'id'>
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

export { db }
