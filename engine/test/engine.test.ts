import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, generateSchedules, generateSchedulesAsync, linkCombos } from "../src/index";
import type { GenerateResult, RankedSchedule, Section } from "../src/types";
import { fmtClock } from "../src/time";
import { allowAll, fixture, request } from "./fixture";

const sectionsOf = (code: string): Section[] => fixture.courses[code].sectionIds.map((id) => fixture.sections[id]);
const idSets = (combos: Section[][]) => combos.map((c) => c.map((s) => s.id).sort().join("+")).sort();
const sectionSets = (r: GenerateResult, code: string) =>
  r.schedules.map((s) => s.courses.find((c) => c.courseCode === code)!.sectionIds.slice().sort().join("+")).sort();
const kinds = (s: RankedSchedule) => s.penalties.map((p) => p.kind);
const GE = ["ARLT-100", "GESM-110", "PHIL-140", "MUSC-101", "AHIS-120"];

describe("linkage (contract section 4)", () => {
  it("coded: same letter goes together, null-coded type joins every combo", () => {
    const r = linkCombos(fixture.courses["CSCI-201"], sectionsOf("CSCI-201"));
    expect(r.ambiguous).toBe(false);
    expect(idSets(r.combos)).toEqual(["30001+30003+30006", "30001+30004+30006", "30002+30005+30006"]);
  });

  it("single: the one lecture with any discussion", () => {
    const r = linkCombos(fixture.courses["MATH-226"], sectionsOf("MATH-226"));
    expect(idSets(r.combos)).toEqual(["31001+31002", "31001+31003"]);
  });

  it("ambiguous: each lecture pairs with the following non-lecture sections", () => {
    const r = linkCombos(fixture.courses["WRIT-150"], sectionsOf("WRIT-150"));
    expect(r.ambiguous).toBe(true);
    expect(idSets(r.combos)).toEqual(["32001+32002", "32003+32004", "32003+32005"]);
  });

  it("ambiguous: a lecture with no following sections may take any of that type", () => {
    const [l1, d1, l2, d2] = ["32001", "32002", "32003", "32004"].map((id) => fixture.sections[id]);
    const r = linkCombos({ linkage: "ambiguous" }, [l1, l2, d1, d2]);
    expect(idSets(r.combos)).toEqual(["32001+32002", "32001+32004", "32002+32003", "32003+32004"]);
  });

  it("drops a letter whose combination has no lecture", () => {
    const lec = { ...fixture.sections["30001"], linkCode: "A" };
    const dis = { ...fixture.sections["30005"], linkCode: "B" };
    expect(idSets(linkCombos({ linkage: "coded" }, [lec, dis]).combos)).toEqual(["30001"]);
  });

  it("enforces linkage inside generateSchedules", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"] }));
    expect(r.totalValid).toBe(3);
    expect(sectionSets(r, "CSCI-201")).toEqual(["30001+30003+30006", "30001+30004+30006", "30002+30005+30006"]);
  });

  it("ambiguous courses carry the ambiguousLink penalty and a warning", () => {
    const r = generateSchedules(fixture, request({ required: ["WRIT-150"] }));
    expect(r.totalValid).toBe(3);
    for (const s of r.schedules) {
      expect(kinds(s)).toContain("ambiguousLink");
      expect(s.warnings.some((w) => w.includes("guessed from section order"))).toBe(true);
    }
  });
});

