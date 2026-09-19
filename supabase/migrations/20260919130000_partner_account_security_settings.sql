-- ============================================================================
-- Partner ACCOUNT SETTINGS v2 + SECURITY — the backend for the
-- /partner/account-settings page:
--
--   • partner_account_settings gains the fields the profile/account forms
--     actually render (structured social links, bank name/branch + SWIFT,
--     PAN/Tax ID for TDS, notification toggles, a 2FA mirror flag).
--   • save_my_partner_account_settings validates every new field in SQL
--     (IFSC / PAN / SWIFT / UPI / account number format, social URL keys) —
--     the client-side Zod checks are convenience, never the gate.
--   • partner_security_events + partner_deactivation_requests: an honest
--     security log and a request-based deactivation flow (support reviews the
--     request; nothing is ever deleted by a browser click).
--   • Security RPCs, all deriving the partner from auth.uid():
--       get_my_partner_security_overview()      sessions + log + 2FA + deactivation
--       revoke_my_other_partner_sessions()      "log out of all other sessions"
--       set_my_partner_two_factor(bool, text)   mirror flag after a verified
--                                               enroll/verify or unenroll
--       request_my_partner_account_deactivation(text)
--       cancel_my_partner_account_deactivation()
--
-- Sessions read auth.sessions (GoTrue-owned). The function probes the table
-- with to_regclass() and information_schema before touching it, so a project
-- where the auth schema differs degrades to sessions_available = false —
-- an honest empty state, never fake rows.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. New columns on partner_account_settings
-- ---------------------------------------------------------------------------

alter table public.partner_account_settings
  add column if not exists social_links jsonb not null default '{}'::jsonb,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists swift_code text,
  add column if not exists pan_number text,
  add column if not exists notify_email boolean not null default true,
  add column if not exists notify_whatsapp boolean not null default false,
  add column if not exists notify_sms boolean not null default false,
  add column if not exists two_factor_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Security log — what the account page renders, written only by the
--    security RPCs below (+ a constrained insert for client-side events the
--    SQL layer cannot see, e.g. a password change that GoTrue performed).
-- ---------------------------------------------------------------------------

create table if not exists public.partner_security_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete cascade,
  event_type text not null check (event_type in (
    'credentials_changed', 'email_change_requested', 'two_factor_enabled',
    'two_factor_disabled', 'sessions_revoked', 'deactivation_requested',
    'deactivation_cancelled', 'profile_updated')),
  detail text,
  created_at timestamptz not null default now()
);
alter table public.partner_security_events enable row level security;
drop policy if exists partner_security_events_select_own on public.partner_security_events;
create policy partner_security_events_select_own on public.partner_security_events
  for select to authenticated using (partner_id = public.my_active_partner_id());
drop policy if exists partner_security_events_insert_own on public.partner_security_events;
create policy partner_security_events_insert_own on public.partner_security_events
  for insert to authenticated with check (partner_id = public.my_active_partner_id());
grant select, insert on public.partner_security_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deactivation requests — a pending review row, never a destructive action.
--    One open request per partner (partial unique index).
-- ---------------------------------------------------------------------------

create table if not exists public.partner_deactivation_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete cascade,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'processed', 'cancelled')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists partner_deactivation_requests_one_open
  on public.partner_deactivation_requests (partner_id) where status = 'pending';
alter table public.partner_deactivation_requests enable row level security;
drop policy if exists partner_deactivation_select_own on public.partner_deactivation_requests;
create policy partner_deactivation_select_own on public.partner_deactivation_requests
  for select to authenticated using (partner_id = public.my_active_partner_id());
drop policy if exists partner_deactivation_insert_own on public.partner_deactivation_requests;
create policy partner_deactivation_insert_own on public.partner_deactivation_requests
  for insert to authenticated with check (partner_id = public.my_active_partner_id());
grant select, insert, update on public.partner_deactivation_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Account settings read/write — full replaces (same whitelist contract as
--    20260918070000: an unknown key is refused, never silently ignored).
-- ---------------------------------------------------------------------------

