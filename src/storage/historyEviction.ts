/**
 * Pick the keys of the oldest rows once a history list exceeds `limit`.
 * Returns an empty array when no eviction is needed. Pure / side-effect-free
 * so callers can compose it with whichever Dexie bulkDelete shape they have.
 */
export function selectKeysToEvict<T, K>(
  rows: T[],
  limit: number,
  getKey: (row: T) => K,
  getTime: (row: T) => number,
): K[] {
  if (rows.length <= limit) return [];
  return [...rows]
    .sort((a, b) => getTime(a) - getTime(b))
    .slice(0, rows.length - limit)
    .map(getKey);
}
