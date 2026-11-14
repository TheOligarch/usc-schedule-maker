import { assert, assertEquals } from "jsr:@std/assert@1";
import { runInterview } from "../_shared/interview.ts";
import { buildPlan, fallbackPreferences, fallbackQuestion, parseTimes, remainingTopics, sanitizePreferences } from "../_shared/interview-plan.ts";
import { HistoryItem, InterviewRequest, MAX_QUESTIONS } from "../_shared/types.ts";
import { CATALOG, request, stubCourses, stubModel } from "./helpers.ts";

const slots = (n: number): InterviewRequest["slots"] => Array.from({ length: n }, (_, i) => ({ label: `Slot ${i + 1}`, kind: "elective" as const }));
const answer = (questionId: string, text: string, freeText?: string): HistoryItem => ({
  questionId,
  question: "?",
  answer: text,
  ...(freeText ? { freeText } : {}),
});

Deno.test("plan never exceeds the question budget and covers every slot", () => {
  for (const n of [0, 1, 4, 5, 6, 9, 12]) {
    const plan = buildPlan(slots(n));
    assert(plan.length <= MAX_QUESTIONS, `${n} slots -> ${plan.length} topics`);
    const covered = plan.flatMap((t) => (t.kind === "slots" ? t.slotIndexes : []));
    assertEquals(covered, Array.from({ length: n }, (_, i) => i));
    assertEquals(new Set(plan.map((t) => t.id)).size, plan.length);
  }
});

Deno.test("remaining topics resume after the furthest asked topic, so skipped ones stay skipped", () => {
  const plan = buildPlan(slots(1));
  assertEquals(remainingTopics(plan, []).length, plan.length);
  // "breaks" and "max-gap" were skipped on the way to "days-off".
  const rest = remainingTopics(plan, [answer("day-spread", "x"), answer("days-off", "Friday")]);
  assertEquals(rest.map((t) => t.id), ["start-time", "end-time", "slots-0"]);
  // Unknown ids fall back to counting answers.
  assertEquals(remainingTopics(plan, [answer("q1", "x"), answer("q2", "y")])[0].id, "max-gap");
});

Deno.test("parseTimes reads 12h and 24h forms", () => {
  assertEquals(parseTimes("10:00 AM"), ["10:00"]);
  assertEquals(parseTimes("between 9am and 3:30 pm"), ["09:00", "15:30"]);
  assertEquals(parseTimes("done by noon, or 14:15"), ["12:00", "14:15"]);
  assertEquals(parseTimes("No preference"), []);
});

Deno.test("sanitizePreferences clamps to hard hours and drops invalid values", () => {
  const p = sanitizePreferences(
    {
      daySpread: "weird",
      breaks: "avoid",
      maxGapMinutes: -5,
      preferredDaysOff: ["Fri", "Funday", "Mon"],
      comfortStart: "07:00",
      comfortEnd: "25:00",
      notes: "  ",
    },
    { earliestStart: "09:00", latestEnd: "18:00" },
  );
  assertEquals(p, {
    daySpread: "neutral",
    breaks: "avoid",
    maxGapMinutes: null,
    preferredDaysOff: ["Mon", "Fri"],
    comfortStart: "09:00",
    comfortEnd: null,
    notes: null,
  });
  const inverted = sanitizePreferences({
    daySpread: "compact",
    breaks: "prefer",
    maxGapMinutes: 90,
    preferredDaysOff: [],
    comfortStart: "15:00",
    comfortEnd: "11:00",
    notes: null,
  });
  assertEquals([inverted.comfortStart, inverted.comfortEnd], [null, null]);
});

Deno.test("with the model down, the built-in interview runs end to end and parses its own options", async () => {
  const deps = { model: stubModel(), courses: stubCourses(CATALOG) };
  const picks: Record<string, number> = { "day-spread": 0, "breaks": 0, "max-gap": 1, "days-off": 0, "start-time": 2, "end-time": 0 };
  const history: HistoryItem[] = [];
  for (let turn = 0; turn <= MAX_QUESTIONS; turn++) {
    const { body, source } = await runInterview(request({ history }), deps);
    assertEquals(source, "fallback");
    if (body.done) {
      assertEquals(history.length, 8); // 6 schedule topics + 2 slots
      assertEquals(body.preferences.daySpread, "compact");
      assertEquals(body.preferences.breaks, "avoid");
      assertEquals(body.preferences.maxGapMinutes, 60);
      assertEquals(body.preferences.preferredDaysOff, ["Fri"]);
      assertEquals(body.preferences.comfortStart, "10:00");
      assert(body.preferences.comfortEnd !== null);
      assertEquals(body.shortlists.map((s) => s.label), ["GE-A Arts", "Free elective"]);
      assert(body.shortlists[0].options.length > 0 && body.shortlists[0].options.length <= 5);
      assert(body.summary.some((s) => s.includes("AI assistant was unavailable")));
      return;
    }
    const q = body.question;
    assert(q.options.length >= 3 && q.options.length <= 5, `${q.id} has ${q.options.length} options`);
    assertEquals(q.allowFreeText, true);
    history.push({ questionId: q.id, question: q.text, answer: q.options[picks[q.id] ?? 0] });
  }
  throw new Error("interview did not finish within the question budget");
});

