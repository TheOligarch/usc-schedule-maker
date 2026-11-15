// @vitest-environment jsdom
// The AI functions' rate limits: install ID header, HTTP 429 handling, and the wait message on
// every screen that calls the AI, while local schedule generation keeps working.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", async (orig) => ({ ...(await orig<typeof import("../lib/config")>()), USE_MOCKS: false, SUPABASE_ANON_KEY: "test-anon" }));
vi.mock("../lib/engine", async () => {
  const { generateSchedulesAsync } = await import("../../../engine/src/index");
  return { generateSchedules: vi.fn(async (data, req, opts) => ({ result: await generateSchedulesAsync(data, req, opts), isMock: false, truncated: false, elapsedMs: 1 })) };
});

const { aiHealth, explainSchedules, interpretFeedback, interviewTurn, INSTALL_ID_HEADER, resetAiPauses } = await import("../lib/ai");
const { AiRateLimitError } = await import("../lib/aiErrors");
const { getInstallId, resetInstallIdCache } = await import("../lib/installId");
const { interpretRefinement } = await import("../lib/refinement");
const { Interview } = await import("../screens/Interview");
const { Results } = await import("../screens/Results");
const { defaultState, DEFAULT_PREFERENCES } = await import("../state");
const { SAMPLE_TERM } = await import("../mocks/sampleTerm");
const { liveTerm } = await import("./fixtures/liveTerm");
type AppState = import("../state").AppState;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function limited(scope: string, retryAfterSeconds: number, header = String(retryAfterSeconds)) {
  return new Response(JSON.stringify({ error: { code: "rate_limited", message: "server copy", details: { scope, retryAfterSeconds } } }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": header },
  });
}

/** A chrome.storage.local stand-in. */
function stubChromeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const local = {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, items)),
  };
  vi.stubGlobal("chrome", { storage: { local } });
  return { data, local };
}

const explainReq = { preferences: DEFAULT_PREFERENCES, schedules: [{ id: "a" } as never] };
const refineReq = { text: "something odd", courses: [], schedule: null };

beforeEach(() => {
  resetAiPauses();
  resetInstallIdCache();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("install ID", () => {
  it("is generated once, persisted in chrome.storage.local and sent with every AI call", async () => {
    const { data, local } = stubChromeStorage();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ explanations: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await explainSchedules(explainReq);
    await explainSchedules(explainReq);
    const id = data.usmInstallId as string;
    expect(id).toMatch(UUID_RE);
    expect(local.set).toHaveBeenCalledTimes(1);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)[INSTALL_ID_HEADER]).toBe(id);
    }
    // A later session (fresh module cache) reuses the stored ID.
    resetInstallIdCache();
    expect(await getInstallId()).toBe(id);
    expect(local.set).toHaveBeenCalledTimes(1);
  });

  it("falls back to localStorage outside the extension", async () => {
    const id = await getInstallId();
    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem("usmInstallId")).toBe(id);
    resetInstallIdCache();
    expect(await getInstallId()).toBe(id);
  });
});

