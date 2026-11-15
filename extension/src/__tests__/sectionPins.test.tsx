// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSchedulesAsync } from "../../../engine/src/index";
import type { TermData } from "../lib/contract-types";
import { canonicalCourseCode, pinView, setComponentPin } from "../lib/sectionPins";
import { Requirements } from "../screens/Requirements";
import { buildRequest, defaultState, loadState, reconcileCourseCodes, saveState, type AppState } from "../state";
import { liveTerm } from "./fixtures/liveTerm";

const data = liveTerm();

/** CSCI-170 with a second link group, so lecture and discussion pins constrain each other. */
function twoGroups(): TermData {
  const d = structuredClone(data);
  d.sections["30295"].linkCode = "B";
  d.sections["30349"].linkCode = "B";
  d.sections["30343"].linkCode = null; // the quiz goes with either
  return d;
}

describe("picker options populate for every required course with published sections", () => {
  it("matches typed, saved or cross-listed codes to the term's own code", () => {
    expect(canonicalCourseCode(data, "bisc 120")).toBe("BISC-120");
    expect(canonicalCourseCode(data, "BISC120")).toBe("BISC-120");
    expect(canonicalCourseCode(data, "MATH-999")).toBeNull();
    const d = structuredClone(data);
    d.courses["CORE-112"].crossListedWith = ["HUMN-112"];
    expect(canonicalCourseCode(d, "humn112")).toBe("CORE-112");
    const state = { ...defaultState(), required: ["bisc 120"], sectionPins: { "bisc 120": ["13003"] } };
    expect(reconcileCourseCodes(state, data)).toEqual({ required: ["BISC-120"], sectionPins: { "BISC-120": ["13003"] } });
    expect(reconcileCourseCodes({ ...state, ...reconcileCourseCodes(state, data)! }, data)).toBeNull();
  });

  it("offers sections listed only under a cross-listed code and courses with only non-lecture components", () => {
    const d = structuredClone(data);
    d.courses["CORE-112"].sectionIds = []; // sections still list CORE-112 in courseCodes
    expect(pinView(d, "CORE-112", []).groups[0].options).toHaveLength(14);
    for (const s of Object.values(d.sections)) if (s.courseCodes.includes("CORE-112")) s.type = "DIS";
    const dis = pinView(d, "CORE-112", []);
    expect(dis.groups.map((g) => g.label)).toEqual(["Discussion"]);
    expect(dis.groups[0].options).toHaveLength(14);
  });

  it("restored state with old single-id pins still drives the picker", () => {
    localStorage.setItem("usm:state:v2", JSON.stringify({ ...defaultState(), required: ["BISC-120"], sectionPins: { "BISC-120": "13006" } }));
    const restored = loadState();
    expect(restored.sectionPins).toEqual({ "BISC-120": ["13006"] });
    expect(pinView(data, "BISC-120", restored.sectionPins["BISC-120"]).groups.find((g) => g.group === "LAB")!.pinned).toBe("13006");
  });
});

describe("component pins", () => {
  it("only offers linked combinations, and dependent options narrow as soon as one is chosen", () => {
    const d = twoGroups();
    const all = pinView(d, "CSCI-170", []);
    expect(all.groups.map((g) => [g.label, g.options.length])).toEqual([["Lecture", 2], ["Discussion", 4], ["Quiz", 1]]);
    const withLecture = pinView(d, "CSCI-170", ["30108"]);
    expect(withLecture.groups.find((g) => g.group === "DIS")!.options.map((s) => s.id).sort()).toEqual(["30116", "30373", "30377"]);
    const withDis = pinView(d, "CSCI-170", ["30349"]);
    expect(withDis.groups.find((g) => g.group === "lecture")!.options.map((s) => s.id)).toEqual(["30295"]);
    // choosing a discussion from the other group replaces the incompatible lecture pin
    expect(setComponentPin(d, "CSCI-170", ["30108"], "DIS", "30349")).toEqual(["30349"]);
    expect(setComponentPin(d, "CSCI-170", ["30108"], "DIS", "30116")).toEqual(["30108", "30116"]);
    expect(setComponentPin(d, "CSCI-170", ["30108", "30116"], "DIS", null)).toEqual(["30108"]);
  });

  it("generation honours lecture + lab pins together and never relaxes an invalid pair", async () => {
    const state = { ...defaultState(), required: ["BISC-120"], sectionPins: { "BISC-120": ["13003", "13006"] } };
    const r = await generateSchedulesAsync(data, buildRequest(state, data));
    expect(r.schedules.map((s) => s.courses[0].sectionIds)).toEqual([["13003", "13006"]]);
    const d = twoGroups();
    const bad = await generateSchedulesAsync(d, buildRequest({ ...defaultState(), required: ["CSCI-170"], sectionPins: { "CSCI-170": ["30108", "30349"] } }, d));
    expect(bad.totalValid).toBe(0);
    expect(bad.blockers[0].constraint).toBe("sectionPin");
    expect(pinView(d, "CSCI-170", ["30108", "30349"]).valid).toBe(false);
  });

  it("lab-only pins survive saving and feed the interview signature", () => {
    const state = { ...defaultState(), required: ["BISC-120"], sectionPins: { "BISC-120": ["13006"] } };
    saveState(state);
    expect(buildRequest(loadState(), data).sectionPins).toEqual({ "BISC-120": ["13006"] });
  });
});

