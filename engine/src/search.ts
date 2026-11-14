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
}

export interface SearchOptions {
  /** keep the best `limit` schedules; 0 = count only */
  limit: number;
  /** stop after this many valid schedules */
  cap: number;
}

/** Bounded max-heap on (total, id): the root is the worst schedule kept. */
class WorstHeap {
  readonly items: Found[] = [];
  constructor(readonly size: number) {}
  static worse(a: Found, b: Found): boolean {
    return a.total > b.total || (a.total === b.total && a.id > b.id);
  }
  peek(): Found | undefined {
    return this.items[0];
  }
  push(f: Found): void {
    const h = this.items;
    if (h.length < this.size) {
      h.push(f);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!WorstHeap.worse(h[i], h[p])) break;
        [h[i], h[p]] = [h[p], h[i]];
        i = p;
      }
      return;
    }
    if (!WorstHeap.worse(h[0], f)) return;
    h[0] = f;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && WorstHeap.worse(h[l], h[m])) m = l;
      if (r < h.length && WorstHeap.worse(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  }
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
  const result: SearchResult = { count: 0, truncated: false, best: [], minUnits: Infinity };
  if (n === 0) return result;
  for (const L of levels) if (!L.combos.length) return result;

  const sizes = levels.map((L) => L.combos.length);
  const suffixMin = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) suffixMin[j] = suffixMin[j + 1] + p.minUnits[j];
  const cap = p.unitCap;
  const heap = opts.limit > 0 ? new WorstHeap(opts.limit) : null;

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
    if (heap) {
      distinct.length = 0;
      for (let i = 0; i < n; i++) if (!shared[i]) distinct.push(levels[i].combos[pick[i]]);
      const total = Math.round((baseAt[n] + scheduleCost(distinct, p.ctx)) * 1000) / 1000;
      const worst = heap.peek();
      if (heap.items.length < heap.size || !worst || total <= worst.total) {
        heap.push({ total, id: scheduleId(distinct), picks: pick.slice(), shared: shared.slice() });
      }
    }
    if (result.count >= opts.cap) {
      result.truncated = true;
      break;
    }
  }

  if (heap) result.best = heap.items.slice().sort((a, b) => a.total - b.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

/** Runs a step generator to completion synchronously. */
export function drain<T>(gen: Generator<void, T, void>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
