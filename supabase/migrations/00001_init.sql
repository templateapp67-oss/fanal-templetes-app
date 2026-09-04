-- ============================================================================
-- Nexora Salon OS — Supabase schema (migration 00001)
-- All salon data is multi-tenant, scoped to the owner (auth.uid()).
-- The signed-in user is the salon owner. Guests book through the trusted
-- Express server / Edge Functions which run with the service_role key.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================================================
-- Helper: keep updated_at fresh
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- PROFILES (1:1 with auth.users)
-- ============================================================================
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  salon_name         text,
  business_type      text,
  email              text,
  phone_number       text,
  whatsapp           text,
  owner_role         text,
  owner_photo_url    text,
  cover_image_url    text,
  logo_url           text,
  tagline            text,
  about              text,
  currency           text default '₹',
  subdomain          text unique,
  custom_domain      text,
  full_address       text,
  address_line2      text,
  city               text,
  postal_code        text,
  state              text,
  landmark           text,
  latitude           double precision,
  longitude          double precision,
  founding_year      text,
  instagram_handle   text,
  facebook_page      text,
  youtube_channel    text,
  tiktok_profile     text,
  google_business_url text,
  theme_preset       text,
  theme_accent_key   text,
  custom_accent_color text,
  require_deposit    boolean default false,
  deposit_percentage numeric(5,2) default 20,
  home_service       jsonb,
  working_hours      jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_owner" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_insert_owner" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_owner" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_owner" on public.profiles
  for delete using (id = auth.uid());

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- Auto-create a minimal profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- SERVICES
-- ============================================================================
create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  category         text default 'General',
  description      text,
  icon             text default 'sparkles',
  price            numeric(12,2) not null default 0,
  duration_minutes integer default 45,
  popular          boolean default false,
  show_duration    boolean default true,
  sort_order       integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.services enable row level security;
create index if not exists idx_services_owner on public.services(owner_id);

create policy "services_select_owner" on public.services
  for select using (owner_id = auth.uid());
create policy "services_insert_owner" on public.services
  for insert with check (owner_id = auth.uid());
create policy "services_update_owner" on public.services
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "services_delete_owner" on public.services
  for delete using (owner_id = auth.uid());

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
  before update on public.services
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- STYLISTS / STAFF
-- ============================================================================
create table if not exists public.stylists (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  role             text default 'Service Provider',
  avatar_url       text,
  bio              text,
  phone            text,
  specialties      jsonb default '[]'::jsonb,
  assigned_services jsonb default '[]'::jsonb,
  rating           numeric(3,2) default 5.0,
  commission_rate  numeric(5,2) default 0,
  status           text default 'Available',
  access_role      text default 'Service Provider (Assigned)',
  hide_phone       boolean default false,
  schedule         jsonb default '[]'::jsonb,
  sort_order       integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.stylists enable row level security;
create index if not exists idx_stylists_owner on public.stylists(owner_id);

create policy "stylists_select_owner" on public.stylists
  for select using (owner_id = auth.uid());
create policy "stylists_insert_owner" on public.stylists
  for insert with check (owner_id = auth.uid());
create policy "stylists_update_owner" on public.stylists
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "stylists_delete_owner" on public.stylists
  for delete using (owner_id = auth.uid());

drop trigger if exists trg_stylists_updated_at on public.stylists;
create trigger trg_stylists_updated_at
  before update on public.stylists
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- BOOKINGS (guest bookings; written via trusted server/service-role)
-- ============================================================================
create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  customer_name       text not null,
  customer_phone      text,
  customer_email      text,
  service_id          uuid,
  service_name        text,
  booking_date        date,
  time_slot           text,
  total_amount        numeric(12,2) default 0,
  advance_paid_amount numeric(12,2) default 0,
  status              text default 'pending',
  payment_status      text default 'pending',
  payment_id          text,
  booking_type        text default 'salon',
  home_address        text,
  proposed_date       date,
  proposed_time_slot  text,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table public.bookings enable row level security;
create index if not exists idx_bookings_owner on public.bookings(owner_id);
create index if not exists idx_bookings_created on public.bookings(created_at desc);

create policy "bookings_select_owner" on public.bookings
  for select using (owner_id = auth.uid());
create policy "bookings_insert_owner" on public.bookings
  for insert with check (owner_id = auth.uid());
create policy "bookings_update_owner" on public.bookings
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "bookings_delete_owner" on public.bookings
  for delete using (owner_id = auth.uid());

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- APPOINTMENTS (owned-logged-in staff view)
-- ============================================================================
create table if not exists public.appointments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  client_name   text not null,
  client_phone  text,
  client_email  text,
  service_id    uuid,
  service_name  text,
  service_price numeric(12,2) default 0,
  stylist_id    uuid,
  stylist_name  text,
  date          date,
  time          text,
  status        text default 'pending',
  payment_status text default 'pay_at_salon',
  amount_paid   numeric(12,2) default 0,
  created_at    timestamptz default now()
);