create or replace function public.get_my_partner_account_settings()
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  r jsonb;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  insert into public.partner_account_settings(partner_id) values (p) on conflict (partner_id) do nothing;
  select jsonb_build_object(
    'agency_name', agency_name, 'whatsapp_phone', whatsapp_phone,
    'city', city, 'state', state, 'public_bio', public_bio,
    'full_address', full_address, 'alternate_phone', alternate_phone,
    'website_url', website_url, 'social_handles', social_handles,
    'social_links', social_links,
    'kyb_status', kyb_status,
    'payout_method', payout_method, 'payout_account_name', payout_account_name,
    'payout_account_number', payout_account_number, 'payout_ifsc', payout_ifsc,
    'payout_upi_id', payout_upi_id,
    'bank_name', bank_name, 'bank_branch', bank_branch, 'swift_code', swift_code,
    'pan_number', pan_number,
    'notify_email', notify_email, 'notify_whatsapp', notify_whatsapp,
    'notify_sms', notify_sms,
    'two_factor_enabled', two_factor_enabled
  ) into r from public.partner_account_settings where partner_id = p;
  return r;
end $$;

create or replace function public.save_my_partner_account_settings(p_patch jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_links jsonb;
  v_pan text;
  v_ifsc text;
  v_swift text;
  v_upi text;
  v_account text;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['agency_name','whatsapp_phone','city','state','public_bio',
        'full_address','alternate_phone','website_url','social_handles','social_links',
        'payout_method','payout_account_name','payout_account_number','payout_ifsc',
        'payout_upi_id','bank_name','bank_branch','swift_code','pan_number',
        'notify_email','notify_whatsapp','notify_sms'] <> '{}'::jsonb then
    raise exception 'Unsupported account setting' using errcode = '22023';
  end if;

  -- Structured social links: an object whose only keys are the four networks,
  -- each an http(s) URL of bounded length (empty string clears the entry).
  if p_patch ? 'social_links' then
    if jsonb_typeof(p_patch->'social_links') <> 'object' then
      raise exception 'Invalid social links' using errcode = '22023';
    end if;
    v_links := p_patch->'social_links';
    if v_links - array['instagram','linkedin','facebook','twitter'] <> '{}'::jsonb then
      raise exception 'Unsupported social network' using errcode = '22023';
    end if;
    for v_upi in select jsonb_array_elements_text(jsonb_agg(value)) from jsonb_each(v_links) loop
      if length(v_upi) > 300 or v_upi !~ '^https?://[^\s]+$' then
        raise exception 'Social links must be http(s) URLs of at most 300 characters' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- PAN (Indian tax id) — required format when provided; stored uppercase.
  if p_patch ? 'pan_number' then
    v_pan := upper(nullif(btrim(coalesce(p_patch->>'pan_number', '')), ''));
    if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      raise exception 'Enter a valid PAN (e.g. ABCDE1234F)' using errcode = '22023';
    end if;
    p_patch := jsonb_set(p_patch, '{pan_number}', to_jsonb(v_pan));
  end if;

  -- IFSC — exactly the RBI format (4 letter bank code + 0 + 6 alnum).
  if p_patch ? 'payout_ifsc' then
    v_ifsc := upper(nullif(btrim(coalesce(p_patch->>'payout_ifsc', '')), ''));
    if v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
      raise exception 'Enter a valid IFSC code (e.g. HDFC0001234)' using errcode = '22023';
    end if;
    p_patch := jsonb_set(p_patch, '{payout_ifsc}', to_jsonb(v_ifsc));
  end if;

  -- SWIFT — 8 or 11 characters when provided.
  if p_patch ? 'swift_code' then
    v_swift := upper(nullif(btrim(coalesce(p_patch->>'swift_code', '')), ''));
    if v_swift is not null and v_swift !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
      raise exception 'Enter a valid SWIFT/BIC code (8 or 11 characters)' using errcode = '22023';
    end if;
    p_patch := jsonb_set(p_patch, '{swift_code}', to_jsonb(v_swift));
  end if;

  -- UPI VPA when provided.
  if p_patch ? 'payout_upi_id' then
    v_upi := nullif(btrim(coalesce(p_patch->>'payout_upi_id', '')), '');
    if v_upi is not null and v_upi !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9.-]{1,63}$' then
      raise exception 'Enter a valid UPI ID (e.g. name@bank)' using errcode = '22023';
    end if;
  end if;

  -- Bank account number: digits (and spaces stripped), 6–24 long when provided.
  if p_patch ? 'payout_account_number' then
    v_account := nullif(regexp_replace(coalesce(p_patch->>'payout_account_number',''),'\s','','g'), '');
    if v_account is not null and v_account !~ '^[0-9]{6,24}$' then
      raise exception 'Account number must be 6–24 digits' using errcode = '22023';
    end if;
    p_patch := jsonb_set(p_patch, '{payout_account_number}', to_jsonb(v_account));
  end if;

  insert into public.partner_account_settings(
    partner_id, agency_name, whatsapp_phone, city, state, public_bio,
    full_address, alternate_phone, website_url, social_handles, social_links,
    payout_method, payout_account_name, payout_account_number, payout_ifsc, payout_upi_id,
    bank_name, bank_branch, swift_code, pan_number,
    notify_email, notify_whatsapp, notify_sms)
  values (
    p,
    coalesce(p_patch->>'agency_name', ''),
    nullif(p_patch->>'whatsapp_phone', ''),
    coalesce(p_patch->>'city', ''),
    coalesce(p_patch->>'state', ''),
    coalesce(p_patch->>'public_bio', ''),
    coalesce(p_patch->>'full_address', ''),
    nullif(p_patch->>'alternate_phone', ''),
    nullif(p_patch->>'website_url', ''),
    coalesce(p_patch->>'social_handles', ''),
    coalesce(p_patch->'social_links', '{}'::jsonb),
    nullif(p_patch->>'payout_method', ''),
    nullif(p_patch->>'payout_account_name', ''),
    v_account,
    v_ifsc,
    v_upi,
    nullif(p_patch->>'bank_name', ''),
    nullif(p_patch->>'bank_branch', ''),
    v_swift,
    v_pan,
    coalesce((p_patch->>'notify_email')::boolean, true),
    coalesce((p_patch->>'notify_whatsapp')::boolean, false),
    coalesce((p_patch->>'notify_sms')::boolean, false))
  on conflict (partner_id) do update set
    agency_name = coalesce(p_patch->>'agency_name', partner_account_settings.agency_name),
    whatsapp_phone = case when p_patch ? 'whatsapp_phone' then nullif(p_patch->>'whatsapp_phone','') else partner_account_settings.whatsapp_phone end,
    city = coalesce(p_patch->>'city', partner_account_settings.city),
    state = coalesce(p_patch->>'state', partner_account_settings.state),
    public_bio = coalesce(p_patch->>'public_bio', partner_account_settings.public_bio),
    full_address = case when p_patch ? 'full_address' then coalesce(p_patch->>'full_address','') else partner_account_settings.full_address end,
    alternate_phone = case when p_patch ? 'alternate_phone' then nullif(p_patch->>'alternate_phone','') else partner_account_settings.alternate_phone end,
    website_url = case when p_patch ? 'website_url' then nullif(p_patch->>'website_url','') else partner_account_settings.website_url end,
    social_handles = case when p_patch ? 'social_handles' then coalesce(p_patch->>'social_handles','') else partner_account_settings.social_handles end,
    social_links = case when p_patch ? 'social_links' then coalesce(p_patch->'social_links','{}'::jsonb) else partner_account_settings.social_links end,
    payout_method = case when p_patch ? 'payout_method' then nullif(p_patch->>'payout_method','') else partner_account_settings.payout_method end,
    payout_account_name = case when p_patch ? 'payout_account_name' then nullif(p_patch->>'payout_account_name','') else partner_account_settings.payout_account_name end,
    payout_account_number = case when p_patch ? 'payout_account_number' then v_account else partner_account_settings.payout_account_number end,
    payout_ifsc = case when p_patch ? 'payout_ifsc' then v_ifsc else partner_account_settings.payout_ifsc end,
    payout_upi_id = case when p_patch ? 'payout_upi_id' then v_upi else partner_account_settings.payout_upi_id end,
    bank_name = case when p_patch ? 'bank_name' then nullif(p_patch->>'bank_name','') else partner_account_settings.bank_name end,
    bank_branch = case when p_patch ? 'bank_branch' then nullif(p_patch->>'bank_branch','') else partner_account_settings.bank_branch end,
    swift_code = case when p_patch ? 'swift_code' then v_swift else partner_account_settings.swift_code end,
    pan_number = case when p_patch ? 'pan_number' then v_pan else partner_account_settings.pan_number end,
    notify_email = case when p_patch ? 'notify_email' then coalesce((p_patch->>'notify_email')::boolean, partner_account_settings.notify_email) else partner_account_settings.notify_email end,
    notify_whatsapp = case when p_patch ? 'notify_whatsapp' then coalesce((p_patch->>'notify_whatsapp')::boolean, partner_account_settings.notify_whatsapp) else partner_account_settings.notify_whatsapp end,
    notify_sms = case when p_patch ? 'notify_sms' then coalesce((p_patch->>'notify_sms')::boolean, partner_account_settings.notify_sms) else partner_account_settings.notify_sms end,
    updated_at = now();

  return public.get_my_partner_account_settings();
