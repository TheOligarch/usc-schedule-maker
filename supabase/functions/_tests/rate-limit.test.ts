import { assert, assertEquals, assertMatch, assertRejects } from "jsr:@std/assert@1";
import { z } from "../_shared/deps.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { runInterview } from "../_shared/interview.ts";
import {
  Bucket,
  bucketsFor,
  callWeight,
  CHARS_PER_UNIT,
  clientIp,
  CounterStore,
  createPostgrestStore,
  DAY,
  Decision,
  DEFAULT_PER_USER,
  Endpoint,
  guardModel,
  hashIp,
  HOUR,
  INSTALL_ID_HEADER,
  installIdFrom,
  loadRateLimitConfig,
  RateLimitConfig,
  waitPhrase,
} from "../_shared/rate-limit.ts";
import { course, request, stubCourses, stubModel } from "./helpers.ts";

const ID = "3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b";
const IP = "203.0.113.7";
const SALT = "test-salt";

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const config = (overrides: Partial<RateLimitConfig> = {}): RateLimitConfig => ({ ...loadRateLimitConfig(env({ RATE_LIMIT_IP_SALT: SALT })), ...overrides });

function req(headers: Record<string, string> = { [INSTALL_ID_HEADER]: ID, "x-forwarded-for": IP }): Request {
  return new Request("http://local/fn", { method: "POST", headers });
}

/** In-memory twin of ai_rate_limit_take: all-or-nothing counting, the latest-freeing denial wins. */
function memoryStore(): CounterStore & { hits: Map<string, number>; calls: { buckets: Bucket[]; weight: number }[] } {
  const hits = new Map<string, number>();
  const calls: { buckets: Bucket[]; weight: number }[] = [];
  return {
    hits,
    calls,
    take(buckets, weight) {
      calls.push({ buckets, weight });
      let denied: Decision | null = null;
      for (const b of buckets) {
        if ((hits.get(b.key) ?? 0) + weight > b.limit) {
          const retryAfter = b.window; // windows start "now" in this twin
          if (!denied || denied.allowed || retryAfter >= denied.retryAfter) denied = { allowed: false, scope: b.scope, retryAfter };
        }
      }
      if (denied) return Promise.resolve(denied);
      for (const b of buckets) hits.set(b.key, (hits.get(b.key) ?? 0) + weight);
      return Promise.resolve({ allowed: true });
    },
  };
}

const Out = z.object({ ok: z.boolean() });

/** An endpoint shaped like the real ones: one model call of `promptChars`, a fallback on any model error. */
const handler = (store: CounterStore | null, cfg = config(), endpoint: Endpoint = "interview", promptChars = 10) =>
  serve("POST", async (r) => {
    const inner = stubModel({ t: () => ({ ok: true }) });
    const guard = guardModel(r, endpoint, inner, { config: cfg, store });
    const user = JSON.stringify("x".repeat(Math.max(0, promptChars - 2)));
    const out = await guard.model.generate({ label: "t", system: "", user, schema: Out, maxTokens: 10 }).catch(() => ({ ok: false }));
    guard.assertAllowed();
    return json({ out, modelCalls: inner.calls.length });
  });

Deno.test("config defaults to the documented budgets and reads overrides from secrets", () => {
  const d = loadRateLimitConfig(env({}));
  assertEquals(d.enabled, true);
  assertEquals(d.perUser, DEFAULT_PER_USER);
  assertEquals(d.perUser.interview, { hour: 600, day: 1800 });
  assertEquals(d.ipMultiplier, 30);
  assertEquals(d.globalDay, 100000);
  assertEquals(d.ipSalt, null);

  const c = loadRateLimitConfig(env({
    RATE_LIMIT_INTERVIEW_HOUR: "5",
    RATE_LIMIT_AI_HEALTH_DAY: "2",
    RATE_LIMIT_GLOBAL_DAY: "100",
    RATE_LIMIT_IP_MULTIPLIER: "4",
    RATE_LIMIT_IP_HEADER: "X-Real-IP",
    RATE_LIMIT_EXPLAIN_DAY: "lots", // invalid: falls back to the default
    RATE_LIMIT_REFINE_HOUR: "-3",
  }));
  assertEquals(c.perUser.interview, { hour: 5, day: 1800 });
  assertEquals(c.perUser["ai-health"].day, 2);
  assertEquals(c.perUser.explain.day, DEFAULT_PER_USER.explain.day);
  assertEquals(c.perUser.refine.hour, DEFAULT_PER_USER.refine.hour);
  assertEquals(c.globalDay, 100);
  assertEquals(c.ipMultiplier, 4);
  assertEquals(c.ipHeaders, ["x-real-ip"]);
  for (const off of ["false", "off", "0", "OFF"]) assertEquals(loadRateLimitConfig(env({ RATE_LIMIT_ENABLED: off })).enabled, false);
});

