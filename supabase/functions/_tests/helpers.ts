// Test doubles: a scripted model client and an in-memory course catalog, so the
// functions' logic runs without the network or an API key.
import { CatalogStatus, CourseRow, CourseSource, normalizeTerms, rankCourses } from "../_shared/courses.ts";
import { GenerateOptions, ModelClient, ModelError } from "../_shared/model.ts";
import { InterviewRequest } from "../_shared/types.ts";

type Responder = (opts: GenerateOptions<unknown>, input: any) => unknown;

export interface StubModel extends ModelClient {
  calls: { label: string; input: any }[];
}

/** `responders` maps a call label to its output; a missing label fails like an API outage. */
export function stubModel(responders: Record<string, Responder> = {}, keyPresent = true): StubModel {
  const calls: StubModel["calls"] = [];
  return {
    model: "stub-model",
    keyPresent,
    calls,
    generate<T>(opts: GenerateOptions<T>): Promise<T> {
      const input = JSON.parse(opts.user);
      calls.push({ label: opts.label, input });
      const responder = responders[opts.label];
      if (!responder) return Promise.reject(new ModelError("api_error", "stubbed outage", 500));
      try {
        return Promise.resolve(opts.schema.parse(responder(opts as GenerateOptions<unknown>, input)));
      } catch (err) {
        return Promise.reject(err);
      }
    },
    ping: () => (responders.ping ? Promise.resolve() : Promise.reject(new ModelError("api_error", "stubbed outage", 500))),
  };
}

export function course(code: string, title: string, ge: string[] = [], description: string | null = null): CourseRow {
  return { code, title, description, ge, units_min: 4, units_max: 4 };
}

export function stubCourses(rows: CourseRow[], status?: CatalogStatus): CourseSource {
  return {
    status: () => Promise.resolve(status ?? (rows.length ? "ok" : "empty")),
    byGe: (_term, cat, limit) => Promise.resolve(rows.filter((r) => r.ge.includes(cat)).slice(0, limit)),
    search: (_term, raw, { geOnly, limit }) => {
      const terms = normalizeTerms(raw);
      const hit = (r: CourseRow) =>
        terms.keywords.some((k) => `${r.title} ${r.description ?? ""}`.toLowerCase().includes(k)) ||
        terms.departments.some((d) => r.code.startsWith(`${d}-`));
      return Promise.resolve(rankCourses(rows.filter((r) => hit(r) && (!geOnly || r.ge.length > 0)), terms).slice(0, limit));
    },
  };
}

export const CATALOG: CourseRow[] = [
  course("CTCS-190", "Introduction to Cinema", ["GEA"], "Film form, history and criticism."),
  course("MUSC-115", "Western Music as Sounding History", ["GEA"]),
  course("AHIS-120", "Foundations of Western Art", ["GEA"]),
  course("THTR-125", "Text Studies for Production", ["GEA"]),
  course("DANC-212", "Dance in Popular Culture", ["GEA"]),
  course("ARCH-114", "Architecture: Culture and Community", ["GEA"]),
  course("FACS-150", "Visual Culture and Literacy", ["GEA"]),
  course("PSYC-100", "Introduction to Psychology", [], "Behavior, cognition and the brain."),
  course("PSYC-155", "Psychology of Happiness", [], "Positive psychology and wellbeing."),
  course("ENST-100", "Introduction to Environmental Studies", ["GEC"]),
  course("CSCI-201", "Principles of Software Development"),
];

export function request(overrides: Partial<InterviewRequest> = {}): InterviewRequest {
  return {
    termCode: "20271",
    required: ["CSCI-201", "MATH-225"],
    slots: [
      { label: "GE-A Arts", kind: "GE", geCategory: "GEA" },
      { label: "Free elective", kind: "elective" },
    ],
    history: [],
    ...overrides,
  };
}
