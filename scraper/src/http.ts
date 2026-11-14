// Polite HTTP helpers: identifying User-Agent, retry with backoff, bounded concurrency.

export const USER_AGENT =
  "usc-schedule-maker-scraper/0.1 (+https://github.com/TheOligarch/usc-schedule-maker; nightly, max 6 concurrent)";

export const MAX_CONCURRENCY = 6;

// classes.usc.edu exposes admin routes next to the public ones. The scraper must never touch them.
const FORBIDDEN_USC_ROUTES = /\/api\/(Configuration|Users|BackgroundJob)\b/i;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  retries?: number;
  /** Base delay for exponential backoff, ms. */
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  if (FORBIDDEN_USC_ROUTES.test(new URL(url).pathname)) {
    throw new Error(`refusing to call admin route ${url}`);
  }
  const retries = opts.retries ?? 4;
  const backoff = opts.backoffMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1) + Math.random() * 250);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9", ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (res.ok) return text;
      lastErr = new HttpError(`${res.status} ${res.statusText} for ${url}: ${text.slice(0, 200)}`, res.status);
      if (!isRetryable(res.status)) throw lastErr;
    } catch (err) {
      if (err instanceof HttpError && !isRetryable(err.status)) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}

/** Map over items with at most `limit` promises in flight. Rejects on the first failure. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i] as T, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
