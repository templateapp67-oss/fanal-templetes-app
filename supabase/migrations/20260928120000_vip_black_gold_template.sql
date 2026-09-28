-- VIP Black & Gold template — tenant-scoped settings and concierge requests.
-- Uses the existing auth user / owner profile as the salon identity. No second
-- database, account, or duplicate salon record is created.

alter table public.profiles
  add column if not exists vip_experience jsonb not null default
  '{"enabled":true,"inviteOnly":false,"conciergeLabel":"VIP Concierge","privateSuiteEnabled":true}'::jsonb;

create table if not exists public.vip_concierge_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  requested_service_id uuid references public.services(id) on delete set null,
  preferred_stylist_id uuid references public.stylists(id) on delete set null,
  preferred_at timestamptz,
  private_suite boolean not null default true,
  note text,
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vip_concierge_requests_owner_created
  on public.vip_concierge_requests(owner_id, created_at desc);
create index if not exists idx_vip_concierge_requests_customer
  on public.vip_concierge_requests(customer_id, created_at desc);

alter table public.vip_concierge_requests enable row level security;

drop policy if exists "vip_concierge_owner_manage" on public.vip_concierge_requests;
create policy "vip_concierge_owner_manage" on public.vip_concierge_requests
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "vip_concierge_customer_read_own" on public.vip_concierge_requests;
create policy "vip_concierge_customer_read_own" on public.vip_concierge_requests
  for select to authenticated
  using ((select auth.uid()) = customer_id);

drop trigger if exists trg_vip_concierge_requests_updated_at on public.vip_concierge_requests;
create trigger trg_vip_concierge_requests_updated_at
  before update on public.vip_concierge_requests
  for each row execute procedure public.set_updated_at();

grant select, insert, update, delete on public.vip_concierge_requests to authenticated;
