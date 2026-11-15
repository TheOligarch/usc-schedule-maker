-- Rate limiting for the AI edge functions (interview, explain, refine, ai-health).
-- The functions call public.ai_rate_limit_take with the service-role key before every model call,
-- charging that call's weight (units of roughly 1,000 prompt tokens, see the README).
-- Privacy (see supabase/functions/README.md "Rate limits"): bucket keys hold only a random
-- per-install UUID or a salted hash of the client IP, never a raw IP, and every row is deleted
-- once its window ends (on the next write and by the hourly job below), so no row outlives 48 hours.

create table public.ai_rate_counters (
  bucket       text        not null,  -- "<scope>:<endpoint>:<id>", e.g. "user:interview:<uuid>"
  window_start timestamptz not null,  -- start of the fixed hour or UTC-day window
  expires_at   timestamptz not null,  -- end of that window; the row is deleted after it
  hits         integer     not null default 0,  -- weighted units used in this window
  primary key (bucket, window_start),
  constraint ai_rate_counters_bucket_len check (char_length(bucket) <= 200)
);

comment on table public.ai_rate_counters is
  'AI request counters per fixed window. Written only by ai_rate_limit_take (service role); rows are deleted when their window ends.';

create index ai_rate_counters_expires_idx on public.ai_rate_counters (expires_at);

-- RLS on with no policies, and no table privileges for the public roles: the anon key can neither
-- read nor write counters. Only the service role (which bypasses RLS) and the function below can.
alter table public.ai_rate_counters enable row level security;
revoke all on table public.ai_rate_counters from public, anon, authenticated;

-- Charges p_weight units (one model call) against every bucket in p_buckets, atomically.
-- p_buckets: [{ "key": text, "window": seconds (60..86400), "limit": integer >= 0, "scope": text }, ...]
-- Returns {"allowed": true}, or {"allowed": false, "scope", "retryAfter", "limit", "window"} for the
-- exceeded bucket that frees up last (on a tie, the later one in p_buckets). A denied call is
-- not counted in any bucket, so a client that keeps retrying while blocked does not extend its wait.
create or replace function public.ai_rate_limit_take(p_buckets jsonb, p_weight integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        jsonb;
  v_now    timestamptz := now();
  v_window integer;
  v_limit  integer;
  v_start  timestamptz;
  v_end    timestamptz;
  v_hits   integer;
  v_retry  integer;
  v_denied jsonb := null;
begin
  if jsonb_typeof(p_buckets) <> 'array' or jsonb_array_length(p_buckets) = 0 or jsonb_array_length(p_buckets) > 8 then
    raise exception 'p_buckets must be an array of 1 to 8 buckets';
  end if;
  if p_weight is null or p_weight < 1 or p_weight > 100000 then
    raise exception 'p_weight must be between 1 and 100000';
  end if;

  for b in select value from jsonb_array_elements(p_buckets) loop
    v_window := (b->>'window')::integer;
    v_limit := (b->>'limit')::integer;
    if v_window is null or v_window < 60 or v_window > 86400 or v_limit is null or v_limit < 0
       or coalesce(b->>'key', '') = '' then
      raise exception 'bad bucket %', b;
    end if;
  end loop;

  -- Delete-on-write cleanup: finished windows are never needed again.
  delete from public.ai_rate_counters where expires_at <= v_now;

  begin
    for b in select value from jsonb_array_elements(p_buckets) loop
      v_window := (b->>'window')::integer;
      v_limit := (b->>'limit')::integer;
      v_start := to_timestamp(floor(extract(epoch from v_now) / v_window) * v_window);
      v_end := v_start + make_interval(secs => v_window);

      insert into public.ai_rate_counters as c (bucket, window_start, expires_at, hits)
      values (b->>'key', v_start, v_end, p_weight)
      on conflict (bucket, window_start) do update set hits = c.hits + p_weight
      returning c.hits into v_hits;

      if v_hits > v_limit then
        v_retry := greatest(1, ceil(extract(epoch from (v_end - v_now)))::integer);
        if v_denied is null or v_retry >= (v_denied->>'retryAfter')::integer then
          v_denied := jsonb_build_object('scope', b->>'scope', 'retryAfter', v_retry, 'limit', v_limit, 'window', v_window);
        end if;
      end if;
    end loop;

    if v_denied is not null then
      -- Rolls back this block's increments; v_denied survives because variables are not transactional.
      raise exception using errcode = 'P0001', message = 'usm_rate_limited';
    end if;
  exception
    when raise_exception then
      if v_denied is null then
        raise;
      end if;
  end;

  if v_denied is not null then
    return jsonb_build_object('allowed', false) || v_denied;
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;

comment on function public.ai_rate_limit_take(jsonb, integer) is
  'AI functions only: atomically charges one model call''s weight to each bucket, or denies it without charging. Executable by service_role only.';

revoke all on function public.ai_rate_limit_take(jsonb, integer) from public, anon, authenticated;
grant execute on function public.ai_rate_limit_take(jsonb, integer) to service_role;

-- Scheduled cleanup, so rows are removed even when no request arrives to trigger delete-on-write.
-- The 48-hour clause is a backstop on top of expires_at (windows are at most 24 hours long).
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'usm-ai-rate-counters-cleanup',
  '17 * * * *',
  $$delete from public.ai_rate_counters where expires_at <= now() or window_start < now() - interval '48 hours'$$
);
