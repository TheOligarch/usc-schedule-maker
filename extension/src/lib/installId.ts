/**
 * Anonymous install ID for the AI functions' rate limits: a random UUID generated once per
 * install and kept in chrome.storage.local. It is linked to nothing else (no account, no WebReg
 * data). Outside the extension (the dev page) it falls back to localStorage, then to memory.
 */
const KEY = "usmInstallId";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let pending: Promise<string> | null = null;

function extensionStorage(): chrome.storage.LocalStorageArea | null {
  try {
    return typeof chrome !== "undefined" && chrome.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

async function loadOrCreate(): Promise<string> {
  const valid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
  const store = extensionStorage();
  if (store) {
    try {
      const saved = (await store.get(KEY))[KEY];
      if (valid(saved)) return saved;
      const id = crypto.randomUUID();
      await store.set({ [KEY]: id });
      return id;
    } catch {
      // Fall through to page storage.
    }
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** The install ID, created on first use; concurrent callers share one lookup. */
export function getInstallId(): Promise<string> {
  pending ??= loadOrCreate().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

/** Tests only: forget the cached ID. */
export function resetInstallIdCache(): void {
  pending = null;
}
