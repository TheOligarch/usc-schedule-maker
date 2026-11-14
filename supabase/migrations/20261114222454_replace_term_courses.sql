-- Atomic per-term swap of public.courses, called by the scraper (service-role key) only after a
-- complete, successful scrape. Delete + insert run in one transaction, so readers see either the
-- previous catalogue or the new one, never a mix or an empty term.
create or replace function public.replace_term_courses(p_term_code text, p_courses jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  inserted integer;
begin
  if p_term_code !~ '^\d{5}$' then
    raise exception 'bad term code %', p_term_code;
  end if;
  if jsonb_typeof(p_courses) <> 'array' or jsonb_array_length(p_courses) = 0 then
    raise exception 'refusing to replace term % with an empty course list', p_term_code;
  end if;

  delete from public.courses where term_code = p_term_code;

  insert into public.courses (term_code, code, title, description, ge, units_min, units_max)
  select p_term_code,
         c->>'code',
         c->>'title',
         c->>'description',
         coalesce(array(select jsonb_array_elements_text(c->'ge')), '{}'),
         (c->>'units_min')::numeric,
         (c->>'units_max')::numeric
  from jsonb_array_elements(p_courses) as c;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.replace_term_courses(text, jsonb) is
  'Scraper-only: atomically replaces all courses rows of one term. Executable by service_role only.';

revoke all on function public.replace_term_courses(text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_term_courses(text, jsonb) to service_role;

-- Private bucket for scraper-internal caches (the once-per-semester RMP snapshot). Not public:
-- only the service-role key can read or write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scraper-cache', 'scraper-cache', false, 52428800, array['application/json'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