describe("hard constraints", () => {
  it("every meeting must sit inside that day's allowed blocks", () => {
    const allowed = allowAll("11:00", "22:00");
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(1);
    expect(r.schedules[0].courses[0].sectionIds).toEqual(["30002", "30005", "30006"]);
  });

  it("supports several blocks per day (gaps are not allowed time)", () => {
    const allowed = allowAll();
    allowed.Fri = [
      { start: "08:00", end: "11:00" },
      { start: "13:00", end: "18:00" },
    ];
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], allowedTimes: allowed }));
    // DIS 30004 (Fri 12:00) falls in the gap
    expect(sectionSets(r, "CSCI-201")).toEqual(["30001+30003+30006", "30002+30005+30006"]);
  });

  it("an empty block list is a day off", () => {
    const allowed = allowAll();
    allowed.Fri = [];
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(0);
  });

  it("TBA meetings never violate allowed times", () => {
    const allowed = allowAll("08:00", "09:00");
    const r = generateSchedules(fixture, request({ required: ["GESM-110"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(1);
    expect(kinds(r.schedules[0])).toContain("onlineOrTba");
  });

  it("rejects time overlaps between courses", () => {
    // MATH-226 DIS 31002 (Tue 10:00) overlaps PHRD-101 (Tue/Thu 10:00)
    const r = generateSchedules(fixture, request({ required: ["MATH-226", "PHRD-101"] }));
    expect(r.totalValid).toBe(1);
    expect(r.schedules[0].courses[0].sectionIds).toEqual(["31001", "31003"]);
  });

  it("enforces the unit cap on units.min", () => {
    // AME-101 (Tue/Thu 16:00) overlaps CSCI-201 DIS 30005, leaving 2
    const req = { required: ["CSCI-201", "AME-101"] };
    expect(generateSchedules(fixture, request({ ...req, unitCap: 7 })).totalValid).toBe(2);
    expect(generateSchedules(fixture, request({ ...req, unitCap: 6 })).totalValid).toBe(0);
    const r = generateSchedules(fixture, request({ required: ["MUSC-101"], unitCap: 2 }));
    expect(r.totalValid).toBe(1);
    expect(r.schedules[0].units).toBe(2);
    expect(r.schedules[0].warnings.some((w) => w.includes("variable units"))).toBe(true);
  });

  it("legacy minRmp never excludes low-rated lecture instructors", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], minRmp: 3 }));
    expect(r.totalValid).toBe(3);
    expect(r.schedules.some((s) => s.courses[0].sectionIds.includes("30002"))).toBe(true);
    expect(r.schedules[0].score).toBeGreaterThan(r.schedules[r.schedules.length - 1].score);
    expect(r.blockers.some((b) => b.constraint === "minRmp")).toBe(false);
  });

  it("unrated, few-rating and missing instructors get a small noRmp penalty, not excluded", () => {
    const r = generateSchedules(fixture, request({ required: ["WRIT-150"], minRmp: 4.95 }));
    expect(r.totalValid).toBe(3);
    const msgs = r.schedules.flatMap((s) => s.penalties.filter((p) => p.kind === "noRmp").map((p) => p.message));
    expect(msgs.some((m) => m.includes("no instructor listed"))).toBe(true);
    expect(msgs.some((m) => m.includes("only 1 RateMyProfessor rating"))).toBe(true);
    const unmatched = generateSchedules(fixture, request({ required: ["PHRD-101"], minRmp: 4 }));
    expect(unmatched.totalValid).toBe(1);
    expect(unmatched.schedules[0].penalties.find((p) => p.kind === "noRmp")!.amount).toBe(DEFAULT_WEIGHTS.noRmp);
  });

  it("noRmp scales with importance.rmp", () => {
    const amount = (rmp: number) =>
      generateSchedules(fixture, request({ required: ["PHRD-101"], importance: { rmp, daySpread: 5, breaks: 5, seatRisk: 5, finals: 5 } }))
        .schedules[0].penalties.find((p) => p.kind === "noRmp")!.amount;
    expect(amount(10)).toBe(DEFAULT_WEIGHTS.noRmp * 2);
    expect(amount(1)).toBeCloseTo(DEFAULT_WEIGHTS.noRmp * 0.2);
  });

  it("each flex slot takes exactly one of its options", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], flexSlots: [{ label: "GE-B", options: GE }] }), { limit: 100 });
    expect(r.totalValid).toBeGreaterThan(0);
    for (const s of r.schedules) {
      expect(s.courses).toHaveLength(2);
      expect(s.courses[0].courseCode).toBe("CSCI-201");
      expect(GE).toContain(s.courses[1].courseCode);
    }
    expect(new Set(r.schedules.map((s) => s.courses[1].courseCode)).size).toBe(5);
  });
});

