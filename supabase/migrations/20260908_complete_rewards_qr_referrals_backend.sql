-- ============================================================================
-- Nexora Salon OS — Complete Rewards / QR-payments / Referrals backend repair
-- Migration: 20260908_complete_rewards_qr_referrals_backend.sql
-- ----------------------------------------------------------------------------
-- ONE idempotent file. Safe to run repeatedly (supabase db push / SQL editor).
-- Preserves all existing data. Drops nothing (policies are created only when
-- missing; triggers are added only when missing; indexes are IF NOT EXISTS).
--
-- MODULE → ACTUAL-SCHEMA MAP (nothing is silently skipped; see each section)
-- ----------------------------------------------------------------------------
--   Required module            Actual repo storage                        Action
--   ─────────────────────────  ─────────────────────────────────────────  ─────
--   1. loyalty_config          public.loyalty_config (00001_init.sql,     repair
--                              PK owner_id → auth.users, per-owner row)
--   2. loyalty_tiers           NO table today: the tier ladder lives in   create +
--                              loyalty_config.tier_thresholds /
--                              tier_multipliers (jsonb) and the current
--                              tier name on clients.loyalty_tier
--   3. loyalty_point_          public.loyalty_point_transactions (00001)  repair
--      transactions
--   4. reward_wallets          canonical wallet rows live in              create +
--                              public.clients (owner-scoped; the app's     backfill
--                              wallet/ledger engine reads/writes clients)
--   5. customer_qr_payments    QR payment claims are ledger rows          create +
--                              (type 'qr_payment') written by the          backfill
--                              customer QR flow + Razorpay verification
--   6. referrals               bookings.metadata.referral_code +          create +
--                              check-in credit snapshots + 'bonus'         backfill
--                              ledger rows (repo-native, engine in
--                              server/bookingCheckin.ts)
--   7. supabase_realtime       no migration ever touches the publication  add at
--                              (the customer app subscribes to            the END
--                              in_app_notifications via postgres_changes)
--
-- OWNER-IDENTITY RULE
--   Every module table keys the salon owner as owner_id uuid NOT NULL
--   REFERENCES auth.users(id) — the canonical owner identity used by all
--   tenant tables in 00001_init.sql (profiles.id is itself a FK to
--   auth.users(id); no other owner column exists to map).
--   Customer identity is auth.users(id) too; on the canonical booking row it
--   is stored as bookings.user_id (added by 20260907_booking_metadata.sql),
--   and backfills below resolve it by email/phone into the new
--   customer_user_id / referred_user_id columns wherever a booking proves it.
--
-- REQUIRED-COLUMN MATRIX (where each required column genuinely applies)
--   owner_id          → all module tables (FK auth.users)
--   customer_user_id  → reward_wallets, customer_qr_payments,
--                       loyalty_point_transactions (backfilled from
--                       bookings.user_id via email/phone)
--   referrer_user_id  → referrals (backfilled by the same derivation rule
--                       the check-in engine uses: NX-<first-8 hex of uid>)
--   referred_user_id  → referrals (← bookings.user_id)
--   status            → loyalty_tiers, reward_wallets, customer_qr_payments,
--                       referrals (canonical booking state stays on
--                       bookings.status; ledger state lives in `type` +
--                       the description state machine written by the one
--                       ledger writer — an unmaintained `status` column
--                       there would silently lie, so it is not invented)
--   points_awarded    → customer_qr_payments, referrals,
--                       loyalty_point_transactions (STORED generated mirror
--                       of points_change so it can never drift)
--   metadata          → every module table (jsonb, NOT NULL default '{}')
--   created_at / updated_at → every module table (+ updated_at triggers)
--
-- IDEMPOTENCY ANCHORS
--   loyalty_config            PK (owner_id)
--   loyalty_tiers             unique (owner_id, tier_key)
--   loyalty_point_transactions dedupe_key partial-unique (owner_id,
--                              dedupe_key) — QR references keep the row
--                              earliest per (client, ref), never re-keyed
--   reward_wallets            unique (owner_id, client_id)
--   customer_qr_payments      partial-unique (owner_id, reference) where
--                              reference <> ''
--   referrals                 partial-unique (owner_id, booking_id) where
--                              booking_id is not null (one referral per
--                              booking, matching the check-in credit rule)
-- ============================================================================

