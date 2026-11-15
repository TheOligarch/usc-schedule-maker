import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", async (orig) => ({ ...(await orig<typeof import("../lib/config")>()), USE_MOCKS: false, SUPABASE_ANON_KEY: "test-anon" }));

const { explainSchedules, interviewTurn } = await import("../lib/ai");

function respond(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("AI text never shows 24-hour times", () => {
  it("rewrites explanations from the explain function", async () => {
    respond({ explanations: [{ id: "a", text: "Allows classes on Mon after 20:00, ending by 12:00." }] });
    const res = await explainSchedules({ preferences: {} as never, schedules: [{ id: "a" } as never] });
    expect(res.explanations).toEqual([{ id: "a", text: "Allows classes on Mon after 8:00 PM, ending by 12:00 PM." }]);
  });

  it("rewrites the interview summary and notes", async () => {
    respond({
      done: true,
      preferences: { daySpread: "neutral", breaks: "neutral", maxGapMinutes: null, preferredDaysOff: [], comfortStart: null, comfortEnd: null, notes: "No classes after 21:00." },
      shortlists: [],
      summary: ["You are fine with Monday classes after 20:00.", "You like 9:30 AM starts."],
    });
    const { res } = await interviewTurn({ history: [] } as never, {} as never);
    if (!res.done) throw new Error("expected a finished interview");
    expect(res.summary).toEqual(["You are fine with Monday classes after 8:00 PM.", "You like 9:30 AM starts."]);
    expect(res.preferences.notes).toBe("No classes after 9:00 PM.");
  });
});
