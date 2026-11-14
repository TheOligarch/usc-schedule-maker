import { describe, expect, it } from "vitest";
import { generateSchedules, generateSchedulesAsync } from "../src/index";
import type { Course, Day, Section, TermData } from "../src/types";
import { allowAll, request } from "./fixture";

/** Small deterministic PRNG so the synthetic term is the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PAIRS: Day[][] = [["Mon", "Wed"], ["Tue", "Thu"]];
const ONE: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * A full-size term (about 3,000 courses / 10,000 sections) where the
 * requested courses look like big USC intro courses: several coded lectures,
 * each with its own discussions, plus null-coded labs any lecture can take.
 */
function syntheticTerm(): { data: TermData; required: string[]; options: string[] } {
  const rand = rng(20271);
  const courses: Record<string, Course> = {};
  const sections: Record<string, Section> = {};
  let nextId = 10000;
  const startAt = () => 8 * 60 + Math.floor(rand() * 25) * 30; // 08:00..20:00

  const mk = (code: string, lectures: number, disPer: number, labs: number) => {
    const ids: string[] = [];
    const add = (type: Section["type"], linkCode: string | null, days: Day[], len: number) => {
      const id = String(nextId++);
      const st = startAt();
      sections[id] = {
        id,
        courseCodes: [code],
        type,
        linkCode,
        session: "001",
        units: { min: type === "LEC" ? 4 : 0, max: type === "LEC" ? 4 : 0 },
        dClearance: rand() < 0.05,
        seats: { registered: Math.floor(rand() * 60), total: 50 },
        isFull: rand() < 0.15,
        online: false,
        campus: null,
        instructors: [{ first: "P", last: `Prof${id}`, rmpId: rand() < 0.8 ? id : null, rmpMatch: "exact" }],
        meetings: [{ days, start: hhmm(st), end: hhmm(st + len) }],
        final: { date: `2027-05-0${1 + Math.floor(rand() * 7)}`, start: "08:00", end: "10:00" },
        notes: null,
        webregUrl: `https://classes.usc.edu/term-20271/course/${code}`,
      };
      ids.push(id);
    };
    for (let l = 0; l < lectures; l++) {
      const letter = lectures > 1 ? String.fromCharCode(65 + l) : null;
      add("LEC", letter, PAIRS[Math.floor(rand() * PAIRS.length)], 80);
      for (let d = 0; d < disPer; d++) add("DIS", letter, [ONE[Math.floor(rand() * 5)]], 50);
    }
    for (let b = 0; b < labs; b++) add("LAB", null, [ONE[Math.floor(rand() * 5)]], 80);
    courses[code] = {
      code,
      title: code,
      description: null,
      units: { min: 4, max: 4 },
      ge: [],
      crossListedWith: [],
      prereqText: null,
      linkage: lectures > 1 ? "coded" : "single",
      sectionIds: ids,
    };
  };

  const required = ["CSCI-103", "CSCI-170", "MATH-225", "PHYS-151", "WRIT-150"];
  for (const c of required) mk(c, 3, 4, 3); // 36 combos each
  const options = ["GE-1", "GE-2", "GE-3", "GE-4", "GE-5"];
  for (const c of options) mk(c, 2, 3, 0); // 6 combos each
  for (let i = 0; i < 2990; i++) mk(`FILL-${i}`, 1, 2, 0);

  const rmp: TermData["rmp"] = {};
  for (const s of Object.values(sections)) {
    const id = s.instructors[0].rmpId;
    if (id) rmp[id] = { legacyId: id, first: "P", last: `Prof${id}`, department: "X", avg: 1.5 + rand() * 3.5, difficulty: 3, count: Math.floor(rand() * 40), wouldTakeAgain: null };
  }
  return { data: { term: { code: "20271", name: "Spring 2027", scrapedAt: "2026-11-14T00:00:00Z" }, courses, sections, rmp }, required, options };
}

describe("performance", () => {
  const { data, required, options } = syntheticTerm();
  const req = request({
    required,
    flexSlots: [{ label: "GE", options }],
    allowedTimes: allowAll("08:00", "22:00"),
    unitCap: 24,
    minRmp: 2,
    preferences: { daySpread: "compact", breaks: "avoid", maxGapMinutes: 90, preferredDaysOff: ["Fri"], comfortStart: "09:00", comfortEnd: "18:00" },
  });

  it("5 courses + 1 slot x 5 options on a full-size term runs under 2s", () => {
    expect(Object.keys(data.sections).length).toBeGreaterThan(9000);
    const t0 = performance.now();
    const r = generateSchedules(data, req, { limit: 100 });
    const ms = performance.now() - t0;
    console.log(`perf: ${r.totalValid} valid${r.truncated ? " (truncated)" : ""}, ${r.schedules.length} returned, ${r.blockers.length} blockers, ${ms.toFixed(0)}ms`);
    expect(r.totalValid).toBeGreaterThan(0);
    expect(r.schedules).toHaveLength(100);
    expect(ms).toBeLessThan(2000);
  });

  it("a loose request with tens of thousands of schedules runs under 2s", () => {
    const loose = request({ required, flexSlots: [{ label: "GE", options }], allowedTimes: allowAll("07:00", "23:00") });
    const t0 = performance.now();
    const r = generateSchedules(data, loose, { limit: 100 });
    const ms = performance.now() - t0;
    console.log(`perf (loose): ${r.totalValid} valid${r.truncated ? " (truncated)" : ""}, ${r.blockers.length} blockers, ${ms.toFixed(0)}ms`);
    expect(r.schedules).toHaveLength(100);
    expect(ms).toBeLessThan(2000);
  });

  it("the async variant yields to the event loop and returns the same result", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const r = await generateSchedulesAsync(data, req, { limit: 20, sliceMs: 5 });
    clearInterval(timer);
    expect(r).toEqual(generateSchedules(data, req, { limit: 20 }));
    expect(ticks).toBeGreaterThan(0);
  });
});
