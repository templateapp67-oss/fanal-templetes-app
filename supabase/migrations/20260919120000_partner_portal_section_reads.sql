-- Phase 1 follow-up: the reads + one client write the promoted portal sections
-- still had no contract for.
--
-- 20260918035349_partner_portal_operations.sql owns the tables, the ledger
-- rules and the payout/notification/asset/ticket RPCs. The portal sections that
-- were "Coming soon" slots (Earnings, Withdrawals, Marketing Materials, Partner
-- Levels, Leaderboards, Notifications, Support) now render live pages, and four
-- of them showed data the backend could not answer: an open payout request was
-- invisible after submission, a submitted ticket could not be listed, the
-- notification toggles had nothing to read or write, and the asset library had
-- no category index to filter by.
--
-- Contract rules copied from the operations migration:
--   • every read derives the partner from my_active_partner_id() — no function
--     here accepts a partner id, so a URL or body can never name someone else;
--   • SELECT-only where the client must not write; the single exception is
--     cancelling an OPEN payout request, which is re-checked against the
--     caller's own row and its status inside the function;
--   • jsonb payloads, bounded limits, stable ordering with a tiebreaker.
begin;

-- ── Prerequisite the ledger lifecycle needs, created only when it is absent ──
-- `release_partner_earnings()` and `admin_mark_partner_payout_paid()` (the two
-- service-side functions the payout flow depends on — cleared commission
-- becoming withdrawable, and a payout being marked paid) both gate on
-- `private.is_trusted_server_or_admin()`, which no migration in this repository
-- defines. On a project where the DBA has already written it, this block changes
-- NOTHING; a predicate that decides who may move money is theirs, not ours.
-- Where it is missing, the honest minimum is: the connection is a superuser, the
-- request carries the same admin claim `private.is_admin()` reads, or the role is
-- service_role — i.e. exactly the callers those functions already accept, and
-- never `authenticated`.
do $$ begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'is_trusted_server_or_admin'
  ) then
    return;
  end if;
  if to_regnamespace('private') is null then
    create schema private;
  end if;
  execute $tsa$
    create or replace function private.is_trusted_server_or_admin() returns boolean
    language sql stable as $body$
      select coalesce(current_setting('is_superuser', false)::boolean, false)
          or coalesce(nullif(current_setting('app.is_admin', true), ''), 'false') = 'true'
          or current_role = 'service_role'
    $body$;
  $tsa$;
  execute 'grant usage on schema private to authenticated, anon';
  execute 'revoke all on function private.is_trusted_server_or_admin() from public, anon';
  execute 'grant execute on function private.is_trusted_server_or_admin() to authenticated, service_role';
end $$;


-- ── Withdrawals: the partner's own payout requests (open + history) ─────────
create or replace function public.get_my_partner_payout_requests(p_limit integer default 25, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'total', coalesce((select count(*) from public.partner_payout_requests
                       where partner_id = public.my_active_partner_id()), 0),
   'open_amount_paise', coalesce((select sum(amount_paise) from public.partner_payout_requests
                                   where partner_id = public.my_active_partner_id()
                                     and status in ('pending','in_review')), 0),
   'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', x.id, 'amount_paise', x.amount_paise, 'payout_method', x.payout_method,
                        'destination_label', x.destination_label, 'status', x.status,
                        'requested_at', x.requested_at, 'reviewed_at', x.reviewed_at, 'paid_at', x.paid_at,
                        'rejection_reason', x.rejection_reason, 'provider_reference', x.provider_reference
                      ) order by x.requested_at desc, x.id desc) from (
      select id, amount_paise, payout_method, destination_label, status,
             requested_at, reviewed_at, paid_at, rejection_reason, provider_reference
        from public.partner_payout_requests
       where partner_id = public.my_active_partner_id()
       order by requested_at desc, id desc
       limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) x), '[]'::jsonb)
 );
$$;

