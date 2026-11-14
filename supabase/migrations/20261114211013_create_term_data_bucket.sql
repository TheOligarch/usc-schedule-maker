-- Public bucket holding the per-term schedule data files the extension downloads:
--   term-data/index.json, term-data/<termCode>.json  (shared build contract section 1)
-- "public = true" lets anyone GET an object by URL
--   https://<project>.supabase.co/storage/v1/object/public/term-data/<path>
-- No storage.objects policies are added on purpose: reads go through the public URL and
-- writes only ever come from the scraper's service-role key, which bypasses RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('term-data', 'term-data', true, 52428800, array['application/json'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
