/** Review guidance belongs to the UI, never to the editable preference bullets. */
export const INTERVIEW_CONFIRMATION = "Please confirm these preferences or change any of them before you continue.";

export function isInterviewConfirmation(text: string): boolean {
  // Match only this instruction; preserve actual preferences, including ones about confirmation.
  const normalize = (value: string) => value.replace(/^[\s\-*•]+/, "").replace(/\s+/g, " ").trim().replace(/[.!]$/, "").toLowerCase();
  return normalize(text) === normalize(INTERVIEW_CONFIRMATION);
}
