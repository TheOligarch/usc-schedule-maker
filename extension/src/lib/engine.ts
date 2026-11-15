/**
 * ENGINE SEAM - every schedule-engine call in the app goes through this file.
 *
 * With VITE_USE_MOCKS=false the real engine from `engine/` (usm-engine) runs, using its
 * async variant so the page keeps painting while it searches. With mocks on, the
 * same engine runs on demo data.
 */
import { USE_MOCKS } from "./config";
import type { GenerateOptions, GenerateResult, ScheduleRequest, TermData } from "./contract-types";

type EngineFn = (data: TermData, req: ScheduleRequest, opts: GenerateOptions & { signal?: AbortSignal }) => Promise<GenerateResult & { truncated?: boolean }>;

async function loadRealEngine(): Promise<EngineFn> {
  const engine = await import("../../../engine/src/index");
  return (data, req, opts) => engine.generateSchedulesAsync(data, req, opts);
}

const mockEngine: EngineFn = async (data, req, opts) => {
  // Let the loading state paint, then use the same cancellable async engine in demo mode.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const fn = await loadRealEngine();
  return fn(data, req, opts);
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
