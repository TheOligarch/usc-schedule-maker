/**
 * Errors from the AI seam, kept apart from ai.ts so screens and tests that mock ai.ts can
 * still recognize a rate-limit pause.
 */
import { rateLimitMessage, type LimitScope } from "../../../supabase/functions/_shared/rate-limit-message";

export type { LimitScope };

export class AiError extends Error {}

/**
 * The AI functions answered HTTP 429: this install, its network or the whole service has used
 * its budget for now. Only the AI features pause; schedule building and ranking run locally.
 */
export class AiRateLimitError extends AiError {
  constructor(
    readonly scope: LimitScope,
    /** Seconds until the AI can be asked again. */
    readonly retryAfterSeconds: number,
  ) {
    super(rateLimitMessage(scope, retryAfterSeconds));
    this.name = "AiRateLimitError";
  }
}
