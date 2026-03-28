import Dexie, { type EntityTable } from 'dexie'
import type { Stroke } from '../drawing/types'

export interface DrawingRecord {
  id?: number
  strokes: Stroke[]
  thumbnail: string  // data URL (PNG)
  referenceInfo: string  // description of what was used as reference
  createdAt: Date
  elapsedMs: number  // drawing time in milliseconds
}

const db = new Dexie('DrawingPracticeDB') as Dexie & {
  drawings: EntityTable<DrawingRecord, 'id'>
}

db.version(1).stores({
  drawings: '++id, createdAt',
})

export { db }
