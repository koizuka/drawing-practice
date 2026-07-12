import { db, type PoseAssetRecord } from './db';

const USER_VRM_ID = 'userVrm';

/** Guard against filling IndexedDB with an unexpectedly huge model. */
export const MAX_USER_VRM_BYTES = 50 * 1024 * 1024;

export class VrmTooLargeError extends Error {
  constructor() {
    super('VRM file exceeds the size limit');
    this.name = 'VrmTooLargeError';
  }
}

/** Stores the user's VRM, replacing any previous one (single-record table). */
export async function saveUserVrm(file: File): Promise<void> {
  if (file.size > MAX_USER_VRM_BYTES) throw new VrmTooLargeError();
  await db.poseAssets.put({
    id: USER_VRM_ID,
    blob: file,
    fileName: file.name,
    updatedAt: new Date(),
  });
}

export async function getUserVrm(): Promise<PoseAssetRecord | undefined> {
  return db.poseAssets.get(USER_VRM_ID);
}

export async function deleteUserVrm(): Promise<void> {
  await db.poseAssets.delete(USER_VRM_ID);
}
