// Nightly scrape: classes.usc.edu (+ finals page + RMP snapshot) -> TermData -> Supabase.
//
//   npm run scrape                     scrape every not-yet-started term and publish
//   npm run scrape -- --dry-run        same, but only write out/<term>.json locally
//   npm run scrape -- --terms 20271    force specific terms (skips start-date detection)
//   npm run scrape -- --raw <file>     reuse a raw dump saved with --save-raw (dev only)
//
// Publishing is all-or-nothing per term: nothing is uploaded unless the term's scrape, normalize,
// and validation all succeeded, so a failed night leaves yesterday's data in place. The process
// exits non-zero on any failure, which makes the GitHub Actions run fail and email the owner.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFinals, applyRmp, programNames } from "./enrich.ts";
import { FINALS_URL, parseFinalsPage } from "./finals.ts";
import { fetchText } from "./http.ts";
import { normalize } from "./normalize.ts";
import { fetchRmpSnapshot, type RmpSnapshot } from "./rmp.ts";
import { downloadText, loadSupabaseEnv, rpc, type SupabaseEnv, uploadJson } from "./supabase.ts";
import { type PlannedTerm, estimatedStart, planTerms, termName } from "./terms.ts";
import type { TermData, TermIndex } from "./types.ts";
import { fetchTermDump, getActiveTerms, type RawTermDump } from "./usc.ts";
import { validateTermData } from "./validate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_BUCKET = "term-data";
const CACHE_BUCKET = "scraper-cache";

const isCI = !!process.env.GITHUB_ACTIONS;
const log = (msg: string) => console.log(msg);
const warn = (msg: string) => console.log(isCI ? `::warning::${msg}` : `WARNING: ${msg}`);
const fail = (msg: string) => console.log(isCI ? `::error::${msg}` : `ERROR: ${msg}`);

interface Args {
  dryRun: boolean;
  terms: string[] | null;
  raw: string | null;
  saveRaw: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, terms: null, raw: null, saveRaw: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--save-raw") a.saveRaw = true;
    else if (v === "--terms") a.terms = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (v === "--raw") a.raw = argv[++i] ?? null;
    else throw new Error(`unknown argument ${v}`);
  }
  if (a.terms && !a.terms.every((t) => /^\d{5}$/.test(t))) throw new Error("--terms takes 5-digit codes, e.g. 20271");
  return a;
}

async function getRmpSnapshot(termCode: string, env: SupabaseEnv | null): Promise<RmpSnapshot> {
  // One snapshot per semester: local cache, then the private scraper-cache bucket, else fetch once.
  const local = join(ROOT, ".cache", `rmp-${termCode}.json`);
  const remotePath = `rmp/${termCode}.json`;
  if (existsSync(local)) {
    log(`rmp: using local snapshot ${local}`);
    const text = readFileSync(local, "utf8");
    // Seed the shared cache so CI reuses this snapshot instead of taking a second one.
    if (env && !(await downloadText(env, CACHE_BUCKET, remotePath))) {
      await uploadJson(env, CACHE_BUCKET, remotePath, text, 3600);
      log(`rmp: saved local snapshot to ${CACHE_BUCKET}/${remotePath}`);
    }
    return JSON.parse(text) as RmpSnapshot;
  }
  if (env) {
    const text = await downloadText(env, CACHE_BUCKET, remotePath);
    if (text) {
      log(`rmp: using cached snapshot ${CACHE_BUCKET}/${remotePath}`);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, text);
      return JSON.parse(text) as RmpSnapshot;
    }
  }
  const snap = await fetchRmpSnapshot(termCode, log);
  const text = JSON.stringify(snap);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, text);
  if (env) {
    await uploadJson(env, CACHE_BUCKET, remotePath, text, 3600);
    log(`rmp: saved snapshot to ${CACHE_BUCKET}/${remotePath}`);
  }
  return snap;
}

