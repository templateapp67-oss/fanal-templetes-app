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

## Partner dashboard (`20260915`, `/partner/*` — alias `/growth-partner/*`)

Six sections (Dashboard, Referrals, Customers, Performance, Commission,
Profile) read through three session-scoped RPCs
(`get_my_partner_dashboard`, `get_my_partner_referrals`,
`get_my_partner_performance`) — no partner/user id parameters, server-side
filter/search/pagination/aggregation, display-name-only disclosure with
masked refs. Page gate + RPC gate both backend-enforce partner-only access.

The dedicated `/partner/login` page (PART 2) is the portal's entry: Supabase
Auth sign-in, then the same backend-only authorization (own `growth_partners`
row + own KYC application: active → `/partner/dashboard`; pending/rejected/
inactive → held or denied; everyone else → "You do not have access to the
Growth Partner portal."). Remember me chooses which browser store holds the
session (localStorage vs sessionStorage — `src/lib/authRememberStorage.ts`);
forgot password goes through Supabase Auth
`resetPasswordForEmail`/`updateUser` with `PASSWORD_RECOVERY` handled on
`/partner/login`.

The portal dashboard shell (`PartnerPortalShell.tsx`, PART 2.2) renders the
sidebar + top header + main layout on desktop and a hamburger drawer on
mobile. The menu is registry-driven — `PARTNER_PORTAL_NAV_GROUPS` groups the
entries `PARTNER_PORTAL_NAV` declares, and each entry carries its own icon,
label, group and section id, so a new module plugs in by joining that registry
plus `PARTNER_PORTAL_SECTIONS` in `src/lib/router.ts` without redesigning the
shell. Menu sections: Dashboard, My Referral Code (own code +
share link `/signup?ref=CODE` — the canonical form built by
`src/lib/partnerReferralLink.ts`; `/onboarding/referral?ref=CODE` is also
accepted by the router — which pre-fills the onboarding
referral screen, backend still re-validates on submit), Referred Users,
Referral Status (KPI chips + legend around the server-filtered list),
Rewards, Extra Onboarding Reward, Commission, Earnings, Withdrawals, Partner
Levels, Leaderboards, Marketing Materials, Notifications, Support, Profile;
Logout is an action, not a section. Legacy `/partner/referrals` and
`/partner/customers` aliases resolve to Referred Users / Referral Status.

The seven operational sections (Earnings, Withdrawals, Marketing Materials,
Partner Levels, Leaderboards, Notifications, Support) are live pages, not
placeholders — no sidebar entry is disabled and none carries a "Soon" badge.
Their shared shape is `src/components/partner/*` on top of
`PartnerModuleKit.tsx` (header, card, table, chips, toast, loading/empty/error
states, each section tagged `data-partner-module`), and they read and write
through one data layer: `src/lib/partnerPortalOperations.ts` calls
`/api/partner/*` (`server/partnerPortalRoutes.ts`, registered from both
`server.ts` and `api/index.ts`) with the caller's own bearer token and falls
back to the `get_my_partner_*` / `request_my_partner_*` RPCs when that proxy is
not part of the deploy. Neither path accepts a partner id from the client — the
SQL derives it from the session, so a section can only ever see its own
partner's rows; the API layer adds no privilege and re-raises a missing
function as `schema_not_applied` so the page can say what to apply.
`src/lib/partnerPortalQueries.ts` keeps the four states a real dashboard has
(first load, refreshing, failed, zero rows) impossible to skip, and
`src/lib/partnerPresentation.ts` is the only formatter allowed to turn paise,
ISO dates or ledger statuses into text on screen.

Every section now meets those data layers through one facade:
`src/services/growthPartner.ts` (`growthPartnerService`). It takes no partner id
— identity is the session JWT — keeps every monetary value in whole paise
(validating the raw answer instead of coercing a missing field to `0`), and
answers either `{ ok: true, data }` or `{ ok: false, error }`. That is what
makes a fake zero impossible to render: a missing or malformed money/count field
is a classified `contract-mismatch` failure owned by an administrator, never
`₹0.00`, while a genuinely empty wallet is a success with real zeros. Failures
are classified by `src/lib/partnerAreaFailure.ts` — the same classifier behind
the in-page failure panel and `npm run diagnose:partner-dashboard` — so a
screen, a copied support report and a terminal diagnosis cannot disagree.
`src/lib/partnerServiceQueries.ts` exposes the same four states over those
result objects (`usePartnerServiceQuery` / `usePartnerServiceAction`).

Two entry points advertise that layer without owning any logic of their own:

* **`src/types/growthPartner.ts`** — the area's public type surface (identity,
  read models, the paise payloads, `GrowthPartnerResult` and the classified
  `PartnerAreaFailure`). It re-exports and defines nothing, so there is exactly
  one definition of every shape; the file's closing note maps the names other
  Growth Partner codebases use (`TransformedReferral`, `partner.email`,
  `partner.tier`, `fetchPartner(partnerId)`) onto these ones and says why they
  are not aliased.
* **`src/components/GrowthPartner/index.ts`** — the UI entry point, re-exporting
  the page, the dashboard sections, the seven operational modules, the guard and
  the failure panel. Components stay next to the rest of the app's components;
  `tests/growthPartnerPublicSurface.test.ts` proves every export is the identical
  module object (a fork would fail), that neither surface defines anything, and
  that no partner-data component reaches around the facade for data.

The header (PART 2.3) shows the page title, the partner's name and Partner ID
(their own auth id, display-only), the notifications dropdown (the real
recent-activity feed from `get_my_partner_dashboard` — the portal reads that
RPC on every section), and the profile avatar's dropdown: My Profile,
Account Settings (a disabled "Soon" slot until that module exists) and
Logout. On phones the header is hamburger + logo + avatar.

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
20260915 → 20260916 → 20260917 → 20260918 → 20260919 → 20260920`, where
`20260916` converges Part 1 objects and guards ordering/shape (it never
redefines later-phase RPC bodies) and `20260919` aligns the application →
KYC review → partner-read chain with the shipped `growth_partners`
schema — without it the area applies cleanly and then fails at runtime;
staff chain honors the in-file ordering guard). `20261002_owner_workspace_
provisioning.sql` closes the PART 3 workspace gap: it creates
`organizations` / `organization_members` / `salons` /
`nexora_owner_salon_ids()` **only when they are absent** (on a project that
already has the normalized generation it is a no-op) and adds the idempotent
`ensure_owner_workspace()` + `get_my_owner_workspace()` that the Template App
entry gate calls. Scheduled cleanup of expired
`public.growth_referral_attributions` rows is an owner action (clients have
no grant on that table). Otherwise: provision partners via
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
