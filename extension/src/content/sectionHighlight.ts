/**
 * Highlights the sections a schedule picked when WebReg opens from a Register link.
 *
 * The link carries the section ids in its fragment (lib/webreg.ts). WebReg's markup is not
 * ours, so a section is found by its id appearing as a whole token in the page text (WebReg
 * may print it with a type letter, e.g. "30381D"), and the row around it is outlined in
 * WebReg's red and gold. Purely visual: nothing is clicked, submitted or added, and a section
 * the page no longer lists is simply skipped.
 */

import { sectionIdsFromHash } from "../lib/webreg";

export const CHOSEN_CLASS = "usm-chosen-section";
const STYLE_ID = "usm-chosen-section-style";
/** Our own UI on WebReg (tab, panel, launcher); never highlight inside it. */
const OWN_UI = "#usm-panel, #usm-tab, #usm-launcher";
/** Row-like containers, most specific kind first: a table row, a list item, a section block. */
const ROW_SELECTORS = ["tr", "li", "[class*='section' i]:not(td):not(th):not(span)", ".row"];

export const CHOSEN_CSS = `
.${CHOSEN_CLASS} { outline: 3px solid #990000 !important; outline-offset: -1px; background-color: #fff4cc !important; }
.${CHOSEN_CLASS} > td, .${CHOSEN_CLASS} > th { background-color: #fff4cc !important; }
`;

function idPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}[A-Za-z]?(?![0-9A-Za-z])`);
}

/** The row-like element that holds the text node naming the section. */
function rowFor(node: Node, root: ParentNode): HTMLElement | null {
  const parent = node.parentElement;
  if (!parent) return null;
  const inRoot = (el: HTMLElement) => el !== document.body && (root === document || (root as Node).contains(el));
  for (const selector of ROW_SELECTORS) {
    const row = parent.closest<HTMLElement>(selector);
    if (row && inRoot(row)) return row;
  }
  return parent;
}

/** Finds the row for each id that the page lists; ids it does not list are left out. */
export function findSectionRows(ids: string[], root: ParentNode = document): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  const pending = new Map(ids.map((id) => [id, idPattern(id)] as const));
  const start = root === document ? document.body : (root as Node);
  if (!start || pending.size === 0) return found;
  const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && pending.size; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (!/\d/.test(text) || node.parentElement?.closest(`${OWN_UI}, script, style, noscript`)) continue;
    for (const [id, re] of pending) {
      if (!re.test(text)) continue;
      const row = rowFor(node, root);
      if (row) found.set(id, row);
      pending.delete(id);
    }
  }
  return found;
}

/** Shows collapsed (Bootstrap accordion) panels that hide a chosen row, without clicking anything. */
function reveal(row: HTMLElement): void {
  for (let el: HTMLElement | null = row.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.classList.contains("collapse") && !el.classList.contains("in") && !el.classList.contains("show")) {
      el.classList.add("in", "show");
    }
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CHOSEN_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Highlights every listed section among `ids` and returns the ids it highlighted, in `ids`
 * order. The first highlighted section is scrolled into view when `scroll` is true.
 */
export function highlightSections(ids: string[], options: { root?: ParentNode; scroll?: boolean } = {}): string[] {
  const rows = findSectionRows(ids, options.root);
  if (rows.size === 0) return [];
  ensureStyle();
  const done: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) continue;
    reveal(row);
    row.classList.add(CHOSEN_CLASS);
    row.setAttribute("data-usm-section", id);
    done.push(id);
  }
  if (options.scroll) rows.get(done[0])?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  return done;
}

/**
 * Applies the highlight for the ids in the current location's fragment. WebReg can render
 * its listing late, so it keeps watching for up to `timeoutMs` until every id is shown.
 */
export function highlightFromLocation(timeoutMs = 10_000): void {
  const ids = sectionIdsFromHash(location.hash);
  if (ids.length === 0) return;
  const shown = new Set<string>();
  const apply = () => {
    const missing = ids.filter((id) => !shown.has(id));
    for (const id of highlightSections(missing, { scroll: shown.size === 0 })) shown.add(id);
    return shown.size === ids.length;
  };
  if (apply() || !document.body) return;
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (apply()) stop();
    });
  });
  const timer = window.setTimeout(() => stop(), timeoutMs);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