describe("cross-listing", () => {
  it("a required code is satisfied by any section listed under it", () => {
    const r = generateSchedules(fixture, request({ required: ["ISE-101"] }));
    expect(r.totalValid).toBe(1);
    expect(r.schedules[0].courses).toEqual([{ courseCode: "ISE-101", sectionIds: ["33001"] }]);
    expect(r.schedules[0].units).toBe(3);
  });

  it("two required codes for the same class share one section, counted once", () => {
    const r = generateSchedules(fixture, request({ required: ["AME-101", "ISE-101"], unitCap: 3 }));
    expect(r.totalValid).toBe(1);
    const s = r.schedules[0];
    expect(s.units).toBe(3);
    expect(s.courses.map((c) => c.sectionIds)).toEqual([["33001"], ["33001"]]);
    expect(s.penalties.filter((p) => p.sectionId === "33001" && p.kind === "preference")).toHaveLength(1);
    expect(s.warnings.some((w) => w.includes("same cross-listed class"))).toBe(true);
  });

  it("a flex slot cannot be filled by a class already required", () => {
    const r = generateSchedules(fixture, request({ required: ["AME-101"], flexSlots: [{ label: "x", options: ["ISE-101"] }] }));
    expect(r.totalValid).toBe(0);
  });

  it("labels initial-only RMP matches as possible matches", () => {
    const r = generateSchedules(fixture, request({ required: ["AME-101"] }));
    expect(r.schedules[0].warnings.some((w) => w.includes("possible match"))).toBe(true);
  });
});

describe("penalties (captain's policy)", () => {
  const one = (code: string, over = {}) => generateSchedules(fixture, request({ required: [code], ...over })).schedules;

  it("flags full, waitlist, D-clearance, online/TBA and HSC", () => {
    expect(one("MATH-226").find((s) => s.courses[0].sectionIds.includes("31003"))!.penalties.map((p) => p.kind)).toContain("full");
    expect(kinds(one("MUSC-101")[0])).toContain("waitlist");
    expect(kinds(one("MUSC-101")[0])).not.toContain("full");
    expect(kinds(one("PHIL-140")[0])).toContain("dClearance");
    expect(kinds(one("GESM-110")[0])).toContain("onlineOrTba");
    const hsc = one("PHRD-101")[0].penalties.find((p) => p.kind === "onlineOrTba")!;
    expect(hsc.message).toContain("HSC");
  });

  it("flags overlapping final exams", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201", "ARLT-100"] }));
    expect(r.totalValid).toBeGreaterThan(0);
    for (const s of r.schedules) expect(kinds(s)).toContain("finalConflict");
  });

  it("heavy penalties scale by importance", () => {
    const seat = (seatRisk: number) =>
      one("PHIL-140", { importance: { rmp: 5, daySpread: 5, breaks: 5, seatRisk, finals: 5 } })[0].penalties.find((p) => p.kind === "dClearance")!.amount;
    expect(seat(5)).toBe(DEFAULT_WEIGHTS.dClearance);
    expect(seat(10)).toBe(DEFAULT_WEIGHTS.dClearance * 2);
  });

  it("weights can be overridden per call", () => {
    const r = generateSchedules(fixture, request({ required: ["PHIL-140"] }), { weights: { dClearance: 1 } });
    expect(r.schedules[0].penalties.find((p) => p.kind === "dClearance")!.amount).toBe(1);
  });

  it("score is 100 minus nothing for a clean schedule and drops with penalties", () => {
    const clean = generateSchedules(fixture, request({ required: ["CSCI-270"] })).schedules[0];
    const risky = generateSchedules(fixture, request({ required: ["PHIL-140"] })).schedules[0];
    expect(clean.score).toBeGreaterThan(risky.score);
    expect(clean.score).toBeLessThanOrEqual(100);
  });
});

