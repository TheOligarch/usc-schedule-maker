/** Build-time configuration. Everything environment-specific lives here. */

export const SUPABASE_URL = "https://mmdvgvpckweiklkbuxvy.supabase.co";
export const TERM_DATA_BASE = `${SUPABASE_URL}/storage/v1/object/public/term-data`;
export const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
export const CLASSES_API = "https://classes.usc.edu/api/Courses/Course";

/** Public anon key, injected by Vite from VITE_SUPABASE_ANON_KEY (never hardcoded). */
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/**
 * THE integration flag. Off by default: the real engine (lib/engine.ts) and the deployed
 * AI functions (lib/ai.ts) run, as in the release build. Set VITE_USE_MOCKS=true (or run
 * `npm run dev:mock`) to back both with the local stand-ins in src/mocks/.
 */
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === "true";

export const DEFAULT_RESULT_LIMIT = 10;
export const MAX_RESULT_LIMIT = 100;
export const MAX_INTERVIEW_QUESTIONS = 10;
export const MAX_SHORTLIST = 5;
