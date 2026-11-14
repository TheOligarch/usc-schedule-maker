// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import navHtml from "./fixtures/webreg-nav.html?raw";
import { findSelectedTab, pinUnselectedLook, selectOurTab } from "../content/tabHighlight";

// The real logged-in WebReg nav (captured on /Calendar), minus our injected tab.
const REAL_NAV = navHtml.replace(/<li id="usm-tab"[\s\S]*?<\/li>/, "");

// Roughly WebReg's look: red bar, white links, and Bootstrap 3's `.active` grey that
// WebReg does not actually show on the term dropdown.
const BASE_CSS = `
  .navbar-nav { background-color: rgb(153, 0, 0); }
  .navbar-nav > li > a { color: rgb(255, 255, 255); background-color: transparent; }
  .navbar-nav > .active > a { background-color: rgb(231, 231, 231); color: rgb(85, 85, 85); }
`;
const SELECTED = { bg: "rgb(102, 0, 0)", color: "rgb(255, 204, 0)" };
const UNSELECTED = { bg: "rgba(0, 0, 0, 0)", color: "rgb(255, 255, 255)" };

function mount(css: string, nav = REAL_NAV) {
  document.head.innerHTML = `<style>${BASE_CSS}${css}</style>`;
  document.body.innerHTML = nav;
  const list = document.querySelector("ul.navbar-nav")!;
  const before = list.outerHTML;
  const calendar = document.getElementById("mItMyCal")!.parentElement!;
  const ours = document.createElement("li");
  ours.id = "usm-tab";
  ours.innerHTML = `<a href="#schedule-maker">myScheduleMaker</a>`;
  list.insertBefore(ours, calendar.nextSibling);
  const strip = () => {
    const clone = list.cloneNode(true) as Element;
    clone.querySelector("#usm-tab")?.remove();
    return clone.outerHTML;
  };
  return { list, before, ours, ourLink: ours.querySelector("a")!, calLink: document.getElementById("mItMyCal")!, strip };
}

const look = (el: Element) => {
  const s = getComputedStyle(el);
  return { bg: s.backgroundColor, color: s.color };
};

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("WebReg tab highlight swap", () => {
  it("handles a highlight that is not class-driven (page rule on #mItMyCal)", () => {
    const { before, ours, ourLink, calLink, strip } = mount(`#mItMyCal { background-color: rgb(102, 0, 0); color: rgb(255, 204, 0); }`);
    const found = findSelectedTab(ours);
    expect(found?.selected).toBe(calLink.parentElement);
    expect(found?.by).toBe("style");

    const unpin = pinUnselectedLook(ours);
    expect(look(ourLink)).toEqual(UNSELECTED);

    const restore = selectOurTab(ours);
    expect(look(ourLink)).toEqual(SELECTED);
    expect(look(calLink)).toEqual(UNSELECTED);
    expect(ourLink.getAttribute("aria-current")).toBe("page");
    // The term dropdown's stale `active` class is left alone.
    expect(document.querySelector("li.active.dropdown")).not.toBeNull();

    restore();
    expect(look(calLink)).toEqual(SELECTED);
    expect(look(ourLink)).toEqual(UNSELECTED);
    expect(ourLink.hasAttribute("aria-current")).toBe(false);
    expect(strip()).toBe(before);
    unpin();
    expect(ours.hasAttribute("style")).toBe(false);
    expect(ourLink.hasAttribute("style")).toBe(false);
  });

  it("handles a highlight applied as an inline style by script", () => {
    const nav = REAL_NAV.replace('id="mItMyCal"', 'id="mItMyCal" style="background-color: rgb(102, 0, 0); color: rgb(255, 204, 0);"');
    const { before, ours, ourLink, calLink, strip } = mount("", nav);
    const restore = selectOurTab(ours);
    expect(look(ourLink)).toEqual(SELECTED);
    expect(look(calLink)).toEqual(UNSELECTED);
    restore();
    expect(look(calLink)).toEqual(SELECTED);
    expect(calLink.getAttribute("style")).toBe("background-color: rgb(102, 0, 0); color: rgb(255, 204, 0);");
    expect(strip()).toBe(before);
  });

  it("moves a class-driven highlight onto our tab and back", () => {
    const nav = REAL_NAV.replace('<li><a id="mItMyCal"', '<li class="selected"><a id="mItMyCal"');
    const { before, ours, ourLink, calLink, strip } = mount(`.navbar-nav > li.selected > a { background-color: rgb(102, 0, 0); color: rgb(255, 204, 0); }`, nav);
    const restore = selectOurTab(ours);
    expect(ours.classList.contains("selected")).toBe(true);
    expect(calLink.parentElement!.classList.contains("selected")).toBe(false);
    expect(look(ourLink)).toEqual(SELECTED);
    expect(look(calLink)).toEqual(UNSELECTED);
    restore();
    expect(ours.classList.contains("selected")).toBe(false);
    expect(look(calLink)).toEqual(SELECTED);
    expect(strip()).toBe(before);
  });

  it("falls back to USC colours when no tab is selected", () => {
    const { before, ours, ourLink, strip } = mount("");
    expect(findSelectedTab(ours)).toBeNull();
    const restore = selectOurTab(ours);
    expect(look(ourLink)).toEqual(SELECTED);
    restore();
    expect(ourLink.hasAttribute("style")).toBe(false);
    expect(strip()).toBe(before);
  });
});
