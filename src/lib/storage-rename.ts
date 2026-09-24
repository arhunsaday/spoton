/* We renamed every persisted key from the app's old "sw." prefix to "spoton."
 * when the project was rebranded. This moves an existing install's data across
 * so the rename doesn't silently log the owner out and drop their chosen
 * source/target playlists.
 *
 * It must run before any store module is evaluated — zustand's `persist`
 * middleware reads localStorage at module load — which is why main.tsx imports
 * this first, for its side effect only.
 *
 * Every access is guarded: storage can be unavailable (private window, blocked
 * site data) and a failed migration must not stop the app booting. */

const RENAMED = [
  "clientId",
  "pkce_verifier",
  "pkce_state",
  "auth",
  "library",
];

try {
  for (const key of RENAMED) {
    const value = localStorage.getItem(`sw.${key}`);
    if (value === null) continue;
    if (localStorage.getItem(`spoton.${key}`) === null)
      localStorage.setItem(`spoton.${key}`, value);
    localStorage.removeItem(`sw.${key}`);
  }
} catch {
  /* no storage, nothing to move */
}

// The IndexedDB cache is disposable, so it refills under the new name instead
// of being copied; drop the old database rather than leaking its quota.
try {
  if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase("sw.cache");
} catch {
  /* same */
}
