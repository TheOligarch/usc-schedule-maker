import assert from "node:assert/strict";
import { test } from "node:test";
import { RmpMatcher } from "../src/rmp.ts";
import { planTerms } from "../src/terms.ts";
import type { RmpTeacher } from "../src/types.ts";

const t = (legacyId: string, first: string, last: string, department: string, count = 10): RmpTeacher => ({
  legacyId,
  first,
  last,
  department,
  avg: 4,
  difficulty: 3,
  count,
  wouldTakeAgain: null,
});

const matcher = new RmpMatcher([
  t("1", "Marco", "Papa", "Computer Science"),
  t("2", "David", "Chan", "Mathematics"),
  t("3", "David", "Chan", "Accounting"),
  t("4", "Steve", "Child", "Economics"),
  t("5", "Ann", "Lee", "History"),
  t("6", "Andrew", "Lee", "Physics"),
  t("7", "José", "Núñez", "Spanish"),
  t("8", "Zero", "Ratings", "Film", 0),
]);

test("exact match, normalized", () => {
  assert.deepEqual(matcher.match("MARCO", "Papa", []), { teacher: matcher.match("Marco", "Papa", [])!.teacher, kind: "exact" });
  assert.equal(matcher.match("Jose", "Nunez", [])?.teacher.legacyId, "7");
});

test("duplicate names: department tie-break, otherwise no match", () => {
  assert.equal(matcher.match("David", "Chan", ["Mathematics"])?.teacher.legacyId, "2");
  assert.equal(matcher.match("David", "Chan", ["Film"]), null);
  assert.equal(matcher.match("David", "Chan", []), null);
});

test("initial match only when unique (or dept-resolved)", () => {
  assert.deepEqual(matcher.match("Stephen", "Child", [])?.kind, "initial");
  assert.equal(matcher.match("Alice", "Lee", []), null, "A. Lee is ambiguous");
  assert.equal(matcher.match("Alice", "Lee", ["Physics"])?.teacher.legacyId, "6");
  assert.equal(matcher.match("Zero", "Ratings", []), null, "zero-rating teachers count as unrated");
  assert.equal(matcher.match("", "Papa", []), null);
});

test("planTerms keeps only terms that have not started", () => {
  const active = [
    { termCode: 20271, season: "Spring", year: 2027, status: "Active" },
    { termCode: 20263, season: "Fall", year: 2026, status: "Active" },
    { termCode: 20262, season: "Summer", year: 2026, status: "Active" },
  ];
  const { plan, skipped } = planTerms(active, new Map([["Spring 2027", "2027-01-11"]]), "2026-11-14");
  assert.deepEqual(
    plan.map((p) => [p.code, p.start, p.startSource]),
    [["20271", "2027-01-11", "registrar"]],
  );
  assert.deepEqual(skipped.map((s) => s.code), ["20262", "20263"]);
  assert.equal(planTerms(active, new Map([["Spring 2027", "2027-01-11"]]), "2027-01-11").plan.length, 0, "start day counts as started");
});
