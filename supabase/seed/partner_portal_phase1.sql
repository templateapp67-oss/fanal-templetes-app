-- Development/staging only. Never run this in production.
-- Usage: set app.seed_partner_id = '<growth_partners.id>'; then run this file.
begin;
do $$
declare v_partner uuid := nullif(current_setting('app.seed_partner_id', true),'')::uuid;
begin
  if v_partner is null or not exists(select 1 from public.growth_partners where id=v_partner) then
    raise exception 'Set app.seed_partner_id to an existing growth_partners.id before seeding';
  end if;
  insert into public.partner_earnings(partner_id,source_key,earning_type,status,amount_paise,earned_at,payment_cleared_at,available_at)
  values
    (v_partner,'phase1-seed-available','recurring_subscription_commission','available_for_withdrawal',125000,now()-interval '10 days',now()-interval '8 days',now()-interval '1 day'),
    (v_partner,'phase1-seed-pending','recurring_subscription_commission','pending',75000,now()-interval '1 day',null,null)
  on conflict(partner_id,source_key) do nothing;
  insert into public.partner_notifications(partner_id,notification_type,title,body)
  values(v_partner,'system','Phase 1 seed data ready','Sample portal data was added for local testing.')
  on conflict do nothing;
end $$;
commit;
