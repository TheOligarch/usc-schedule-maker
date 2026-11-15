// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import sectionsHtml from "./fixtures/webreg-course-sections.html?raw";
import { CHOSEN_CLASS, findSectionRows, highlightFromLocation, highlightSections } from "../content/sectionHighlight";
import { departmentOf, sectionIdsFromHash, webregRegisterUrl } from "../lib/webreg";

// A schedule's CSCI 201 pick: one lecture, one lab, one discussion.
const CHOSEN = ["29911", "29920", "29931"];

describe("webregRegisterUrl", () => {
  it("links to the course's WebReg department listing, never classes.usc.edu", () => {
    const url = new URL(webregRegisterUrl("CSCI-201", CHOSEN));
    expect(url.origin).toBe("https://webreg.usc.edu");
    expect(url.pathname).toBe("/Courses");
    expect(url.searchParams.get("DeptId")).toBe("CSCI");
    expect(url.toString()).not.toContain("classes.usc.edu");
  });

  it("carries every chosen section in the fragment, which round-trips", () => {
    const url = new URL(webregRegisterUrl("CSCI-201", CHOSEN));
    expect(url.hash).toBe("#usm-sections=29911,29920,29931");
    expect(sectionIdsFromHash(url.hash)).toEqual(CHOSEN);
  });

  it("omits the fragment when there are no sections", () => {
    expect(webregRegisterUrl("WRIT-150", [])).toBe("https://webreg.usc.edu/Courses?DeptId=WRIT");
  });

  it("takes the department from multi-letter and spaced course codes", () => {
    expect(departmentOf("ENGL-250")).toBe("ENGL");
    expect(departmentOf("aan 500")).toBe("AAN");
    expect(departmentOf("BISC-410L")).toBe("BISC");
  });

  it("ignores unrelated or malformed fragments", () => {
    expect(sectionIdsFromHash("")).toEqual([]);
    expect(sectionIdsFromHash("#schedule-maker")).toEqual([]);
    expect(sectionIdsFromHash("#usm-sections=1<b>,29911,29911,")).toEqual(["29911"]);
  });
});

function mount() {
  document.head.innerHTML = `<style>.collapse { display: none; } .collapse.in { display: block; }</style>`;
  document.body.innerHTML = sectionsHtml;
  const clicks = vi.fn();
  document.addEventListener("click", clicks, true);
  return { clicks, before: document.body.innerHTML };
}

const rowOf = (text: string) => Array.from(document.querySelectorAll("tr")).find((tr) => tr.cells[0]?.textContent === text)!;

describe("highlightSections", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    history.replaceState(null, "", "/");
  });

  it("finds each chosen component's row by its id, ignoring the WebReg type letter", () => {
    mount();
    const rows = findSectionRows(CHOSEN);
    expect([...rows.keys()]).toEqual(CHOSEN);
    expect(rows.get("29911")).toBe(rowOf("29911R"));
    expect(rows.get("29920")).toBe(rowOf("29920R"));
    expect(rows.get("29931")).toBe(rowOf("29931D"));
  });

  it("highlights exactly the chosen lecture, lab and discussion and reveals the collapsed listing", () => {
    mount();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(highlightSections(CHOSEN, { scroll: true })).toEqual(CHOSEN);
    const lit = Array.from(document.querySelectorAll(`.${CHOSEN_CLASS}`)).map((el) => (el as HTMLTableRowElement).cells[0].textContent);
    expect(lit).toEqual(["29911R", "29920R", "29931D"]);
    expect(getComputedStyle(document.getElementById("CSCI-201")!).display).toBe("block");
    // The other course stays collapsed, and the first chosen section is the one scrolled to.
    expect(getComputedStyle(document.getElementById("CSCI-270")!).display).toBe("none");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(rowOf("29911R"));
  });

  it("does not match an id that is only a prefix of another section's id", () => {
    mount();
    highlightSections(["29911"]);
    expect(rowOf("299110R").classList.contains(CHOSEN_CLASS)).toBe(false);
  });

  it("highlights the rest when a chosen section is no longer listed", () => {
    mount();
    expect(highlightSections(["99999", "29920", "29931"])).toEqual(["29920", "29931"]);
    expect(document.querySelectorAll(`.${CHOSEN_CLASS}`)).toHaveLength(2);
    expect(highlightSections(["99999"])).toEqual([]);
  });

  it("is purely visual: no clicks, and only classes and markers change", () => {
    const { clicks, before } = mount();
    highlightSections(CHOSEN, { scroll: true });
    expect(clicks).not.toHaveBeenCalled();
    const strip = (html: string) => html.replace(/ ?\b(in|show|usm-chosen-section)\b/g, "").replace(/ data-usm-section="\d+"/g, "").replace(/ class=""/g, "");
    expect(strip(document.body.innerHTML)).toBe(strip(before));
  });

  it("applies the highlight from a Register link's fragment, including once WebReg renders late", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    history.replaceState(null, "", `/Courses?DeptId=CSCI#usm-sections=${CHOSEN.join(",")}`);
    document.body.innerHTML = "<p>Loading...</p>";
    highlightFromLocation(2000);
    expect(document.querySelectorAll(`.${CHOSEN_CLASS}`)).toHaveLength(0);
    document.body.innerHTML = sectionsHtml;
    await vi.waitFor(() => expect(document.querySelectorAll(`.${CHOSEN_CLASS}`)).toHaveLength(3));
  });
});
