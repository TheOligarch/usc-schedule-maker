import { assert, assertEquals } from "jsr:@std/assert@1";
import { questionRepeatsSetup, runInterview } from "../_shared/interview.ts";
import { buildPlan, fallbackPreferences, parseTimes, remainingTopics, sanitizePreferences } from "../_shared/interview-plan.ts";
import { HistoryItem, InterviewRequest, MAX_QUESTIONS } from "../_shared/types.ts";
import { CATALOG, course, request, stubCourses, stubModel } from "./helpers.ts";

const slots = (n: number): InterviewRequest["slots"] => Array.from({ length: n }, (_, i) => ({ label: `Slot ${i + 1}`, kind: "elective" as const }));
const answer = (questionId: string, text: string, freeText?: string): HistoryItem => ({
  questionId,
  question: "?",
  answer: text,
  ...(freeText ? { freeText } : {}),
});

Deno.test("the plan never asks about start or end times", () => {
  for (const n of [0, 1, 4, 5, 6, 7, 9, 12]) {
    const kinds = buildPlan(slots(n)).map((t) => t.kind as string);
    for (const k of ["start-time", "end-time", "comfort-hours"]) assert(!kinds.includes(k), `${n} slots asks ${k}`);
  }
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
  // "breaks" was skipped on the way to "max-gap".
  const rest = remainingTopics(plan, [answer("day-spread", "x"), answer("max-gap", "1 hour")]);
  assertEquals(rest.map((t) => t.id), ["slots-0"]);
  // Unknown ids fall back to counting answers.
  assertEquals(remainingTopics(plan, [answer("q1", "x"), answer("q2", "y")])[0].id, "max-gap");
});

Deno.test("parseTimes reads 12h and 24h forms", () => {
  assertEquals(parseTimes("10:00 AM"), ["10:00"]);
  assertEquals(parseTimes("between 9am and 3:30 pm"), ["09:00", "15:30"]);
  assertEquals(parseTimes("done by noon, or 14:15"), ["12:00", "14:15"]);
  assertEquals(parseTimes("No preference"), []);
});

Deno.test("sanitizePreferences drops invalid values and always nulls comfort hours", () => {
  const p = sanitizePreferences({
    daySpread: "weird",
    breaks: "avoid",
    maxGapMinutes: -5,
    preferredDaysOff: ["Fri", "Funday", "Mon"],
    comfortStart: "09:00",
    comfortEnd: "17:00",
    notes: "  ",
  });
  assertEquals(p, {
    daySpread: "neutral",
    breaks: "avoid",
    maxGapMinutes: null,
    preferredDaysOff: ["Mon", "Fri"],
    comfortStart: null,
    comfortEnd: null,
    notes: null,
  });
});

