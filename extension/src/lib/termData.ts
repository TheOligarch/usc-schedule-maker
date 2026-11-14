/**
 * Term data loading: index.json + one per-term file from the public Supabase bucket,
 * cached in IndexedDB and revalidated by `scrapedAt`. Falls back to the cached copy when
 * offline, and to the bundled sample term when nothing has been published yet.
 */
import { TERM_DATA_BASE } from "./config";
import type { TermData, TermIndex, TermRef } from "./contract-types";
import { idbGet, idbSet } from "./idb";
import { SAMPLE_INDEX, SAMPLE_TERM } from "../mocks/sampleTerm";

export type DataSource = "live" | "cached" | "sample";

export interface LoadedIndex {
  index: TermIndex;
  source: DataSource;
  /** Why the live index was not used, when it was not. */
  note: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function validIndex(x: unknown): x is TermIndex {
  return Boolean(x) && Array.isArray((x as TermIndex).terms) && (x as TermIndex).terms.every((t) => typeof t.code === "string" && typeof t.name === "string");
}

function validTerm(x: unknown): x is TermData {
  const t = x as TermData;
  return Boolean(t) && typeof t.term?.code === "string" && typeof t.courses === "object" && typeof t.sections === "object" && typeof t.rmp === "object";
}

export async function loadTermIndex(): Promise<LoadedIndex> {
  try {
    const index = await fetchJson<unknown>(`${TERM_DATA_BASE}/index.json`);
    if (!validIndex(index) || index.terms.length === 0) throw new Error("empty or malformed index");
    void idbSet("index", index);
    return { index, source: "live", note: null };
  } catch (err) {
    const cached = await idbGet<TermIndex>("index");
    if (validIndex(cached) && cached.terms.length > 0)
      return { index: cached, source: "cached", note: "Could not reach the course data service; showing the last downloaded copy." };
    const why = err instanceof Error ? err.message : String(err);
    return { index: SAMPLE_INDEX, source: "sample", note: `Live course data is not published yet (${why}); showing a small sample term.` };
  }
}

export async function loadTermData(ref: TermRef, indexSource: DataSource): Promise<{ data: TermData; source: DataSource }> {
  if (indexSource === "sample") return { data: SAMPLE_TERM, source: "sample" };
  const key = `term:${ref.code}`;
  const cached = await idbGet<TermData>(key);
  if (validTerm(cached) && cached.term.scrapedAt === ref.scrapedAt) return { data: cached, source: indexSource };
  try {
    const data = await fetchJson<unknown>(`${TERM_DATA_BASE}/${encodeURIComponent(ref.code)}.json`);
    if (!validTerm(data)) throw new Error("malformed term file");
    void idbSet(key, data);
    return { data, source: "live" };
  } catch (err) {
    if (validTerm(cached)) return { data: cached, source: "cached" };
    throw new Error(`Could not download ${ref.name} course data (${err instanceof Error ? err.message : String(err)}).`);
  }
}
