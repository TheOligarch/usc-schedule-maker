-- Course catalogue per term, written by the nightly scraper (scraper/) and read by the AI functions.
-- Contract: shared build contract section 2.
create table public.courses (
  term_code   text    not null,
  code        text    not null,            -- "CSCI-201"
  title       text    not null,
  description text,
  ge          text[]  not null default '{}', -- current GE category codes only, e.g. {QREA}
  units_min   numeric not null,
  units_max   numeric not null,
  primary key (term_code, code)
);

comment on table public.courses is 'USC course catalogue per term. Upserted nightly by scraper/ with the service-role key.';

-- The AI GE shortlist filters by category: where ge @> array['QREA'].
create index courses_ge_idx on public.courses using gin (ge);

alter table public.courses enable row level security;

-- Read-only for the extension and the edge functions (anon key). There are no insert/update/
-- delete policies: only the service-role key, which bypasses RLS, can write.
create policy "courses are readable by everyone"
  on public.courses
  for select
  to anon, authenticated
  using (true);

grant select on public.courses to anon, authenticated;
