// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import csci103Html from "./fixtures/webreg-course-CSCI-103.html?raw";
import phys151Html from "./fixtures/webreg-course-PHYS-151.html?raw";
import { CHOSEN_CLASS, TERM_NOTICE_ID, findSectionRows, highlightFromLocation, highlightSections } from "../content/sectionHighlight";
import { departmentOf, sectionIdsFromHash, termFromHash, termName, webregRegisterUrl } from "../lib/webreg";

// Real WebReg course pages (Spring 2027). PHYS-151 lists 4 lectures, a discussion and many labs;
// a schedule picks the second lecture, the discussion and one lab.
const PHYS_CHOSEN = ["50381", "50383", "50390"];

describe("webregRegisterUrl", () => {
  it("links to the course's WebReg listing, never classes.usc.edu", () => {
    const url = new URL(webregRegisterUrl("CSCI-103", ["29966"], "20271"));
    expect(url.origin).toBe("https://webreg.usc.edu");
    expect(url.pathname).toBe("/Courses");
    expect(url.searchParams.get("Program")).toBe("CSCI");
    expect(url.searchParams.get("Course")).toBe("CSCI-103");
    expect(url.toString()).not.toContain("classes.usc.edu");
  });

  it("carries every chosen section and the term in the fragment, which round-trips", () => {
    const url = new URL(webregRegisterUrl("PHYS-151", PHYS_CHOSEN, "20271"));
    expect(url.toString()).toBe("https://webreg.usc.edu/Courses?Program=PHYS&Course=PHYS-151#usm-sections=50381,50383,50390&usm-term=20271");
    expect(sectionIdsFromHash(url.hash)).toEqual(PHYS_CHOSEN);
    expect(termFromHash(url.hash)).toBe("20271");
  });

  it("omits the fragment when there are no sections", () => {
    expect(webregRegisterUrl("WRIT-150", [], "20271")).toBe("https://webreg.usc.edu/Courses?Program=WRIT&Course=WRIT-150");
  });

  it("takes the program from the course prefix", () => {
    expect(departmentOf("ENGL-250")).toBe("ENGL");
    expect(departmentOf("aan 500")).toBe("AAN");
    expect(departmentOf("CSCI-491B")).toBe("CSCI");
  });

  it("ignores unrelated or malformed fragments", () => {
    expect(sectionIdsFromHash("")).toEqual([]);
    expect(sectionIdsFromHash("#schedule-maker")).toEqual([]);
    expect(sectionIdsFromHash("#usm-sections=1<b>,29911,29911,")).toEqual(["29911"]);
    expect(termFromHash("#usm-term=fall")).toBeNull();
    expect(termName("20263")).toBe("Fall 2026");
  });
});

// Bootstrap 3's collapse rules, as WebReg ships them.
const COLLAPSE_CSS = `<style>.collapse { display: none; } .collapse.in { display: block; }</style>`;

function mount(html: string) {
  document.head.innerHTML = COLLAPSE_CSS;
  document.body.innerHTML = html;
  const clicks = vi.fn();
  const submits = vi.fn();
  document.addEventListener("click", clicks, true);
  document.addEventListener("submit", submits, true);
  return { clicks, submits, before: document.body.innerHTML };
}

const sectionEl = (id: string) => document.getElementById(`section_${id}`)!;
// What the student sees for a section: its full-width row inside the zero-height wrapper.
const sectionRow = (id: string) => sectionEl(id).querySelector(":scope > .section-row")!;
const litIds = () => Array.from(document.querySelectorAll(`.${CHOSEN_CLASS}`)).map((el) => el.getAttribute("data-usm-section"));