Deno.test("built-in time options stay inside hard hours", () => {
  const req = request({ hardHours: { earliestStart: "10:30", latestEnd: "16:00" } });
  const plan = buildPlan(req.slots);
  for (const id of ["start-time", "end-time"]) {
    const q = fallbackQuestion(plan.find((t) => t.id === id)!, req);
    const times = q.options.flatMap(parseTimes);
    assert(times.length >= 2, `${id}: ${q.options}`);
    for (const t of times) assert(t >= "10:30" && t <= "16:00", `${id} offered ${t}`);
  }
});

Deno.test("a model question is used, cleaned, and tied to a planned topic", async () => {
  const model = stubModel({
    "interview-question": (_o, input) => ({
      topicId: input.remainingTopics[0].topicId,
      text: "  How should your week look? ",
      options: ["Few days", "few days", " Spread out ", "No preference", "", "A", "B", "C"],
    }),
  });
  const { body, source } = await runInterview(request(), { model, courses: stubCourses(CATALOG) });
  assertEquals(source, "ai");
  assert(!body.done);
  assertEquals(body.question, {
    id: "day-spread",
    text: "How should your week look?",
    options: ["Few days", "Spread out", "No preference", "A", "B"],
    allowFreeText: true,
  });
});

Deno.test("unusable model questions fall back to the built-in one", async () => {
  const bad = [
    { topicId: "made-up", text: "Q?", options: ["a", "b", "c"] },
    { topicId: "day-spread", text: "Q?", options: ["only", "two"] },
    { topicId: "done", text: "", options: [] }, // slot topics remain, so "done" is refused
    { topicId: "slots-1", text: "Q?", options: ["a", "b", "c"] }, // would skip slots-0
  ];
  for (const output of bad) {
    const history = output.topicId === "slots-1" ? ["day-spread", "breaks", "max-gap", "days-off", "start-time", "end-time"].map((id) => answer(id, "x")) : [];
    const model = stubModel({ "interview-question": () => output });
    const { body, source } = await runInterview(request({ history }), { model, courses: stubCourses(CATALOG) });
    assertEquals(source, "fallback", JSON.stringify(output));
    assert(!body.done);
    assertEquals(body.question.id, history.length ? "slots-0" : "day-spread");
  }
});

Deno.test("topics are skipped only after the student typed free text", async () => {
  // The model tries to jump from "breaks" straight to "days-off", skipping "max-gap".
  const skipTo = (id: string) => stubModel({ "interview-question": () => ({ topicId: id, text: "Q?", options: ["a", "b", "c"] }) });
  const tapped = [answer("day-spread", "Pack them onto fewer days"), answer("breaks", "Back-to-back is fine")];

  const refused = await runInterview(request({ history: tapped }), { model: skipTo("days-off"), courses: stubCourses(CATALOG) });
  assertEquals(refused.source, "fallback");
  assert(!refused.body.done);
  assertEquals(refused.body.question.id, "max-gap");

  const typed = [tapped[0], answer("breaks", "Back-to-back is fine", "Never more than 30 minutes between classes.")];
  const allowed = await runInterview(request({ history: typed }), { model: skipTo("days-off"), courses: stubCourses(CATALOG) });
  assertEquals(allowed.source, "ai");
  assert(!allowed.body.done);
  assertEquals(allowed.body.question.id, "days-off");

  // "done" skips everything left, so the same rule applies (no slots in this request).
  const noSlots = request({ slots: [], history: tapped });
  const done = await runInterview(noSlots, { model: skipTo("done"), courses: stubCourses(CATALOG) });
  assert(!done.body.done);
  assertEquals(done.body.question.id, "max-gap");
});

