// RateMyProfessors snapshot (unofficial GraphQL API) and instructor name matching.
//
// The API is unofficial and RMP's ToS discourages scraping, so we take ONE snapshot per semester,
// cache it, and reuse it on every nightly run. The UI must show RMP_CREDIT next to ratings.

import { fetchText } from "./http.ts";
import type { RmpTeacher } from "./types.ts";

export const RMP_GRAPHQL = "https://www.ratemyprofessors.com/graphql";
/** USC on RMP (base64 of "School-1381"). */
export const RMP_USC_SCHOOL_ID = "U2Nob29sLTEzODE=";

export interface RmpSnapshot {
  schoolId: string;
  termCode: string;
  fetchedAt: string;
  teachers: RmpTeacher[];
}

const QUERY = `query Teachers($text: String!, $schoolID: ID!, $first: Int!, $after: String) {
  newSearch {
    teachers(query: { text: $text, schoolID: $schoolID }, first: $first, after: $after) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges { node { legacyId firstName lastName department avgRating avgDifficulty numRatings wouldTakeAgainPercent } }
    }
  }
}`;

interface RmpNode {
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgainPercent: number | null;
}

interface RmpPage {
  data?: {
    newSearch: {
      teachers: { resultCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: RmpNode }[] };
    };
  };
  errors?: { message: string }[];
}

export async function fetchRmpSnapshot(termCode: string, log: (msg: string) => void): Promise<RmpSnapshot> {
  const teachers: RmpTeacher[] = [];
  let after: string | null = null;
  let resultCount = 0;
  for (let page = 0; page < 50; page++) {
    const body = JSON.stringify({ query: QUERY, variables: { text: "", schoolID: RMP_USC_SCHOOL_ID, first: 1000, after } });
    const res = JSON.parse(
      await fetchText(RMP_GRAPHQL, {
        method: "POST",
        body,
        // Public, well-known credential the RMP web app itself sends; not a secret.
        headers: { Authorization: "Basic dGVzdDp0ZXN0", "Content-Type": "application/json", Accept: "application/json" },
      }),
    ) as RmpPage;
    if (!res.data) throw new Error(`RMP GraphQL error: ${JSON.stringify(res.errors ?? res).slice(0, 300)}`);
    const t = res.data.newSearch.teachers;
    resultCount = t.resultCount;
    for (const { node } of t.edges) teachers.push(toTeacher(node));
    if (!t.pageInfo.hasNextPage || !t.pageInfo.endCursor) break;
    after = t.pageInfo.endCursor;
  }
  log(`rmp: fetched ${teachers.length}/${resultCount} USC teachers`);
  if (teachers.length < resultCount * 0.9) throw new Error(`RMP snapshot incomplete: ${teachers.length}/${resultCount}`);
  return { schoolId: RMP_USC_SCHOOL_ID, termCode, fetchedAt: new Date().toISOString(), teachers };
}

function toTeacher(n: RmpNode): RmpTeacher {
  const wta = n.wouldTakeAgainPercent;
  return {
    legacyId: String(n.legacyId),
    first: n.firstName.trim(),
    last: n.lastName.trim(),
    department: (n.department ?? "").trim(),
    avg: n.avgRating,
    difficulty: n.avgDifficulty,
    count: n.numRatings,
    wouldTakeAgain: wta === null || wta < 0 ? null : Math.round(wta * 10) / 10,
  };
}

// ---------- matching ----------

export function normPerson(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

export interface RmpMatch {
  teacher: RmpTeacher;
  kind: "exact" | "initial";
}

/**
 * Matching rule (captain-approved):
 *   1. normalized exact first + last;
 *   2. otherwise a unique first-initial + last ("initial", shown in the UI as "possible match");
 *   at either step, several candidates are tie-broken by department, and if that does not leave
 *   exactly one, the instructor stays unmatched. Never guess between ties.
 * Teachers with zero ratings are left out of the pool, so they count as unrated.
 */
export class RmpMatcher {
  private byFull = new Map<string, RmpTeacher[]>();
  private byInitial = new Map<string, RmpTeacher[]>();

  constructor(teachers: RmpTeacher[]) {
    for (const t of teachers) {
      if (t.count <= 0) continue;
      const f = normPerson(t.first);
      const l = normPerson(t.last);
      if (!f || !l) continue;
      push(this.byFull, `${f}|${l}`, t);
      push(this.byInitial, `${f[0]}|${l}`, t);
    }
  }

  match(first: string, last: string, departments: string[]): RmpMatch | null {
    const f = normPerson(first);
    const l = normPerson(last);
    if (!f || !l) return null;
    const depts = departments.map(normDept).filter(Boolean);

    const firstToken = f.split(" ")[0] ?? f;
    const exact = this.byFull.get(`${f}|${l}`) ?? (firstToken !== f ? this.byFull.get(`${firstToken}|${l}`) : undefined);
    if (exact?.length) {
      const one = pickOne(exact, depts);
      return one ? { teacher: one, kind: "exact" } : null; // tie on the full name: never fall back to initials
    }
    const initial = this.byInitial.get(`${f[0]}|${l}`);
    if (initial?.length) {
      const one = pickOne(initial, depts);
      return one ? { teacher: one, kind: "initial" } : null;
    }
    return null;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function normDept(s: string): string {
  return normPerson(s.replace(/&/g, " and "));
}

function deptMatches(teacherDept: string, depts: string[]): boolean {
  const t = normDept(teacherDept);
  return !!t && depts.some((d) => d === t || d.includes(t) || t.includes(d));
}

function pickOne(cands: RmpTeacher[], depts: string[]): RmpTeacher | null {
  if (cands.length === 1) return cands[0] ?? null;
  const inDept = cands.filter((c) => deptMatches(c.department, depts));
  return inDept.length === 1 ? (inDept[0] ?? null) : null;
}