describe("clear-section vs remove-course controls", () => {
  let root: Root, container: HTMLDivElement, current: AppState;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  function Harness({ start }: { start: AppState }) {
    const [state, setState] = useState(start); current = state;
    return <Requirements data={data} state={state} onChange={(p) => setState((s) => ({ ...s, ...p }))} onNext={() => {}} />;
  }
  const choose = async (id: string, value: string) => {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("pins a lab, clears just that pin with its own X, and removes the course only with the course button", async () => {
    await act(async () => root.render(<Harness start={{ ...defaultState(), required: ["BISC-120", "CORE-112"] }} />));
    expect(container.querySelector("#pin-BISC-120-lab")!.querySelectorAll("option").length).toBe(7); // "Any lab" + 6 labs
    await choose("pin-BISC-120", "13003");
    await choose("pin-BISC-120-lab", "13006");
    expect(current.sectionPins).toEqual({ "BISC-120": ["13003", "13006"] });
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear pinned lab section 13006 for BISC-120"]')!;
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove course BISC-120"]')!;
    expect(clear.className).toBe("pin-clear");
    expect(remove.className).toContain("course-remove");
    expect(clear.closest(".pin-chip")).not.toBeNull();
    expect(remove.closest(".pin-chip")).toBeNull();
    await act(async () => clear.click());
    expect(current.required).toEqual(["BISC-120", "CORE-112"]);
    expect(current.sectionPins).toEqual({ "BISC-120": ["13003"] });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Clear pinned lecture section 13003 for BISC-120"]')!.click());
    expect(current.sectionPins).toEqual({});
    await choose("pin-BISC-120-lab", "13006");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove course BISC-120"]')!.click());
    expect(current.required).toEqual(["CORE-112"]);
    expect(current.sectionPins).toEqual({});
  });

  it("renders the picker for a code saved in another format and shows no helper text about relaxing pins", async () => {
    await act(async () => root.render(<Harness start={{ ...defaultState(), required: ["core 112"] }} />));
    expect(container.querySelector("#pin-CORE-112")!.querySelectorAll("option").length).toBe(15);
    expect(container.textContent).not.toContain("Linked components are selected with this section");
    expect(container.textContent).not.toContain("never relaxed");
  });

  it("units and the remove-course X share a fixed top-right corner, apart from the pin pickers and clear-pin chips", async () => {
    await act(async () => root.render(<Harness start={{ ...defaultState(), required: ["BISC-120"] }} />));
    const card = container.querySelector<HTMLLIElement>("li.course-chip")!;
    const corner = () => card.querySelector<HTMLDivElement>(":scope > .chip-corner")!;
    const before = corner();
    expect([...card.children].map((c) => c.className)).toEqual(["chip-body", "chip-corner"]);
    expect([...before.children].map((c) => c.textContent || c.getAttribute("aria-label"))).toEqual(["4 u", "Remove course BISC-120"]);
    await choose("pin-BISC-120", "13003");
    await choose("pin-BISC-120-lab", "13006");
    // pickers and their clear chips grow the body; the corner is the same node with the same contents
    expect(corner()).toBe(before);
    expect(corner().children).toHaveLength(2);
    expect(corner().querySelector(".pin-clear")).toBeNull();
    expect(card.querySelector(".chip-body")!.querySelectorAll(".pin-clear")).toHaveLength(2);
    expect(card.querySelector(".chip-body")!.querySelector(".course-remove")).toBeNull();
  });

  it("the card stylesheet keeps the corner top-aligned and unwrapped while the body shrinks", async () => {
    const css = (await import("../styles/app.css?raw")).default as string;
    const rule = (sel: string) => css.split("\n").find((line) => line.startsWith(`${sel} {`)) ?? "";
    expect(rule(".course-chip")).toContain("display: grid");
    expect(rule(".course-chip")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(rule(".course-chip")).toContain("align-items: start");
    expect(rule(".chip-corner")).toMatch(/grid-column: 2; grid-row: 1; align-self: start;/);
    expect(rule(".chip-corner")).toContain("flex-wrap: nowrap");
    expect(rule(".chip-corner")).toContain("white-space: nowrap");
    expect(rule(".chip-body")).toContain("min-width: 0");
  });

  it("a pin the term no longer offers can be cleared without removing the course", async () => {
    await act(async () => root.render(<Harness start={{ ...defaultState(), required: ["BISC-120"], sectionPins: { "BISC-120": ["99999"] } }} />));
    expect(container.textContent).toContain("Section 99999 is no longer offered");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Clear unavailable pinned section 99999 for BISC-120"]')!.click());
    expect(current.sectionPins).toEqual({});
    expect(current.required).toEqual(["BISC-120"]);
  });
});
