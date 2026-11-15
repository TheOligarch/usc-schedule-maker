// Wait messages for rate-limited AI requests. Dependency-free so the extension imports the same
// wording it renders when it pauses AI calls locally.

/** user: this install; network: this IP (the backstop); global: the daily breaker for everyone. */
export type LimitScope = "user" | "network" | "global";

/** "in a minute", "in 12 minutes", "in 3 hours". */
export function waitPhrase(seconds: number): string {
  if (seconds <= 60) return "in a minute";
  if (seconds < 90 * 60) return `in ${Math.ceil(seconds / 60)} minutes`;
  return `in ${Math.ceil(seconds / 3600)} hours`;
}

const STILL_WORKS = "Building and ranking schedules still works without it.";

export function rateLimitMessage(scope: LimitScope, retryAfter: number): string {
  const wait = waitPhrase(retryAfter);
  if (scope === "global") return `The AI assistant is taking a break after a very busy day. Try again ${wait}. ${STILL_WORKS}`;
  if (scope === "network") return `The AI assistant is getting a lot of requests from your network. Try again ${wait}. ${STILL_WORKS}`;
  return `You've used the AI assistant a lot in a short time. Try again ${wait}. ${STILL_WORKS}`;
}