Deno.test("install IDs must be UUIDs; client IP comes from the first configured header", () => {
  assertEquals(installIdFrom(req({ [INSTALL_ID_HEADER]: ID.toUpperCase() })), ID);
  assertEquals(installIdFrom(req({ [INSTALL_ID_HEADER]: "me@example.com" })), null);
  assertEquals(installIdFrom(req({})), null);
  assertEquals(clientIp(req({ "x-forwarded-for": `${IP}, 10.0.0.1` })), IP);
  assertEquals(clientIp(req({ "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": IP })), "198.51.100.1");
  assertEquals(clientIp(req({ "x-forwarded-for": IP }), ["x-real-ip"]), null);
});

Deno.test("buckets never contain the raw IP, only a salted hash", async () => {
  const buckets = await bucketsFor(req(), "interview", config());
  const hash = await hashIp(IP, SALT);
  assertMatch(hash, /^[0-9a-f]{32}$/);
  assert(hash !== (await hashIp(IP, "other-salt")), "the salt changes the hash");
  assertEquals(buckets.map((b) => [b.scope, b.window, b.limit]), [
    ["user", HOUR, 600],
    ["user", DAY, 1800],
    ["network", HOUR, 600 * 30],
    ["network", DAY, 1800 * 30],
    ["global", DAY, 100000],
  ]);
  assert(buckets[0].key.includes(ID));
  assert(buckets[2].key.includes(hash));
  for (const b of buckets) assert(!b.key.includes(IP), b.key);
});

Deno.test("without an install ID the hashed network stands in for the user; without a salt no IP bucket exists", async () => {
  const noId = await bucketsFor(req({ "x-forwarded-for": IP }), "refine", config());
  assertEquals(noId[0].key, `user:refine:ip-${await hashIp(IP, SALT)}:h`);
  assertEquals(noId[0].limit, DEFAULT_PER_USER.refine.hour);

  const noSalt = await bucketsFor(req(), "refine", config({ ipSalt: null }));
  assertEquals(noSalt.map((b) => b.scope), ["user", "user", "global"]);
  const nothing = await bucketsFor(req({ "x-forwarded-for": IP }), "refine", config({ ipSalt: null }));
  assertEquals(nothing.map((b) => b.scope), ["global"]);
});

Deno.test("a user is cut off at the hourly budget with a 429, Retry-After and a renderable body", async () => {
  const store = memoryStore();
  const fn = handler(store, config({ perUser: { ...DEFAULT_PER_USER, interview: { hour: 3, day: 10 } } }));
  for (let i = 0; i < 3; i++) assertEquals((await fn(req())).status, 200);
  const res = await fn(req());
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), String(HOUR));
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assert(res.headers.get("access-control-expose-headers")!.includes("retry-after"));
  const body = await res.json();
  assertEquals(body.error.code, "rate_limited");
  assertEquals(body.error.details, { scope: "user", retryAfterSeconds: HOUR });
  assertMatch(body.error.message, /Try again in 60 minutes\. Building and ranking schedules still works/);
  // Another install on the same network is unaffected.
  assertEquals((await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": IP }))).status, 200);
});

