# Growth Partner + Onboarding + Template Website — End-to-End Architecture

Single Supabase project, single Auth system, single database. No second
backend, no duplicate user/profile/referral/customer tables, no parallel
business rules. This document matches the implementation on
`arena/01a08be5-fanal-templetes-app` (final audit).

## Flow

```
Growth Partner (unique referral code)
  → Onboarding App: Sign Up → Login → Referral Code (server-validated, immutable link)
  → Secure one-time handoff (5-min, single-use, server-validated)
  → Template App: website setup → explicit cloud save
  → Backend verifies completion → onboarding_status = completed
  → Growth Partner dashboard: referrals, customers, performance
  → Commission: staff engine exists (see below); partner payouts have no
    model yet, so the UI honestly reports "No commission earned yet."
```

## Canonical entities (one source of truth each)

| Fact | Canonical store |
|---|---|
| User / session / password | Supabase Auth (`auth.users`); passwords never stored manually |
| Profile | `public.profiles` (created by `handle_new_user`, owner-only RLS) |
| Organization / salon / services | Normalized production schema (`organization_members`, `salons`, `services`) |
| Growth Partner + referral code | `public.growth_partners` (unique code, `is_active`; partner ≠ salon owner) |
| Referral ownership | `public.growth_onboarding.growth_partner_id` (immutable after link) |
| Onboarding state | `public.growth_onboarding.status` (`not_started → linked → template_started → template_completed`, forward-only, terminal) |
| Handoff grant | `public.template_handoffs` (hash-only, RLS fully closed, RPC-only) |
| Website/template state | Normalized salon rows (slug/name/services) or legacy `profiles`+`services.owner_id` |
| Staff commission | `staff_commission_settings` + `staff_commission_payouts` (owner-scoped payroll domain) |
| Salon loyalty referrals | `public.referrals` + loyalty ledger (NX- check-in credits — a DIFFERENT domain from Growth Partner referrals; namespaced, no shared logic) |

## Onboarding state machine

`pending` (not_started) → `referral_added` (linked) → `template_started` →
`completed` (template_completed). Transitions are backend-only
(`link_my_growth_referral`, handoff exchange / `start_template`,
verified completion); completed never regresses; repeats are idempotent.

## Secure handoff (`20260913`)

64-hex token (244-bit), md5-hash storage, 5-minute TTL, single-active
supersede, atomic `FOR UPDATE` + conditional consume. Exchange verifies
owner = `auth.uid()`, destination, consumed, expiry, live referral. The URL
carries only token+state — never identity. Consumed/expired grants show safe
recovery states (no loops).

## Completion definition (`20260914`)

Trigger: the existing explicit **“Save & Update Website”** cloud save that
opens “Website saved successfully!” — no invented button. Verification is
server-side (`template_website_is_complete`): active owner/manager org +
named + slugged salon + active service (normalized), or subdomain + name +
owned service (legacy). `complete_template_onboarding()` advances the
session caller idempotently with server timestamps; the legacy stepper's
complete-branch enforces the same check (no bypass).

## Partner dashboard (`20260915`, `/growth-partner/*`)

Six sections (Dashboard, Referrals, Customers, Performance, Commission,
Profile) read through three session-scoped RPCs
(`get_my_partner_dashboard`, `get_my_partner_referrals`,
`get_my_partner_performance`) — no partner/user id parameters, server-side
filter/search/pagination/aggregation, display-name-only disclosure with
masked refs. Page gate + RPC gate both backend-enforce partner-only access.

## Commission source of truth

- **Staff (salon payroll):** `calculate_staff_commission` (canonical 5-arg;
  the obsolete 4-arg overload is dropped in `20260909`) computes
  **percentage on NET (gross − discount), capped at net; fixed capped at
  net; missing/disabled/`none` pays 0; effective-dated.** Per-staff
  `commission_basis` (`net` default, `gross` opt-in) is honored by the
  reporting scalar. Payouts: `pending → approved → paid` with
  double-pay/double-approve guards + unique open-period index (concurrent
  approves fail safe, never duplicate). Refunds: exclusion-based —
  failed/refunded/cancelled payments are excluded from commissionable facts
  (no reversal entries; existing policy preserved). Math is pinned by
  `tests/staffCommissionMath.test.ts` against the verbatim shipped bodies.
- **Growth Partner:** NO commission model exists (no tables/RPCs/config).
  Nothing was invented. Requirements to build one: a defined qualifying
  event + amount basis + rate/amount config + eligibility lifecycle; only
  then can display/history be wired.

## Required environment variables

Public (browser-safe): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_TEMPLATE_APP_URL` (same deployment default), `VITE_ONBOARDING_APP_URL`
(optional). Server-only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`. Service-role key must never appear in `VITE_*`,
bundles, URLs, or storage. Razorpay mock gateway never activates in
production unless explicitly forced.

## Required production configuration (owner checklist)

Supabase dashboard: Auth URL allow-list (production + preview domains),
email provider/limits; apply migrations in filename order (growth chain
`20260911094853 → 20260911101201 → 20260912 → 20260913 → 20260914 →
20260915 → 20260916 → 20260917 → 20260918 → 20260919`, where
`20260916` converges Part 1 objects and guards ordering/shape (it never
redefines later-phase RPC bodies) and `20260919` aligns the application →
KYC review → partner-read chain with the shipped `growth_partners`
schema — without it the area applies cleanly and then fails at runtime;
staff chain honors the in-file ordering guard); provision partners via
`provision_growth_partner` or `provision_growth_partner_by_email`
(SQL Editor / service_role only — revoked from all clients; omitted code
keeps the current code, explicit code rotates intentionally), or approve a
submitted application with `review_growth_partner_application`. Full
runbook: `GROWTH_PARTNER_SETUP.md`; check a deployment with
`npm run verify:growth-partner -- .env`. Vercel:
env vars above, SPA rewrites (already in `vercel.json`), serverless `/api`
entry (`api/index.ts`). Razorpay: live keys + webhook secret + endpoint
`<domain>/api/payments/razorpay/webhook`.

## Migration order & rollback

Apply `supabase/migrations/*.sql` in lexical order; never run files
individually out of order. Growth migrations (`20260912–19`) are additive
(functions + two tables + RLS/policies); rollback = drop the added
functions/tables (no destructive rewrites exist in this chain). Do not
recreate the legacy bootstrap to “fix” drift — normalized production is
the baseline; legacy branches are probed defensively, never assumed.

Two files are NOT part of that chain and must not be applied to a project
built from this repository: `20260911092650_growth_partner_referred_users_production.sql`
and `20260911092959_bind_growth_partner_referrals_private_wrapper.sql`. They
target an older production `growth_partners` generation (`id`,
`partner_code`, `status`) plus `shop_attributions`; the first is a
`language sql` body, so Postgres resolves `gp.status` at CREATE time and the
file fails against the table `20260912` creates. `20260919` supplies
`get_my_growth_partner()` for the shipped schema instead (and still serves
the older generation if a deployment has it). Pinned by
`tests/growthPartnerApproval.test.ts`.

## Testing procedure

`npx tsc --noEmit` · `npm test` (PGlite backend contracts + SSR + static
guards; commission math runs the verbatim shipped bodies) · `npm run build`.
Live auth/DB/payment validation requires project credentials and is
blocked in automation — see “Known blockers”.

## Known externally blocked items

Live Supabase auth/referral/handoff/completion walkthrough, production
Razorpay capture + webhook delivery, Supabase dashboard URL allow-list
verification, Vercel env presence — all need owner credentials/access and
are explicitly NOT claimed complete.
