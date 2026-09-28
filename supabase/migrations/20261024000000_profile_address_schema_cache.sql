-- Targeted repair for PGRST204: profiles.address absent from the API schema.
-- The profile client writes both canonical and legacy address spellings.
-- Safe to re-run in the SQL Editor; preserves existing rows, RLS and grants.
begin;
alter table public.profiles
  add column if not exists address text,
  add column if not exists full_address text;
notify pgrst, 'reload schema';
commit;
