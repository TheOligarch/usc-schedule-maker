import { describe, expect, it } from "vitest";
import { generateSchedules, linkCombos } from "../src/index";
import type { Section, TermData } from "../src/types";
import { fixture, request } from "./fixture";

const run = (pins: Record<string, string>, extra = {}) => generateSchedules(fixture, request({ required: ["CSCI-201"], sectionPins: pins, ...extra }));

describe("hard section pins", () => {
  it("pins either a lecture or a component and retains its valid linked components", () => {
    const lec = run({ "CSCI-201": "30002" });
    expect(lec.totalValid).toBe(1);
    expect(lec.schedules[0].courses[0].sectionIds).toEqual(["30002", "30005", "30006"]);
    const dis = run({ "CSCI-201": "30004" });
    expect(dis.schedules[0].courses[0].sectionIds).toEqual(["30001", "30004", "30006"]);
    expect(run({}).totalValid).toBe(3);
  });
  it("never relaxes stale, wrong-course, conflicting-time or excluded pins", () => {
    for (const pin of ["missing", "31001"]) expect(run({ "CSCI-201": pin }).totalValid).toBe(0);
    expect(run({ "CSCI-201": "30004" }, { excludedSectionIds: ["30004"] }).totalValid).toBe(0);
    expect(run({ "CSCI-201": "30004" }, { allowedTimes: { ...request().allowedTimes, Fri: [] } }).totalValid).toBe(0);
    expect(run({ "MATH-226": "31001" }).blockers[0].constraint).toBe("sectionPin");
  });
});

it("does not mix sessions or drop components split into another session", () => {
  const l = { ...fixture.sections["30001"], linkCode: "A" };
  const d = { ...fixture.sections["30003"], linkCode: "A", session: "060" };
  expect(linkCombos({ linkage: "coded" }, [l, d]).combos).toEqual([]);
});
it("combined lectures satisfy their own component without adding a second lecture", () => {
  const l = { ...fixture.sections["30001"], type: "LEC-LAB" as const };
  const lab = { ...fixture.sections["30003"], type: "LAB" as const };
  const normal = { ...fixture.sections["30002"], linkCode: "A" };
  const combos = linkCombos({ linkage: "coded" }, [l, normal, lab]).combos;
  expect(combos.map(c => c.map(s => s.id))).toEqual([[l.id], [normal.id, lab.id]]);
});

function alternatives(): TermData {
  const data = structuredClone(fixture);
  const c = data.courses["AHIS-120"];
  c.sectionIds = [];
  for (let i = 0; i < 25; i++) {
    const id = `alt-${i}`;
    const section: Section = { ...data.sections["38001"], id, instructors: [], meetings: [{ days: [i === 24 ? "Tue" : "Mon"], start: i === 23 ? "10:05" : "10:00", end: i === 23 ? "11:05" : "11:00" }] };
    data.sections[id] = section; c.sectionIds.push(id);
  }
  delete data.sections["38001"];
  return data;
}

describe("timetable diversity", () => {
  it("deduplicates equivalent identifiers, prefers a different day to a five-minute shift", () => {
    const data = alternatives();
    const res = generateSchedules(data, request({ required: ["AHIS-120"] }), { limit: 2 });
    expect(res.totalValid).toBe(25);
    expect(res.totalDistinct).toBe(3);
    expect(res.schedules).toHaveLength(2);
    expect(res.schedules[0].courses[0].sectionIds).toEqual(["alt-0"]);
    expect(res.schedules[1].courses[0].sectionIds).toEqual(["alt-24"]);
    expect(res.schedules.every(s => s.courses[0].courseCode === "AHIS-120")).toBe(true);
  });
  it("keeps the best preference fit for equivalent meeting times and returns only available distinct schedules", () => {
    const data = alternatives();
    data.sections["alt-0"].isFull = true;
    const res = generateSchedules(data, request({ required: ["AHIS-120"] }), { limit: 10 });
    expect(res.schedules).toHaveLength(3);
    expect(res.schedules.every(s => !s.courses[0].sectionIds.includes("alt-0"))).toBe(true);
    expect(res.schedules.map(s => s.score)).toEqual(res.schedules.map(s => s.score).sort((a,b) => b-a));
  });
  it("ranks selected elective relevance as an actual soft cost", () => {
    const data = structuredClone(fixture);
    const req = request({ flexSlots: [{ label: "Elective", options: ["ARLT-100", "PHIL-140"] }], courseInterestScores: { "ARLT-100": 0.25, "PHIL-140": 1 } });
    const r = generateSchedules(data, req);
    expect(r.schedules.find(s => s.courses[0].courseCode === "ARLT-100")!.penalties.some(p => p.message.includes("elective interests"))).toBe(true);
    req.courseInterestScores = { "ARLT-100": 1, "PHIL-140": 1 };
    expect(generateSchedules(data, req).schedules.find(s => s.courses[0].courseCode === "ARLT-100")!.score).toBeGreaterThan(r.schedules.find(s => s.courses[0].courseCode === "ARLT-100")!.score);
  });
});