-- A partner may withdraw an OPEN request of their own. Re-checking
-- partner_id + status in the WHERE clause is the whole authorization story: a
-- guessed uuid from another partner matches nothing, and a paid/rejected row is
-- never rewritable. The partial unique index on the table then frees the
-- "one open request per partner" slot, so a new request is possible at once.
create or replace function public.cancel_my_partner_payout_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; begin
  update public.partner_payout_requests
     set status = 'cancelled', reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
   where id = p_request_id
     and partner_id = public.my_active_partner_id()
     and status in ('pending','in_review')
   returning jsonb_build_object('id', id, 'status', status, 'amount_paise', amount_paise)
     into v_result;
  if v_result is null then
    raise exception 'Open payout request not found' using errcode = 'P0002';
  end if;
  return v_result;
end $$;

-- ── Support: the partner's own tickets, newest first ───────────────────────
create or replace function public.get_my_partner_support_tickets(p_limit integer default 25, p_status text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'ticket_number', x.ticket_number, 'subject', x.subject, 'message', x.message,
            'status', x.status, 'priority', x.priority, 'created_at', x.created_at,
            'updated_at', x.updated_at, 'closed_at', x.closed_at
          ) order by x.created_at desc, x.id desc), '[]'::jsonb)
   from (
     select id, ticket_number, subject, message, status, priority, created_at, updated_at, closed_at
       from public.partner_support_tickets
      where partner_id = public.my_active_partner_id()
        and (p_status is null or status = p_status)
      order by created_at desc, id desc
      limit least(greatest(p_limit, 1), 100)
   ) x;
$$;

-- ── Notifications: the real preference row (defaults when none was saved) ───
create or replace function public.get_my_partner_notification_preferences()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(
   (select jsonb_build_object('email_enabled', email_enabled, 'in_app_enabled', in_app_enabled,
                              'updated_at', updated_at)
      from public.partner_notification_preferences
     where partner_id = public.my_active_partner_id()),
   jsonb_build_object('email_enabled', true, 'in_app_enabled', true, 'updated_at', null)
 );
$$;

create or replace function public.update_my_partner_notification_preferences(p_email_enabled boolean, p_in_app_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); v_result jsonb; begin
  if v_partner is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;
  insert into public.partner_notification_preferences
    (partner_id, email_enabled, in_app_enabled, updated_at)
  values (v_partner, coalesce(p_email_enabled, true), coalesce(p_in_app_enabled, true), now())
  on conflict (partner_id) do update
    set email_enabled = excluded.email_enabled,
        in_app_enabled = excluded.in_app_enabled,
        updated_at = now()
  returning jsonb_build_object('email_enabled', email_enabled, 'in_app_enabled', in_app_enabled,
                               'updated_at', updated_at)
    into v_result;
  return v_result;
end $$;

-- ── Marketing Materials: category index for the asset library filter ───────
create or replace function public.get_partner_marketing_asset_categories()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'asset_count', x.asset_count)
                           order by x.category), '[]'::jsonb)
   from (
     select category, count(*)::integer as asset_count
       from public.partner_marketing_assets
      where is_published
     group by category
   ) x;
$$;

