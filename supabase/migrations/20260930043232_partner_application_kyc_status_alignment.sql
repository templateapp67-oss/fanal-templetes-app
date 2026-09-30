-- Production RPC writes 'submitted', but a legacy CHECK only allowed
-- pending/approved/rejected (SQLSTATE 23514). Keep legacy pending rows valid
-- and allow the KYC lifecycle used by submission and review RPCs.
begin;
set local lock_timeout = '5s';

alter table public.growth_partner_applications
  drop constraint if exists growth_partner_applications_kyc_status_check;
alter table public.growth_partner_applications
  add constraint growth_partner_applications_kyc_status_check
  check (kyc_status in (
    'pending', 'not_submitted', 'submitted', 'under_review', 'approved', 'rejected'
  ));

notify pgrst, 'reload schema';
commit;
