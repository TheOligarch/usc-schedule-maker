import rawCourses from "./usc-20271-components.json";
import { normalize } from "../../../../scraper/src/normalize";
import type { RawCourse } from "../../../../scraper/src/usc";

export function liveTerm() {
  return normalize({ termCode: "20271", schools: [], ge: [], programs: [{ school: "", program: "", courses: rawCourses as unknown as RawCourse[] }] }, { code: "20271", name: "Spring 2027" }, "2026-11-14T23:20:00Z").data;
}