alter table public.appointments enable row level security;
create index if not exists idx_appointments_owner on public.appointments(owner_id);
create index if not exists idx_appointments_date on public.appointments(date desc);

create policy "appointments_select_owner" on public.appointments
  for select using (owner_id = auth.uid());
create policy "appointments_insert_owner" on public.appointments
  for insert with check (owner_id = auth.uid());
create policy "appointments_update_owner" on public.appointments
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "appointments_delete_owner" on public.appointments
  for delete using (owner_id = auth.uid());

-- ============================================================================
-- CLIENTS
-- ============================================================================
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  total_visits    integer default 0,
  total_spent     numeric(12,2) default 0,
  last_visit      date,
  notes           text,
  favorite_stylist text,
  points          integer default 0,
  lifetime_points integer default 0,
  loyalty_tier    text default 'bronze',
  point_history   jsonb default '[]'::jsonb,
  redeemed_rewards jsonb default '[]'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.clients enable row level security;
create index if not exists idx_clients_owner on public.clients(owner_id);
create index if not exists idx_clients_last_visit on public.clients(last_visit desc);

create policy "clients_select_owner" on public.clients
  for select using (owner_id = auth.uid());
create policy "clients_insert_owner" on public.clients
  for insert with check (owner_id = auth.uid());
create policy "clients_update_owner" on public.clients
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "clients_delete_owner" on public.clients
  for delete using (owner_id = auth.uid());

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- IN-APP NOTIFICATIONS
-- ============================================================================
create table if not exists public.in_app_notifications (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users(id) on delete cascade,
  user_email text not null,
  title      text,
  message    text,
  is_read    boolean default false,
  created_at timestamptz default now()
);

alter table public.in_app_notifications enable row level security;
create index if not exists idx_notifications_email on public.in_app_notifications(user_email, created_at desc);

create policy "notifications_select_owner" on public.in_app_notifications
  for select using (owner_id = auth.uid() or user_email = auth.jwt() ->> 'email');
create policy "notifications_insert_owner" on public.in_app_notifications
  for insert with check (owner_id = auth.uid() or owner_id is null);
create policy "notifications_update_owner" on public.in_app_notifications
  for update using (owner_id = auth.uid() or user_email = auth.jwt() ->> 'email');
create policy "notifications_delete_owner" on public.in_app_notifications
  for delete using (owner_id = auth.uid());

-- ============================================================================
-- LOYALTY
-- ============================================================================
create table if not exists public.loyalty_config (
  owner_id                 uuid primary key references auth.users(id) on delete cascade,
  program_enabled          boolean default true,
  points_per_visit         integer default 10,
  points_per_hundred_spent numeric(12,2) default 10,
  tier_thresholds          jsonb default '{"bronze":0,"silver":500,"gold":1000,"platinum":2000}'::jsonb,
  tier_multipliers         jsonb default '{"bronze":1,"silver":1.15,"gold":1.3,"platinum":1.5}'::jsonb,
  updated_at               timestamptz default now()
);