-- ============================================================================
-- 0. Extensions + helper functions (idempotent)
-- ============================================================================
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Adds a `before update` trigger calling public.set_updated_at() to a public
-- table, unless one already exists (never drops a trigger that is there).
create or replace function public.ensure_updated_at_trigger(p_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from pg_trigger trg
    join pg_class cls on cls.oid = trg.tgrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = p_table
      and not trg.tgisinternal
  ) then
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I for each row execute procedure public.set_updated_at()',
      p_table, p_table
    );
  end if;
end;
$$;

-- Creates the repo-standard owner-scoped RLS policy family on a table when the
-- policies are missing (never drops/replaces an existing policy):
--   <table>_select_owner / _insert_owner / _update_owner / _delete_owner
-- Owner scope is auth.uid() on `owner_id` — the rule used by every table in
-- 00001_init.sql. Policies are granted to the `authenticated` role only.
create or replace function public.ensure_owner_scoped_rls(p_table text, p_owner_column text default 'owner_id')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text := 'owner_id';
begin
  if p_owner_column <> '' then
    -- Only a plain lower-case identifier may be used in the dynamic DDL.
    if p_owner_column ~ '^[a-z][a-z0-9_]*$' then
      v_owner := p_owner_column;
    end if;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_table || '_select_owner'
  ) then
    execute format(
      'create policy %I on public.%I for select to authenticated using (%I = (select auth.uid()))',
      p_table || '_select_owner', p_table, v_owner
    );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_table || '_insert_owner'
  ) then
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%I = (select auth.uid()))',
      p_table || '_insert_owner', p_table, v_owner
    );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_table || '_update_owner'
  ) then
    -- UPDATE policies must constrain BOTH sides: the row being changed and
    -- the row the change would produce.
    execute format(
      'create policy %I on public.%I for update to authenticated using (%I = (select auth.uid())) with check (%I = (select auth.uid()))',
      p_table || '_update_owner', p_table, v_owner, v_owner
    );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_table and policyname = p_table || '_delete_owner'
  ) then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%I = (select auth.uid()))',
      p_table || '_delete_owner', p_table, v_owner
    );
  end if;
end;
$$;

-- ============================================================================
-- 1. MODULE loyalty_config — REPAIR (table exists from 00001_init.sql)
--    Missing required columns today: created_at. owner_id (PK → auth.users),
--    updated_at, tier_thresholds/tier_multipliers (the tier metadata this
--    module owns) and bonus columns already exist; 20260908_member_bonuses
--    added birthday_bonus_points / referral_bonus_points.
-- ============================================================================
alter table if exists public.loyalty_config
  add column if not exists created_at timestamptz default now();

comment on column public.loyalty_config.created_at is
  'Created for the required created_at/updated_at pair (updated_at existed from 00001).';

select public.ensure_updated_at_trigger('loyalty_config');

-- ============================================================================
-- 2. MODULE loyalty_tiers — CREATE + BACKFILL
--    The tier ladder currently lives only inside loyalty_config jsonb
--    (tier_thresholds / tier_multipliers). This is the relational form of the
--    same ladder, backfilled per owner from their own config so nothing that
--    owners already configured is lost or guessed.
-- ============================================================================
create table if not exists public.loyalty_tiers (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  tier_key            text not null,
  tier_name           text not null default '',
  min_lifetime_points integer not null default 0,
  points_multiplier   numeric(5,2) not null default 1.00,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  status              text not null default 'active',
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_loyalty_tiers_owner_key unique (owner_id, tier_key)
);

create index if not exists idx_loyalty_tiers_owner on public.loyalty_tiers(owner_id, sort_order);

-- Backfill: one row per (owner, ladder key) taken from that owner's own
-- loyalty_config jsonb. Fixed default ladder bronze/silver/gold/platinum is
-- used only when the config row or a key inside it is absent. Re-runs are
-- no-ops (unique owner_id + tier_key).
insert into public.loyalty_tiers
  (owner_id, tier_key, tier_name, min_lifetime_points, points_multiplier, is_active, sort_order, status, metadata, created_at, updated_at)
