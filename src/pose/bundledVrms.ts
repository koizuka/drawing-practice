/**
 * Registry of VRM mannequins bundled with the app (served from public/).
 * Adding a model later is data-only: drop the .vrm into public/ and add an
 * entry here. `ReferenceInfo.vrmId` stores either one of these ids or 'user'
 * (a user-loaded .vrm persisted in the poseAssets table).
 */

export interface BundledVrm {
  id: string;
  /** File name under public/ (fetched via import.meta.env.BASE_URL). */
  file: string;
  /** Attribution / license note (also documented in README). */
  license: string;
}

export const BUNDLED_VRMS: readonly BundledVrm[] = [
  {
    id: 'bundled',
    file: 'mannequin.vrm',
    license: 'VRM1_Constraint_Twist_Sample — © pixiv (three-vrm examples, MIT License)',
  },
];

export const DEFAULT_VRM_ID = BUNDLED_VRMS[0].id;

export const USER_VRM_ID = 'user';

export function getBundledVrm(id: string): BundledVrm | undefined {
  return BUNDLED_VRMS.find(v => v.id === id);
}

export function bundledVrmUrl(vrm: BundledVrm): string {
  return `${import.meta.env.BASE_URL}${vrm.file}`;
}