alter table public.loyalty_config enable row level security;

create policy "loyalty_config_select_owner" on public.loyalty_config
  for select using (owner_id = auth.uid());
create policy "loyalty_config_insert_owner" on public.loyalty_config
  for insert with check (owner_id = auth.uid());
create policy "loyalty_config_update_owner" on public.loyalty_config
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "loyalty_config_delete_owner" on public.loyalty_config
  for delete using (owner_id = auth.uid());

drop trigger if exists trg_loyalty_config_updated_at on public.loyalty_config;
create trigger trg_loyalty_config_updated_at
  before update on public.loyalty_config
  for each row execute procedure public.set_updated_at();

create table if not exists public.loyalty_rewards (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  title              text not null,
  required_points    integer default 0,
  reward_type        text default 'percentage_discount',
  discount_value     numeric(12,2) default 0,
  applicable_category text,
  description        text,
  is_active          boolean default true,
  coupon_code_prefix text,
  sort_order         integer default 0,
  created_at         timestamptz default now()
);

alter table public.loyalty_rewards enable row level security;
create index if not exists idx_loyalty_rewards_owner on public.loyalty_rewards(owner_id);

create policy "rewards_select_owner" on public.loyalty_rewards
  for select using (owner_id = auth.uid());
create policy "rewards_insert_owner" on public.loyalty_rewards
  for insert with check (owner_id = auth.uid());
create policy "rewards_update_owner" on public.loyalty_rewards
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "rewards_delete_owner" on public.loyalty_rewards
  for delete using (owner_id = auth.uid());

create table if not exists public.loyalty_point_transactions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete cascade,
  date          date default current_date,
  description   text,
  points_change integer default 0,
  type          text default 'spend_earned',
  created_at    timestamptz default now()
);

alter table public.loyalty_point_transactions enable row level security;
create index if not exists idx_point_tx_owner on public.loyalty_point_transactions(owner_id);
create index if not exists idx_point_tx_client on public.loyalty_point_transactions(client_id);

create policy "point_tx_select_owner" on public.loyalty_point_transactions
  for select using (owner_id = auth.uid());
create policy "point_tx_insert_owner" on public.loyalty_point_transactions
  for insert with check (owner_id = auth.uid());
create policy "point_tx_update_owner" on public.loyalty_point_transactions
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "point_tx_delete_owner" on public.loyalty_point_transactions
  for delete using (owner_id = auth.uid());

create table if not exists public.loyalty_redeemed_rewards (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,
  reward_id        uuid references public.loyalty_rewards(id) on delete set null,
  reward_title     text,
  discount_summary text,
  points_spent     integer default 0,
  redeemed_at      date default current_date,
  coupon_code      text,
  status           text default 'active',
  created_at       timestamptz default now()
);

alter table public.loyalty_redeemed_rewards enable row level security;
create index if not exists idx_redeemed_owner on public.loyalty_redeemed_rewards(owner_id);
create index if not exists idx_redeemed_client on public.loyalty_redeemed_rewards(client_id);

create policy "redeemed_select_owner" on public.loyalty_redeemed_rewards
  for select using (owner_id = auth.uid());
create policy "redeemed_insert_owner" on public.loyalty_redeemed_rewards
  for insert with check (owner_id = auth.uid());
create policy "redeemed_update_owner" on public.loyalty_redeemed_rewards
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "redeemed_delete_owner" on public.loyalty_redeemed_rewards
  for delete using (owner_id = auth.uid());

