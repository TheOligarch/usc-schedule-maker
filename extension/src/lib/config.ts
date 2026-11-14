/** Build-time configuration. Everything environment-specific lives here. */

export const SUPABASE_URL = "https://mmdvgvpckweiklkbuxvy.supabase.co";
export const TERM_DATA_BASE = `${SUPABASE_URL}/storage/v1/object/public/term-data`;
export const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
export const CLASSES_API = "https://classes.usc.edu/api/Courses/Course";

/** Public anon key, injected by Vite from VITE_SUPABASE_ANON_KEY (never hardcoded). */
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/**
 * THE integration flag. While true, the schedule engine (lib/engine.ts) and the AI
 * functions (lib/ai.ts) are backed by src/mocks/. Defaults to true until the engine
 * and AI tasks are merged; set VITE_USE_MOCKS=false to use the real implementations.
 */
export const USE_MOCKS: boolean = (import.meta.env.VITE_USE_MOCKS ?? "true") !== "false";

export const DEFAULT_RESULT_LIMIT = 10;
export const MAX_RESULT_LIMIT = 100;
export const MAX_INTERVIEW_QUESTIONS = 10;
export const MAX_SHORTLIST = 5;
