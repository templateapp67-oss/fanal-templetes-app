-- Temporary bearer attribution, validated before signup and consumed atomically
-- on auth account creation (including email-confirmation-required accounts).
begin;
create table if not exists public.growth_referral_attributions (
  token_hash text primary key,
  partner_id uuid not null references public.growth_partners(user_id) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz
);
alter table public.growth_referral_attributions enable row level security;
revoke all on public.growth_referral_attributions from public, anon, authenticated;
create index if not exists growth_referral_attributions_expiry on public.growth_referral_attributions(expires_at);

-- Public validation returns no partner identity. The random token is a one-use
-- capability, not a partner ID. First valid touch wins for seven days.
create or replace function public.capture_growth_referral(p_code text, p_token text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_code text := public.growth_normalize_code(p_code);
  v_partner uuid;
  v_token text;
  v_existing public.growth_referral_attributions;
begin
  if p_token ~ '^[a-f0-9]{64}$' then
    select a.* into v_existing from public.growth_referral_attributions a
    join public.growth_partners gp on gp.user_id = a.partner_id and gp.is_active and gp.referral_code = a.referral_code
    where a.token_hash = md5(p_token) and a.expires_at > now() and a.consumed_at is null;
    if found then
      return jsonb_build_object('valid', true, 'token', p_token, 'referral_code', v_existing.referral_code,
        'expires_at', v_existing.expires_at);
    end if;
  end if;
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    return jsonb_build_object('valid', false);
  end if;
  select user_id into v_partner from public.growth_partners where referral_code = v_code and is_active;
  if v_partner is null then return jsonb_build_object('valid', false); end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.growth_referral_attributions(token_hash, partner_id, referral_code)
  values (md5(v_token), v_partner, v_code);
  return jsonb_build_object('valid', true, 'token', v_token, 'referral_code', v_code, 'expires_at', now() + interval '7 days');
end;
$$;
revoke all on function public.capture_growth_referral(text, text) from public;
grant execute on function public.capture_growth_referral(text, text) to anon, authenticated;

create or replace function public.consume_signup_growth_referral()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_token text := new.raw_user_meta_data ->> 'growth_referral_token';
  v_attr public.growth_referral_attributions;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then return new; end if;
  select * into v_attr from public.growth_referral_attributions
  where token_hash = md5(v_token) and expires_at > now() and consumed_at is null for update;
  if not found or v_attr.partner_id = new.id then return new; end if;
  -- Reject stale tokens after a code rotation or partner deactivation. Never
  -- resolve an old code to a different partner, even if an admin reassigns it.
  perform 1 from public.growth_partners where user_id = v_attr.partner_id
    and referral_code = v_attr.referral_code and is_active for share;
  if not found then return new; end if;
  insert into public.growth_onboarding as o(user_id, growth_partner_id, referral_code, linked_at, status)
  values (new.id, v_attr.partner_id, v_attr.referral_code, now(), 'linked')
  on conflict (user_id) do update set
    growth_partner_id = excluded.growth_partner_id, referral_code = excluded.referral_code,
    linked_at = excluded.linked_at,
    status = case when o.status = 'not_started' then 'linked' else o.status end
  where o.growth_partner_id is null;
  update public.growth_referral_attributions set consumed_by = new.id, consumed_at = now()
  where token_hash = v_attr.token_hash;
  return new;
end;
$$;
revoke all on function public.consume_signup_growth_referral() from public, anon, authenticated;
drop trigger if exists trg_signup_growth_referral on auth.users;
create trigger trg_signup_growth_referral after insert on auth.users
for each row execute function public.consume_signup_growth_referral();

-- Requested field names over the existing immutable relationship, not a
-- second source of truth. Underlying growth_onboarding RLS still applies.
create or replace view public.partner_referral_attribution with (security_invoker = true) as
select user_id as referred_user_id, growth_partner_id as partner_id,
  referral_code, linked_at as referred_at
from public.growth_onboarding where growth_partner_id is not null;
revoke all on public.partner_referral_attribution from public, anon;
grant select on public.partner_referral_attribution to authenticated;
commit;