describe("highlightSections on WebReg's course page", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    history.replaceState(null, "", "/");
  });

  it("finds each chosen component's section block", () => {
    mount(phys151Html);
    const rows = findSectionRows(PHYS_CHOSEN);
    for (const id of PHYS_CHOSEN) expect(rows.get(id)).toBe(sectionEl(id));
  });

  it("highlights exactly the chosen lecture, discussion and lab, opens the course panel and scrolls to the first", () => {
    mount(phys151Html);
    const panel = document.getElementById("courseBin_PHYS-151")!;
    expect(getComputedStyle(panel).display).toBe("none");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(highlightSections(PHYS_CHOSEN, { scroll: true })).toEqual(PHYS_CHOSEN);
    expect(litIds()).toEqual(PHYS_CHOSEN);
    // The other lectures stay unmarked.
    for (const id of ["50380", "50382", "50384"]) expect(sectionEl(id).querySelector(`.${CHOSEN_CLASS}`)).toBeNull();
    for (const id of PHYS_CHOSEN) expect(sectionRow(id).classList.contains(CHOSEN_CLASS)).toBe(true);
    // The wrapper itself is not restyled, so the WebReg float layout is untouched.
    expect(sectionEl("50381").classList.contains(CHOSEN_CLASS)).toBe(false);
    expect(getComputedStyle(panel).display).toBe("block");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(sectionRow("50381"));
    expect(scroll.mock.calls[0][0]).toMatchObject({ block: "start" });
  });

  it("handles lecture + lab + quiz on CSCI-103", () => {
    mount(csci103Html);
    expect(highlightSections(["29966", "30046", "29900"])).toEqual(["29966", "30046", "29900"]);
    expect(litIds()).toEqual(["29966", "30046", "29900"]);
  });

  it("falls back to the printed id (e.g. \"50383 R\") when the element id is missing", () => {
    mount(phys151Html.replace('id="section_50383"', 'id="renamed"'));
    const rows = findSectionRows(["50383"]);
    expect(rows.get("50383")).toBe(document.getElementById("renamed"));
    expect(findSectionRows(["5038"]).size).toBe(0);
  });

  it("highlights the rest when a chosen section is no longer listed", () => {
    mount(phys151Html);
    expect(highlightSections(["99999", "50383", "50390"])).toEqual(["50383", "50390"]);
    expect(litIds()).toEqual(["50383", "50390"]);
    expect(highlightSections(["99999"])).toEqual([]);
  });

  it("is purely visual: no clicks or submits, and only classes and markers change", () => {
    const { clicks, submits, before } = mount(phys151Html);
    Element.prototype.scrollIntoView = vi.fn();
    highlightSections(PHYS_CHOSEN, { scroll: true });
    expect(clicks).not.toHaveBeenCalled();
    expect(submits).not.toHaveBeenCalled();
    // classList normalises class whitespace, so compare class token lists.
    const strip = (html: string) =>
      html
        .replace(/ class="([^"]*)"/g, (_, c: string) => ` class="${c.split(/\s+/).filter((t) => t && t !== "in" && t !== CHOSEN_CLASS).join(" ")}"`)
        .replace(/ data-usm-section="\d+"| aria-expanded="(true|false)"| style=""/g, "");
    expect(strip(document.body.innerHTML)).toBe(strip(before));
  });

  it("applies the highlight from a Register link's fragment, including once WebReg renders late", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    history.replaceState(null, "", new URL(webregRegisterUrl("PHYS-151", PHYS_CHOSEN, "20271")).pathname + "?Program=PHYS&Course=PHYS-151#usm-sections=50381,50383,50390&usm-term=20271");
    document.body.innerHTML = "<p>Loading...</p>";
    highlightFromLocation(2000);
    expect(litIds()).toEqual([]);
    document.body.innerHTML = phys151Html;
    await vi.waitFor(() => expect(litIds()).toEqual(PHYS_CHOSEN));
    expect(document.getElementById(TERM_NOTICE_ID)).toBeNull();
  });

  it("points out when WebReg's session is on another term", () => {
    history.replaceState(null, "", "/Courses?Program=PHYS&Course=PHYS-151#usm-sections=50381&usm-term=20263");
    mount(phys151Html);
    highlightFromLocation(0);
    const notice = document.getElementById(TERM_NOTICE_ID)!;
    expect(notice.textContent).toContain("this schedule is for Fall 2026, but WebReg is showing Spring 2027");
    expect(notice.querySelector("a")!.getAttribute("href")).toBe("https://webreg.usc.edu/Terms?term=20263&handler=TermSelect");
  });
});
