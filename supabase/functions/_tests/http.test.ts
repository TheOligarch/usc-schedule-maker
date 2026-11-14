import { assert, assertEquals } from "jsr:@std/assert@1";
import { cleanKeyword, createCourseSource, normalizeTerms } from "../_shared/courses.ts";
import { runHealth } from "../_shared/health.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { ModelError, redact } from "../_shared/model.ts";
import { ExplainRequestSchema, InterviewRequestSchema } from "../_shared/types.ts";
import { request, stubModel } from "./helpers.ts";

const post = (body: unknown) => new Request("http://local/fn", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const echo = serve("POST", async (req) => json(await readJson(req, InterviewRequestSchema)));

Deno.test("preflight is answered with open CORS headers", async () => {
  const res = await echo(new Request("http://local/fn", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assert(res.headers.get("access-control-allow-headers")!.includes("apikey"));
});

Deno.test("wrong method, bad JSON and bad shapes get clear JSON errors with CORS", async () => {
  const cases: [Request, number, string][] = [
    [new Request("http://local/fn"), 405, "method_not_allowed"],
    [post("{not json"), 400, "invalid_json"],
    [post({ termCode: "20271" }), 400, "invalid_request"],
    [post(request({ history: Array.from({ length: 11 }, () => ({ questionId: "q", question: "?", answer: "a" })) })), 400, "invalid_request"],
    [post(request({ termCode: "spring 2027!" })), 400, "invalid_request"],
    [post("x".repeat(300 * 1024)), 413, "payload_too_large"],
  ];
  for (const [req, status, code] of cases) {
    const res = await echo(req);
    assertEquals(res.status, status);
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    assertEquals((await res.json()).error.code, code);
  }
});

Deno.test("validation errors name the failing field", async () => {
  const res = await echo(post(request({ slots: [{ label: "", kind: "GE" }] })));
  const { error } = await res.json();
  assertEquals(error.details[0].path, "slots.0.label");
});

Deno.test("explain accepts at most ten schedules", () => {
  const s = { id: "s", units: 16, score: 1, courses: [], penalties: [], warnings: [], display: "" };
  const preferences = { daySpread: "neutral", breaks: "neutral", maxGapMinutes: null, preferredDaysOff: [], comfortStart: null, comfortEnd: null, notes: null };
  assert(ExplainRequestSchema.safeParse({ preferences, schedules: Array(10).fill(s) }).success);
  assert(!ExplainRequestSchema.safeParse({ preferences, schedules: Array(11).fill(s) }).success);
  assert(!ExplainRequestSchema.safeParse({ preferences: { ...preferences, comfortStart: "9am" }, schedules: [s] }).success);
});

Deno.test("unexpected errors become a bare 500 that leaks nothing", async () => {
  const boom = serve("POST", () => Promise.reject(new Error("secret sk-ant-api03-abc123 exploded")));
  const res = await boom(post({}));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: { code: "internal_error", message: "Unexpected server error" } });
  const known = serve("POST", () => Promise.reject(new HttpError(418, "teapot", "short and stout")));
  assertEquals((await known(post({}))).status, 418);
});

Deno.test("health reports a missing key without calling the model, and a failing model with its error", async () => {
  assertEquals(await runHealth(stubModel({}, false)), {
    keyPresent: false,
    model: "stub-model",
    modelOk: false,
    error: "missing_key: ANTHROPIC_API_KEY is not set",
  });
  assertEquals(await runHealth(stubModel({ ping: () => null })), { keyPresent: true, model: "stub-model", modelOk: true });
  const failing = { ...stubModel(), ping: () => Promise.reject(new ModelError("not_found_error", "model: nope was not found", 404)) };
  assertEquals((await runHealth(failing)).error, "not_found_error (404): model: nope was not found");
});

Deno.test("redact strips the configured key and anything key-shaped", () => {
  assertEquals(redact("bad key my-secret-value here", "my-secret-value"), "bad key [redacted] here");
  assertEquals(redact("x-api-key sk-ant-api03-AbC_123-xyz rejected"), "x-api-key [redacted] rejected");
});

Deno.test("search terms are made safe for PostgREST filters", () => {
  assertEquals(cleanKeyword(' Film*,(noir)"% '), "film noir");
  assertEquals(normalizeTerms({ keywords: ["AI", "Machine Learning", "machine learning"], departments: ["csci", "x", "CTCS-190"] }), {
    keywords: ["machine learning"],
    departments: ["CSCI", "CTCS"],
  });
});

Deno.test("course source builds the expected queries and recognises a missing table", async () => {
  const urls: string[] = [];
  const fakeFetch = ((input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.search);
    if (url.searchParams.get("term_code") === "eq.missing") {
      return Promise.resolve(Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 }));
    }
    return Promise.resolve(Response.json([{ code: "CTCS-190", title: "Introduction to Cinema", description: null, ge: null, units_min: 4, units_max: 4 }]));
  }) as typeof fetch;
  const source = createCourseSource({ url: "http://db", key: "anon" }, fakeFetch);

  assertEquals(await source.status("missing"), "missing");
  assertEquals(await source.status("20271"), "ok");
  assertEquals((await source.byGe("20271", "GEA", 50))[0].ge, []);
  await source.search("20271", { keywords: ["film"], departments: ["CTCS"] }, { geOnly: true, limit: 10 });

  const ge = new URLSearchParams(urls[2]);
  assertEquals(ge.get("ge"), "cs.{GEA}");
  const search = new URLSearchParams(urls[3]);
  assertEquals(search.get("or"), '(title.ilike."*film*",description.ilike."*film*",code.ilike."CTCS-*")');
  assertEquals(search.get("ge"), "neq.{}");
  assertEquals(await createCourseSource(null).status("20271"), "error");
});
