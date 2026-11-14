/**
 * ENGINE SEAM - every schedule-engine call in the app goes through this file.
 *
 * With VITE_USE_MOCKS=false the real engine from `engine/` (usm-engine) runs, using its
 * async variant so the page keeps painting while it searches. With mocks on, the
 * stand-in in src/mocks/mockEngine.ts answers instead.
 */
import { USE_MOCKS } from "./config";
import type { GenerateOptions, GenerateResult, ScheduleRequest, TermData } from "./contract-types";
import { mockGenerateSchedules } from "../mocks/mockEngine";

type EngineFn = (data: TermData, req: ScheduleRequest, opts: GenerateOptions & { signal?: AbortSignal }) => Promise<GenerateResult & { truncated?: boolean }>;

async function loadRealEngine(): Promise<EngineFn> {
  const engine = await import("../../../engine/src/index");
  return (data, req, opts) => engine.generateSchedulesAsync(data, req, opts);
}

const mockEngine: EngineFn = async (data, req, opts) => {
  // Let the "Building schedules" state paint before the synchronous mock run.
  await new Promise((resolve) => setTimeout(resolve, 40));
  return mockGenerateSchedules(data, req, opts);
};

let cached: Promise<{ fn: EngineFn; isMock: boolean }> | null = null;

function resolveEngine(): Promise<{ fn: EngineFn; isMock: boolean }> {
  cached ??= USE_MOCKS ? Promise.resolve({ fn: mockEngine, isMock: true }) : loadRealEngine().then((fn) => ({ fn, isMock: false }));
  return cached;
}

export interface EngineRun {
  result: GenerateResult;
  /** True when the result came from the mock engine. */
  isMock: boolean;
  /** True when the engine stopped enumerating early (very large search space). */
  truncated: boolean;
  elapsedMs: number;
}

export async function generateSchedules(data: TermData, req: ScheduleRequest, opts: GenerateOptions & { signal?: AbortSignal } = {}): Promise<EngineRun> {
  const engine = await resolveEngine();
  const started = performance.now();
  const result = await engine.fn(data, req, opts);
  return { result, isMock: engine.isMock, truncated: Boolean(result.truncated), elapsedMs: Math.round(performance.now() - started) };
}
