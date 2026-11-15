/**
 * Two installed copies of the extension (say an old unzipped folder still loaded next to a
 * new one) both run this content script in WebReg and share the same element ids. Without
 * a tiebreak, whichever copy injects first wins and the other silently backs off, so an old
 * copy can keep showing removed features. Each copy stamps its manifest version on what it
 * injects, and a newer copy removes an older copy's (or an unstamped pre-0.1.1 copy's)
 * elements before injecting its own. Old copies back off on seeing our ids.
 */

export const VERSION_ATTR = "data-usm-version";

/** Negative if a < b, positive if a > b, 0 if equal ("0.1.10" > "0.1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** True when `el` was injected by a copy older than `ours` (no stamp means pre-0.1.1). */
export function isOlderCopy(el: Element, ours: string): boolean {
  const theirs = el.getAttribute(VERSION_ATTR);
  return theirs === null || compareVersions(theirs, ours) < 0;
}

/**
 * Remove an older copy's tab, tab style, panel and launcher so this copy can inject its own.
 * Leaves everything alone when the existing elements come from the same or a newer version.
 */
export function displaceOlderCopy(doc: Document, ids: { tab: string; panel: string; launcher: string }, ours: string): void {
  const marker = doc.getElementById(ids.tab) ?? doc.getElementById(ids.launcher);
  if (!marker || !isOlderCopy(marker, ours)) return;
  for (const id of [ids.tab, `${ids.tab}-style`, ids.panel, ids.launcher]) doc.getElementById(id)?.remove();
  doc.documentElement.style.overflow = "";
}
