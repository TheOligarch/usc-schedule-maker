/**
 * Makes our injected WebReg tab look exactly like WebReg's own selected tab while the
 * Schedule Maker panel is open, and makes the tab WebReg had selected (e.g. myCalendar)
 * look unselected until the panel closes again.
 *
 * WebReg's markup is not ours, so nothing here assumes a class name. The selected tab is
 * found by its look (its computed colours differ from every other tab), falling back to
 * the usual markers (`active` / `selected` / `current`, `aria-current`). Its look is then
 * transferred two ways: the classes the selected tab has and an ordinary tab lacks are
 * moved onto ours, and the computed colours are applied inline (with `!important`, so
 * Bootstrap's `:hover` / `:focus` / `.active` rules cannot repaint our link). Every class
 * and inline property touched is recorded so closing restores the page exactly.
 */

/** Properties that make up a tab's "selected" or "unselected" look. */
export const LOOK_PROPS = [
  "background-color",
  "background-image",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
] as const;

/** Properties compared to tell the selected tab apart from the rest. */
const SIGNATURE_PROPS = ["background-color", "background-image", "color"] as const;

const MARKER_CLASS_RE = /^(active|selected|current|on|sel)$/i;
/** Structural classes that never describe selection and must not be moved between tabs. */
const STRUCTURAL_CLASS_RE = /^(dropdown|dropdown-toggle|open|navbar-right|pull-right|pull-left|disabled)$/i;

/** Used only when WebReg shows no selected tab to copy from: USC dark red + gold. */
export const FALLBACK_SELECTED_LOOK: Look = { "background-color": "rgb(102, 0, 0)", color: "rgb(255, 204, 0)" };

export type Look = Partial<Record<(typeof LOOK_PROPS)[number], string>>;

interface TabLook {
  li: Look;
  a: Look;
}

function link(li: Element): HTMLElement | null {
  return li.querySelector<HTMLElement>(":scope > a") ?? li.querySelector<HTMLElement>("a");
}

function computed(el: Element | null, props: readonly string[]): Look {
  const out: Record<string, string> = {};
  if (!el) return out;
  const style = getComputedStyle(el);
  for (const p of props) out[p] = style.getPropertyValue(p);
  return out as Look;
}

function tabLook(li: Element): TabLook {
  return { li: computed(li, LOOK_PROPS), a: computed(link(li), LOOK_PROPS) };
}

function signature(li: Element): string {
  return JSON.stringify([computed(li, SIGNATURE_PROPS), computed(link(li), SIGNATURE_PROPS)]);
}

function hasMarker(el: Element | null): boolean {
  if (!el) return false;
  const current = el.getAttribute("aria-current");
  if (current && current !== "false") return true;
  if (el.getAttribute("aria-selected") === "true") return true;
  return Array.from(el.classList).some((c) => MARKER_CLASS_RE.test(c));
}

export interface SelectedTab {
  selected: HTMLElement;
  /** An ordinary, unselected tab to take the unselected look (and class baseline) from. */
  reference: HTMLElement | null;
  by: "style" | "marker";
}

/** Finds WebReg's currently-selected tab among `ours`' siblings. */
export function findSelectedTab(ours: Element): SelectedTab | null {
  const all = Array.from(ours.parentElement?.children ?? []).filter(
    (c): c is HTMLElement => c !== ours && c instanceof HTMLElement && c.tagName === "LI",
  );
  // Dropdown menus (WebReg's term picker carries a stale `active` class; myInfo) are not
  // page tabs, so compare plain link tabs whenever there are enough of them.
  const plain = all.filter((t) => !t.classList.contains("dropdown"));
  const tabs = plain.length >= 3 ? plain : all;
  if (tabs.length === 0) return null;

  const sigs = tabs.map(signature);
  const counts = new Map<string, number>();
  for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [majority, majorityCount] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const pickReference = (exclude: Element) =>
    tabs.find((t, i) => t !== exclude && sigs[i] === majority && !t.classList.contains("dropdown")) ??
    tabs.find((t, i) => t !== exclude && sigs[i] === majority) ??
    tabs.find((t) => t !== exclude) ??
    null;

  // 1. By look: exactly one tab is painted differently from the (2+) others.
  const outliers = tabs.filter((_, i) => sigs[i] !== majority);
  if (outliers.length === 1 && majorityCount >= 2) {
    return { selected: outliers[0], reference: pickReference(outliers[0]), by: "style" };
  }
  // 2. By the usual selection markers on the li or its link.
  const marked = tabs.filter((t) => hasMarker(t) || hasMarker(link(t)));
  if (marked.length === 1) return { selected: marked[0], reference: pickReference(marked[0]), by: "marker" };
  return null;
}