-- ============================================================================
-- DEMO DATA HELPER — call once an auth user exists:
--   select public.seed_demo_data('<owner-uuid>', 'Miraki Studio', 'Bengaluru');
-- It is NOT run automatically so it won't fail before the owner exists.
-- ============================================================================
create or replace function public.seed_demo_data(
  p_owner_id uuid,
  p_salon_name text default 'Miraki Studio',
  p_city text default 'Bengaluru'
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s_id uuid;
  st1 uuid; st2 uuid; st3 uuid;
begin
  insert into public.services (owner_id, name, category, price, duration_minutes, description, icon, popular, sort_order)
  values
    (p_owner_id, 'Master Stylist Precision Cut & Blowdry', 'Hair', 750, 60, 'Signature cut by our senior stylists.', 'scissors', true, 1),
    (p_owner_id, 'Classic Layered Cut & Argan Wash', 'Hair', 450, 45, 'Relaxing cut and cleanse.', 'scissors', false, 2),
    (p_owner_id, 'Formaldehyde-Free Keratin Smoothing', 'Treatments', 4200, 120, 'Frizz-free, long-lasting smoothness.', 'sparkles', true, 3),
    (p_owner_id, 'Hair Botox Deep Fiber Reconstruction', 'Treatments', 3600, 90, 'Repairs and rebuilds hair fibers.', 'sparkles', false, 4),
    (p_owner_id, 'Bridal Makeup & Hair Styling', 'Bridal', 15000, 180, 'Full bridal glam with trial.', 'heart', true, 5)
  returning id into s_id; -- not strictly used, keeps the helper robust

  insert into public.stylists (owner_id, name, role, avatar_url, specialties, rating, commission_rate, status, access_role, schedule)
  values
    (p_owner_id, 'Ananya Sharma', 'Senior Stylist', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '["Cuts","Keratin"]', 4.9, 30, 'Available', 'Manager (Full Access)', '[]'::jsonb),
    (p_owner_id, 'Rohan Kapoor', 'Barber & Stylist', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '["Men grooming","Cuts"]', 4.8, 25, 'Available', 'Service Provider (Assigned)', '[]'::jsonb),
    (p_owner_id, 'Kavita Deshmukh', 'Hair Specialist', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&auto=format&fit=crop&q=80', '["Color","Botox"]', 4.9, 30, 'Available', 'Service Provider (Assigned)', '[]'::jsonb);

  insert into public.clients (owner_id, name, phone, email, total_visits, total_spent, last_visit, notes, favorite_stylist, points, lifetime_points, loyalty_tier, point_history)
  values
    (p_owner_id, 'Pooja Mehra', '+91 98451 22910', 'pooja.mehra@gmail.com', 7, 18400, current_date - 21, 'Regular Keratin client.', 'Ananya Sharma', 1150, 2190, 'platinum', '[]'::jsonb),
    (p_owner_id, 'Siddharth Verma', '+91 98201 44589', 'siddharth.verma@techcorp.in', 5, 4250, current_date - 15, 'Razor texture crown.', 'Rohan Kapoor', 425, 675, 'silver', '[]'::jsonb),
    (p_owner_id, 'Meera Iyer', '+91 98860 33419', 'meera.iyer@designhouse.in', 9, 26500, current_date - 10, 'VIP bridal client.', 'Ananya Sharma', 1650, 3100, 'platinum', '[]'::jsonb);

  insert into public.loyalty_config (owner_id, program_enabled, points_per_visit, points_per_hundred_spent)
  values (p_owner_id, true, 10, 10)
  on conflict (owner_id) do nothing;

  insert into public.loyalty_rewards (owner_id, title, required_points, reward_type, discount_value, description, is_active, coupon_code_prefix, sort_order)
  values
    (p_owner_id, '10% OFF Next Visit', 300, 'percentage_discount', 10, 'Redeem for 10% off any service.', true, 'LOYAL', 1),
    (p_owner_id, 'Free Deluxe Scalp Detox', 1200, 'free_service', 100, 'Complimentary scalp treatment.', true, 'FREESPA', 2),
    (p_owner_id, '20% OFF Premium Treatments', 750, 'percentage_discount', 20, 'On full-price premium services.', true, 'ROYAL', 3);

  return p_owner_id;
end;
$$;
