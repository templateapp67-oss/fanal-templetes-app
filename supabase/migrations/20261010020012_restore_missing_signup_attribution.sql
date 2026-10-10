-- Repair projects that have the core onboarding schema but never applied the
-- cookie attribution migrations. Preserve newer installed RPC definitions.
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
grant all on public.growth_referral_attributions to service_role;
create index if not exists growth_referral_attributions_expiry
  on public.growth_referral_attributions(expires_at);

-- These narrowly scoped definer RPCs are the anonymous capability boundary:
-- callers never get table access, partner identities or arbitrary write access.
do $repair$
begin
  if to_regprocedure('public.capture_growth_referral(text,text)') is null then
    execute $ddl$
      create function public.capture_growth_referral(p_code text, p_token text default null)
      returns jsonb language plpgsql security definer set search_path = '' as $fn$
      declare
        code text := upper(btrim(coalesce(p_code, '')));
        partner public.growth_partners%rowtype;
        attribution public.growth_referral_attributions%rowtype;
        capability text;
      begin
        if code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
          return jsonb_build_object('valid', false);
        end if;
        select gp.* into partner from public.growth_partners gp
        where upper(btrim(gp.referral_code)) = code and gp.is_active is true
          and nullif(to_jsonb(gp)->>'deleted_at', '') is null
          and nullif(to_jsonb(gp)->>'banned_at', '') is null
          and nullif(to_jsonb(gp)->>'disabled_at', '') is null
          -- Core-schema projects have no approval column; newer schemas do.
          and (not (to_jsonb(gp) ? 'status') or to_jsonb(gp)->>'status' = 'approved')
        for share;
        if not found then return jsonb_build_object('valid', false); end if;
        if p_token ~ '^[a-f0-9]{64}$' then
          select a.* into attribution from public.growth_referral_attributions a
          where a.token_hash = md5(p_token) and a.expires_at > now()
            and a.consumed_at is null and a.partner_id = partner.user_id
            and a.referral_code = partner.referral_code;
          if found then
            return jsonb_build_object('valid', true, 'token', p_token,
              'referral_code', partner.referral_code, 'expires_at', attribution.expires_at);
          end if;
        end if;
        capability := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        insert into public.growth_referral_attributions(token_hash, partner_id, referral_code)
        values (md5(capability), partner.user_id, partner.referral_code)
        returning * into attribution;
        return jsonb_build_object('valid', true, 'token', capability,
          'referral_code', partner.referral_code, 'expires_at', attribution.expires_at);
      end $fn$;
      revoke all on function public.capture_growth_referral(text,text) from public;
      grant execute on function public.capture_growth_referral(text,text) to anon, authenticated, service_role;
    $ddl$;
  end if;
  if to_regprocedure('public.prepare_growth_referral_signup(text)') is null then
    execute $ddl$
      create function public.prepare_growth_referral_signup(p_token text)
      returns jsonb language plpgsql security definer set search_path = '' as $fn$
      declare attribution public.growth_referral_attributions%rowtype;
      begin
        if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
          return jsonb_build_object('valid', false);
        end if;
        select a.* into attribution from public.growth_referral_attributions a
        join public.growth_partners gp on gp.user_id = a.partner_id
          and gp.referral_code = a.referral_code and gp.is_active is true
          and nullif(to_jsonb(gp)->>'deleted_at', '') is null
          and nullif(to_jsonb(gp)->>'banned_at', '') is null
          and nullif(to_jsonb(gp)->>'disabled_at', '') is null
          and (not (to_jsonb(gp) ? 'status') or to_jsonb(gp)->>'status' = 'approved')
        where a.token_hash = md5(p_token) and a.expires_at > now() and a.consumed_at is null;
        if not found then return jsonb_build_object('valid', false); end if;
        return jsonb_build_object('valid', true, 'token', p_token,
          'referral_code', attribution.referral_code, 'expires_at', attribution.expires_at);
      end $fn$;
      revoke all on function public.prepare_growth_referral_signup(text) from public;
      grant execute on function public.prepare_growth_referral_signup(text) to anon, authenticated, service_role;
    $ddl$;
  end if;
  if to_regprocedure('public.consume_signup_growth_referral()') is null then
    execute $ddl$
      create function public.consume_signup_growth_referral()
      returns trigger language plpgsql security definer set search_path = '' as $fn$
      declare
        capability text := new.raw_user_meta_data ->> 'growth_referral_token';
        attribution public.growth_referral_attributions%rowtype;
      begin
        if capability is null or capability !~ '^[a-f0-9]{64}$' then return new; end if;
        select a.* into attribution from public.growth_referral_attributions a
        where a.token_hash = md5(capability) and a.expires_at > now()
          and a.consumed_at is null for update;
        if not found or attribution.partner_id = new.id then return new; end if;
        perform 1 from public.growth_partners gp
        where gp.user_id = attribution.partner_id and gp.referral_code = attribution.referral_code
          and gp.is_active is true
          and nullif(to_jsonb(gp)->>'deleted_at', '') is null
          and nullif(to_jsonb(gp)->>'banned_at', '') is null
          and nullif(to_jsonb(gp)->>'disabled_at', '') is null
          and (not (to_jsonb(gp) ? 'status') or to_jsonb(gp)->>'status' = 'approved')
        for share;
        if not found then return new; end if;
        insert into public.growth_onboarding as o(user_id, growth_partner_id, referral_code, linked_at, status)
        values (new.id, attribution.partner_id, attribution.referral_code, now(), 'linked')
        on conflict(user_id) do update set growth_partner_id = excluded.growth_partner_id,
          referral_code = excluded.referral_code, linked_at = excluded.linked_at,
          status = case when o.status = 'not_started' then 'linked' else o.status end
        where o.growth_partner_id is null;
        update public.growth_referral_attributions set consumed_by = new.id, consumed_at = now()
        where token_hash = attribution.token_hash and consumed_at is null;
        return new;
      end $fn$;
      revoke all on function public.consume_signup_growth_referral() from public, anon, authenticated;
    $ddl$;
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
    and tgname = 'trg_signup_growth_referral' and not tgisinternal) then
    create trigger trg_signup_growth_referral after insert on auth.users
      for each row execute function public.consume_signup_growth_referral();
  end if;
end $repair$;
notify pgrst, 'reload schema';
