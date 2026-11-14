/**
 * ENGINE SEAM - every schedule-engine call in the app goes through this file.
 *
 * Integration (after usm-engine merges `engine/` to main) is a two-line swap:
 *   1. replace the body of `loadRealEngine` with
 *        return (await import("../../../engine/src/index")).generateSchedules;
 *   2. build with VITE_USE_MOCKS=false.
 */
import { USE_MOCKS } from "./config";
import type { GenerateOptions, GenerateResult, GenerateSchedulesFn, ScheduleRequest, TermData } from "./contract-types";
import { mockGenerateSchedules } from "../mocks/mockEngine";

async function loadRealEngine(): Promise<GenerateSchedulesFn | null> {
  return null; // usm-engine not merged yet
}

let cached: { fn: GenerateSchedulesFn; isMock: boolean } | null = null;

async function resolveEngine(): Promise<{ fn: GenerateSchedulesFn; isMock: boolean }> {
  if (cached) return cached;
  const real = USE_MOCKS ? null : await loadRealEngine();
  cached = real ? { fn: real, isMock: false } : { fn: mockGenerateSchedules, isMock: true };
  return cached;
}

export interface EngineRun {
  result: GenerateResult;
  /** True when the result came from the mock engine. */
  isMock: boolean;
  elapsedMs: number;
}

export async function generateSchedules(data: TermData, req: ScheduleRequest, opts?: GenerateOptions): Promise<EngineRun> {
  const engine = await resolveEngine();
  // Let the "Building schedules" state paint before the synchronous engine run.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const started = performance.now();
  const result = engine.fn(data, req, opts);
  return { result, isMock: engine.isMock, elapsedMs: Math.round(performance.now() - started) };
}