describe("results-page feedback: whole-week rules, soft section costs, multi-section pins", () => {
  const csci = (extra = {}) => generateSchedules(fixture, request({ required: ["CSCI-201"], ...extra }));
  const has = (r: ReturnType<typeof csci>, id: string) => r.schedules.some((s) => s.courses[0].sectionIds.includes(id));
  const rule = (kind: string, value: number, hard = true, days?: string[]) => ({ kind, value, hard, label: `${kind} ${value}`, ...(days ? { days } : {}) });

  it("hard rules exclude schedules over the whole week and are reported as a blocker", () => {
    expect(csci({ scheduleRules: [rule("maxDays", 3)] }).totalValid).toBe(3);
    const none = csci({ scheduleRules: [rule("maxDays", 2)] });
    expect(none.totalValid).toBe(0);
    expect(none.blockers.some((b) => b.constraint === "scheduleRule" && b.message.includes('"maxDays 2"'))).toBe(true);
    const breaks = csci({ scheduleRules: [rule("minBreak", 30)] }); // B: Thu 3:50 PM lecture then 4:00 PM discussion
    expect(breaks.totalValid).toBe(2);
    expect(has(breaks, "30002")).toBe(false);
    const gaps = csci({ scheduleRules: [rule("maxGap", 60)] }); // A leaves 70+ minutes before Friday's quiz
    expect(gaps.totalValid).toBe(1);
    expect(gaps.schedules[0].courses[0].sectionIds).toContain("30002");
    const friday = csci({ scheduleRules: [rule("maxPerDay", 1, true, ["Fri"])] });
    expect(friday.schedules.map((s) => s.courses[0].sectionIds)).toEqual([["30002", "30005", "30006"]]);
    expect(csci({ scheduleRules: [rule("maxMinutesPerDay", 160)] }).totalValid).toBe(3);
    expect(csci({ scheduleRules: [rule("maxMinutesPerDay", 150)] }).totalValid).toBe(2); // B's Thursday is 1h50m + 50m
  });

  it("soft rules re-rank instead of excluding, with a visible penalty", () => {
    const r = csci({ scheduleRules: [rule("maxGap", 60, false)] });
    expect(r.totalValid).toBe(3);
    expect(r.schedules[0].courses[0].sectionIds).toContain("30002");
    expect(r.schedules.slice(1).every((s) => s.penalties.some((p) => p.message === 'Misses your feedback "maxGap 60"'))).toBe(true);
  });

  it("soft section costs push a section down the ranking without removing it", () => {
    const base = csci();
    const costed = csci({ sectionCosts: { "30001": { amount: 50, message: "Section 30001 misses your feedback" } } });
    expect(costed.totalValid).toBe(base.totalValid);
    expect(costed.schedules[0].courses[0].sectionIds).not.toContain("30001");
    const hit = costed.schedules.find((s) => s.courses[0].sectionIds.includes("30001"))!;
    expect(hit.penalties.some((p) => p.sectionId === "30001" && p.message.includes("misses your feedback"))).toBe(true);
  });

  it("pins a lecture and a linked component together, and refuses an unlinked pair", () => {
    const both = run({ "CSCI-201": ["30001", "30004"] } as never);
    expect(both.schedules.map((s) => s.courses[0].sectionIds)).toEqual([["30001", "30004", "30006"]]);
    const bad = run({ "CSCI-201": ["30002", "30003"] } as never);
    expect(bad.totalValid).toBe(0);
    expect(bad.blockers[0]).toMatchObject({ constraint: "sectionPin" });
    expect(bad.blockers[0].message).toContain("not a registrable linked combination");
    expect(run({ "CSCI-201": ["30004"] } as never).schedules[0].courses[0].sectionIds).toEqual(["30001", "30004", "30006"]);
  });
});
