-- Preserve local/template identifiers without sending them to UUID columns.
-- Existing deployments can apply this migration independently of 00001_init.sql.
alter table if exists public.bookings
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table if exists public.bookings
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_bookings_user on public.bookings(user_id);
