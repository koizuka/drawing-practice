import { db, type SessionDraft } from './db'

export type DraftData = Omit<SessionDraft, 'id' | 'updatedAt'>

export async function saveDraft(data: DraftData): Promise<void> {
  await db.session.put({
    ...data,
    id: 1 as const,
    updatedAt: new Date(),
  })
}

export async function loadDraft(): Promise<SessionDraft | undefined> {
  return await db.session.get(1)
}

export async function clearDraft(): Promise<void> {
  await db.session.delete(1)
}
