/**
 * WebReg content script. Adds a "myScheduleMaker" tab (right of "myCalendar") to WebReg's top navigation and,
 * when it is selected, shows the React app (an extension page, so WebReg's Bootstrap
 * CSS and scripts cannot interfere with it) in a panel directly under the navigation.
 *
 * WebReg's markup is not under our control, so the tab bar is located by behaviour
 * (a Bootstrap `ul.nav` holding the Departments / myCourseBin / Calendar links) rather
 * than by one hard-coded selector, and a floating launcher is used if none is found.
 *
 * It also adds a schedule's sections to the student's myCourseBin when the app asks
 * (content/courseBin.ts): only from this tab's own top frame, and only by adding.
 */

import { createCourseBinService, handleCourseBinMessage } from "./courseBin";
import { highlightFromLocation } from "./sectionHighlight";
import { pinUnselectedLook, selectOurTab, TAB_FOCUS_CSS } from "./tabHighlight";
import { displaceOlderCopy, VERSION_ATTR } from "./takeover";

const TAB_ID = "usm-tab";
const PANEL_ID = "usm-panel";
const LAUNCHER_ID = "usm-launcher";
const HASH = "#schedule-maker";
const VERSION = chrome.runtime.getManifest().version;
const NAV_LINK_RE = /departments|coursebin|calendar|checkout|registration/i;

let isOpen = false;
let navBottom = 0;
let restoreSelection: (() => void) | null = null;

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
  el.setAttribute(VERSION_ATTR, VERSION);
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
    // Only one tab should look selected while our panel is showing: ours, in WebReg's
    // own selected style. Closing puts WebReg's selected tab back exactly as it was.
    restoreSelection?.();
    restoreSelection = isOpen ? selectOurTab(tab) : null;
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
  li.setAttribute(VERSION_ATTR, VERSION);
  const template = list.querySelector(":scope > li:not(.dropdown):not(.active)") ?? list.querySelector(":scope > li");
  if (template) li.className = template.className.replace(/\b(active|dropdown|open)\b/g, "").trim();
  const a = document.createElement("a");
  a.href = HASH;
  a.textContent = "myScheduleMaker";
  a.title = "Build and rank schedules with USC Schedule Maker";
  const templateLink = template?.querySelector("a");
  if (templateLink) a.className = templateLink.className.replace(/\bdropdown-toggle\b/g, "").trim();
  a.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(!isOpen, list);
  });
  li.appendChild(a);
  // Sit immediately to the right of WebReg's "myCalendar" tab when present.
  const calendar = Array.from(list.children).find((c) => {
    const link = c.querySelector(":scope > a");
    const text = (link?.textContent ?? "").replace(/\s+/g, "").toLowerCase();
    const href = (link?.getAttribute("href") ?? "").toLowerCase();
    return text === "mycalendar" || /(^|\/)mycalendar\b/.test(href);
  });
  if (calendar) {
    list.insertBefore(li, calendar.nextSibling);
  } else {
    // Fallback: keep right-aligned dropdowns (myInfo, term picker) last.
    const firstDropdown = Array.from(list.children).find((c) => c.classList.contains("dropdown") || c.classList.contains("navbar-right"));
    list.insertBefore(li, firstDropdown ?? null);
  }
  // Look like an ordinary WebReg tab, without Bootstrap's grey :focus box or focus ring.
  const style = document.createElement("style");
  style.id = `${TAB_ID}-style`;
  style.setAttribute(VERSION_ATTR, VERSION);
  style.textContent = TAB_FOCUS_CSS(TAB_ID);
  document.head.appendChild(style);
  pinUnselectedLook(li);
}

function injectLauncher(): void {
  if (document.getElementById(LAUNCHER_ID)) return;
  const btn = document.createElement("button");
  btn.id = LAUNCHER_ID;
  btn.setAttribute(VERSION_ATTR, VERSION);
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
    // An older copy of this extension may already be in the page; a newer copy replaces it.
    displaceOlderCopy(document, { tab: TAB_ID, panel: PANEL_ID, launcher: LAUNCHER_ID }, VERSION);
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
      displaceOlderCopy(document, { tab: TAB_ID, panel: PANEL_ID, launcher: LAUNCHER_ID }, VERSION);
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

if (window.top === window) {
  start();
  // Opened from a schedule's Register link: mark the sections that schedule picked.
  highlightFromLocation();
  // "Add to myCourseBin" from the app's frame in this tab: WebReg's own add requests, same-origin.
  const binService = createCourseBinService((url, init) => fetch(url, init));
  const extension = { id: chrome.runtime.id, appUrl: chrome.runtime.getURL("index.html") };
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const reply = handleCourseBinMessage(binService, message, sender, extension);
    if (!reply) return false;
    reply.then(sendResponse, (err: unknown) => sendResponse({ ok: false, reason: "error", outcome: "failed", message: String(err) }));
    return true; // async response
  });
}
