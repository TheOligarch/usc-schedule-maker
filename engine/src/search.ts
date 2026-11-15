import type { Problem } from "./prepare";
import { type Combo, scheduleCost } from "./score";

/** How many DFS nodes to visit between cooperative yields. */
export const YIELD_EVERY = 4096;

export interface Found {
  total: number;
  id: string;
  /** combo index chosen at each search level */
  picks: number[];
  /** per level: shares its class with an earlier level */
  shared: boolean[];
}

export interface SearchResult {
  count: number;
  truncated: boolean;
  /** best schedules, best first (empty in count mode) */
  best: Found[];
  /** fewest units among schedules seen (Infinity if none) */
  minUnits: number;
  distinctCount: number;
}

export interface SearchOptions {
  /** keep the best `limit` schedules; 0 = count only */
  limit: number;
  /** stop after this many valid schedules */
  cap: number;
}

interface TimetableCandidate { found: Found; bits: number[]; }

function timetable(combos: readonly Combo[]): { key: string; bits: number[] } {
  const meetings = [...new Set(combos.flatMap(c => c.slots.map(s => `${s.day}:${s.s}:${s.e}`)))].sort();
  // Half-hour occupancy gives nearby starts less diversity than a different day.
  const bits = new Array<number>(11).fill(0);
  for (const c of combos) for (const s of c.slots) {
    for (let t = Math.floor(s.s / 30); t < Math.ceil(s.e / 30); t++) {
      const bit = s.day * 48 + t;
      bits[bit >>> 5] |= 1 << (bit & 31);
    }
  }
  return { key: meetings.join("|") || "TBA", bits };
}

function popcount(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function distance(a: number[], b: number[]): number {
  let diff = 0, union = 0;
  for (let i = 0; i < a.length; i++) { diff += popcount(a[i] ^ b[i]); union += popcount(a[i] | b[i]); }
  return union ? diff / union : 0;
}

/** Best representative of each timetable, then a quality-aware diversity sample. */
function diverse(candidates: TimetableCandidate[], limit: number): Found[] {
  const compare = (a: TimetableCandidate, b: TimetableCandidate) => a.found.total - b.found.total || a.found.id.localeCompare(b.found.id);
  candidates.sort(compare);
  if (candidates.length <= limit) return candidates.map(c => c.found);
  // Bounded selection cost; enumeration still deduplicates every feasible leaf.
  const pool = candidates.slice(0, Math.max(2000, limit * 20));
  const picked = [pool[0]];
  const available = pool.slice(1).map(c => ({ ...c, nearest: distance(c.bits, pool[0].bits) }));
  const best = pool[0].found.total;
  const range = Math.max(1, pool[pool.length - 1].found.total - best);
  while (picked.length < limit && available.length) {
    let at = 0, utility = -Infinity;
    for (let i = 0; i < available.length; i++) {
      const c = available[i];
      const value = 0.65 * c.nearest + 0.35 * (1 - (c.found.total - best) / range);
      if (value > utility) { utility = value; at = i; }
    }
    const [next] = available.splice(at, 1);
    picked.push(next);
    for (const c of available) c.nearest = Math.min(c.nearest, distance(c.bits, next.bits));
  }
  return picked.sort(compare).map(c => c.found);
}

export function scheduleId(combos: readonly Combo[]): string {
  const ids: string[] = [];
  for (const c of combos) for (const id of c.sectionIds) ids.push(id);
  return [...new Set(ids)].sort().join("+");
}

/**
 * Iterative backtracking over search levels (requirements, fewest options
 * first). A combo is accepted only if it is compatible with every earlier
 * pick (precomputed matrices) and keeps units under the cap including the
 * minimum the remaining levels must add. Yields every YIELD_EVERY nodes so
 * the caller can hand control back to the event loop.
 */
export function* search(p: Problem, opts: SearchOptions): Generator<void, SearchResult, void> {
  const levels = p.order.map((i) => p.reqs[i]);
  const n = levels.length;
  const result: SearchResult = { count: 0, truncated: false, best: [], minUnits: Infinity, distinctCount: 0 };
  if (n === 0) return result;
  for (const L of levels) if (!L.combos.length) return result;

  const sizes = levels.map((L) => L.combos.length);
  const suffixMin = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) suffixMin[j] = suffixMin[j + 1] + p.minUnits[j];
  const cap = p.unitCap;
  const candidates = opts.limit > 0 ? new Map<string, TimetableCandidate>() : null;

  const pick = new Array<number>(n).fill(-1);
  const shared = new Array<boolean>(n).fill(false);
  const unitsAt = new Array<number>(n + 1).fill(0); // units before level j
  const baseAt = new Array<number>(n + 1).fill(0);
  const distinct: Combo[] = [];

  let level = 0;
  let nodes = 0;
  while (level >= 0) {
    const next = ++pick[level];
    if (next >= sizes[level]) {
      pick[level] = -1;
      level--;
      continue;
    }
    if (++nodes % YIELD_EVERY === 0) yield;

    // compatibility with earlier picks
    let ok = true;
    let isShared = false;
    const row = p.compat[level];
    const nj = sizes[level];
    for (let i = 0; i < level; i++) {
      const v = row[i][pick[i] * nj + next];
      if (v === 0) {
        ok = false;
        break;
      }
      if (v === 2) isShared = true;
    }
    if (!ok) continue;

    const combo = levels[level].combos[next];
    const units = unitsAt[level] + (isShared ? 0 : combo.units);
    if (cap !== null && units + suffixMin[level + 1] > cap) continue;
    shared[level] = isShared;
    unitsAt[level + 1] = units;
    baseAt[level + 1] = baseAt[level] + (isShared ? 0 : combo.base);

    if (level < n - 1) {
      level++;
      continue;
    }

    // leaf: a valid schedule
    result.count++;
    if (units < result.minUnits) result.minUnits = units;
    if (candidates) {
      distinct.length = 0;
      for (let i = 0; i < n; i++) if (!shared[i]) distinct.push(levels[i].combos[pick[i]]);
      const total = Math.round((baseAt[n] + scheduleCost(distinct, p.ctx)) * 1000) / 1000;
      const time = timetable(distinct);
      const id = scheduleId(distinct);
      const prev = candidates.get(time.key);
      if (!prev || total < prev.found.total || (total === prev.found.total && id < prev.found.id)) {
        candidates.set(time.key, { found: { total, id, picks: pick.slice(), shared: shared.slice() }, bits: time.bits });
      }
    }
    if (result.count >= opts.cap) {
      result.truncated = true;
      break;
    }
  }

  if (candidates) {
    result.distinctCount = candidates.size;
    result.best = diverse([...candidates.values()], opts.limit);
  }
  return result;
}

/** Runs a step generator to completion synchronously. */
export function drain<T>(gen: Generator<void, T, void>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
