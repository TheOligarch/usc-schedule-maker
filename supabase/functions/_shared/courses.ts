// Read-only access to the `courses` table (contract section 2) through PostgREST
// with the anon key, so RLS applies exactly as it does for the extension.

export interface CourseRow {
  code: string;
  title: string;
  description: string | null;
  ge: string[];
  units_min: number | null;
  units_max: number | null;
}

export type CatalogStatus = "ok" | "empty" | "missing" | "error";

export interface SearchTerms {
  keywords: string[];
  departments: string[];
}

export interface CourseSource {
  /** Whether the term has any course rows at all. */
  status(termCode: string): Promise<CatalogStatus>;
  /** Courses carrying a GE category code. */
  byGe(termCode: string, geCategory: string, limit: number): Promise<CourseRow[]>;
  /** Courses matching any keyword (title/description) or department prefix. */
  search(termCode: string, terms: SearchTerms, opts: { geOnly: boolean; limit: number }): Promise<CourseRow[]>;
}

const COLUMNS = "code,title,description,ge,units_min,units_max";

/** Keeps a search keyword safe to embed in a PostgREST filter. */
export function cleanKeyword(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function cleanDepartment(raw: string): string {
  const dept = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return dept.length >= 2 && dept.length <= 6 ? dept : "";
}

export function normalizeTerms(terms: SearchTerms): SearchTerms {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    keywords: uniq(terms.keywords.map(cleanKeyword).filter((k) => k.length >= 3)).slice(0, 10),
    departments: uniq(terms.departments.map(cleanDepartment)).slice(0, 8),
  };
}

/** Orders rows by how well they match the terms; title hits count most. Stable for ties. */
export function rankCourses(rows: CourseRow[], terms: SearchTerms): CourseRow[] {
  const score = (row: CourseRow): number => {
    const title = row.title.toLowerCase();
    const desc = (row.description ?? "").toLowerCase();
    let s = 0;
    for (const k of terms.keywords) {
      if (title.includes(k)) s += 3;
      else if (desc.includes(k)) s += 1;
    }
    if (terms.departments.some((d) => row.code.toUpperCase().startsWith(`${d}-`))) s += 2;
    return s;
  };
  return rows
    .map((row, i) => ({ row, i, s: score(row) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.row);
}

interface RestConfig {
  url: string;
  key: string;
}

/** Uses the function's own anon key, falling back to the key the caller sent. */
export function restConfigFromRequest(req: Request): RestConfig | null {
  const url = Deno.env.get("SUPABASE_URL");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || bearer;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

export function createCourseSource(config: RestConfig | null, fetchFn: typeof fetch = fetch): CourseSource {
  async function query(params: Record<string, string>): Promise<{ rows: CourseRow[]; status: CatalogStatus }> {
    if (!config) return { rows: [], status: "error" };
    const qs = new URLSearchParams({ select: COLUMNS, order: "code.asc", ...params });
    let res: Response;
    try {
      res = await fetchFn(`${config.url}/rest/v1/courses?${qs}`, {
        headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
      });
    } catch {
      console.error("[courses] request failed");
      return { rows: [], status: "error" };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { code?: string } | null;
      // PGRST205 / 42P01: the table does not exist yet (usm-data has not migrated).
      const missing = res.status === 404 || body?.code === "PGRST205" || body?.code === "42P01";
      if (!missing) console.error(`[courses] query failed: ${res.status} ${body?.code ?? ""}`);
      return { rows: [], status: missing ? "missing" : "error" };
    }
    const rows = await res.json() as CourseRow[];
    return {
      rows: rows.map((r) => ({ ...r, ge: Array.isArray(r.ge) ? r.ge : [] })),
      status: rows.length ? "ok" : "empty",
    };
  }

  return {
    async status(termCode) {
      return (await query({ term_code: `eq.${termCode}`, limit: "1" })).status;
    },

    async byGe(termCode, geCategory, limit) {
      const cat = geCategory.replace(/[^A-Za-z0-9_-]/g, "");
      if (!cat) return [];
      const fetchCat = (c: string) => query({ term_code: `eq.${termCode}`, ge: `cs.{${c}}`, limit: String(limit) });
      const exact = await fetchCat(cat);
      if (exact.rows.length || cat === cat.toUpperCase()) return exact.rows;
      return (await fetchCat(cat.toUpperCase())).rows;
    },

    async search(termCode, rawTerms, { geOnly, limit }) {
      const terms = normalizeTerms(rawTerms);
      const clauses = [
        ...terms.keywords.flatMap((k) => [`title.ilike."*${k}*"`, `description.ilike."*${k}*"`]),
        ...terms.departments.map((d) => `code.ilike."${d}-*"`),
      ];
      if (!clauses.length) return [];
      const params: Record<string, string> = {
        term_code: `eq.${termCode}`,
        or: `(${clauses.join(",")})`,
        limit: String(limit),
      };
      if (geOnly) params.ge = "neq.{}";
      return rankCourses((await query(params)).rows, terms);
    },
  };
}