describe("ranking", () => {
  const geReq = (over = {}) => request({ required: ["CSCI-201"], flexSlots: [{ label: "GE-B", options: GE }], ...over });

  it("returns schedules best-first and avoids heavy penalties at the top", () => {
    const r = generateSchedules(fixture, geReq());
    for (let i = 1; i < r.schedules.length; i++) expect(r.schedules[i - 1].score).toBeGreaterThanOrEqual(r.schedules[i].score);
    expect(r.schedules[0].courses[1].courseCode).toBe("AHIS-120");
  });

  it("importance and comfort times change the order", () => {
    const r = generateSchedules(
      fixture,
      geReq({ importance: { rmp: 5, daySpread: 5, breaks: 5, seatRisk: 5, finals: 1 }, preferences: { comfortStart: "09:00" } }),
    );
    expect(r.schedules[0].courses[1].courseCode).toBe("ARLT-100");
    const ahis = r.schedules.find((s) => s.courses[1].courseCode === "AHIS-120")!;
    expect(ahis.penalties.some((p) => p.kind === "preference" && p.message === "Classes start as early as 8:00 AM (you prefer 9:00 AM or later)")).toBe(true);
  });

  it("daySpread compact prefers fewer class days", () => {
    const base = { required: ["CSCI-201", "MATH-226"] };
    const neutral = generateSchedules(fixture, request(base));
    expect(neutral.schedules[0].courses[0].sectionIds).toContain("30001");
    const compact = generateSchedules(fixture, request({ ...base, preferences: { daySpread: "compact" } }));
    expect(compact.schedules[0].courses[0].sectionIds).toContain("30002");
    expect(compact.schedules[0].courses[1].sectionIds).toEqual(["31001", "31002"]);
  });

  it("daySpread spread prefers more class days", () => {
    const base = { required: ["CSCI-201", "MATH-226"], preferences: { daySpread: "spread" as const } };
    const r = generateSchedules(fixture, request(base));
    expect(r.schedules[0].courses[0].sectionIds).toContain("30001");
    const tth = r.schedules.find((s) => s.courses[0].sectionIds.includes("30002"))!;
    expect(tth.penalties.some((p) => p.message.includes("spread out"))).toBe(true);
  });

  it("penalizes class on a preferred day off", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], preferences: { preferredDaysOff: ["Fri"] } }));
    for (const s of r.schedules) expect(s.penalties.some((p) => p.message.includes("preferred day off (Fri)"))).toBe(true);
  });

  it("breaks and maxGapMinutes", () => {
    // MATH 31001 Tue 08:00-09:20 then DIS Tue 10:00 = 40 min gap
    const avoid = generateSchedules(fixture, request({ required: ["MATH-226"], preferences: { breaks: "avoid" } }));
    const s = avoid.schedules.find((x) => x.courses[0].sectionIds.includes("31002"))!;
    expect(s.penalties.some((p) => p.message.includes("gaps between classes"))).toBe(true);
    const maxGap = generateSchedules(fixture, request({ required: ["MATH-226"], preferences: { maxGapMinutes: 30 } }));
    const g = maxGap.schedules.find((x) => x.courses[0].sectionIds.includes("31002"))!;
    expect(g.penalties.some((p) => p.message.includes("longer than 30 minutes"))).toBe(true);
    // CSCI 30001 Mon/Wed 10:00-11:50 then WRIT 32001 Mon/Wed 12:00: back-to-back
    const prefer = generateSchedules(fixture, request({ required: ["CSCI-201", "WRIT-150"], preferences: { breaks: "prefer" } }), { limit: 100 });
    expect(prefer.schedules.some((x) => x.penalties.some((p) => p.message.includes("back-to-back")))).toBe(true);
  });

  it("is deterministic with stable ids", () => {
    const a = generateSchedules(fixture, geReq(), { limit: 100 });
    const b = generateSchedules(fixture, geReq(), { limit: 100 });
    expect(a).toEqual(b);
    expect(new Set(a.schedules.map((s) => s.id)).size).toBe(a.schedules.length);
    expect(a.schedules[0].id).toMatch(/^\d+(\+\d+)*$/);
  });

  it("limit defaults to 10 and is clamped to 1..100", () => {
    const big = request({ required: ["CSCI-201", "WRIT-150"], flexSlots: [{ label: "GE-B", options: GE }] });
    const all = generateSchedules(fixture, big, { limit: 100 });
    expect(all.totalValid).toBeGreaterThan(10);
    expect(generateSchedules(fixture, big).schedules).toHaveLength(10);
    expect(generateSchedules(fixture, big, { limit: 2 }).schedules).toHaveLength(2);
    expect(generateSchedules(fixture, big, { limit: 0 }).schedules).toHaveLength(1);
    expect(generateSchedules(fixture, big, { limit: 5000 }).schedules.length).toBe(Math.min(100, all.totalValid));
    // the top 2 are the same as the first 2 of the full ranking
    expect(generateSchedules(fixture, big, { limit: 2 }).schedules).toEqual(all.schedules.slice(0, 2));
  });

  it("marks truncated enumeration", () => {
    const big = request({ required: ["CSCI-201", "WRIT-150"], flexSlots: [{ label: "GE-B", options: GE }] });
    const r = generateSchedules(fixture, big, { maxEnumerate: 3 });
    expect(r.totalValid).toBe(3);
    expect(r.truncated).toBe(true);
  });
});