Deno.test("GE slot questions are grounded in titles from that category", async () => {
  const model = stubModel({
    "interview-question": (_o, input) => ({ topicId: input.remainingTopics[0].topicId, text: "Q?", options: ["a", "b", "c"] }),
  });
  const history = ["day-spread", "breaks", "max-gap", "days-off", "start-time", "end-time"].map((id) => answer(id, "x"));
  await runInterview(request({ history }), { model, courses: stubCourses(CATALOG) });
  const titles: string[] = model.calls[0].input.sampleCourseTitles;
  assert(titles.includes("Introduction to Cinema"));
  assert(!titles.includes("Introduction to Psychology"));
});

const FULL_HISTORY: HistoryItem[] = [
  answer("day-spread", "Few days"),
  answer("breaks", "Back-to-back"),
  answer("max-gap", "1 hour"),
  answer("days-off", "Friday"),
  answer("start-time", "10:00 AM"),
  answer("end-time", "5:00 PM"),
  answer("slots-0", "Film and visual art"),
  answer("slots-1", "Psychology", "especially happiness"),
];

Deno.test("final shortlists keep only real candidate codes, capped and de-duplicated", async () => {
  const model = stubModel({
    "interview-search": () => ({ slots: [{ slotIndex: 1, keywords: ["psychology", "film"], departments: ["PSYC", "CSCI"] }] }),
    "interview-final": (_o, input) => {
      // The elective search must not offer a required course.
      assert(!input.slots[1].candidates.some((c: { courseCode: string }) => c.courseCode === "CSCI-201"));
      return {
        preferences: {
          daySpread: "compact",
          breaks: "avoid",
          maxGapMinutes: 60,
          preferredDaysOff: ["Fri"],
          comfortStart: "10:00",
          comfortEnd: "17:00",
          notes: null,
        },
        shortlists: [
          {
            slotIndex: 0,
            options: ["ctcs-190", "FAKE-999", "AHIS-120", "MUSC-115", "THTR-125", "DANC-212", "ARCH-114"].map((courseCode) => ({
              courseCode,
              reason: "fits film and art",
            })),
          },
          { slotIndex: 1, options: ["PSYC-155", "CTCS-190", "CSCI-201", "PSYC-100"].map((courseCode) => ({ courseCode, reason: "psychology" })) },
        ],
        summary: ["- You prefer few days.", "  ", "You want Fridays off."],
      };
    },
  });
  const { body, source } = await runInterview(request({ history: FULL_HISTORY }), { model, courses: stubCourses(CATALOG) });
  assertEquals(source, "ai");
  assert(body.done);
  assertEquals(body.shortlists[0].options.map((o) => o.courseCode), ["CTCS-190", "AHIS-120", "MUSC-115", "THTR-125", "DANC-212"]);
  // CTCS-190 already used by slot 0, CSCI-201 is required.
  assertEquals(body.shortlists[1].options.map((o) => o.courseCode), ["PSYC-155", "PSYC-100"]);
  assertEquals(body.summary, ["You prefer few days.", "You want Fridays off."]);
  assertEquals(body.preferences.comfortEnd, "17:00");
});

Deno.test("an empty or missing catalog yields empty shortlists and a note, never invented codes", async () => {
  for (const status of ["empty", "missing"] as const) {
    const model = stubModel({
      "interview-final": () => ({
        preferences: { daySpread: "neutral", breaks: "neutral", maxGapMinutes: null, preferredDaysOff: [], comfortStart: null, comfortEnd: null, notes: null },
        shortlists: [{ slotIndex: 0, options: [{ courseCode: "CTCS-190", reason: "invented" }] }],
        summary: ["You have no strong preferences."],
      }),
    });
    const { body } = await runInterview(request({ history: FULL_HISTORY }), { model, courses: stubCourses([], status) });
    assert(body.done);
    assertEquals(body.shortlists, [{ label: "GE-A Arts", options: [] }, { label: "Free elective", options: [] }]);
    assert(body.summary.some((s) => s.includes("no course data is loaded for term 20271")));
    assert(!model.calls.some((c) => c.label === "interview-search"));
  }
});

Deno.test("ten answers always finish the interview, even with unknown question ids", async () => {
  const history = Array.from({ length: MAX_QUESTIONS }, (_, i) => answer(`q${i}`, "x"));
  const { body } = await runInterview(request({ history }), { model: stubModel(), courses: stubCourses(CATALOG) });
  assert(body.done);
});

Deno.test("rule-based preferences read free text too", () => {
  const req = request({
    slots: [],
    history: [answer("days-off", "Something else", "no classes on Tuesdays or Thursdays"), answer("end-time", "I want to be out by 4pm")],
  });
  const p = fallbackPreferences(buildPlan(req.slots), req);
  assertEquals(p.preferredDaysOff, ["Tue", "Thu"]);
  assertEquals(p.comfortEnd, "16:00");
});