describe("HTTP 429", () => {
  it("becomes a friendly per-user wait message and pauses that function locally", async () => {
    const fetchMock = vi.fn(async () => limited("user", 720));
    vi.stubGlobal("fetch", fetchMock);
    const err = await explainSchedules(explainReq).catch((e) => e);
    expect(err).toBeInstanceOf(AiRateLimitError);
    expect(err.scope).toBe("user");
    expect(err.message).toBe("You've used the AI assistant a lot in a short time. Try again in 12 minutes. Building and ranking schedules still works without it.");
    // The next explain call fails fast without hitting the network; other functions still go out.
    await expect(explainSchedules(explainReq)).rejects.toBeInstanceOf(AiRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ constraints: [], unparsed: null }), { headers: { "x-usm-ai-source": "ai" } }));
    await interpretFeedback(refineReq);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the global breaker has its own message and pauses every AI function", async () => {
    const fetchMock = vi.fn(async () => limited("global", 5 * 3600));
    vi.stubGlobal("fetch", fetchMock);
    const err = await interpretFeedback(refineReq).catch((e) => e);
    expect(err).toBeInstanceOf(AiRateLimitError);
    expect(err.scope).toBe("global");
    expect(err.message).toMatch(/^The AI assistant is taking a break after a very busy day\. Try again in 5 hours\./);
    await expect(explainSchedules(explainReq)).rejects.toBeInstanceOf(AiRateLimitError);
    await expect(aiHealth()).rejects.toBeInstanceOf(AiRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the Retry-After header when the body has no details, and asks again once the wait is over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetchMock = vi.fn(async () => new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "90" } }));
      vi.stubGlobal("fetch", fetchMock);
      const err = await explainSchedules(explainReq).catch((e) => e);
      expect(err.scope).toBe("user");
      expect(err.message).toContain("Try again in 2 minutes");
      vi.setSystemTime(Date.now() + 91_000);
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ explanations: [] })));
      await expect(explainSchedules(explainReq)).resolves.toEqual({ explanations: [] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("network-scope limits read as a network message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => limited("network", 30)));
    const err = await interviewTurn({ termCode: "20271", required: [], slots: [], history: [] }, SAMPLE_TERM).catch((e) => e);
    expect(err.message).toMatch(/^The AI assistant is getting a lot of requests from your network\. Try again in a minute\./);
  });
});

describe("screens while the AI is paused", () => {
  let root: Root, container: HTMLDivElement, current: AppState;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));

  it("the interview shows the wait message and the offline interview still runs locally", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => limited("user", 600)));
    function Harness() {
      const [state, setState] = useState<AppState>({ ...defaultState(), step: "interview", slots: [{ id: "s1", label: "Elective", kind: "elective" }] } as AppState);
      current = state;
      return <Interview data={SAMPLE_TERM} sampleData={false} state={state} onChange={(p) => setState((s) => ({ ...s, ...p }))} onBack={() => {}} onNext={() => {}} />;
    }
    await act(async () => root.render(<Harness />));
    await settle();
    const notice = container.querySelector(".notice-warn");
    expect(notice?.textContent).toContain("Try again in 10 minutes. Building and ranking schedules still works without it.");
    expect(container.querySelector(".notice-error")).toBeNull();
    const offline = button("Use offline interview")!;
    expect(offline.className).toContain("btn-primary");
    await act(async () => offline.click());
    await settle(700);
    expect(container.querySelector(".notice-warn")).toBeNull();
    expect(container.querySelector(".bubble-ai")?.textContent).toBeTruthy();
    expect(current.history).toEqual([]);
  });

  it("results still generate and rank schedules; the explanation box shows the wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => limited("global", 3 * 3600)));
    const data = liveTerm();
    const state: AppState = { ...defaultState(), step: "results", required: ["BISC-120"], interview: { preferences: DEFAULT_PREFERENCES, shortlists: [], summary: [] } };
    await act(async () => root.render(<Results data={data} state={state} onChange={() => {}} onEdit={() => {}} binTransport={null} />));
    await settle(300);
    expect(container.querySelectorAll("button.sched-item").length).toBeGreaterThan(0);
    const explain = container.querySelector(".explain")!;
    expect(explain.textContent).toContain("The AI assistant is taking a break after a very busy day. Try again in 3 hours.");
    expect(explain.textContent).not.toContain("Explanation unavailable");
  });

  it("feedback the local parser cannot read says the AI helper is paused; readable feedback still applies", async () => {
    const pausedAi = async () => {
      throw new AiRateLimitError("user", 300);
    };
    const ctx = { data: liveTerm(), codes: ["BISC-120"], schedule: null };
    await expect(interpretRefinement("make it feel more balanced somehow", ctx, pausedAi)).rejects.toThrow(/Try again in 5 minutes\..*Try a day, time/);
    const ok = await interpretRefinement("no classes before 10am", ctx, pausedAi);
    expect(ok.constraints.length).toBeGreaterThan(0);
    expect(ok.source).toBe("parser");
  });
});