Deno.test("with the model down, the built-in interview runs end to end and parses its own options", async () => {
  const deps = { model: stubModel(), courses: stubCourses(CATALOG) };
  const picks: Record<string, number> = { "day-spread": 0, "breaks": 0, "max-gap": 1 };
  const history: HistoryItem[] = [];
  for (let turn = 0; turn <= MAX_QUESTIONS; turn++) {
    const { body, source } = await runInterview(request({ history }), deps);
    assertEquals(source, "fallback");
    if (body.done) {
      assertEquals(history.length, 5); // 3 schedule topics + 2 slots
      assertEquals(body.preferences.daySpread, "compact");
      assertEquals(body.preferences.breaks, "avoid");
      assertEquals(body.preferences.maxGapMinutes, 60);
      assertEquals(body.preferences.preferredDaysOff, []);
      assertEquals(body.preferences.comfortStart, null);
      assertEquals(body.preferences.comfortEnd, null);
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
    const history = output.topicId === "slots-1" ? ["day-spread", "breaks", "max-gap"].map((id) => answer(id, "x")) : [];
    const model = stubModel({ "interview-question": () => output });
    const { body, source } = await runInterview(request({ history }), { model, courses: stubCourses(CATALOG) });
    assertEquals(source, "fallback", JSON.stringify(output));
    assert(!body.done);
    assertEquals(body.question.id, history.length ? "slots-0" : "day-spread");
  }
});

Deno.test("topics are skipped only after the student typed free text", async () => {
  const skipTo = (id: string) => stubModel({ "interview-question": () => ({ topicId: id, text: "Q?", options: ["a", "b", "c"] }) });
  const tapped = [answer("day-spread", "Pack them onto fewer days")];
  const refused = await runInterview(request({ history: tapped }), { model: skipTo("max-gap"), courses: stubCourses(CATALOG) });
  assertEquals(refused.source, "fallback");
  assert(!refused.body.done);
  assertEquals(refused.body.question.id, "breaks");

  const typed = [answer("day-spread", "Pack them onto fewer days", "I prefer back-to-back classes.")];
  const allowed = await runInterview(request({ history: typed }), { model: skipTo("max-gap"), courses: stubCourses(CATALOG) });
  assertEquals(allowed.source, "ai");
  assert(!allowed.body.done);
  assertEquals(allowed.body.question.id, "max-gap");

  const done = await runInterview(request({ slots: [], history: tapped }), { model: skipTo("done"), courses: stubCourses(CATALOG) });
  assert(!done.body.done);
  assertEquals(done.body.question.id, "breaks");
});

Deno.test("GE slot questions are grounded in titles from that category", async () => {
  const model = stubModel({
    "interview-question": (_o, input) => ({ topicId: input.remainingTopics[0].topicId, text: "Q?", options: ["a", "b", "c"] }),
  });
  const history = ["day-spread", "breaks", "max-gap"].map((id) => answer(id, "x"));
  await runInterview(request({ history }), { model, courses: stubCourses(CATALOG) });
  const titles: string[] = model.calls[0].input.sampleCourseTitles;
  assert(titles.includes("Introduction to Cinema"));
  assert(!titles.includes("Introduction to Psychology"));
});

const FULL_HISTORY: HistoryItem[] = [
  answer("day-spread", "Few days"),
  answer("breaks", "Back-to-back"),
  answer("max-gap", "1 hour"),
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
          notes: "Keep Thursdays clear after 18:30.",
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
        summary: [
          "- You prefer few days.",
          "  ",
          "• Please confirm these preferences or change any of them before you continue.",
          "You want Fridays off.",
          "You are fine with Monday classes after 20:00.",
        ],
      };
    },
  });
  const { body, source } = await runInterview(request({ history: FULL_HISTORY }), { model, courses: stubCourses(CATALOG) });
  assertEquals(source, "ai");
  assert(body.done);
  assertEquals(body.shortlists[0].options.map((o) => o.courseCode), ["CTCS-190", "AHIS-120", "MUSC-115", "THTR-125", "DANC-212"]);
  // CTCS-190 already used by slot 0, CSCI-201 is required.
  assertEquals(body.shortlists[1].options.map((o) => o.courseCode), ["PSYC-155", "PSYC-100"]);
  // Model slips into 24-hour time are rewritten before the student sees them.
  assertEquals(body.summary, ["You prefer few days.", "You want Fridays off.", "You are fine with Monday classes after 8:00 PM."]);
  assertEquals(body.preferences.notes, "Keep Thursdays clear after 6:30 PM.");
  // The model returned comfort hours anyway; they are dropped.
  assertEquals([body.preferences.comfortStart, body.preferences.comfortEnd], [null, null]);
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
    history: [answer("breaks", "I like breaks", "Time for lunch"), answer("max-gap", "2 hours")],
  });
  const p = fallbackPreferences(buildPlan(req.slots), req);
  assertEquals(p.maxGapMinutes, 120);
  assertEquals(p.preferredDaysOff, []);
  assertEquals(p.notes, "Time for lunch");
  assertEquals(p.comfortEnd, null);
});