describe("fmtClock", () => {
  it("writes 12-hour times for students", () => {
    expect(fmtClock(20 * 60)).toBe("8:00 PM");
    expect(fmtClock(12 * 60)).toBe("12:00 PM");
    expect(fmtClock(9 * 60 + 30)).toBe("9:30 AM");
    expect(fmtClock(0)).toBe("12:00 AM");
    expect(fmtClock(24 * 60)).toBe("12:00 AM");
  });
});

describe("blockers", () => {
  it("names the time restriction that is killing the schedules", () => {
    const allowed = allowAll("11:00", "22:00");
    allowed.Tue = [{ start: "15:00", end: "22:00" }];
    allowed.Thu = [{ start: "15:00", end: "22:00" }];
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(0);
    expect(r.blockers[0].constraint).toBe("allowedTimes");
    expect(r.blockers[0].eliminated).toBe(3);
    expect(r.blockers[0].message).toBe("Allowing classes before 11:00 AM on Mon/Wed/Fri and before 3:00 PM on Tue/Thu would give 3 schedules.");
  });

  it("names a late cutoff in 12-hour time, never 24-hour", () => {
    const allowed = allowAll("08:00", "15:00");
    allowed.Thu = [{ start: "08:00", end: "16:00" }];
    const r = generateSchedules(fixture, request({ required: ["AME-101"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(0);
    const late = r.blockers.find((b) => b.message.includes(" after "))!;
    expect(late.message).toBe("Allowing classes after 3:00 PM on Tue and after 4:00 PM on Thu would give 1 schedule.");
    for (const b of r.blockers) expect(b.message).not.toMatch(/\b(1[3-9]|2[0-4]):\d\d\b/);
  });

  it("names a day off", () => {
    const allowed = allowAll();
    allowed.Fri = [];
    const r = generateSchedules(fixture, request({ required: ["CSCI-201"], allowedTimes: allowed }));
    expect(r.blockers[0]).toEqual({ constraint: "allowedTimes", eliminated: 3, message: "Allowing classes on Fri would give 3 schedules." });
  });

  it("reports blockers as diagnostics even when schedules exist", () => {
    const allowed = allowAll();
    allowed.Wed = [];
    const r = generateSchedules(fixture, request({ required: ["MATH-226"], allowedTimes: allowed }));
    expect(r.totalValid).toBe(1);
    expect(r.blockers).toContainEqual({ constraint: "allowedTimes", eliminated: 1, message: "Allowing classes on Wed would give 2 schedules." });
  });

  it("explains a unit cap", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201", "AME-101"], unitCap: 6 }));
    expect(r.blockers[0].constraint).toBe("unitCap");
    expect(r.blockers[0].message).toBe("Removing your 6-unit cap would give 2 schedules (the smallest is 7 units).");
  });

  it("a low rating cannot be reported as a blocker, even for a legacy request", () => {
    const r = generateSchedules(fixture, request({ required: ["AHIS-120"], minRmp: 3 }));
    expect(r.totalValid).toBe(1);
    expect(r.blockers.some((b) => b.constraint === "minRmp")).toBe(false);
    expect(r.schedules[0].penalties.some((p) => p.kind === "preference" && p.message.includes("2.1/5"))).toBe(true);
  });

  it("explains unavoidable time conflicts", () => {
    const r = generateSchedules(fixture, request({ required: ["AME-101", "CSCI-270"] }));
    expect(r.totalValid).toBe(0);
    const tc = r.blockers.find((b) => b.constraint === "timeConflict")!;
    expect(tc.eliminated).toBe(1);
    expect(tc.message).toContain("overlap in every section option");
  });

  it("suggests dropping a course only when no constraint relaxation helps", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201", "AME-101", "CSCI-270"] }));
    expect(r.blockers[0].constraint).toBe("timeConflict");
    expect(r.blockers.some((b) => b.constraint === "requiredCourse")).toBe(false);
    const allowed = allowAll("08:00", "22:00");
    allowed.Fri = [];
    // Fri off kills CSCI-201 and AME-101/CSCI-270 always clash: no single relaxation helps
    const stuck = generateSchedules(fixture, request({ required: ["CSCI-201", "AME-101", "CSCI-270"], allowedTimes: allowed }));
    expect(stuck.totalValid).toBe(0);
    expect(stuck.blockers.map((b) => b.constraint)).toEqual(["combination"]);
    const drop = generateSchedules(fixture, request({ required: ["CSCI-201", "AME-101"], allowedTimes: allowed, unitCap: 4 }));
    expect(drop.blockers).toContainEqual({ constraint: "requiredCourse", eliminated: 1, message: "Dropping CSCI-201 would give 1 schedule." });
  });

  it("reports unknown courses and courses with no sections", () => {
    const r = generateSchedules(fixture, request({ required: ["CSCI-201", "CSCI-999", "EMPT-100"] }));
    expect(r.totalValid).toBe(0);
    expect(r.blockers.map((b) => b.constraint)).toEqual(expect.arrayContaining(["unknownCourse", "noValidLinkCombo"]));
    expect(r.blockers.find((b) => b.constraint === "unknownCourse")!.message).toBe("CSCI-999 is not offered in Spring 2027.");
    const one = generateSchedules(fixture, request({ required: ["CSCI-201", "CSCI-999"] }));
    expect(one.blockers).toEqual([{ constraint: "unknownCourse", eliminated: 3, message: "CSCI-999 is not offered in Spring 2027." }]);
  });

  it("is always non-empty when nothing fits", () => {
    const allowed = allowAll("11:00", "12:00");
    const r = generateSchedules(fixture, request({ required: ["AME-101", "CSCI-270"], allowedTimes: allowed, unitCap: 1 }));
    expect(r.totalValid).toBe(0);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(generateSchedules(fixture, request()).blockers.length).toBeGreaterThan(0);
  });
});

describe("generateSchedulesAsync", () => {
  it("matches the sync result", async () => {
    const req = request({ required: ["CSCI-201", "WRIT-150"], flexSlots: [{ label: "GE-B", options: GE }] });
    expect(await generateSchedulesAsync(fixture, req, { sliceMs: 0 })).toEqual(generateSchedules(fixture, req));
  });

  it("can be aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(generateSchedulesAsync(fixture, request({ required: ["CSCI-201"] }), { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
