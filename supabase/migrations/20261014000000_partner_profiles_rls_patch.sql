-- Migration to ensure partner_profiles exists with the required RLS policy
create table if not exists public.partner_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_profiles enable row level security;

drop policy if exists "Users can update own partner profile" on public.partner_profiles;
create policy "Users can update own partner profile" 
  on public.partner_profiles for update 
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can select own partner profile" on public.partner_profiles;
create policy "Users can select own partner profile" 
  on public.partner_profiles for select 
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own partner profile" on public.partner_profiles;
create policy "Users can insert own partner profile" 
  on public.partner_profiles for insert 
  with check (auth.uid() = user_id);

grant select, insert, update on public.partner_profiles to authenticated;
grant select, insert, update on public.partner_profiles to anon;
