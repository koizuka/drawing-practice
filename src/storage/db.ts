import Dexie, { type EntityTable } from 'dexie'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from '../components/SketchfabViewer'

export interface DrawingRecord {
  id?: number
  strokes: Stroke[]
  thumbnail: string  // data URL (PNG)
  referenceInfo: string  // legacy: plain string description
  reference?: ReferenceInfo  // structured reference info (v2)
  createdAt: Date
  elapsedMs: number  // drawing time in milliseconds
}

const db = new Dexie('DrawingPracticeDB') as Dexie & {
  drawings: EntityTable<DrawingRecord, 'id'>
}

db.version(1).stores({
  drawings: '++id, createdAt',
})

db.version(2).stores({
  drawings: '++id, createdAt',
})

export { db }