Deno.test("rotating install IDs from one IP hits the network backstop", async () => {
  const store = memoryStore();
  const fn = handler(store, config({ ipMultiplier: 2, perUser: { ...DEFAULT_PER_USER, explain: { hour: 2, day: 50 } } }), "explain");
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": IP }))).status);
  assertEquals(statuses, [200, 200, 200, 200, 429, 429]);
  const res = await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": IP }));
  assertEquals((await res.json()).error.details.scope, "network");
  // A different network still gets through.
  assertEquals((await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": "198.51.100.9" }))).status, 200);
});

Deno.test("the global breaker answers with its own message and the longer wait", async () => {
  const store = memoryStore();
  const fn = handler(store, config({ globalDay: 2 }));
  assertEquals((await fn(req())).status, 200);
  assertEquals((await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": "198.51.100.2" }))).status, 200);
  const res = await fn(req({ [INSTALL_ID_HEADER]: crypto.randomUUID(), "x-forwarded-for": "198.51.100.3" }));
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), String(DAY));
  const body = await res.json();
  assertEquals(body.error.details.scope, "global");
  assertMatch(body.error.message, /taking a break after a very busy day\. Try again in 24 hours/);
});

Deno.test("a denied request is not counted, so retrying while blocked does not extend the wait", async () => {
  const store = memoryStore();
  const fn = handler(store, config({ perUser: { ...DEFAULT_PER_USER, interview: { hour: 1, day: 10 } } }));
  await fn(req());
  for (let i = 0; i < 5; i++) assertEquals((await fn(req())).status, 429);
  assertEquals(store.hits.get(`user:interview:${ID}:d`), 1);
  assertEquals(store.hits.get("global:all:d"), 1);
});

Deno.test("limiter storage failures let the request through", async () => {
  const broken: CounterStore = { take: () => Promise.reject(new Error("connection refused")) };
  assertEquals((await handler(broken)(req())).status, 200);
  assertEquals((await handler(null)(req())).status, 200, "no service key: allowed");
  const failingFetch = (() => Promise.resolve(new Response('{"code":"PGRST202"}', { status: 404 }))) as typeof fetch;
  assertEquals((await handler(createPostgrestStore({ url: "http://db", key: "k" }, failingFetch))(req())).status, 200);
  const throwingFetch = (() => Promise.reject(new TypeError("network down"))) as typeof fetch;
  assertEquals((await handler(createPostgrestStore({ url: "http://db", key: "k" }, throwingFetch))(req())).status, 200);
  const weird = (() => Promise.resolve(new Response('"ok"'))) as typeof fetch;
  assertEquals((await handler(createPostgrestStore({ url: "http://db", key: "k" }, weird))(req())).status, 200);
});

Deno.test("each model call is charged by prompt size, about 1,000 tokens per unit", async () => {
  assertEquals(CHARS_PER_UNIT, 4000);
  assertEquals([0, 1, 4000, 4001, 525_000].map(callWeight), [1, 1, 1, 2, 132]);
  const store = memoryStore();
  const cfg = config({ perUser: { ...DEFAULT_PER_USER, explain: { hour: 10, day: 100 } } });
  const small = await handler(store, cfg, "explain", 100)(req());
  assertEquals((await small.json()).modelCalls, 1);
  assertEquals(store.calls.at(-1)!.weight, 1);
  // A 30,000-character prompt costs 8 units: 1 + 8 = 9 fits the hourly 10, the next one does not.
  assertEquals((await handler(store, cfg, "explain", 30_000)(req())).status, 200);
  assertEquals(store.hits.get(`user:explain:${ID}:h`), 9);
  const big = await handler(store, cfg, "explain", 30_000)(req());
  assertEquals(big.status, 429);
  assertEquals((await big.json()).error.details.scope, "user");
  // ...while a 1-unit call still fits the one unit left.
  assertEquals((await handler(store, cfg, "explain", 100)(req())).status, 200);
});

Deno.test("a denied call is never made, and the endpoint's fallback answer is replaced by the 429", async () => {
  const store = memoryStore();
  const cfg = config({ perUser: { ...DEFAULT_PER_USER, refine: { hour: 1, day: 10 } } });
  const res = await handler(store, cfg, "refine", 8000)(req()); // 2 units > 1
  assertEquals(res.status, 429);
  assertEquals(store.hits.size, 0, "nothing charged");
  // The inner model saw no call: check through a guard directly.
  const inner = stubModel({ t: () => ({ ok: true }) });
  const guard = guardModel(req(), "refine", inner, { config: cfg, store });
  await assertRejects(() => guard.model.generate({ label: "t", system: "s".repeat(8000), user: "{}", schema: Out, maxTokens: 10 }));
  await assertRejects(
    () => guard.model.generate({ label: "t", system: "", user: "{}", schema: Out, maxTokens: 10 }),
    Error,
    "",
    "later calls in a denied request fail fast",
  );
  assertEquals(inner.calls.length, 0);
  const thrown = (() => {
    try {
      guard.assertAllowed();
    } catch (e) {
      return e;
    }
  })();
  assert(thrown instanceof HttpError && thrown.status === 429);
});

Deno.test("a cheap anonymous interview request that builds a huge prompt is charged for the prompt, not the request", async () => {
  const cats = Array.from({ length: 12 }, (_, i) => `GE${String.fromCharCode(65 + i)}`);
  const rows = cats.flatMap((c) =>
    Array.from({ length: 150 }, (_, i) => course(`${c}-${100 + i}`, `Course ${i} on a long and winding topic`, [c], "d".repeat(400)))
  );
  const body = request({
    slots: cats.map((c) => ({ label: c, kind: "GE" as const, geCategory: c })),
    history: Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i}`, question: "q", answer: "a" })),
  });
  assert(JSON.stringify(body).length < 2000, "the request itself is small");
  const store = memoryStore();
  const guard = guardModel(req(), "interview", stubModel({}), { config: config(), store });
  await runInterview(body, { model: guard.model, courses: stubCourses(rows) });
  guard.assertAllowed();
  const charged = store.calls.reduce((sum, c) => sum + c.weight, 0);
  assert(charged >= 100, `charged ${charged} units`);
  // Five such requests use up an hour's interview budget for this install.
  const tight = memoryStore();
  let status = 200;
  for (let i = 0; i < 6 && status === 200; i++) {
    const g = guardModel(req(), "interview", stubModel({}), { config: config(), store: tight });
    await runInterview(body, { model: g.model, courses: stubCourses(rows) });
    try {
      g.assertAllowed();
    } catch (e) {
      status = (e as HttpError).status;
    }
  }
  assertEquals(status, 429);
});

Deno.test("ai-health pings are charged one unit", async () => {
  const store = memoryStore();
  const guard = guardModel(req(), "ai-health", stubModel({ ping: () => null }), { config: config(), store });
  await guard.model.ping();
  assertEquals(store.calls.map((c) => c.weight), [1]);
  assertEquals(store.calls[0].buckets[0].key, `user:ai-health:${ID}:h`);
});

Deno.test("a disabled limiter never touches the store", async () => {
  const store = memoryStore();
  assertEquals((await handler(store, config({ enabled: false, globalDay: 0 }))(req())).status, 200);
  assertEquals(store.calls.length, 0);
});

Deno.test("the PostgREST store calls the RPC with the service key and maps its answer", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const answers = [{ allowed: true }, { allowed: false, scope: "global", retryAfter: 120.4 }, { allowed: false, scope: "weird" }];
  const fetchFn = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(Response.json(answers[seen.length - 1]));
  }) as unknown as typeof fetch;
  const store = createPostgrestStore({ url: "https://p.supabase.co/", key: "service-key" }, fetchFn);
  const buckets: Bucket[] = [{ key: "global:all:d", window: DAY, limit: 5, scope: "global" }];
  assertEquals(await store.take(buckets, 3), { allowed: true });
  assertEquals(await store.take(buckets, 1), { allowed: false, scope: "global", retryAfter: 121 });
  assertEquals(await store.take(buckets, 1), { allowed: false, scope: "user", retryAfter: 60 });
  assertEquals(seen[0].url, "https://p.supabase.co/rest/v1/rpc/ai_rate_limit_take");
  const headers = seen[0].init.headers as Record<string, string>;
  assertEquals(headers.apikey, "service-key");
  assertEquals(headers.Authorization, "Bearer service-key");
  assertEquals(JSON.parse(seen[0].init.body as string), { p_buckets: buckets, p_weight: 3 });
  await assertRejects(() =>
    createPostgrestStore({ url: "http://db", key: "k" }, (() => Promise.resolve(new Response("", { status: 500 }))) as typeof fetch).take(buckets, 1)
  );
});

Deno.test("wait phrases round up to minutes, then hours", () => {
  assertEquals(waitPhrase(5), "in a minute");
  assertEquals(waitPhrase(61), "in 2 minutes");
  assertEquals(waitPhrase(3600), "in 60 minutes");
  assertEquals(waitPhrase(5400), "in 2 hours");
  assertEquals(waitPhrase(DAY), "in 24 hours");
});

Deno.test("HttpError headers reach the response", async () => {
  const fn = serve("POST", () => Promise.reject(new HttpError(429, "rate_limited", "wait", undefined, { "Retry-After": "7" })));
  const res = await fn(req());
  assertEquals(res.headers.get("retry-after"), "7");
  assert(res.headers.get("access-control-allow-headers")!.includes(INSTALL_ID_HEADER));
});
