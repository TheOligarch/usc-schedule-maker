// Minimal Supabase REST client (Storage + one RPC) using the service-role key. No SDK dependency.

import { readFileSync, existsSync } from "node:fs";
import { USER_AGENT } from "./http.ts";

export interface SupabaseEnv {
  url: string;
  serviceKey: string;
}

/** Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment, then from scraper/.env (gitignored). */
export function loadSupabaseEnv(envFile: string): SupabaseEnv | null {
  const fileVars: Record<string, string> = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trimStart().startsWith("#")) fileVars[m[1] as string] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  const url = process.env.SUPABASE_URL || fileVars.SUPABASE_URL || "https://mmdvgvpckweiklkbuxvy.supabase.co";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileVars.SUPABASE_SERVICE_ROLE_KEY || "";
  return serviceKey ? { url: url.replace(/\/+$/, ""), serviceKey } : null;
}

function headers(env: SupabaseEnv, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "User-Agent": USER_AGENT, ...extra };
}

async function check(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.text()).slice(0, 300);
  throw new Error(`${what} failed: ${res.status} ${body}`);
}

export async function uploadJson(env: SupabaseEnv, bucket: string, path: string, json: string, cacheSeconds: number): Promise<void> {
  const res = await fetch(`${env.url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: headers(env, { "Content-Type": "application/json", "x-upsert": "true", "cache-control": `max-age=${cacheSeconds}` }),
    body: json,
    signal: AbortSignal.timeout(120_000),
  });
  await check(res, `upload ${bucket}/${path}`);
}

/** Returns null when the object does not exist. */
export async function downloadText(env: SupabaseEnv, bucket: string, path: string): Promise<string | null> {
  const res = await fetch(`${env.url}/storage/v1/object/authenticated/${bucket}/${path}`, {
    headers: headers(env),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404 || res.status === 400) return null;
  await check(res, `download ${bucket}/${path}`);
  return res.text();
}

export async function rpc<T>(env: SupabaseEnv, fn: string, args: unknown): Promise<T> {
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(env, { "Content-Type": "application/json" }),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(180_000),
  });
  await check(res, `rpc ${fn}`);
  return (await res.json()) as T;
}