Deno.test("course interests recognize course variants and seminar slots without duplicates", () => {
  for (const code of ["GESM", "GESM-110", "GESM-120g", "GESM-121g", "GESM-130g", "GESM-131g", "GESM-140g", "GESM-150g", "GESM-160g"]) {
    assertEquals(buildPlan([], [code]).filter((t) => t.kind === "course-interest").map((t) => t.id), ["seminar-interests"]);
  }
  assertEquals(buildPlan([], ["WRIT-150", "writ 150"]).filter((t) => t.kind === "course-interest").map((t) => t.id), ["writing-interests"]);
  assertEquals(buildPlan([], ["WRIT-1500", "WRIT-340", "GESM-OTHER", "CSCI-150"]).filter((t) => t.kind === "course-interest"), []);
  for (const geCategory of ["GESM", "General Education Seminar"]) {
    const plan = buildPlan([{ label: `${geCategory} course`, kind: "GE", geCategory }], ["GESM-120g", "GESM-121g"]);
    assertEquals(plan.filter((t) => t.kind === "course-interest").map((t) => t.id), ["seminar-interests"]);
    assertEquals(plan.filter((t) => t.kind === "slots"), []);
  }
});

Deno.test("course interests and every generic slot fit within the question budget", () => {
  for (let n = 0; n <= 12; n++) {
    for (const required of [[], ["WRIT-150"], ["GESM-120g"], ["WRIT-150", "GESM-120g"]]) {
      const plan = buildPlan(slots(n), required);
      assert(plan.length <= MAX_QUESTIONS);
      assertEquals(plan.flatMap((t) => t.kind === "slots" ? t.slotIndexes : []), Array.from({ length: n }, (_, i) => i));
      assertEquals(new Set(plan.map((t) => t.id)).size, plan.length);
    }
  }
});

for (const ai of [false, true]) {
  for (const required of [[], ["WRIT-150"], ["GESM-120g"], ["WRIT-150", "GESM-120g", "GESM-121g"]]) {
    Deno.test(`${ai ? "AI" : "fallback"} interview retains course interests: ${required.join(", ") || "neither"}`, async () => {
      const model = stubModel(
        ai
          ? {
            "interview-question": (_o, input) => ({
              topicId: input.remainingTopics[0].topicId,
              text: input.remainingTopics[0].goal,
              options: ["Film", "Science", "No preference"],
            }),
            "interview-final": (_o, input) => {
              for (const id of ["writing-interests", "seminar-interests"]) {
                assertEquals(
                  input.answers.some((a: { topicId: string }) => a.topicId === id),
                  id === "writing-interests" ? required.includes("WRIT-150") : required.includes("GESM-120g"),
                );
              }
              return {
                preferences: fallbackPreferences(buildPlan([], required), request({ slots: [], required })),
                shortlists: [],
                summary: ["Your schedule preferences."],
              };
            },
          }
          : {},
      );
      const history: HistoryItem[] = [];
      for (let turn = 0; turn <= MAX_QUESTIONS; turn++) {
        const { body, source } = await runInterview(request({ required, slots: [], history }), { model, courses: stubCourses(CATALOG) });
        if (body.done) {
          assertEquals(source, ai ? "ai" : "fallback");
          for (
            const [code, label, interest] of [["WRIT-150", "WRIT-150 writing interests", "Film criticism"], [
              "GESM-120g",
              "GESM seminar interests",
              "Climate justice",
            ]]
          ) {
            assertEquals(body.summary.some((s) => s.includes(label)), required.includes(code));
            if (required.includes(code)) {
              assert(body.preferences.notes?.includes(interest));
              assert(body.summary.some((s) => s.includes(interest)));
            }
          }
          assertEquals(history.filter((h) => h.questionId === "writing-interests").length, required.includes("WRIT-150") ? 1 : 0);
          assertEquals(history.filter((h) => h.questionId === "seminar-interests").length, required.includes("GESM-120g") ? 1 : 0);
          return;
        }
        const q = body.question;
        const response = q.id === "writing-interests" ? "Film criticism" : q.id === "seminar-interests" ? "Climate justice" : q.options[0];
        history.push(answer(q.id, response, q.id === "writing-interests" ? "especially documentaries" : undefined));
      }
      throw new Error("course-aware interview exceeded its budget");
    });
  }
}

Deno.test("AI cannot skip course interests or finish early even after free text", async () => {
  const required = ["WRIT-150", "GESM-120g"];
  const history = ["day-spread", "breaks", "max-gap"].map((id) => answer(id, "x", "I like film"));
  for (const topicId of ["done", "seminar-interests"]) {
    const model = stubModel({ "interview-question": () => ({ topicId, text: "Q?", options: ["a", "b", "c"] }) });
    const { body, source } = await runInterview(request({ required, slots: [], history }), { model, courses: stubCourses(CATALOG) });
    assertEquals(source, "fallback");
    assert(!body.done);
    assertEquals(body.question.id, "writing-interests");
    assert(body.question.text.includes("writing about in WRIT-150"));
  }
});