function classDiff(selected: Element | null, reference: Element | null): string[] {
  if (!selected) return [];
  const base = new Set(reference ? Array.from(reference.classList) : []);
  return Array.from(selected.classList).filter((c) => !base.has(c) && !STRUCTURAL_CLASS_RE.test(c));
}

/** Records and later restores exactly the inline properties / classes / attributes we change. */
class Ledger {
  private undo: Array<() => void> = [];

  setStyle(el: HTMLElement | null, look: Look) {
    if (!el) return;
    // Undo runs in reverse, so this runs after the properties below are restored.
    const hadStyleAttr = el.hasAttribute("style");
    this.undo.push(() => {
      if (!hadStyleAttr && !el.getAttribute("style")) el.removeAttribute("style");
    });
    for (const [prop, value] of Object.entries(look)) {
      if (!value) continue;
      const oldValue = el.style.getPropertyValue(prop);
      const oldPriority = el.style.getPropertyPriority(prop);
      this.undo.push(() => {
        if (oldValue) el.style.setProperty(prop, oldValue, oldPriority);
        else el.style.removeProperty(prop);
      });
      el.style.setProperty(prop, value, "important");
    }
  }

  addClasses(el: Element | null, classes: string[]) {
    if (!el) return;
    for (const c of classes) {
      if (el.classList.contains(c)) continue;
      el.classList.add(c);
      this.undo.push(() => el.classList.remove(c));
    }
  }

  removeClasses(el: Element | null, classes: string[]) {
    if (!el) return;
    for (const c of classes) {
      if (!el.classList.contains(c)) continue;
      el.classList.remove(c);
      this.undo.push(() => el.classList.add(c));
    }
  }

  setAttr(el: Element | null, name: string, value: string | null) {
    if (!el) return;
    const old = el.getAttribute(name);
    this.undo.push(() => (old === null ? el.removeAttribute(name) : el.setAttribute(name, old)));
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  restore() {
    for (const fn of this.undo.reverse()) fn();
    this.undo = [];
  }
}

/**
 * Gives `ours` WebReg's selected-tab look and the previously selected tab the
 * unselected look. Returns a function that restores everything exactly.
 */
export function selectOurTab(ours: HTMLElement): () => void {
  const ledger = new Ledger();
  const ourLink = link(ours);
  const found = findSelectedTab(ours);

  if (!found) {
    ledger.setStyle(ourLink, FALLBACK_SELECTED_LOOK);
    ledger.setAttr(ourLink, "aria-current", "page");
    return () => ledger.restore();
  }

  const { selected, reference } = found;
  const selectedLink = link(selected);
  // Capture both looks before anything changes.
  const selectedLook = tabLook(selected);
  const unselectedLook = reference ? tabLook(reference) : null;
  const liClasses = classDiff(selected, reference);
  const aClasses = classDiff(selectedLink, reference ? link(reference) : null);

  // Class-driven highlight: move the selected-only classes from their tab to ours.
  ledger.removeClasses(selected, liClasses);
  ledger.removeClasses(selectedLink, aClasses);
  ledger.addClasses(ours, liClasses);
  ledger.addClasses(ourLink, aClasses);

  // Style-driven (or partly style-driven) highlight: pin the computed looks inline.
  ledger.setStyle(ours, selectedLook.li);
  ledger.setStyle(ourLink, selectedLook.a);
  if (unselectedLook) {
    ledger.setStyle(selected, unselectedLook.li);
    ledger.setStyle(selectedLink, unselectedLook.a);
  }

  for (const el of [selected, selectedLink]) {
    if (el?.hasAttribute("aria-current")) ledger.setAttr(el, "aria-current", null);
  }
  ledger.setAttr(ourLink, "aria-current", "page");
  return () => ledger.restore();
}

/**
 * Pins the unselected look of an ordinary sibling onto our (closed) tab, so Bootstrap's
 * `.nav > li > a:focus` grey box never shows on it. Returns a restore function.
 */
export function pinUnselectedLook(ours: HTMLElement): () => void {
  const ledger = new Ledger();
  const found = findSelectedTab(ours);
  const reference =
    found?.reference ??
    Array.from(ours.parentElement?.children ?? []).find(
      (c): c is HTMLElement => c !== ours && c instanceof HTMLElement && c.tagName === "LI" && !c.classList.contains("dropdown"),
    ) ??
    null;
  if (reference) {
    const look = tabLook(reference);
    ledger.setStyle(ours, look.li);
    ledger.setStyle(link(ours), look.a);
  }
  return () => ledger.restore();
}

/** Focus styles for our link: no Bootstrap focus ring/box, but a visible keyboard focus. */
export const TAB_FOCUS_CSS = (tabId: string) => `
#${tabId} > a, #${tabId} > a:hover, #${tabId} > a:focus, #${tabId} > a:active { outline: none !important; text-decoration: none !important; }
#${tabId} > a:focus-visible { outline: 2px solid currentColor !important; outline-offset: -4px !important; }
`;
