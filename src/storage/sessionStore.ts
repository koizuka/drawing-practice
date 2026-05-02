import { db, type SessionDraft, COORD_VERSION_CURRENT } from './db'

export type DraftData = Omit<SessionDraft, 'id' | 'updatedAt' | 'coordVersion'>

export async function saveDraft(data: DraftData): Promise<void> {
  await db.session.put({
    ...data,
    id: 1 as const,
    updatedAt: new Date(),
    coordVersion: COORD_VERSION_CURRENT,
  })
}

export async function loadDraft(): Promise<SessionDraft | undefined> {
  return await db.session.get(1)
}

export async function clearDraft(): Promise<void> {
  await db.session.delete(1)
}