select
  cfg.owner_id,
  ladder.tier_key,
  case ladder.tier_key
    when 'bronze'   then 'Bronze'
    when 'silver'   then 'Silver'
    when 'gold'     then 'Gold'
    when 'platinum' then 'Platinum'
    else ladder.tier_key
  end,
  case when (cfg.tier_thresholds ->> ladder.tier_key) ~ '^[0-9]+$'
       then (cfg.tier_thresholds ->> ladder.tier_key)::integer else 0 end,
  case when (cfg.tier_multipliers ->> ladder.tier_key) ~ '^[0-9]+(\.[0-9]+)?$'
       then (cfg.tier_multipliers ->> ladder.tier_key)::numeric(5,2) else 1.00 end,
  true,
  ladder.sort_order,
  'active',
  jsonb_build_object(
    'source', 'backfill:loyalty_config',
    'threshold_jsonb', cfg.tier_thresholds ->> ladder.tier_key,
    'multiplier_jsonb', cfg.tier_multipliers ->> ladder.tier_key
  ),
  now(),
  now()
from public.loyalty_config cfg
cross join lateral (
  values
    ('bronze'   , 1),
    ('silver'   , 2),
    ('gold'     , 3),
    ('platinum' , 4)
) as ladder(tier_key, sort_order)
on conflict (owner_id, tier_key) do nothing;

alter table public.loyalty_tiers enable row level security;
select public.ensure_owner_scoped_rls('loyalty_tiers');
select public.ensure_updated_at_trigger('loyalty_tiers');

-- ============================================================================
-- 3. MODULE loyalty_point_transactions — REPAIR (table exists from 00001)
--    Adds: customer_user_id (+backfill via bookings), updated_at (+trigger),
--    metadata, points_awarded (generated mirror — can never drift from
--    points_change), and a dedupe_key idempotency anchor for QR references.
-- ============================================================================
alter table if exists public.loyalty_point_transactions
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.loyalty_point_transactions
  add column if not exists updated_at timestamptz default now();

alter table if exists public.loyalty_point_transactions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.loyalty_point_transactions
  add column if not exists points_awarded integer
  generated always as (case when points_change > 0 then points_change else 0 end) stored;

alter table if exists public.loyalty_point_transactions
  add column if not exists dedupe_key text;

comment on column public.loyalty_point_transactions.customer_user_id is
  'auth.users id resolved from the paying/booking identity (bookings.user_id via client email/phone). Null until a booking proves it.';
comment on column public.loyalty_point_transactions.points_awarded is
  'STORED generated column mirroring points_change when positive — the audit-friendly award amount that cannot drift.';
comment on column public.loyalty_point_transactions.dedupe_key is
  'Idempotency anchor. For qr_payment rows: qr:<client_id>:<ref:…> on the EARLIEST row of a duplicate set only.';

-- Backfill customer_user_id from bookings.user_id through the client row
-- (email or digit-normalised phone must match, exactly like the wallet
-- resolution in the customer API). Re-runs update nothing (already set).
with identity_map as (
  select distinct on (cl.id)
         cl.id as client_id,
         bk.user_id
  from public.clients cl
  join public.bookings bk
    on (bk.customer_email is not null and lower(bk.customer_email) = lower(cl.email))
    or (bk.customer_phone is not null
        and regexp_replace(bk.customer_phone, '\D', '', 'g') = regexp_replace(cl.phone, '\D', '', 'g'))
  where bk.user_id is not null
  order by cl.id, bk.created_at desc
)
update public.loyalty_point_transactions tx
set customer_user_id = identity_map.user_id
from identity_map
where tx.client_id = identity_map.client_id
  and tx.customer_user_id is null;

-- Backfill dedupe_key for qr_payment rows: only the earliest row of any
-- duplicate (owner, client, reference) set receives the key, so the unique
-- index below can never fail on legacy duplicates.
with qr_refs as (
  select
    tx.id,
    tx.owner_id,
    tx.client_id,
    (regexp_match(tx.description, 'ref:(\S+)'))[1] as ref,
    row_number() over (
      partition by tx.owner_id, tx.client_id, (regexp_match(tx.description, 'ref:(\S+)'))[1]
      order by tx.created_at, tx.id
    ) as rn
  from public.loyalty_point_transactions tx
  where tx.type = 'qr_payment'
)
update public.loyalty_point_transactions tx
set dedupe_key = 'qr:' || qr_refs.client_id::text || ':' || qr_refs.ref
from qr_refs
where tx.id = qr_refs.id
  and qr_refs.rn = 1
  and qr_refs.ref is not null
  and tx.dedupe_key is null;

