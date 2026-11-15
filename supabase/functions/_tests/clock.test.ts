import { assertEquals } from "jsr:@std/assert@1";
import { fmtClock, normalizeClockTimes } from "../_shared/clock.ts";

Deno.test("fmtClock writes 12-hour times", () => {
  assertEquals(fmtClock(20 * 60), "8:00 PM");
  assertEquals(fmtClock(12 * 60), "12:00 PM");
  assertEquals(fmtClock(9 * 60 + 30), "9:30 AM");
  assertEquals(fmtClock(0), "12:00 AM");
  assertEquals(fmtClock(24 * 60), "12:00 AM");
});

Deno.test("normalizeClockTimes rewrites 24-hour times and leaves everything else", () => {
  assertEquals(normalizeClockTimes("Allowing classes on Mon after 20:00 would help."), "Allowing classes on Mon after 8:00 PM would help.");
  assertEquals(normalizeClockTimes("from 09:30 to 12:00, or 13:15-14:50"), "from 9:30 AM to 12:00 PM, or 1:15 PM-2:50 PM");
  assertEquals(normalizeClockTimes("0:00 and 00:00 and 24:00"), "12:00 AM and 12:00 AM and 12:00 AM");
  // Already 12-hour, ambiguous, or not a clock time: unchanged.
  for (const text of ["8:00 PM", "10:30am", "9:30 a.m.", "after 8:00", "ratio 3:1", "25:00", "24:30", "10:00:00", "1.12:30", "Mon 10-11:50am"]) {
    assertEquals(normalizeClockTimes(text), text);
  }
});
