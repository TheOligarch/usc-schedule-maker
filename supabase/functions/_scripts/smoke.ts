// Exercises the three deployed functions the way the extension will.
//   USM_ANON_KEY=<anon key> deno task smoke
// Optional: USM_FUNCTIONS_URL (defaults to the project's functions URL), USM_TERM (default 20271).
// Walks a whole interview by always tapping the first quick reply, then asks for explanations.

const BASE = (Deno.env.get("USM_FUNCTIONS_URL") ?? "https://mmdvgvpckweiklkbuxvy.supabase.co/functions/v1").replace(/\/+$/, "");
const KEY = Deno.env.get("USM_ANON_KEY");
const TERM = Deno.env.get("USM_TERM") ?? "20271";
if (!KEY) {
  console.error("Set USM_ANON_KEY to the project's anon key.");
  Deno.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; source: string | null; body: any; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY!, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch { /* keep the raw text */ }
  return { status: res.status, source: res.headers.get("x-usm-ai-source"), body, ms: Math.round(performance.now() - started) };
}
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

// ---- ai-health ----
const health = await call("ai-health");
console.log("ai-health:", JSON.stringify(health.body));
check("ai-health responds", health.status === 200);
check("ai-health keyPresent", health.body.keyPresent === true);
check("ai-health modelOk", health.body.modelOk === true, health.body.error ?? health.body.model);

// ---- CORS ----
const preflight = await fetch(`${BASE}/interview`, {
  method: "OPTIONS",
  headers: {
    Origin: "chrome-extension://smoke",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,apikey,content-type",
  },
});
await preflight.body?.cancel();
check("preflight allows any origin", preflight.headers.get("access-control-allow-origin") === "*", `status ${preflight.status}`);

// ---- interview ----
const interview = {
  termCode: TERM,
  required: ["CSCI-201", "MATH-225"],
  slots: [
    { label: "GE-A: The Arts", kind: "GE", geCategory: Deno.env.get("USM_GE_CATEGORY") ?? "GEA" },
    { label: "Free elective", kind: "elective" },
  ],
  hardHours: { earliestStart: "08:00", latestEnd: "19:00" },
  history: [] as { questionId: string; question: string; answer: string; freeText?: string }[],
};
let finished: any = null;
for (let turn = 0; turn <= 10 && !finished; turn++) {
  const res = await post("interview", interview);
  if (res.status !== 200) {
    check(`interview turn ${turn + 1}`, false, `${res.status} ${JSON.stringify(res.body)}`);
    break;
  }
  if (res.body.done) {
    finished = res.body;
    console.log(`interview done after ${turn} questions [${res.source}, ${res.ms} ms]`);
    break;
  }
  const q = res.body.question;
  console.log(`Q${turn + 1} [${res.source}, ${res.ms} ms] ${q.id}: ${q.text}\n     ${q.options.join(" | ")}`);
  check(`question ${turn + 1} has 3-5 options and free text`, q.options.length >= 3 && q.options.length <= 5 && q.allowFreeText === true);
  interview.history.push({
    questionId: q.id,
    question: q.text,
    answer: q.options[0],
    ...(turn === 0 ? { freeText: "I work Friday afternoons, so Fridays off would be ideal." } : {}),
  });
}
check("interview finishes within 10 questions", Boolean(finished));
if (finished) {
  console.log(JSON.stringify(finished, null, 2));
  check("preferences present", typeof finished.preferences?.daySpread === "string");
  check("one shortlist per slot, in order", finished.shortlists?.length === 2 && finished.shortlists[0].label === interview.slots[0].label);
  check("shortlists have at most 5 options", finished.shortlists.every((s: any) => s.options.length <= 5));
  check("summary has bullets", Array.isArray(finished.summary) && finished.summary.length > 0);
}

const invalid = await post("interview", { termCode: TERM });
check("interview rejects a bad body with 400", invalid.status === 400 && invalid.body.error?.code === "invalid_request");

// ---- explain ----
const preferences = finished?.preferences ??
  { daySpread: "compact", breaks: "avoid", maxGapMinutes: 60, preferredDaysOff: ["Fri"], comfortStart: "10:00", comfortEnd: "17:00", notes: null };
const schedules = [
  {
    id: "sched-a",
    units: 16,
    score: 92.5,
    courses: [{ courseCode: "CSCI-201", sectionIds: ["30381", "30382"] }, { courseCode: "MATH-225", sectionIds: ["39600"] }],
    penalties: [{ kind: "noRmp", sectionId: "39600", amount: 1.5, message: "MATH-225 lecture instructor has no RateMyProfessors rating." }],
    warnings: [],
    display:
      "Mon/Wed 10:00-11:50 CSCI-201 LEC; Mon/Wed 12:00-13:50 MATH-225 LEC; Tue 10:00-11:50 CSCI-201 LAB. Days on campus: Mon, Tue, Wed. Longest gap: 10 min.",
  },
  {
    id: "sched-b",
    units: 16,
    score: 61,
    courses: [{ courseCode: "CSCI-201", sectionIds: ["30390", "30391"] }, { courseCode: "MATH-225", sectionIds: ["39610"] }],
    penalties: [
      { kind: "full", sectionId: "30390", amount: 25, message: "CSCI-201 lecture 30390 is full (120/120)." },
      { kind: "preference", amount: 6.5, message: "Classes on Friday, which you wanted free." },
    ],
    warnings: ["CSCI-201: prerequisite CSCI-104."],
    display:
      "Tue/Thu 08:00-09:50 CSCI-201 LEC; Tue/Thu 14:00-15:50 MATH-225 LEC; Fri 09:00-10:50 CSCI-201 LAB. Days on campus: Tue, Thu, Fri. Longest gap: 4 h 10 min.",
  },
];
const explain = await post("explain", { preferences, schedules });
console.log(`explain [${explain.source}, ${explain.ms} ms]:`, JSON.stringify(explain.body, null, 2));
check(
  "explain returns one text per schedule, in order",
  explain.status === 200 && explain.body.explanations?.map((e: any) => e.id).join() === "sched-a,sched-b",
);
check("explain texts are non-empty", explain.body.explanations?.every((e: any) => e.text.length > 20) === true);
const tooMany = await post("explain", { preferences, schedules: Array(11).fill(schedules[0]) });
check("explain rejects more than 10 schedules", tooMany.status === 400);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
Deno.exit(failures ? 1 : 0);
