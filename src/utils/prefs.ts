// Per-user view preferences (toolbar switches, panel placement, …) live in
// localStorage, not the autosave draft. Access is wrapped because storage can
// throw (private mode, quota, disabled cookies) — a pref must never break the UI.

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