create unique index if not exists uq_point_tx_dedupe_key
  on public.loyalty_point_transactions(owner_id, dedupe_key)
  where dedupe_key is not null;

select public.ensure_updated_at_trigger('loyalty_point_transactions');

-- ============================================================================
-- 4. MODULE reward_wallets — CREATE + BACKFILL
--    The canonical wallet the running app reads/writes is public.clients
--    (owner-scoped rows keyed by client id). reward_wallets is created as the
--    relational wallet projection of the same rows: every clients row is
--    mirrored here ONCE (unique owner_id + client_id) with the balances the
--    app maintains. The app remains the writer on clients; this table is the
--    stable, spec-shaped read projection and the future write target.
-- ============================================================================
create table if not exists public.reward_wallets (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  client_id        uuid not null references public.clients(id) on delete cascade,
  name             text not null default '',
  phone            text,
  email            text,
  currency         text not null default '₹',
  points           integer not null default 0,
  lifetime_points  integer not null default 0,
  total_spent      numeric(12,2) not null default 0,
  total_visits     integer not null default 0,
  loyalty_tier_key text,
  last_visit       date,
  status           text not null default 'active',
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_reward_wallets_owner_client unique (owner_id, client_id)
);

create index if not exists idx_reward_wallets_customer on public.reward_wallets(customer_user_id);
create index if not exists idx_reward_wallets_owner_phone on public.reward_wallets(owner_id, phone);

-- Backfill from clients (mirror). Re-runs are no-ops via the unique anchor.
insert into public.reward_wallets
  (owner_id, customer_user_id, client_id, name, phone, email, currency, points,
   lifetime_points, total_spent, total_visits, loyalty_tier_key, last_visit,
   status, metadata, created_at, updated_at)
select
  cl.owner_id,
  null,                        -- resolved below from bookings (step 2)
  cl.id,
  cl.name,
  cl.phone,
  cl.email,
  '₹',
  coalesce(cl.points, 0),
  coalesce(cl.lifetime_points, 0),
  coalesce(cl.total_spent, 0),
  coalesce(cl.total_visits, 0),
  cl.loyalty_tier,
  cl.last_visit,
  'active',
  jsonb_build_object('source', 'backfill:clients'),
  now(),
  now()
from public.clients cl
on conflict (owner_id, client_id) do nothing;

-- customer_user_id resolution (same identity_map rule as §3).
with identity_map as (
  select distinct on (cl.id)
         cl.id as client_id,
         bk.user_id
  from public.clients cl
  join public.bookings bk
    on (bk.customer_email is not null and lower(bk.customer_email) = lower(cl.email))
    or (bk.customer_phone is not null
        and regexp_replace(bk.customer_phone, '\D', '', 'g') = regexp_replace(cl.phone, '\D', '', 'g'))
  where bk.user_id is not null
  order by cl.id, bk.created_at desc
)
update public.reward_wallets w
set customer_user_id = identity_map.user_id,
    metadata = w.metadata || jsonb_build_object('identity_resolved_from', 'bookings')
from identity_map
where w.client_id = identity_map.client_id
  and w.customer_user_id is null;

alter table public.reward_wallets enable row level security;
select public.ensure_owner_scoped_rls('reward_wallets');
select public.ensure_updated_at_trigger('reward_wallets');

