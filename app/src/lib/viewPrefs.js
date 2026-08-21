// Per-plan, per-device memory for list view settings (sort, filters, board/list
// toggle, group-by) so re-entering a section doesn't reset it. Owner/editor
// only, and pure localStorage on this browser — never part of the saved plan
// data, so it never ends up in the exported package an heir opens.
const PREFIX = 'openfirst.viewprefs.';

function prefKey(planId, section) {
  return `${PREFIX}${section}:${planId || 'current'}`;
}

export function loadViewPref(planId, section) {
  try {
    const raw = localStorage.getItem(prefKey(planId, section));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveViewPref(planId, section, value) {
  try {
    localStorage.setItem(prefKey(planId, section), JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

// Called on lock/close (see store.svelte.js) so a protected plan's filter/tag
// selections don't sit in plaintext localStorage after the plan itself is no
// longer in memory — these are UI prefs, not plan content, but they're still
// this plan's metadata (tag names, which section you were in) and shouldn't
// outlive the session on a shared device. Scans by key prefix rather than a
// fixed section list, so it can't drift out of sync with which sections call
// saveViewPref.
export function clearViewPrefs(planId) {
  try {
    const suffix = `:${planId || 'current'}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX) && key.endsWith(suffix)) localStorage.removeItem(key);
    }
  } catch {
    /* private mode etc. */
  }
}
