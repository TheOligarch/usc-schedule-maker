/**
 * WebReg content script. Adds a "Schedule Maker" tab to WebReg's top navigation and,
 * when it is selected, shows the React app (an extension page, so WebReg's Bootstrap
 * CSS and scripts cannot interfere with it) in a panel directly under the navigation.
 *
 * WebReg's markup is not under our control, so the tab bar is located by behaviour
 * (a Bootstrap `ul.nav` holding the Departments / myCourseBin / Calendar links) rather
 * than by one hard-coded selector, and a floating launcher is used if none is found.
 */

const TAB_ID = "usm-tab";
const PANEL_ID = "usm-panel";
const LAUNCHER_ID = "usm-launcher";
const HASH = "#schedule-maker";
const NAV_LINK_RE = /departments|coursebin|calendar|checkout|registration/i;

let isOpen = false;
let navBottom = 0;

function findNavList(): HTMLUListElement | null {
  const lists = Array.from(document.querySelectorAll<HTMLUListElement>("ul.nav-tabs, ul.navbar-nav, ul.nav, nav ul, #header ul"));
  let best: HTMLUListElement | null = null;
  let bestScore = 0;
  for (const list of lists) {
    if (list.closest(".dropdown-menu")) continue;
    const links = Array.from(list.querySelectorAll<HTMLAnchorElement>(":scope > li > a"));
    const score = links.filter((a) => NAV_LINK_RE.test(a.getAttribute("href") ?? "") || NAV_LINK_RE.test(a.textContent ?? "")).length;
    if (score > bestScore) {
      best = list;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

function panel(): HTMLElement {
  let el = document.getElementById(PANEL_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = PANEL_ID;
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "USC Schedule Maker");
  Object.assign(el.style, {
    position: "fixed",
    left: "0",
    right: "0",
    bottom: "0",
    top: "0",
    zIndex: "2147483000",
    background: "#f6f4f1",
    display: "none",
    borderTop: "3px solid #990000",
  } satisfies Partial<CSSStyleDeclaration>);
  const frame = document.createElement("iframe");
  frame.title = "USC Schedule Maker";
  frame.src = chrome.runtime.getURL("index.html") + "?embedded=1";
  Object.assign(frame.style, { width: "100%", height: "100%", border: "0", display: "block" } satisfies Partial<CSSStyleDeclaration>);
  el.appendChild(frame);
  document.body.appendChild(el);
  return el;
}

function measureNavBottom(anchor: Element | null): number {
  if (!anchor) return 0;
  const host = anchor.closest("nav, .navbar, #header, header") ?? anchor;
  return Math.max(0, Math.round(host.getBoundingClientRect().bottom + window.scrollY));
}

function setOpen(next: boolean, anchor: Element | null) {
  isOpen = next;
  const el = panel();
  if (isOpen) {
    window.scrollTo({ top: 0 });
    navBottom = measureNavBottom(anchor);
    el.style.top = `${navBottom}px`;
  }
  el.style.display = isOpen ? "block" : "none";
  document.documentElement.style.overflow = isOpen ? "hidden" : "";
  const tab = document.getElementById(TAB_ID);
  if (tab) {
    tab.classList.toggle("active", isOpen);
    tab.querySelector("a")?.setAttribute("aria-current", isOpen ? "page" : "false");
    // Only one tab should look selected while our panel is showing.
    for (const sibling of Array.from(tab.parentElement?.children ?? [])) {
      if (sibling === tab) continue;
      if (isOpen && sibling.classList.contains("active")) {
        sibling.classList.remove("active");
        sibling.setAttribute("data-usm-was-active", "1");
      } else if (!isOpen && sibling.hasAttribute("data-usm-was-active")) {
        sibling.classList.add("active");
        sibling.removeAttribute("data-usm-was-active");
      }
    }
  }
  const launcher = document.getElementById(LAUNCHER_ID);
  if (launcher) launcher.textContent = isOpen ? "Close Schedule Maker" : "Schedule Maker";
  if (isOpen && location.hash !== HASH) history.replaceState(null, "", HASH);
  if (!isOpen && location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
}

function injectTab(list: HTMLUListElement): void {
  if (document.getElementById(TAB_ID)) return;
  const li = document.createElement("li");
  li.id = TAB_ID;
  const template = list.querySelector(":scope > li:not(.dropdown):not(.active)") ?? list.querySelector(":scope > li");
  if (template) li.className = template.className.replace(/\b(active|dropdown|open)\b/g, "").trim();
  const a = document.createElement("a");
  a.href = HASH;
  a.textContent = "Schedule Maker";
  a.title = "Build and rank schedules with USC Schedule Maker";
  const templateLink = template?.querySelector("a");
  if (templateLink) a.className = templateLink.className.replace(/\bdropdown-toggle\b/g, "").trim();
  a.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(!isOpen, list);
  });
  li.appendChild(a);
  // Keep right-aligned dropdowns (myInfo, term picker) last.
  const firstDropdown = Array.from(list.children).find((c) => c.classList.contains("dropdown") || c.classList.contains("navbar-right"));
  list.insertBefore(li, firstDropdown ?? null);
}

function injectLauncher(): void {
  if (document.getElementById(LAUNCHER_ID)) return;
  const btn = document.createElement("button");
  btn.id = LAUNCHER_ID;
  btn.type = "button";
  btn.textContent = "Schedule Maker";
  Object.assign(btn.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483001",
    padding: "12px 18px",
    font: "600 14px system-ui, sans-serif",
    color: "#fff",
    background: "#990000",
    border: "2px solid #ffcc00",
    borderRadius: "999px",
    boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  btn.addEventListener("click", () => setOpen(!isOpen, null));
  document.body.appendChild(btn);
}

function start(): void {
  let tries = 0;
  const attempt = () => {
    const list = findNavList();
    if (list) {
      injectTab(list);
      if (location.hash === HASH) setOpen(true, list);
      return true;
    }
    return false;
  };
  if (attempt()) return;
  // The nav can render late; retry briefly, then fall back to a floating launcher.
  const timer = window.setInterval(() => {
    tries++;
    if (attempt()) window.clearInterval(timer);
    else if (tries >= 12) {
      window.clearInterval(timer);
      injectLauncher();
      if (location.hash === HASH) setOpen(true, null);
    }
  }, 500);
}

window.addEventListener("resize", () => {
  if (!isOpen) return;
  const tab = document.getElementById(TAB_ID);
  navBottom = measureNavBottom(tab);
  panel().style.top = `${navBottom}px`;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen) setOpen(false, document.getElementById(TAB_ID));
});

if (window.top === window) start();