-- ============================================================================
-- 5. MODULE customer_qr_payments — CREATE + BACKFILL
--    Canonical QR-payment claims are ledger rows (type 'qr_payment', single
--    writer in the customer QR flow, verified by the Razorpay gateway before
--    any points move). customer_qr_payments is the relational form of those
--    claims; rows are backfilled from the ledger, deduplicated to the
--    earliest claim per (owner, reference), and the partial unique index on
--    reference is the hard idempotency guard for new writes.
-- ============================================================================
create table if not exists public.customer_qr_payments (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  customer_user_id   uuid references auth.users(id) on delete set null,
  client_id          uuid references public.clients(id) on delete set null,
  amount             numeric(12,2) not null default 0,
  currency           text not null default '₹',
  reference          text not null default '',
  status             text not null default 'awaiting_verification',
  gateway_payment_id text,
  points_awarded     integer not null default 0,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.customer_qr_payments.reference is
  'QR reference logged on the claim (ref:… in the ledger description). Non-empty values are unique per owner — the idempotency anchor.';
comment on column public.customer_qr_payments.status is
  'awaiting_verification → verified / below_minimum. Mirrors the ledger state words the single QR writer stores in the description.';

create unique index if not exists uq_customer_qr_payments_reference
  on public.customer_qr_payments(owner_id, reference)
  where reference <> '';

create index if not exists idx_customer_qr_payments_customer on public.customer_qr_payments(customer_user_id);
create index if not exists idx_customer_qr_payments_status on public.customer_qr_payments(owner_id, status);

-- Backfill from the ledger's qr_payment rows. The description format is owned
-- by one writer (qrLedgerDescription):  "QR payment (state) ₹<amount> ref:<ref>"
-- with state ∈ {awaiting verification, verified <gateway id>, below earning
-- minimum}. Amount is matched in ASCII digits so the file stays encoding-safe.
insert into public.customer_qr_payments
  (owner_id, customer_user_id, client_id, amount, currency, reference, status,
   gateway_payment_id, points_awarded, metadata, created_at, updated_at)
select distinct on (parsed.owner_id, parsed.reference)
  parsed.owner_id,
  null,                      -- resolved below from bookings (step 2)
  parsed.client_id,
  parsed.amount,
  '₹',
  parsed.reference,
  parsed.status,
  parsed.gateway_payment_id,
  greatest(parsed.points_change, 0),
  jsonb_build_object('source', 'backfill:loyalty_point_transactions', 'ledger_id', parsed.ledger_id),
  parsed.created_at,
  coalesce(parsed.updated_at, parsed.created_at)
from (
  select
    tx.id as ledger_id,
    tx.owner_id,
    tx.client_id,
    tx.points_change,
    tx.created_at,
    tx.updated_at,
    (regexp_match(tx.description, 'ref:(\S+)'))[1]                        as reference,
    -- The ledger writer always prints the amount immediately after "₹"
    -- (₹<digits>[.<digits>]), so match right after the rupee mark instead of
    -- the first number anywhere in the description (which could be a
    -- gateway/payment id inside the state words). Legacy descriptions with
    -- thousands separators (₹1,200.50) are tolerated by stripping commas
    -- before the cast — a parse failure must never silently drop a claim.
    nullif(
      regexp_replace(
        coalesce((regexp_match(tx.description, '₹([0-9]+(,[0-9]{3})*(\.[0-9]{1,2})?)'))[1], ''),
        ',', '', 'g'
      ),
      ''
    )::numeric(12,2) as amount,
    case
      when tx.description like '%below earning minimum%' then 'below_minimum'
      when tx.description like '%verified%'              then 'verified'
      when tx.description like '%awaiting verification%' then 'awaiting_verification'
      else 'recorded'
    end as status,
    (regexp_match(tx.description, 'verified ([A-Za-z0-9_]+)'))[1] as gateway_payment_id
  from public.loyalty_point_transactions tx
  where tx.type = 'qr_payment'
    and tx.description is not null
) parsed
where parsed.reference is not null
  and parsed.reference <> ''
  and parsed.amount is not null
order by parsed.owner_id, parsed.reference, parsed.created_at, parsed.ledger_id
on conflict (owner_id, reference) where reference <> '' do nothing;

-- customer_user_id resolution (same identity_map rule as §3).
with identity_map as (
  select distinct on (cl.id)
         cl.id as client_id,
         bk.user_id
  from public.clients cl
  join public.bookings bk
    on (bk.customer_email is not null and lower(bk.customer_email) = lower(cl.email))
    or (bk.customer_phone is not null
        and regexp_replace(bk.customer_phone, '\D', '', 'g') = regexp_replace(cl.phone, '\D', '', 'g'))
  where bk.user_id is not null
  order by cl.id, bk.created_at desc
)
update public.customer_qr_payments qp
set customer_user_id = identity_map.user_id,
    metadata = qp.metadata || jsonb_build_object('identity_resolved_from', 'bookings')
from identity_map
where qp.client_id = identity_map.client_id
  and qp.customer_user_id is null;

alter table public.customer_qr_payments enable row level security;
select public.ensure_owner_scoped_rls('customer_qr_payments');
select public.ensure_updated_at_trigger('customer_qr_payments');

-- ============================================================================
-- 6. MODULE referrals — CREATE + BACKFILL
--    The canonical referral fact is bookings.metadata.referral_code (the
--    booking flow stores the friend's NX-… code there; the check-in engine
--    credits the referrer through the loyalty ledger). referrals is the
--    relational form: one row per referred booking. Referrers are resolved
--    with the same derivation the engine uses — NX-<first 8 hex chars of the
--    auth uid> — scanning the salon's own bookings, never trusting client
--    input. One referral per booking is enforced by the partial unique index.
-- ============================================================================
create table if not exists public.referrals (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  referral_code    text not null,
  referrer_user_id uuid references auth.users(id) on delete set null,
  referred_user_id uuid references auth.users(id) on delete set null,
  booking_id       uuid references public.bookings(id) on delete cascade,
  status           text not null default 'booked',
  points_awarded   integer not null default 0,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.referrals.status is
  'booked → credited. Credited when the booking check-in snapshots a referral credit (metadata.checkin_credits) or the booking completed.';
comment on column public.referrals.referrer_user_id is
  'Resolved from the salon''s own bookings (NX- code derivation). Null when no matching member booking exists — the app''s ledger rows remain the points source of truth.';

create unique index if not exists uq_referrals_owner_booking
  on public.referrals(owner_id, booking_id)
  where booking_id is not null;

create index if not exists idx_referrals_code on public.referrals(owner_id, referral_code, status);
create index if not exists idx_referrals_referrer on public.referrals(referrer_user_id);
create index if not exists idx_referrals_referred on public.referrals(referred_user_id);

-- Backfill: every booking that carries a referral_code.
--   referrer       → the salon's own member whose uid derives that code
--                    (first 8 hex chars, app rule in src/lib/customer/schema.ts)
--   referred_user  → the booking's user_id (bookings.user_id)
--   status         → credited when this booking's check-in snapshots a
--                    referral credit or the booking is completed
-- Self-referrals (booking.user_id == derived referrer) are deliberately not
-- backfilled — the check-in engine skips them too.
insert into public.referrals
  (owner_id, referral_code, referrer_user_id, referred_user_id, booking_id,
   status, points_awarded, metadata, created_at, updated_at)
select
  bk.owner_id,
  upper(bk.metadata ->> 'referral_code'),
  referrer.user_id,
  bk.user_id,
  bk.id,
  case
    when bk.metadata -> 'checkin_credits' @> '[{"kind":"referral"}]'::jsonb then 'credited'
    when bk.status = 'completed'                                          then 'credited'
    else 'booked'
  end,
  0,   -- points stay on the loyalty ledger ('bonus' rows); this is the fact row
  jsonb_build_object('source', 'backfill:bookings.metadata'),
  bk.created_at,
  coalesce(bk.updated_at, bk.created_at)
from public.bookings bk
left join lateral (
  select member.user_id
  from public.bookings member
  where member.owner_id = bk.owner_id
    and member.user_id is not null
    and 'NX-' || left(upper(replace(member.user_id::text, '-', '')), 8) = upper(bk.metadata ->> 'referral_code')
    and (bk.user_id is null or member.user_id <> bk.user_id)
  order by member.created_at
  limit 1
) referrer on true
where bk.metadata ? 'referral_code'
  and upper(bk.metadata ->> 'referral_code') ~ '^NX-[A-Z0-9]{4,8}$'
on conflict (owner_id, booking_id) where booking_id is not null do nothing;

alter table public.referrals enable row level security;
select public.ensure_owner_scoped_rls('referrals');
select public.ensure_updated_at_trigger('referrals');

-- ============================================================================
-- 7. GRANTS — explicit, idempotent (this repo learned the hard way in
--    20260907_owner_save_grants.sql that Supabase default ACLs cannot be
--    assumed; the server-side API runs as service_role, salon owners as
--    authenticated; anonymous callers get nothing on these module tables).
-- ============================================================================
grant select, insert, update, delete on table
  public.loyalty_config,
  public.loyalty_tiers,
  public.loyalty_point_transactions,
  public.reward_wallets,
  public.customer_qr_payments,
  public.referrals
to authenticated;

grant select, insert, update, delete on table
  public.loyalty_config,
  public.loyalty_tiers,
  public.loyalty_point_transactions,
  public.reward_wallets,
  public.customer_qr_payments,
  public.referrals
to service_role;

-- ============================================================================
-- 8. SUPABASE REALTIME — publication membership (LAST: every table above
--    already exists by this point). Idempotent: only tables that exist and
--    are not already members are added; a project without the
--    `supabase_realtime` publication (local/self-hosted) is left untouched.
--    In addition to the six module tables, the tables the application
--    actually listens to (in_app_notifications for customer push signals;
--    bookings/clients/loyalty_rewards for the owner availability/reward
--    surfaces) are enrolled so websocket delivery can start without further
--    migrations.
-- ============================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'loyalty_config',
      'loyalty_tiers',
      'loyalty_point_transactions',
      'reward_wallets',
      'customer_qr_payments',
      'referrals',
      'in_app_notifications',
      'bookings',
      'clients',
      'profiles',
      'services',
      'stylists',
      'loyalty_rewards',
      'loyalty_redeemed_rewards'
    ] loop
      if exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t
      ) and not exists (
        select 1
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ============================================================================
-- VERIFICATION QUERIES (read-only — run in the Supabase SQL editor / psql)
-- ============================================================================
-- -- 1. The six module tables exist (plus the app's own realtime tables):
-- select tablename
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- order by tablename;
--
-- -- 2. Required columns on each module table:
-- select table_name, column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
--   and column_name in (
--     'owner_id','customer_user_id','referrer_user_id','referred_user_id',
--     'status','points_awarded','metadata','created_at','updated_at'
--   )
-- order by table_name, column_name;
--
-- -- 3. owner_id/customer_user_id coverage on applicable tables:
-- select table_name,
--        bool_or(column_name = 'owner_id')       as has_owner_id,
--        bool_or(column_name = 'customer_user_id') as has_customer_user_id
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- group by table_name order by table_name;
--
-- -- 4. RLS enabled:
-- select relname, relrowsecurity
-- from pg_class
-- where relnamespace = 'public'::regnamespace
--   and relname in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- order by relname;
--
-- -- 5. Policies per module table:
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- order by tablename, cmd;
--
-- -- 6. Authenticated / service_role grants:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and grantee in ('authenticated','service_role')
--   and table_name in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- order by table_name, grantee, privilege_type;
--
-- -- 7. Helper functions and triggers:
-- select proname from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('set_updated_at','ensure_updated_at_trigger','ensure_owner_scoped_rls');
--
-- select tgname, relname
-- from pg_trigger t
-- join pg_class c on c.oid = t.tgrelid
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and not t.tgisinternal
--   and c.relname in (
--     'loyalty_config','loyalty_tiers','loyalty_point_transactions',
--     'reward_wallets','customer_qr_payments','referrals'
--   )
-- order by c.relname;
--
-- -- 8. Realtime publication membership:
-- select pt.schemaname, pt.tablename
-- from pg_publication_tables pt
-- where pt.pubname = 'supabase_realtime'
-- order by pt.tablename;
--
-- -- 9. Backfill proof (run twice; counts must be identical on re-run):
-- select 'loyalty_tiers' as tbl, count(*) from public.loyalty_tiers
-- union all select 'reward_wallets', count(*) from public.reward_wallets
-- union all select 'customer_qr_payments', count(*) from public.customer_qr_payments
-- union all select 'referrals', count(*) from public.referrals
-- union all select 'point_tx_dedupe_keyed',
--   count(*) from public.loyalty_point_transactions where dedupe_key is not null;
-- ============================================================================
