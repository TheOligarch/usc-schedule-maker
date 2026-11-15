import type { Slot } from "./score";
import { dayIndex } from "./time";
import type { ScheduleRule } from "./types";

/** Cost of one soft-rule violation (about one "full section" penalty). */
export const SOFT_RULE_COST = 6;

export interface CompiledRule {
  rule: ScheduleRule;
  /** bit mask of days the rule applies to (all days when the rule names none) */
  dayMask: number;
}

export function compileRules(rules: readonly ScheduleRule[] | undefined): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const rule of rules ?? []) {
    if (!rule || typeof rule.value !== "number" || !Number.isFinite(rule.value) || rule.value < 0) continue;
    let dayMask = 0;
    for (const d of rule.days ?? []) {
      const i = dayIndex(d);
      if (i >= 0) dayMask |= 1 << i;
    }
    out.push({ rule, dayMask: dayMask || 0x7f });
  }
  return out;
}

/** How many times `rule` is broken by the week in `byDay` (slots sorted by start). */
export function violations(c: CompiledRule, byDay: readonly Slot[][]): number {
  const { rule, dayMask } = c;
  if (rule.kind === "maxDays") {
    let days = 0;
    for (let d = 0; d < 7; d++) if (byDay[d].length && dayMask & (1 << d)) days++;
    return Math.max(0, days - rule.value);
  }
  let n = 0;
  for (let d = 0; d < 7; d++) {
    if (!(dayMask & (1 << d))) continue;
    const slots = byDay[d];
    if (!slots.length) continue;
    if (rule.kind === "maxPerDay") {
      n += Math.max(0, slots.length - rule.value);
      continue;
    }
    if (rule.kind === "maxMinutesPerDay") {
      let minutes = 0;
      for (const s of slots) minutes += s.e - s.s;
      if (minutes > rule.value) n++;
      continue;
    }
    let end = slots[0].e;
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i].s - end;
      if (rule.kind === "maxGap" && gap > rule.value) n++;
      if (rule.kind === "minBreak" && gap >= 0 && gap < rule.value) n++;
      if (slots[i].e > end) end = slots[i].e;
    }
  }
  return n;
}