end $$;

revoke all on function public.get_my_partner_account_settings() from public, anon;
revoke all on function public.save_my_partner_account_settings(jsonb) from public, anon;
grant execute on function public.get_my_partner_account_settings() to authenticated;
grant execute on function public.save_my_partner_account_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Security overview — sessions (when auth.sessions exists), the security
--    log, the 2FA mirror and any pending deactivation request, in one call.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_partner_security_overview()
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_has_sessions boolean := to_regclass('auth.sessions') is not null;
  v_has_ua boolean;
  v_has_ip boolean;
  v_current text;
  v_sessions jsonb := '[]'::jsonb;
  v_settings public.partner_account_settings;
  v_deactivation jsonb := null;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;

  -- The current session id lives in the JWT's session_id claim, which
  -- PostgREST exposes as the request.jwt.claims GUC. Absent → nothing is
  -- marked current (the UI then never offers a destructive confusion).
  begin
    v_current := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'session_id';
  exception when others then v_current := null;
  end;

  if v_has_sessions then
    select count(*) > 0 into v_has_ua from information_schema.columns
      where table_schema = 'auth' and table_name = 'sessions' and column_name = 'user_agent';
    select count(*) > 0 into v_has_ip from information_schema.columns
      where table_schema = 'auth' and table_name = 'sessions' and column_name = 'ip';
    execute format($f$
      select coalesce(jsonb_agg(row order by (row->>'updated_at') desc nulls last), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', s.id::text,
          'user_agent', case when $2 then s.user_agent else null end,
          'ip', case when $3 then split_part(s.ip::text, '/', 1) else null end,
          'created_at', s.created_at,
          'updated_at', s.updated_at,
          'is_current', $4 is not null and s.id::text = $4
        ) as row
        from auth.sessions s
        where s.user_id = (select user_id from public.growth_partners where id = $1)
        order by s.updated_at desc nulls last
        limit 20
      ) latest
    $f$) into v_sessions using p, v_has_ua, v_has_ip, v_current;
  end if;

  select * into v_settings from public.partner_account_settings where partner_id = p;
  if not found then
    insert into public.partner_account_settings(partner_id) values (p) on conflict (partner_id) do nothing;
    select * into v_settings from public.partner_account_settings where partner_id = p;
  end if;

  select jsonb_build_object(
    'id', d.id, 'reason', d.reason, 'status', d.status, 'requested_at', d.requested_at)
    into v_deactivation
  from public.partner_deactivation_requests d
  where d.partner_id = p and d.status = 'pending'
  order by d.requested_at desc limit 1;

  return jsonb_build_object(
    'two_factor_enabled', v_settings.two_factor_enabled,
    'sessions_available', v_has_sessions,
    'sessions', v_sessions,
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'detail', e.detail,
        'created_at', e.created_at) order by e.created_at desc), '[]'::jsonb)
      from (
        select * from public.partner_security_events
        where partner_id = p order by created_at desc limit 20
      ) e),
    'deactivation', v_deactivation
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. Revoke every other session of the caller. Without a current session id
--    in the JWT the function refuses rather than guessing which session to
--    keep — revoking "all the others" is exactly the operation where guessing
--    is unacceptable.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_my_other_partner_sessions()
returns integer language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_current text;
  v_revoked integer := 0;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  if to_regclass('auth.sessions') is null then
    raise exception 'Session management is not available on this deployment' using errcode = 'feature_not_supported';
  end if;
  begin
    v_current := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'session_id';
  exception when others then v_current := null;
  end;
  if coalesce(v_current, '') = '' then
    raise exception 'Current session could not be identified; sign in again and retry' using errcode = '28000';
  end if;
  with gone as (
    delete from auth.sessions
    where user_id = (select user_id from public.growth_partners where id = p)
      and id::text <> v_current
    returning 1)
  select count(*) into v_revoked from gone;
  insert into public.partner_security_events(partner_id, event_type, detail)
  values (p, 'sessions_revoked', v_revoked || ' other session(s) signed out');
  return v_revoked;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Two-factor mirror. The authoritative factor lives in Supabase Auth