-- ── A paid payout keeps spending the balance it spent ───────────────────────
-- `partner_earnings` rows stay `available_for_withdrawal` after a payout is paid
-- — nothing allocates a payout against specific ledger rows — and BOTH
-- `get_my_partner_earnings()` and `request_my_partner_payout()` netted off only
-- requests that are still open ('pending','in_review'). So mark ₹1,500 paid and
-- the wallet jumped back to ₹1,500, and a second ₹1,500 request passed the
-- ceiling check: the same commission could be withdrawn over and over. Fixed
-- here, by forward `create or replace`, rather than by editing
-- 20260918035349 (deployed projects have already run that file — history is not
-- rewritten; this is the same convention
-- 20260919_growth_partner_area_contract_alignment.sql uses to fix an older one).
--
-- Both functions now net off every payout request that was not cancelled or
-- rejected, which includes the paid ones. Signatures are unchanged, so the
-- existing EXECUTE grants and every caller keep working. The read gains
-- `cleared_paise` — the gross cleared figure — because a page that says "₹1,250
-- cleared, ₹600 of it reserved" needs both numbers, and `available_paise` is
-- clamped at zero so an adjustment cannot print a negative wallet.
create or replace function public.get_my_partner_earnings(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); begin
 if v_partner is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 return jsonb_build_object('currency','INR','totals',(select jsonb_build_object(
  'lifetime_paise',coalesce(sum(amount_paise) filter(where status not in ('reversed')),0),
  'pending_paise',coalesce(sum(amount_paise) filter(where status='pending'),0),
  'cleared_paise',coalesce(sum(amount_paise) filter(where status='available_for_withdrawal'),0),
  'available_paise',greatest(coalesce(sum(amount_paise) filter(where status='available_for_withdrawal'),0)
    - coalesce((select sum(p.amount_paise) from public.partner_payout_requests p
                 where p.partner_id=v_partner and p.status not in ('cancelled','rejected')),0),0)) from public.partner_earnings where partner_id=v_partner),
  'transactions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select id,earning_type,commission_bps,status,amount_paise,earned_at,payment_cleared_at,available_at,paid_at from public.partner_earnings where partner_id=v_partner order by earned_at desc,id desc limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)) x));
end $$;

create or replace function public.request_my_partner_payout(p_amount_paise bigint, p_method text, p_destination_label text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); v_available bigint; v_id uuid; begin
 if v_partner is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
 if p_amount_paise < 50000 then raise exception 'Minimum withdrawal is ₹500' using errcode='22023'; end if;
 if p_method not in ('upi','bank_transfer','paypal') or length(trim(coalesce(p_destination_label,''))) < 2 then raise exception 'Invalid payout destination' using errcode='22023'; end if;
 -- "Spent" means every request the desk has not refused: an open one reserves
 -- the money, and a paid one has already had it sent.
 select coalesce(sum(amount_paise) filter(where status='available_for_withdrawal'),0)
        - coalesce((select sum(p.amount_paise) from public.partner_payout_requests p
                     where p.partner_id=v_partner and p.status not in ('cancelled','rejected')),0)
   into v_available
   from public.partner_earnings where partner_id=v_partner;
 if p_amount_paise > v_available then raise exception 'Withdrawal exceeds available balance' using errcode='22023'; end if;
 insert into public.partner_payout_requests(partner_id,amount_paise,payout_method,destination_label)
   values(v_partner,p_amount_paise,p_method,trim(p_destination_label)) returning id into v_id;
 return jsonb_build_object('id',v_id,'status','pending','amount_paise',p_amount_paise);
end $$;

-- ── Marketing Materials: the bucket the library rows point at ──────────────
-- `partner_marketing_assets` (20260918035349) defaults `storage_bucket` to
-- 'partner-marketing-assets' but never created that bucket, so the library
-- could list assets whose files had nowhere to live. Private, like
-- `partner-support` — and deliberately with NO storage policy for
-- `authenticated`: a partner reaches a file only through
-- GET /api/partner/marketing-assets/:id/download, which signs a short-lived URL
-- after the id has shown up in get_partner_marketing_assets for THAT caller. A
-- client-side policy here would let anyone who guessed a path read the file.
-- Guarded the same way the operations migration guards its storage half: no
-- storage schema (a bare Postgres, the local PGlite gateway) means nothing to do.
do $$ begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  execute $ma$
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
     ('partner-marketing-assets','partner-marketing-assets',false,26214400,
      array['image/png','image/jpeg','image/webp','application/pdf','video/mp4','text/plain','application/zip'])
    on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types
  $ma$;
end $$;

revoke all on function public.get_my_partner_payout_requests(integer,integer),
  public.cancel_my_partner_payout_request(uuid), public.get_my_partner_support_tickets(integer,text),
  public.get_my_partner_notification_preferences(), public.update_my_partner_notification_preferences(boolean,boolean),
  public.get_partner_marketing_asset_categories() from public, anon;
grant execute on function public.get_my_partner_payout_requests(integer,integer),
  public.cancel_my_partner_payout_request(uuid), public.get_my_partner_support_tickets(integer,text),
  public.get_my_partner_notification_preferences(), public.update_my_partner_notification_preferences(boolean,boolean),
  public.get_partner_marketing_asset_categories() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
