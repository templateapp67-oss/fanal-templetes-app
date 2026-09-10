-- ============================================================================
-- Nexora Salon OS — Secure one-time Onboarding → Template App handoff
-- Migration: 20260913_template_handoff.sql
-- ----------------------------------------------------------------------------
-- PHASE 4 ONLY: short-lived, single-use handoff sessions that carry a
-- referral-verified user from the Onboarding App into the Template App.
--
-- WHAT THIS SCRIPT DOES
--   • Creates exactly one table: `public.template_handoffs`. No existing
--     table, column, constraint, policy, function or row is touched.
--   • `create_template_handoff()` — authenticated + referral-linked callers
--     only. The backend derives the user from auth.uid() (no user-id
--     parameter exists), verifies the live referral link, enforces a single
--     active handoff per user, and returns ONE opaque token (revealed once).
--   • `exchange_template_handoff()` — validates the token server-side
--     (owner, destination, consumed, expiry, account, live referral),
--     consumes it ATOMICALLY (row lock + conditional update, so two
--     simultaneous requests cannot both succeed), and records the Template
--     App entry event (status → template_started, template_started_at set
--     exactly once). Never regresses or overwrites existing progress.
--   • `purge_expired_template_handoffs()` — admin-only housekeeping.
--
-- TOKEN DESIGN
--   • 64 lowercase hex chars from two UUIDv4 values
--     (md5(gen_random_uuid()) || md5(gen_random_uuid())): 244 bits from
--     Postgres' cryptographic PRNG. Unpredictable; never derived from user
--     ids, timestamps or referral codes.
--   • Only md5(token) is stored (UNIQUE). The raw token exists solely in the
--     create response and the redirect URL, then is discarded; the database
--     never exposes a reusable secret to clients (RLS enabled, NO policies,
--     NO grants — RPCs only).
--   • pgcrypto is deliberately NOT required: md5()/gen_random_uuid() are
--     core functions, so this migration applies identically to production
--     and to every test engine. For a 244-bit random token, md5 preimage
--     resistance is the only property needed (recovering the token from its
--     hash is infeasible; collision attacks do not apply to random tokens).
--   • Lifetime: 5 minutes. Expired or consumed tokens are rejected.
--
-- WHAT THIS SCRIPT DOES NOT DO (strict Phase 4 boundary)
--   • No completion detection/callbacks, no commission/performance/payouts.
--   • No duplicate user tables, no password/credential storage, no RLS
--     weakening anywhere. The referral code is NEVER an auth credential.
--
-- IDEMPOTENCY: safe to re-run (SQL Editor / supabase db push). New objects
-- only; existing data preserved; nothing is dropped.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Private helper: token fingerprint (callable only from inside the
--    SECURITY DEFINER RPCs, or by the database owner / service_role).
-- ---------------------------------------------------------------------------
create or replace function public.template_handoff_hash(p_token text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select md5($1)
$$;
revoke all on function public.template_handoff_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Table (new only).
-- ---------------------------------------------------------------------------
create table if not exists public.template_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  growth_partner_id uuid,
  destination text not null,
  state text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create unique index if not exists template_handoffs_token_hash_key
  on public.template_handoffs(token_hash);
create index if not exists template_handoffs_user_idx
  on public.template_handoffs(user_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'template_handoffs_state_check') then
    alter table public.template_handoffs
      add constraint template_handoffs_state_check
      check (state is null or (char_length(state) between 1 and 256));
  end if;
end $$;

comment on table public.template_handoffs is
'TEMPLATE HANDOFF wiring (Phase 4): short-lived one-time grants carrying a referral-verified user into the Template App. Stores token hashes only; raw tokens are never persisted. RLS with no policies: RPC access only.';

-- ---------------------------------------------------------------------------
-- 2. Row Level Security: enabled with NO policies and NO grants, so even
--    authenticated clients cannot read or write handoff rows directly.
--    service_role (server/Edge Functions) bypasses RLS as usual.
-- ---------------------------------------------------------------------------
alter table public.template_handoffs enable row level security;
revoke all on table public.template_handoffs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3a. create_template_handoff — mint a one-time grant for the CALLER.
--
-- The caller must be authenticated AND referral-linked (verified live from
-- growth_onboarding — the frontend cannot supply or choose any of this).
-- At most one active handoff per user exists: older active rows are removed
-- first, so double-clicks/retries never pile up live tokens.
-- Returns {token, expires_at, destination}. The raw token is revealed here
-- and ONLY here.
-- ---------------------------------------------------------------------------
create or replace function public.create_template_handoff(p_state text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_partner uuid;
  v_token text;
  v_expires timestamptz;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_state is not null and (char_length(p_state) < 1 or char_length(p_state) > 256) then
    raise exception 'Invalid handoff state' using errcode = '22023';
  end if;

  select o.growth_partner_id into v_partner
  from public.growth_onboarding as o
  where o.user_id = actor;
  if v_partner is null then
    raise exception 'A verified referral is required before entering the Template App'
      using errcode = '22023';
  end if;

  -- Single-active invariant: supersede any live handoff before minting.
  delete from public.template_handoffs
  where user_id = actor and consumed_at is null and expires_at > now();

  v_token := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  v_expires := now() + interval '5 minutes';

  insert into public.template_handoffs (token_hash, user_id, growth_partner_id, destination, state, expires_at)
  values (md5(v_token), actor, v_partner, 'template-app', p_state, v_expires);

  return jsonb_build_object(
    'token', v_token,
    'expires_at', v_expires,
    'destination', 'template-app'
  );
end;
$$;
revoke all on function public.create_template_handoff(text) from public, anon;
grant execute on function public.create_template_handoff(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. exchange_template_handoff — redeem a grant and enter the Template App.
--
-- Checks, in order: token exists → owned by the caller → correct destination
-- → not consumed → not expired → account exists and is not banned → live
-- referral still matches the snapshot. Then consumes ATOMICALLY
-- (SELECT … FOR UPDATE plus a conditional UPDATE, so concurrent redemptions
-- cannot both succeed) and records the entry event: onboarding advances to
-- template_started with template_started_at set exactly once. Rows already
-- past that stage are left untouched (no regression, no timestamp rewrite).
-- Returns {user_id, referral_code, growth_partner_id, onboarding_status,
-- template_started_at}. All failure messages are safe for UI display.
-- ---------------------------------------------------------------------------
create or replace function public.exchange_template_handoff(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_code text;
  v_row public.template_handoffs%rowtype;
  v_current_partner uuid;
  v_referral_code text;
  v_status text;
  v_started_at timestamptz;
  v_consumed integer;
  v_banned boolean := false;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  v_code := nullif(btrim(coalesce(p_token, '')), '');
  if v_code is null then
    raise exception 'Invalid onboarding session.' using errcode = '22023';
  end if;

  select * into v_row
  from public.template_handoffs
  where token_hash = md5(v_code)
  for update;
  if v_row.id is null then
    raise exception 'Invalid onboarding session.' using errcode = '22023';
  end if;
  -- Cross-user redemption is indistinguishable from a bad token (no oracle).
  if v_row.user_id <> actor then
    raise exception 'Invalid onboarding session.' using errcode = '22023';
  end if;
  if v_row.destination <> 'template-app' then
    raise exception 'Invalid onboarding session.' using errcode = '22023';
  end if;
  if v_row.consumed_at is not null then
    raise exception 'This onboarding session has already been used.' using errcode = '22023';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'Your onboarding session has expired. Please return to the onboarding app and try again.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = actor) then
    raise exception 'Your account cannot continue at this time.' using errcode = '22023';
  end if;
  -- GoTrue bans (auth.users.banned_until) when the column exists; generations
  -- without it simply skip this check.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until'
  ) then
    execute 'select exists (select 1 from auth.users where id = $1 and banned_until is not null and banned_until > now())'
      into v_banned using actor;
    if v_banned then
      raise exception 'Your account cannot continue at this time.' using errcode = '22023';
    end if;
  end if;

  select o.growth_partner_id, o.referral_code into v_current_partner, v_referral_code
  from public.growth_onboarding as o
  where o.user_id = actor;
  if v_current_partner is null or v_current_partner <> v_row.growth_partner_id then
    raise exception 'Your account cannot continue at this time.' using errcode = '22023';
  end if;

  -- Atomic single-use: the row lock serializes racers; the predicate is the
  -- backstop that lets exactly one redemption win.
  update public.template_handoffs
  set consumed_at = now()
  where id = v_row.id and consumed_at is null;
  get diagnostics v_consumed = row_count;
  if v_consumed <> 1 then
    raise exception 'This onboarding session has already been used.' using errcode = '22023';
  end if;

  -- Entry event: advance to template_started exactly once; never regress or
  -- rewrite timestamps for users already past this stage (Phase 5 owns those).
  update public.growth_onboarding
  set status = 'template_started',
      template_started_at = coalesce(template_started_at, now()),
      updated_at = now()
  where user_id = actor and status in ('not_started', 'linked');

  select o.status, o.template_started_at into v_status, v_started_at
  from public.growth_onboarding as o
  where o.user_id = actor;

  return jsonb_build_object(
    'user_id', actor,
    'referral_code', v_referral_code,
    'growth_partner_id', v_current_partner,
    'onboarding_status', v_status,
    'template_started_at', v_started_at
  );
end;
$$;
revoke all on function public.exchange_template_handoff(text) from public, anon;
grant execute on function public.exchange_template_handoff(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. purge_expired_template_handoffs — ADMIN ONLY (no EXECUTE grants).
-- Housekeeping for old rows; run from SQL Editor / service_role / cron.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_template_handoffs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_removed integer;
begin
  delete from public.template_handoffs
  where expires_at < now() - interval '1 day';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;
revoke all on function public.purge_expired_template_handoffs() from public, anon, authenticated;

comment on function public.create_template_handoff(text) is
'Phase 4 handoff: mint a 5-minute one-time Template App grant for the referral-linked caller. Raw token revealed once.';
comment on function public.exchange_template_handoff(text) is
'Phase 4 handoff: atomically redeem a grant (owner/destination/consumed/expiry/account/referral checks) and record the template_started entry event.';
comment on function public.purge_expired_template_handoffs() is
'ADMIN ONLY: delete handoff rows expired for over a day. No EXECUTE grant for anon/authenticated.';

notify pgrst, 'reload schema';

commit;