--    (auth.mfa_factors, written by GoTrue after the QR enrollment is verified
--    in the browser). This flag is the partner-visible mirror the overview
--    page renders, set ONLY after the browser completed enroll → challenge →
--    verify (enable) or unenroll (disable).
-- ---------------------------------------------------------------------------

create or replace function public.set_my_partner_two_factor(p_enabled boolean, p_factor_id text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Invalid two-factor state' using errcode = '22023'; end if;
  if p_factor_id is not null and (length(p_factor_id) > 128 or p_factor_id !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Invalid authenticator reference' using errcode = '22023';
  end if;
  insert into public.partner_account_settings(partner_id, two_factor_enabled)
  values (p, p_enabled)
  on conflict (partner_id) do update set two_factor_enabled = excluded.two_factor_enabled, updated_at = now();
  insert into public.partner_security_events(partner_id, event_type, detail)
  values (p, case when p_enabled then 'two_factor_enabled' else 'two_factor_disabled' end, null);
  return jsonb_build_object('two_factor_enabled', p_enabled);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Deactivation request / cancel.
-- ---------------------------------------------------------------------------

create or replace function public.request_my_partner_account_deactivation(p_reason text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_row public.partner_deactivation_requests;
  v_reason text;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  if p_reason is not null then
    v_reason := left(btrim(p_reason), 500);
    if v_reason = '' then v_reason := null; end if;
  end if;
  insert into public.partner_deactivation_requests(partner_id, reason)
  values (p, v_reason)
  on conflict (partner_id) where status = 'pending' do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'A deactivation request is already pending review' using errcode = '23505';
  end if;
  insert into public.partner_security_events(partner_id, event_type, detail)
  values (p, 'deactivation_requested', null);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'requested_at', v_row.requested_at);
end $$;

create or replace function public.cancel_my_partner_account_deactivation()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_updated integer;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  update public.partner_deactivation_requests
    set status = 'cancelled', processed_at = now()
    where partner_id = p and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'No pending deactivation request to cancel' using errcode = 'P0002';
  end if;
  insert into public.partner_security_events(partner_id, event_type, detail)
  values (p, 'deactivation_cancelled', null);
  return jsonb_build_object('status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- 8b. Client-side audit hook. The account page logs the events the SQL layer
--     cannot see itself (a password GoTrue changed, an email verification
--     requested). Type is whitelisted; the partner is derived, never accepted.
-- ---------------------------------------------------------------------------

create or replace function public.log_my_partner_security_event(p_type text, p_detail text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  p uuid := public.my_active_partner_id();
  v_detail text;
begin
  if p is null then raise exception 'Active Growth Partner required' using errcode = '42501'; end if;
  if p_type not in ('credentials_changed', 'email_change_requested', 'profile_updated') then
    raise exception 'Unsupported security event' using errcode = '22023';
  end if;
  v_detail := left(coalesce(p_detail, ''), 300);
  insert into public.partner_security_events(partner_id, event_type, detail)
  values (p, p_type, nullif(v_detail, ''));
end $$;
revoke all on function public.log_my_partner_security_event(text, text) from public, anon;
grant execute on function public.log_my_partner_security_event(text, text) to authenticated;

revoke all on function public.get_my_partner_security_overview() from public, anon;
revoke all on function public.revoke_my_other_partner_sessions() from public, anon;
revoke all on function public.set_my_partner_two_factor(boolean, text) from public, anon;
revoke all on function public.request_my_partner_account_deactivation(text) from public, anon;
revoke all on function public.cancel_my_partner_account_deactivation() from public, anon;
grant execute on function public.get_my_partner_security_overview() to authenticated;
grant execute on function public.revoke_my_other_partner_sessions() to authenticated;
grant execute on function public.set_my_partner_two_factor(boolean, text) to authenticated;
grant execute on function public.request_my_partner_account_deactivation(text) to authenticated;
grant execute on function public.cancel_my_partner_account_deactivation() to authenticated;

commit;