Deno.test("seminar interests feed the existing slot shortlist context separately from generic interests", async () => {
  const req = request({
    required: ["WRIT-150", "GESM-120g"],
    slots: [{ label: "General Education Seminar course", kind: "GE", geCategory: "GESM" }, { label: "Elective", kind: "elective" }],
  });
  req.history = buildPlan(req.slots, req.required).map((t) =>
    answer(t.id, t.id === "seminar-interests" ? "Climate justice" : t.id === "writing-interests" ? "Film criticism" : "Psychology")
  );
  const model = stubModel();
  const rows = [course("GESM-110g", "Literature", ["GESM"]), course("GESM-121g", "Climate justice", ["GESM"])];
  const { body } = await runInterview(req, { model, courses: stubCourses(rows) });
  assert(body.done);
  assertEquals(body.shortlists[0].options[0].courseCode, "GESM-121g");
  assert(body.preferences.notes?.includes("Film criticism"));
  const input = model.calls.find((c) => c.label === "interview-final")!.input;
  assertEquals(input.slots.map((s: { interests: string }) => s.interests), ["Climate justice", "Psychology"]);
  assertEquals(input.slots[0].candidates[0].courseCode, "GESM-121g");
});

Deno.test("both course interests and twelve slots complete within ten fallback turns", async () => {
  const req = request({ required: ["WRIT-150", "GESM-121g"], slots: slots(12) });
  const deps = { model: stubModel(), courses: stubCourses(CATALOG) };
  for (let turn = 0; turn <= MAX_QUESTIONS; turn++) {
    const { body } = await runInterview(req, deps);
    if (body.done) {
      assertEquals(req.history.length, MAX_QUESTIONS);
      assertEquals(body.shortlists.length, 12);
      assert(body.preferences.notes?.includes("WRIT-150"));
      assert(body.preferences.notes?.includes("GESM"));
      return;
    }
    req.history.push(answer(body.question.id, body.question.options[0]));
  }
  throw new Error("interview exceeded its budget");
});

Deno.test("model drift into setup questions falls back even with a valid topic id", async () => {
  const redundant = [
    { text: "Which day would you like off?", options: ["Friday", "Monday", "No preference"] },
    { text: "What times are you available?", options: ["Morning", "Afternoon", "Evening"] },
    { text: "When should classes start?", options: ["9am", "10am", "Noon"] },
    { text: "What is your unit cap?", options: ["16 units", "18 units", "20 units"] },
    { text: "What professor rating do you prefer?", options: ["3", "4", "5"] },
    { text: "What do you prefer?", options: ["Keep Fridays free", "Higher ratings", "18 credits"] },
  ];
  for (const output of redundant) {
    const model = stubModel({ "interview-question": () => ({ topicId: "day-spread", ...output }) });
    const { body, source } = await runInterview(request(), { model, courses: stubCourses(CATALOG) });
    assertEquals(source, "fallback");
    assert(!body.done);
    assert(!questionRepeatsSetup(body.question.text, body.question.options));
  }
});

Deno.test("fallback plans ask new preferences only and finish without padding to ten", async () => {
  for (const required of [[], ["WRIT-150", "GESM-120g"]]) {
    const req = request({ required, slots: [] });
    const plan = buildPlan(req.slots, req.required);
    assertEquals(plan.slice(0, 3).map((t) => t.id), ["day-spread", "breaks", "max-gap"]);
    for (let turn = 0; turn < MAX_QUESTIONS; turn++) {
      const { body } = await runInterview(req, { model: stubModel(), courses: stubCourses(CATALOG) });
      if (body.done) {
        assertEquals(req.history.length, required.length ? 5 : 3);
        break;
      }
      assert(!questionRepeatsSetup(body.question.text, body.question.options));
      req.history.push(answer(body.question.id, body.question.options[0]));
    }
    assertEquals(req.history.length, plan.length);
  }
});
