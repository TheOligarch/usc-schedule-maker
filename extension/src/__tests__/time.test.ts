import { describe, expect, it } from "vitest";
import { fmtDays, fmtTime, insideBlocks, normalizeBlocks, subtractBlocks } from "../lib/time";

describe("time helpers", () => {
  it("formats times", () => {
    expect(fmtTime("13:30")).toBe("1:30 PM");
    expect(fmtTime("09:00", true)).toBe("9am");
    expect(fmtTime(0)).toBe("12:00 AM");
    expect(fmtDays(["Thu", "Tue"])).toBe("TuTh");
  });

  it("merges touching and overlapping blocks and drops empty ones", () => {
    expect(
      normalizeBlocks([
        { start: "13:00", end: "15:00" },
        { start: "08:00", end: "10:00" },
        { start: "10:00", end: "11:00" },
        { start: "14:00", end: "16:00" },
        { start: "12:00", end: "12:00" },
      ]),
    ).toEqual([
      { start: "08:00", end: "11:00" },
      { start: "13:00", end: "16:00" },
    ]);
  });

  it("subtracts a range, splitting a block that straddles it", () => {
    expect(subtractBlocks([{ start: "08:00", end: "20:00" }], "12:00", "13:00")).toEqual([
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "20:00" },
    ]);
    expect(subtractBlocks([{ start: "08:00", end: "10:00" }], "07:00", "11:00")).toEqual([]);
  });

  it("checks meetings sit fully inside a block", () => {
    const blocks = [{ start: "08:00", end: "12:00" }];
    expect(insideBlocks("10:00", "11:50", blocks)).toBe(true);
    expect(insideBlocks("11:00", "12:20", blocks)).toBe(false);
  });
});
