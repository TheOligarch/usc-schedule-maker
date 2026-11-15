// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TermPicker } from "../components/TermPicker";
import { freshnessLine, relativeTime } from "../lib/time";

const NOW = Date.parse("2026-11-15T08:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("relative time", () => {
  it.each([
    [ago(10_000), "just now"],
    [ago(-30_000), "just now"], // a timestamp slightly ahead of this clock
    [ago(MIN), "1 minute ago"],
    [ago(5 * MIN + 59_000), "5 minutes ago"],
    [ago(HOUR), "1 hour ago"],
    [ago(3 * HOUR + 20 * MIN), "3 hours ago"],
    [ago(DAY + HOUR), "1 day ago"],
    [ago(2 * DAY), "2 days ago"],
  ])("%s -> %s", (iso, text) => expect(relativeTime(iso, NOW)).toBe(text));
  it("accepts epoch milliseconds and rejects missing or unreadable timestamps", () => {
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe("5 minutes ago");
    for (const bad of ["", "not a date", null, undefined]) expect(relativeTime(bad, NOW)).toBeNull();
  });
});

describe("the freshness line", () => {
  it("always uses the timestamp of the data in use", () => {
    expect(freshnessLine(ago(5 * MIN), { now: NOW })).toBe("Live seat counts from classes.usc.edu, updated 5 minutes ago");
    expect(freshnessLine(ago(2 * DAY), { now: NOW })).toBe("Live seat counts from classes.usc.edu, updated 2 days ago");
  });
  it("uses truthful wording when there is no timestamp or the data is the bundled sample", () => {
    expect(freshnessLine(null)).toBe("Live seat counts from classes.usc.edu; last update time unavailable");
    expect(freshnessLine("garbage")).toBe("Live seat counts from classes.usc.edu; last update time unavailable");
    expect(freshnessLine(ago(MIN), { sample: true })).toBe("Sample seat counts, not from classes.usc.edu");
  });
  it("the term picker shows it for each term", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<TermPicker terms={[{ code: "20271", name: "Spring 2027", scrapedAt: new Date(Date.now() - 3 * HOUR).toISOString() }]} termCode="20271" source="live" onTerm={() => {}} />));
    expect(el.textContent).toContain("Live seat counts from classes.usc.edu, updated 3 hours ago");
    expect(el.textContent).not.toMatch(/nightly/i);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

it("no user-facing source mentions a nightly refresh schedule", () => {
  const sources = import.meta.glob(["../**/*.{ts,tsx,css}", "!../__tests__/**", "../../public/**/*.json", "../../*.html"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  expect(Object.keys(sources).length).toBeGreaterThan(20);
  const hits = Object.entries(sources).filter(([, text]) => /nightly|every night|refreshes daily|daily snapshot/i.test(text)).map(([file]) => file);
  expect(hits).toEqual([]);
});
