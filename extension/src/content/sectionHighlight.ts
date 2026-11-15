/**
 * Highlights the sections a schedule picked when WebReg opens from a Register link.
 *
 * The link carries the section ids in its fragment (lib/webreg.ts). On WebReg's course list
 * each section is a `div#section_<id>.section` inside the course's collapsed accordion panel
 * (`div.collapse#courseBin_<CODE>`), with the id printed as e.g. "50380 R". A section is found
 * by that element id, or, should WebReg's markup change, by its id appearing as a whole token
 * in the page text; its row is outlined in WebReg's red and gold. Purely visual: nothing is
 * clicked, submitted or added, and a section the page no longer lists is simply skipped.
 */

import { sectionIdsFromHash, termFromHash, termName, webregTermSelectUrl } from "../lib/webreg";

export const CHOSEN_CLASS = "usm-chosen-section";
export const TERM_NOTICE_ID = "usm-term-notice";
const STYLE_ID = "usm-chosen-section-style";
/** Our own UI on WebReg (tab, panel, launcher, notice); never highlight inside it. */
const OWN_UI = "#usm-panel, #usm-tab, #usm-launcher, #usm-term-notice";
/** Row-like containers for the text fallback, most specific kind first. */
const ROW_SELECTORS = ["div.section", "tr", "li", ".section-row", ".row"];

export const CHOSEN_CSS = `
.${CHOSEN_CLASS} { outline: 3px solid #990000 !important; outline-offset: -3px; background-color: #fff4cc !important; }
.${CHOSEN_CLASS} > div, .${CHOSEN_CLASS} > div > div, .${CHOSEN_CLASS} > td, .${CHOSEN_CLASS} > th { background-color: #fff4cc !important; }
`;

/**
 * The element to outline for a found section. WebReg's `div.section` holds only floated
 * Bootstrap columns and so has no height of its own; its full-width `.section-row` is what
 * the student sees, so that is marked (restyling the wrapper would disturb the float layout).
 */
export function highlightTarget(row: HTMLElement): HTMLElement {
  if (!row.matches("div.section")) return row;
  return row.querySelector<HTMLElement>(":scope > .section-row") ?? row;
}
function idPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}(\\s?[A-Za-z])?(?![0-9A-Za-z])`);
}

function rowForText(node: Node, start: Node): HTMLElement | null {
  const parent = node.parentElement;
  if (!parent) return null;
  for (const selector of ROW_SELECTORS) {
    const row = parent.closest<HTMLElement>(selector);
    if (row && row !== document.body && start.contains(row)) return row;
  }
  return parent;
}

/** Finds the row for each id that the page lists; ids it does not list are left out. */
export function findSectionRows(ids: string[], root: ParentNode = document): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  const start = root === document ? document.body : (root as Node);
  if (!start) return found;
  const pending = new Map<string, RegExp>();
  for (const id of ids) {
    if (!/^[0-9A-Za-z]+$/.test(id)) continue;
    const el = (root as Document | Element).querySelector<HTMLElement>(`[id="section_${id}"]`);
    if (el) found.set(id, el);
    else pending.set(id, idPattern(id));
  }
  if (pending.size === 0) return found;
  const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && pending.size; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (!/\d/.test(text) || node.parentElement?.closest(`${OWN_UI}, script, style, noscript, option`)) continue;
    for (const [id, re] of pending) {
      if (!re.test(text)) continue;
      const row = rowForText(node, start);
      if (row) found.set(id, row);
      pending.delete(id);
    }
  }
  return found;
}

/** Opens the collapsed accordion panel that hides a chosen row, by class only (nothing is clicked). */
function reveal(row: HTMLElement): void {
  for (let el: HTMLElement | null = row.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.classList.contains("collapse") && !el.classList.contains("in")) {
      el.classList.add("in");
      el.setAttribute("aria-expanded", "true");
      el.style.height = "";
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
    const target = highlightTarget(row);
    reveal(target);
    target.classList.add(CHOSEN_CLASS);
    target.setAttribute("data-usm-section", id);
    done.push(id);
  }
  if (options.scroll && done.length) highlightTarget(rows.get(done[0])!).scrollIntoView?.({ block: "start", behavior: "smooth" });
  return done;
}

/** WebReg's session term, from the hidden `#ActiveTerm` field on its course pages. */
function activeTerm(): string | null {
  const value = document.querySelector<HTMLInputElement>("input#ActiveTerm")?.value ?? "";
  return /^\d{5}$/.test(value) ? value : null;
}

/**
 * When WebReg's session is on a different term than the schedule, says so above the page with
 * a link to WebReg's own term switch. Returns whether the notice is shown.
 */
export function showTermNotice(scheduleTerm: string | null): boolean {
  const current = activeTerm();
  if (!scheduleTerm || !current || current === scheduleTerm || document.getElementById(TERM_NOTICE_ID)) return false;
  const notice = document.createElement("div");
  notice.id = TERM_NOTICE_ID;
  notice.setAttribute("role", "status");
  Object.assign(notice.style, {
    margin: "8px auto",
    maxWidth: "1100px",
    padding: "10px 14px",
    font: "14px system-ui, sans-serif",
    color: "#1a1a1a",
    background: "#fff4cc",
    border: "2px solid #990000",
    borderRadius: "4px",
  } satisfies Partial<CSSStyleDeclaration>);
  const link = document.createElement("a");
  link.href = webregTermSelectUrl(scheduleTerm);
  link.textContent = `switch WebReg to ${termName(scheduleTerm)}`;
  notice.append(
    `Schedule Maker: this schedule is for ${termName(scheduleTerm)}, but WebReg is showing ${termName(current)}, so its sections may not be listed. `,
    link,
    ", then use Register again.",
  );
  const anchor = document.querySelector(".content-wrapper-courses") ?? document.body.firstElementChild;
  anchor?.parentElement?.insertBefore(notice, anchor) ?? document.body.prepend(notice);
  return true;
}

/**
 * Applies the highlight for the ids in the current location's fragment. WebReg can render
 * its listing late, so it keeps watching for up to `timeoutMs` until every id is shown.
 */
export function highlightFromLocation(timeoutMs = 10_000): void {
  const ids = sectionIdsFromHash(location.hash);
  if (ids.length === 0) return;
  showTermNotice(termFromHash(location.hash));
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