async function buildTerm(term: PlannedTerm, finalsHtml: string | null, env: SupabaseEnv | null, args: Args): Promise<TermData> {
  const t0 = Date.now();
  let dump: RawTermDump;
  if (args.raw) {
    dump = JSON.parse(readFileSync(args.raw, "utf8")) as RawTermDump;
    if (dump.termCode !== term.code) throw new Error(`--raw file is for ${dump.termCode}, not ${term.code}`);
  } else {
    dump = await fetchTermDump(term.code, log);
    if (args.saveRaw) {
      const p = join(ROOT, ".cache", `raw-${term.code}.json`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(dump));
      log(`saved raw dump ${p}`);
    }
  }
  log(`term ${term.code}: fetched in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const { data, stats } = normalize(dump, term, new Date().toISOString());
  log(`term ${term.code}: ${JSON.stringify(stats)}`);

  const { names, byPrefix } = programNames(dump.schools);
  if (finalsHtml) {
    const parsed = parseFinalsPage(finalsHtml, term, names);
    for (const w of parsed.warnings) warn(w);
    const n = applyFinals(data, parsed.rules);
    log(`term ${term.code}: finals ${parsed.rules ? `${parsed.rules.patterns.length} pattern rows, ${parsed.rules.common.size} common-exam courses` : "unavailable"}; ${n} sections got a final`);
  } else {
    warn(`finals: ${FINALS_URL} unavailable; finals left null for ${term.code}`);
  }

  const snap = await getRmpSnapshot(term.code, env);
  const r = applyRmp(data, snap.teachers, byPrefix);
  log(`term ${term.code}: rmp ${JSON.stringify(r)}; ${Object.keys(data.rmp).length} teachers in file (snapshot ${snap.fetchedAt})`);
  return data;
}

async function previousSectionCount(env: SupabaseEnv | null, code: string): Promise<number | null> {
  if (!env) return null;
  const text = await downloadText(env, PUBLIC_BUCKET, `${code}.json`).catch(() => null);
  if (!text) return null;
  try {
    return Object.keys((JSON.parse(text) as TermData).sections).length;
  } catch {
    return null;
  }
}

async function publish(env: SupabaseEnv, built: TermData[]): Promise<void> {
  for (const data of built) {
    const json = JSON.stringify(data);
    await uploadJson(env, PUBLIC_BUCKET, `${data.term.code}.json`, json, 300);
    log(`published ${PUBLIC_BUCKET}/${data.term.code}.json (${(json.length / 1e6).toFixed(1)} MB)`);
    const rows = Object.values(data.courses).map((c) => ({
      code: c.code,
      title: c.title,
      description: c.description,
      ge: c.ge,
      units_min: c.units.min,
      units_max: c.units.max,
    }));
    const n = await rpc<number>(env, "replace_term_courses", { p_term_code: data.term.code, p_courses: rows });
    log(`replaced courses rows for ${data.term.code}: ${n}`);
  }
  // index.json last: keep entries for terms not refreshed tonight (e.g. already started).
  const prevText = await downloadText(env, PUBLIC_BUCKET, "index.json").catch(() => null);
  const prev: TermIndex = prevText ? (JSON.parse(prevText) as TermIndex) : { terms: [] };
  const byCode = new Map(prev.terms.map((t) => [t.code, t]));
  for (const d of built) byCode.set(d.term.code, { ...d.term });
  const index: TermIndex = { terms: [...byCode.values()].sort((a, b) => b.code.localeCompare(a.code)) };
  await uploadJson(env, PUBLIC_BUCKET, "index.json", JSON.stringify(index), 300);
  log(`published ${PUBLIC_BUCKET}/index.json: ${index.terms.map((t) => t.code).join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadSupabaseEnv(join(ROOT, ".env"));
  if (!env && !args.dryRun) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (env or scraper/.env); use --dry-run to scrape without publishing");

  const active = await getActiveTerms();
  let finalsHtml: string | null = null;
  try {
    finalsHtml = await fetchText(FINALS_URL);
  } catch (err) {
    warn(`finals: could not fetch ${FINALS_URL}: ${String(err)}`);
  }

  const knownStarts = new Map<string, string>();
  if (finalsHtml) {
    for (const t of active) {
      const s = parseFinalsPage(finalsHtml, { name: termName(t), year: t.year }, { byName: new Map() }).sessionStart;
      if (s) knownStarts.set(termName(t), s);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  let plan: PlannedTerm[];
  if (args.terms) {
    plan = args.terms.map((code) => {
      const t = active.find((x) => String(x.termCode) === code);
      const name = t ? termName(t) : code;
      return { code, name, season: t?.season ?? "", year: t?.year ?? Number(code.slice(0, 4)), start: knownStarts.get(name) ?? estimatedStart(code), startSource: knownStarts.has(name) ? "registrar" : "estimate" };
    });
  } else {
    const p = planTerms(active, knownStarts, today);
    plan = p.plan;
    for (const s of p.skipped) log(`skip ${s.code} ${s.name}: started ${s.start} (${s.startSource})`);
  }
  if (!plan.length) {
    log("no upcoming terms to scrape");
    return;
  }
  log(`plan: ${plan.map((t) => `${t.code} ${t.name} (starts ${t.start}, ${t.startSource})`).join("; ")}`);

  const built: TermData[] = [];
  let failures = 0;
  for (const term of plan) {
    try {
      const data = await buildTerm(term, finalsHtml, env, args);
      const problems = validateTermData(data, await previousSectionCount(env, term.code));
      if (problems.length) throw new Error(`validation failed: ${problems.join("; ")}`);
      const out = join(ROOT, "out", `${term.code}.json`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(data));
      log(`wrote ${out}`);
      built.push(data);
    } catch (err) {
      failures++;
      fail(`term ${term.code} not published (previous data kept): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }

  if (args.dryRun) log("dry run: nothing published");
  else if (env && built.length) await publish(env, built);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
