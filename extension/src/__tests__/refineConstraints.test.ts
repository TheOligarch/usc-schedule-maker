import { describe, expect, it, vi } from "vitest";
import { generateSchedulesAsync } from "../../../engine/src/index";
import type { RankedSchedule, Section } from "../lib/contract-types";
import { interpretRefinement, parseLocally, suggestRefinements, summarize, type ParseContext } from "../lib/refinement";
import { toMin } from "../lib/time";
import { buildRequest, defaultState, type AppState } from "../state";
import { liveTerm } from "./fixtures/liveTerm";

const data = liveTerm();
const shown: RankedSchedule = { id: "s", units: 8, score: 1, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13005"] }, { courseCode: "CORE-112", sectionIds: ["63538"] }], penalties: [], warnings: [] };
const codes = ["BISC-120", "CORE-112"];
const ctx: ParseContext = { data, codes, schedule: shown };
const base = (): AppState => {
  const s = { ...defaultState(), required: codes };
  s.times.global = [{ start: "07:00", end: "23:00" }];
  return s;
};

async function run(text: string, state = base()) {
  const refinement = await interpretRefinement(text, { ...ctx, codes: state.required }, null);
  const r = await generateSchedulesAsync(data, buildRequest({ ...state, refinements: [refinement] }, data), { limit: 100 });
  return { refinement, r };
}
const sections = (s: RankedSchedule): Section[] => s.courses.flatMap((c) => c.sectionIds.map((id) => data.sections[id]));
const meetings = (s: RankedSchedule) => sections(s).flatMap((sec) => sec.meetings.flatMap((m) => m.days.map((day) => ({ sec, day, s: toMin(m.start), e: toMin(m.end) }))));

describe("local parser understands general schedule constraints", () => {
  it.each([
    ["I dont want a bisc lab on friday", "No BISC labs on Fri"],
    ["no classes before 10", "No classes before 10:00 AM"],
    ["nothing after 4pm on Tuesdays", "No classes after 4:00 PM on Tue"],
    ["Fridays off", "No classes on Fri"],
    ["only between 10am and 4pm", "No classes before 10:00 AM; No classes after 4:00 PM"],
    ["keep Tuesday afternoons free", "No classes between 12:00 PM and 5:00 PM on Tue"],
    ["CORE 112 only on TTh", "CORE-112 sections only on Tue/Thu"],
    ["no gaps longer than 90 minutes", "No gaps longer than 90 minutes"],
    ["no back-to-back classes", "At least 15 minutes between classes"],
    ["only 2 days a week", "Classes on at most 2 days a week"],
    ["no more than 2 classes a day", "At most 2 class meetings a day"],
    ["avoid professor Cannon", "Avoid sections with Cannon"],
    ["I want Petitti for CORE 112", "Keep CORE-112 sections with Petitti"],
    ["keep section 13006", "Keep section 13006"],
    ["drop this lab", "Avoid BISC-120 section 13005"],
    ["I'd prefer no classes before 9", "Prefer: no classes before 9:00 AM"],
    ["no lab on friday and no classes before 10am", "No labs on Fri; No classes before 10:00 AM"],
  ])("%s", (text, summary) => {
    const r = parseLocally(text, ctx);
    expect(r.unparsed).toEqual([]);
    expect(summarize(r.constraints)).toBe(summary);
  });
});

describe("constraints filter and re-rank real generation", () => {
  it("days off and earliest start remove every violating meeting", async () => {
    const off = await run("Fridays off");
    expect(off.r.totalValid).toBeGreaterThan(0);
    for (const s of off.r.schedules) expect(meetings(s).some((m) => m.day === "Fri")).toBe(false);
    const late = await run("no classes before 11am");
    for (const s of late.r.schedules) expect(Math.min(...meetings(s).map((m) => m.s))).toBeGreaterThanOrEqual(11 * 60);
  });

  it("time windows, per-course days and per-day end times", async () => {
    const lunch = await run("keep 12-1pm free on Mondays and Wednesdays");
    for (const s of lunch.r.schedules) expect(meetings(s).some((m) => ["Mon", "Wed"].includes(m.day) && m.s < 13 * 60 && 12 * 60 < m.e)).toBe(false);
    const tth = await run("CORE 112 only on TTh");
    for (const s of tth.r.schedules) expect(sections(s).filter((x) => x.courseCodes.includes("CORE-112")).every((x) => x.meetings.every((m) => m.days.every((d) => d === "Tue" || d === "Thu")))).toBe(true);
    const thu = await run("done by 3pm on Thursdays");
    for (const s of thu.r.schedules) expect(meetings(s).filter((m) => m.day === "Thu").every((m) => m.e <= 15 * 60)).toBe(true);
  });

  it("avoids or requires instructors and keeps or excludes a particular section", async () => {
    const avoid = await run("avoid professor Cannon");
    for (const s of avoid.r.schedules) expect(sections(s).some((x) => x.instructors.some((i) => i.last === "Cannon"))).toBe(false);
    const want = await run("I want Petitti for CORE 112");
    expect(want.r.schedules.length).toBeGreaterThan(0);
    for (const s of want.r.schedules) expect(sections(s).find((x) => x.courseCodes.includes("CORE-112"))!.instructors[0].last).toBe("Petitti");
    const keep = await run("keep section 13006");
    for (const s of keep.r.schedules) expect(s.courses.find((c) => c.courseCode === "BISC-120")!.sectionIds).toContain("13006");
    const drop = await run("drop this lab");
    for (const s of drop.r.schedules) expect(s.courses.find((c) => c.courseCode === "BISC-120")!.sectionIds).not.toContain("13005");
  });

  it("gap, back-to-back, days-per-week and per-day limits apply to the whole week", async () => {
    const days = await run("only 2 days a week");
    expect(days.r.totalValid).toBeGreaterThan(0);
    for (const s of days.r.schedules) expect(new Set(meetings(s).map((m) => m.day)).size).toBeLessThanOrEqual(2);
    const gaps = await run("no gaps longer than an hour");
    const b2b = await run("no back-to-back classes");
    for (const [res, ok] of [[gaps, (g: number) => g <= 60], [b2b, (g: number) => g >= 15]] as const) {
      expect(res.r.totalValid).toBeGreaterThan(0);
      for (const s of res.r.schedules) {
        const byDay = new Map<string, { s: number; e: number }[]>();
        for (const m of meetings(s)) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
        for (const list of byDay.values()) {
          list.sort((a, b) => a.s - b.s);
          for (let i = 1; i < list.length; i++) expect(ok(list[i].s - list[i - 1].e)).toBe(true);
        }
      }
    }
    const perDay = await run("no more than 1 class a day");
    for (const s of perDay.r.schedules) {
      const count = new Map<string, number>();
      for (const m of meetings(s)) count.set(m.day, (count.get(m.day) ?? 0) + 1);
      expect(Math.max(...count.values())).toBeLessThanOrEqual(1);
    }
  });

  it("a preference re-ranks without removing alternatives", async () => {
    const baseline = await generateSchedulesAsync(data, buildRequest(base(), data), { limit: 100 });
    const soft = await run("I'd prefer no classes before 10am");
    expect(soft.refinement.constraints[0].hard).toBe(false);
    expect(soft.r.totalValid).toBe(baseline.totalValid);
    expect(Math.min(...meetings(soft.r.schedules[0]).map((m) => m.s))).toBeGreaterThanOrEqual(10 * 60);
    expect(soft.r.schedules.at(-1)!.penalties.some((p) => p.message.includes("misses your feedback"))).toBe(true);
  });
});

describe("AI fallback and unparseable text", () => {
  it("asks the AI only for text the parser cannot account for, and validates its answer", async () => {
    const ai = vi.fn(async () => ({
      constraints: [
        { rule: { kind: "notBefore", time: "09:00" }, target: { components: ["lab"] }, hard: true },
        { rule: { kind: "avoidDays", days: ["Funday"] }, hard: true }, // invalid: dropped
        { rule: { kind: "avoidSections" }, target: { courses: ["MATH-999"] }, hard: true }, // not a course in play: dropped
      ],
      unparsed: "the bit about my job",
    }));
    const r = await interpretRefinement("the 8am lab clashes with my job", ctx, ai);
    expect(ai).toHaveBeenCalledOnce();
    expect(r.source).toBe("ai");
    expect(r.summary).toBe("No labs before 9:00 AM");
    expect(r.ignored).toBe("the bit about my job");
    const local = await interpretRefinement("no BISC lab on Friday", ctx, ai);
    expect(local.source).toBe("parser");
    expect(ai).toHaveBeenCalledOnce();
  });

  it("reports text as not understood when neither the parser nor the AI can use it", async () => {
    await expect(interpretRefinement("make it better somehow", ctx, null)).rejects.toThrow("I couldn’t understand “make it better somehow”");
    const down = vi.fn(async () => { throw new Error("offline"); });
    await expect(interpretRefinement("make it better somehow", ctx, down)).rejects.toThrow("couldn’t understand");
    const empty = vi.fn(async () => ({ constraints: [], unparsed: "not a schedule rule" }));
    await expect(interpretRefinement("make it better somehow", ctx, empty)).rejects.toThrow("not a schedule rule");
  });

  it("partially understood text is applied with the unused words shown, never silently dropped", async () => {
    const r = await interpretRefinement("no BISC lab on Friday because of volleyball", ctx, null);
    expect(r.summary).toBe("No BISC labs on Fri");
    expect(r.ignored).toContain("volleyball");
  });
});

describe("suggestions come from the schedule on screen", () => {
  it("names a real course component, day and time from the displayed schedule, and each one parses cleanly", async () => {
    const s = suggestRefinements(data, shown);
    expect(s[0]).toBe("No BISC-120 lab on Friday"); // 13005 meets Fri 8:00 AM
    expect(s[1]).toBe("No classes before 9am"); // earliest start is that 8:00 AM lab
    for (const text of s) {
      const r = parseLocally(text, ctx);
      expect(r.unparsed).toEqual([]);
      expect(r.ignored).toEqual([]);
    }
    const other = suggestRefinements(data, { ...shown, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13006"] }] });
    expect(other[0]).toBe("No BISC-120 lab on Thursday");
    expect(suggestRefinements(data, null)).toEqual([]);
  });
});

it("department codes that are also English words do not trip the unknown-course check", async () => {
  const d = structuredClone(data);
  d.courses["PAIN-101"] = { ...d.courses["CORE-112"], code: "PAIN-101", sectionIds: [] };
  const r = await interpretRefinement("8am classes are a pain, no classes before 9am", { ...ctx, data: d }, null);
  expect(r.summary).toBe("No classes before 9:00 AM");
  await expect(interpretRefinement("no PAIN lab on Friday", { ...ctx, data: d }, null)).rejects.toThrow("None of the courses you are scheduling is in PAIN");
});

it("suggestions skip a component day the course offers no alternative to", () => {
  // every CSCI-170 discussion meets on Friday, so "no CSCI-170 discussion on Friday" could never fit
  const s = suggestRefinements(data, { id: "x", units: 4, score: 1, courses: [{ courseCode: "CSCI-170", sectionIds: ["30108", "30116", "30343"] }], penalties: [], warnings: [] });
  expect(s.some((t) => /discussion on Friday/.test(t))).toBe(false);
  expect(s.some((t) => /quiz on Wednesday/.test(t))).toBe(false); // the only quiz section is on Wednesday
  expect(s[0]).toBe("No classes before 12pm"); // earliest start is the 11:00 AM lecture
});
