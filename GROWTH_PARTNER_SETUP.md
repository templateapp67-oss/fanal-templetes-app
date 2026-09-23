# Growth Partner area — complete setup

`/partner/dashboard` (Dashboard · My Referral Code · Referred Users · Referral Status · Profile), reached through the dedicated login page at **`/partner/login`** ("Growth Partner Login"). The older `/growth-partner/*` routes keep working as an alias of the same module — both namespaces share the same component, the same Supabase Auth and the same backend checks.

The frontend, the backend RPCs and the tests are all in this repository. What a
deployment must add is three things, in this order:

1. **A live Supabase connection** (`.env`) — without it the app runs in mock
   mode and the area shows *"Growth Partner area needs a live connection"*.
2. **The Growth Partner migrations**, applied in the order below.
3. **A partner row for your account** — the area is denied to every signed-in
   user who is not in `public.growth_partners`. With migration
   `20260922091000` a signed-in account provisions itself (see §4b); without it,
   create the row as in §4a/§4c.

Then verify with one command:

```bash
npm run verify:growth-partner -- .env
```

It prints PASS/FAIL per check (env, tables, schema generation, every function
the UI calls, anonymous fail-closed, pending-application queue) and exits 1 with
the next step for anything missing.

---

## 1. Environment

Copy `.env.example` to `.env` (or run `npm run setup:env`) and fill in:

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | browser auth + every area read (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only: provisioning/approving partners. Never ships to the browser. |

Restart the dev server after editing `.env` — the mode is decided once, at
startup (`src/lib/supabaseClient.ts` logs `Supabase keys are missing…` in mock
mode).

## 2. Prerequisites that must already exist

* `public.profiles` — created by `supabase/migrations/00001_init.sql`
  (`growth_partner_applications.user_id` references it).
* `private.is_admin()` — used by the admin review RPC and by the applications
  RLS policy. **This function is not defined in this repository** (production
  carries its own). If your project does not have it yet, create it before
  step 3; if it already exists, leave it alone:

```sql
create schema if not exists private;

create table if not exists private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from private.platform_admins a where a.user_id = auth.uid()
  )
$$;

-- Add yourself (SQL Editor / service_role), then the review RPC accepts you:
-- insert into private.platform_admins(user_id) values ('<your auth uid>');
```

`private` is not exposed by PostgREST, so the admin list is not readable over
the API.
* `private.is_trusted_server_or_admin()` — the ledger half of the portal gates on
  it (`release_partner_earnings()` makes cleared commission withdrawable,
  `admin_mark_partner_payout_paid()` pays a request out), and no migration in this
  repository defined it. `20260919120000_partner_portal_section_reads.sql` now
  creates the minimum — superuser, or the same `app.is_admin` claim
  `private.is_admin()` reads, or `service_role` — **only when the function does not
  already exist**: if your project has its own predicate for who may move money,
  that one stays in force untouched.

## 3. Migrations, in this order

Apply in the SQL Editor (or `supabase db push`) exactly in this order — each
file is idempotent:

| # | File | What it adds |
| --- | --- | --- |
| 1 | `20260911094853_growth_partner_signup_approval.sql` | `growth_partner_applications` + submit/review |
| 2 | `20260911101201_growth_partner_kyc_approval.sql` | KYC columns + KYC submit |
| 3 | `20260912_growth_partner_onboarding.sql` | `growth_partners`, `growth_onboarding`, link/progress RPCs, `provision_growth_partner` |
| 4 | `20260915_growth_partner_dashboard.sql` | dashboard / referrals / performance RPCs |
| 5 | `20260916_part1_referral_hardening.sql` | code rotation safety, `provision_growth_partner_by_email` |
| 6 | `20260917_part1b_link_atomicity.sql` | atomic single-winner referral link |
| 7 | `20260918_partner_dashboard_inactive_guard.sql` | paused partners denied by the backend |
| 8 | `20260919_growth_partner_area_contract_alignment.sql` | **required** — see below |
| 9 | `20260920_growth_partner_application_queue.sql` | `list_growth_partner_applications` — the admin review queue (admin-only) |
| 10 | `20260928_partner_referrals_table.sql`, `20260929_partner_referral_events_rls.sql` | `partner_referrals`, `partner_referral_events` and `growth_partners.id` — **must precede the portal sections below** |
| 11 | `20260918035349_partner_portal_operations.sql` | the operational model the Earnings/Withdrawals/Marketing/Levels/Leaderboards/Notifications/Support sections read: `partner_earnings`, `partner_payout_requests`, `partner_level_definitions` (+ seeded tiers), `partner_notifications`, `partner_notification_preferences`, `partner_marketing_assets`, `partner_support_tickets`, `partner_support_attachments`, own-row RLS for all of it, the two private buckets, and the `get_my_partner_*` / `request_my_partner_payout` / `record_partner_subscription_commission` / `release_partner_earnings` / `admin_mark_partner_payout_paid` RPCs |
| 12 | `20260922085236_enable_growth_partner_open_enrollment.sql` | open enrollment: a signed-in account that submits its own validated application is approved immediately (the `/partner/login` "Become a Growth Partner" form) |
| 13 | `20260922091000_direct_growth_partner_dashboard_access.sql` | **`ensure_my_growth_partner()`** — direct self-enrollment for `auth.uid()`. Required by `/partner/dashboard`: without it every denial screen's "Instantly Approve & Access" action and the login page's automatic activation cannot run (see 7.4) |
| 14 | `20260919120000_partner_portal_section_reads.sql` | the reads/writes section 7.3 still needed on top: `get_my_partner_payout_requests`, `cancel_my_partner_payout_request`, `get_my_partner_support_tickets`, `get_my_partner_notification_preferences`, `update_my_partner_notification_preferences`, `get_partner_marketing_asset_categories`; the private `partner-marketing-assets` bucket; `private.is_trusted_server_or_admin()` when §2's prerequisite is missing; and a forward fix to `get_my_partner_earnings` / `request_my_partner_payout` so a **paid** payout stays spent (see 7.3) |

The two portal migrations sort earlier than they apply:
`partner_earnings.partner_id` and the referral joins FK to
`growth_partners(id)` / `partner_referrals` / `partner_referral_events`, which
only exist from `20260928_partner_referrals_table.sql` /
`20260929_partner_referral_events_rls.sql` onward. Apply them after those two.

Inside that window they run on **either** `growth_partners` generation:
`my_active_partner_id()` and `get_partner_leaderboard()` look the `status`
column up in `information_schema` and use `is_active` alone when the table has
no approval column — the same two-branch idiom
`20260919_growth_partner_area_contract_alignment.sql` established, and for the
same reason (`language sql` resolves columns at CREATE time, so an unguarded
`gp.status` made the whole file uninstallable on a project built from this
repository). Their storage halves are likewise conditional: with no
`storage.buckets` (a bare Postgres, e.g. the PGlite suites) the bucket rows and
object policies are skipped and every table and RPC above still applies. On a project where these
two files are simply missing, every promoted section says so instead of showing
an empty dashboard (see 7.3).

**Do not apply `20260911092650_growth_partner_referred_users_production.sql` or
`20260911092959_bind_growth_partner_referrals_private_wrapper.sql` to a project
built from this repository.** They were written against an older production
`growth_partners` generation (`id`, `partner_code`, `status`) and reference
`shop_attributions`; the first is a `language sql` body, so Postgres resolves
`gp.status` at CREATE time and the file fails outright against the table
`20260912` creates. `tests/growthPartnerApproval.test.ts` (test 12) pins this.

### Why `20260919` is required

Before it, the chain applied cleanly and then failed at runtime — three defects
that only appear when the area is used (all reproduced on PGlite and pinned by
`tests/growthPartnerApproval.test.ts`):

| Symptom | Cause | Fix in `20260919` |
| --- | --- | --- |
| `42501 permission denied for table "growth_partner_applications"` on every sign-up | `submit_growth_partner_application` was `SECURITY INVOKER`, and `INSERT … ON CONFLICT DO UPDATE` needs UPDATE, which `authenticated` does not have (and no UPDATE policy exists) | now `SECURITY DEFINER` with a pinned `search_path`; still writes only `auth.uid()`'s own row, so no new table grant is needed |
| `column "partner_code" of relation "growth_partners" does not exist` on approval | the review RPC inserted `partner_code`/`status` and a `'REF-…'` code that the `^[A-Z0-9]{6,12}$` CHECK rejects; plpgsql bodies are not validated at CREATE time | approval now provisions through `public.provision_growth_partner()` and keeps an existing partner's referral code (re-approving never rotates it) |
| `column gp.status does not exist` on the area's first read | `get_my_growth_partner()` (from `092650`) read the older generation, while the dashboard RPCs read `is_active` | same JSON contract, active flag resolved from whichever column the deployed table has; stays `SECURITY INVOKER` so RLS remains the access control |

## 4. Make your account a Growth Partner

The area denies every signed-in user without a `growth_partners` row
(*"Growth Partners only"*). Three ways in — with the enrollment migrations
applied, option (c) is the one the product uses:

**a. KYC review (the product flow).** The applicant signs up on
`/growth-partner/login`, which calls `submit_growth_partner_application`. Then,
as an admin (a JWT for which `private.is_admin()` is true — the SQL Editor
session user works):

```sql
select id, full_name, phone, kyc_status, kyc_document_type, kyc_document_reference, created_at
from public.growth_partner_applications
where status = 'pending'
order by created_at;

select public.review_growth_partner_application('<application id>', true, 'KYC verified');
```

Approval creates the partner row with a valid unique referral code. Rejecting
(`false`) leaves the applicant without access and lets them reapply.

**b. Self-service enrollment (applied by migration 20260922091000).** A
signed-in account provisions **itself** — the login page does this
automatically, the denial screens offer it as "Instantly Approve & Access", and
`select public.ensure_my_growth_partner();` works from any signed-in SQL session
that carries the user's JWT. It cannot name another account, and it will not
reactivate a suspended one. With `20260922085236` (open enrollment) the signup
form approves the applicant immediately.

**c. Admin shortcut (no application needed).**

```sql
select public.provision_growth_partner_by_email('you@example.com');
-- or by UUID:  select public.provision_growth_partner('<auth uid>');
```

Or from the CLI with the service-role key in `.env`:

```bash
npm run verify:growth-partner -- .env --provision-email you@example.com
```

Pause a partner (they lose the area, backend-enforced) with
`select public.provision_growth_partner('<auth uid>', null, false);`.

## 5. Verify

```bash
npm run verify:growth-partner -- .env
```

Expected tail: `The Growth Partner area is wired end to end on this project.`

The verifier checks the operational model too: the seven `partner_*` tables and
one read probe per promoted section (each probe is a read, or a write the
function itself refuses for a key that owns no partner row — the financial
writers are never called, a health check must not be able to move money). On a
project where `20260918035349_partner_portal_operations.sql` has not been
applied this fails with `partner_earnings … not found` /
`PGRST202` lines — the same reason the seven sections print the schema hint
(7.3), now visible before a partner has to discover it.

Backend-only regression checks (no live project needed — they run the real
migrations on PGlite):

```bash
npx tsx --test tests/growthPartnerApproval.test.ts   # apply → approve → area reads
npx tsx --test tests/growthPartner.test.ts tests/growthPartnerDashboard.test.ts
```

## 6. Running it locally with no Supabase project

For local development this repository ships a small Supabase-compatible gateway
(`server/localSupabase.ts`) that serves `/auth/v1` and `/rest/v1` from PGlite and
applies the same migrations above, so the Growth Partner flow can be exercised
end to end without a cloud project.

```bash
# .env  (git-ignored; .env.example documents the same block)
VITE_LOCAL_SUPABASE=true
LOCAL_SUPABASE=true
SUPABASE_ANON_KEY=local-dev-anon-key
VITE_SUPABASE_ANON_KEY=local-dev-anon-key

npm run dev
```

What it gives you:

* **Dev + no real `SUPABASE_URL` only.** The gateway mounts when
  `NODE_ENV !== production`, the local flag is on, and no real project URL is
  configured. Point `SUPABASE_URL` at a real project and it steps aside.
* A **seeded admin account**, printed once on boot: `admin@nexora.local` /
  `Admin#12345` (local database only, never a production credential). Signing in
  with it shows the review queue on the login route so approvals are clickable.
* Sign-up, password sign-in, session restore and logout; the KYC submit →
  admin review → partner area path; and the area's own table read
  (`growth_partner_applications`), which stays RLS-scoped to the caller.
* Admin claims map to `service_role`, so admin-only RPCs behave as they do in a
  real project (a browser session cannot call them).
* **Honest failures instead of fake data.** Table reads outside the Growth
  Partner area (owner/booking screens, which need the normalized production
  schema) answer `501`, and unknown functions answer `PGRST202`.

Sign-ups persist in `.local-db/` across restarts; delete that directory to start
clean. `tests/localSupabaseGateway.test.ts` drives the gateway over real HTTP.

## 7. The `/partner/*` portal (PART 2)

`/partner/login` and `/partner/dashboard` are the canonical Growth Partner
routes (the legacy `/growth-partner/*` namespace renders the same module and
stays supported for existing links). No new backend objects are required — the
portal uses the same Supabase Auth, the same migrations and the same RLS model
as everything above.

What the portal adds on top of the area:

* **A dedicated login page** (`src/components/PartnerPortalLogin.tsx`) with the
  platform logo, the `Growth Partner Login` heading, email + password fields, a
  show/hide password toggle, **Remember me**, **Forgot Password**, loading and
  error states, and a success redirect to `/partner/dashboard`.
* **Authorization is still backend-only.** After every sign-in and session
  restore the page reads the caller's own `growth_partners` row (RLS) plus
  their own KYC application: an ACTIVE partner is forwarded to the dashboard;
  `pending` → "under review", `rejected` → not approved, `is_active = false`
  (inactive/suspended) → denied, and a normal customer/owner/admin gets
  *"You do not have access to the Growth Partner portal."* Nothing settable
  from the browser (role flags, localStorage, query parameters, partner ids)
  is an input to that decision — `resolvePartnerPortalLogin()` accepts only
  the session id and the backend rows.
* **Remember me is real.** Checked (default): the session persists in
  `localStorage` and the email is remembered for the next visit. Unchecked:
  the session lives in `sessionStorage` (it dies with the browser) and any
  older remembered session token is dropped so it cannot silently revive
  (`src/lib/authRememberStorage.ts` supplies the storage supabase-js uses; a
  failed sign-in reverts the choice). The remembered email is only a prefill —
  never an access input.
* **Forgot password is real.** The reset form calls Supabase Auth
  `resetPasswordForEmail` with `redirectTo /partner/login`; the reset email's
  link lands back here, the client's `detectSessionInUrl` establishes the
  recovery session and fires `PASSWORD_RECOVERY`, and the page shows the
  set-a-new-password form which completes via `updateUser`. With the local
  gateway there is no email: the one-time recovery link (same implicit-grant
  format) is printed to the dev-server console instead, and
  `PUT /auth/v1/user` enforces the same password rules.

Tests: `tests/partnerPortalLogin.test.ts` (routes, resolver, form elements,
remember-me stores, reset flow, PGlite backend contract) and
`tests/dom/partnerPortalLoginBrowserFlow.test.ts` (real clicks: show/hide,
remember me, submit → error → success redirect, denial, forgot password,
recovery). Gateway coverage for the reset endpoints lives in
`tests/localSupabaseGateway.test.ts` (test 6).

### 7.1 The partner dashboard shell (Part 2, section 2)

After login, `/partner/dashboard` renders the professional portal shell
(`src/components/PartnerPortalShell.tsx`): on desktop a **fixed sidebar + top
header + main content** column; on mobile a collapsible navigation **drawer**
(hamburger button, backdrop click and Escape both close it, a navigation tap
closes it too).

* **The sidebar menu is exactly** Dashboard, My Referral Code, Referred Users,
  Referral Status, Profile and Logout (bottom of the sidebar, also in the
  header). `aria-current="page"` marks the active section; the header shows
  the partner's name, email and a logout action.
* **My Referral Code** (`/partner/referral-code`) shows the caller's own code
  (from their `growth_partners` row — never editable in the UI) with one-click
  copy and a ready-to-share onboarding link:
  `<origin>/onboarding/referral?ref=CODE`. Opening that link lands the new
  user on the onboarding referral screen with the code pre-filled
  (`readSharedReferralCode()` in `src/onboarding/OnboardingApp.tsx`); the
  backend still re-validates the code on submit, so the prefill is UX only.
  A paused partner sees an honest "paused" note instead.
* **Referred Users** (`/partner/referred-users`) is the plain referrals roll;
  **Referral Status** (`/partner/referral-status`) frames the same real,
  server-filtered/searchable list with KPI chips (Total / In Progress /
  Completed, from `get_my_partner_dashboard`) and a plain-language legend of
  the three statuses. **Profile** (`/partner/profile`) stays read-only.
* **Expandable by design.** The sidebar is data-driven from two registries in
  the shell: `PARTNER_PORTAL_NAV` (live menu items) and `PARTNER_PORTAL_PLANNED`
  (future modules, rendered as disabled "Soon" slots — never fake links). The
  eight planned slots are Earnings, Commission, Withdrawals, Marketing
  Materials, Partner Levels, Leaderboards, Notifications and Support: adding a
  real module later means adding a router section + content renderer and moving
  the entry from the planned registry to the nav registry — no shell redesign.
  `/partner/performance` and `/partner/commission` remain URL-reachable (their
  real content) without being menu items yet. Legacy aliases
  `/partner/referrals` → Referred Users and `/partner/customers` → Referral
  Status keep working.

Tests: `tests/partnerPortalShell.test.ts` (menu contract, layout SSR, planned
slots, referral-code page, share-link helper, status page, prefill wiring) and
`tests/dom/partnerPortalShellBrowserFlow.test.ts` (real clicks through the
stubbed-but-real Supabase REST layer: boot → shell → section navigation,
drawer open/close, logout, `?ref=` prefill).

### 7.2 The dashboard header (Part 2, section 3)

The portal header carries: the **page title**, the **partner name** and
**Partner ID** (the signed-in partner's own auth id — a display value from the
session, shown in a compact form with the full id in the tooltip), the
**notification icon**, the **profile avatar** with a **profile dropdown**
(My Profile → `/partner/profile`; Account Settings — a planned slot shown
disabled with a "Soon" badge until an account-settings module exists; Logout),
and a quick **Logout** button (sm+ screens). On phones the header is the
hamburger menu, the logo and the partner avatar (the avatar opens the same
profile dropdown, where Logout lives).

The **notifications dropdown** is a peek at the recent-activity feed from
`get_my_partner_dashboard` (referral added / website started / website
completed, with masked refs) and nothing more — no invented counts, no unread
badge the dashboard payload cannot back up. Its footer hands off to
`/partner/notifications`, which is where the real notification rows, their
unread count and mark-as-read live (7.3). The portal reads the dashboard RPC on
every section (it also feeds the page KPIs). Dropdowns close on outside click,
Escape and after an action, and both are keyboard/AT-labelled (`aria-expanded`,
`aria-haspopup`, `role="menu"`).

Tests: the Section 2 suites above cover the header too (header structure,
profile menu, notifications panel, `shortPartnerId`, and the click flows).

### 7.3 The operational sections — Earnings, Withdrawals, Marketing Materials, Partner Levels, Leaderboards, Notifications, Support

These seven sidebar entries used to be inert placeholders. They are live
routes now, at the paths the product asked for:

| Section | Path | Aliases the router still answers |
| --- | --- | --- |
| Earnings | `/partner/earnings` | — |
| Withdrawals | `/partner/withdrawals` | — |
| Marketing Materials | `/partner/marketing` | `/partner/marketing-materials` |
| Partner Levels | `/partner/levels` | `/partner/partner-levels` |
| Leaderboards | `/partner/leaderboard` | `/partner/leaderboards` |
| Notifications | `/partner/notifications` | — |
| Support | `/partner/support` | — |

Nothing is disabled and no "Soon" badge remains in the shell: every entry is an
`<a href>` (so it can be copied, opened in a tab, or deep-linked), a plain left
click is handed to the SPA router, and the current section is marked
`aria-current="page"` in both the sidebar and the mobile drawer.
`tests/partnerPortalShell.test.ts` pins menu ↔ URL ↔ content sync for all
fourteen entries; `tests/dom/partnerPortalModulesBrowserFlow.test.ts` clicks
through the pages in jsdom.

**Data path.** Each page reads through `src/lib/partnerPortalOperations.ts`,
which calls this app's own API first and falls back to PostgREST RPCs when the
deploy has no `/api/partner/*`:

| Method + path | RPC behind it |
| --- | --- |
| `GET /api/partner/earnings?limit&offset` | `get_my_partner_earnings` |
| `POST /api/partner/payout-requests` | `request_my_partner_payout` |
| `GET /api/partner/payout-requests?limit&offset` | `get_my_partner_payout_requests` |
| `POST /api/partner/payout-requests/cancel` | `cancel_my_partner_payout_request` |
| `GET /api/partner/levels` | `get_my_partner_levels` |
| `GET /api/partner/leaderboard?limit` | `get_partner_leaderboard` |
| `GET /api/partner/notifications?limit&type` | `get_my_partner_notifications` |
| `POST /api/partner/notifications/read` | `mark_my_partner_notifications_read` |
| `GET`/`POST /api/partner/notification-preferences` | `get_my_partner_notification_preferences` / `update_my_partner_notification_preferences` |
| `GET /api/partner/marketing-assets?category` | `get_partner_marketing_assets` |
| `GET /api/partner/marketing-assets/categories` | `get_partner_marketing_asset_categories` |
| `GET /api/partner/marketing-assets/:id/download` | signed URL from the `partner-marketing-assets` bucket, after the id is checked against the caller's published list |
| `GET /api/partner/support-tickets?limit&status` | `get_my_partner_support_tickets` |
| `POST /api/partner/support-tickets` | `submit_my_partner_support_ticket` |

The routes are the same code in `server.ts` and `api/index.ts`
(`server/partnerPortalRoutes.ts`), they forward the caller's own bearer token,
and they never accept a partner id: the SQL derives it from the session, so a
partner cannot read another partner's wallet, tickets or notifications, and the
API layer adds no privilege of its own. Input bounds are mirrored from the
table checks (₹500 minimum payout, 2–120-character destination, 3–180
subject, 10–5000 message, ≤100 ids per mark-read, limits clamped to 200/100)
so a bad request is refused with the database's own copy rather than a
500-level surprise. Failure mapping is part of the contract:
`schema_not_applied` (501) when the migrations above are missing, 403 for a
non-partner, 400 for a rule the SQL refused, 401 for a dead session, 502 when
Postgres is unreachable — and the pages render those as an explanation with a
Retry, never as a spinner or a zero.

**A paid payout stays spent.** Ledger rows keep the status
`available_for_withdrawal` after the desk pays them (nothing allocates a payout
against particular rows), and both `get_my_partner_earnings()` and
`request_my_partner_payout()` originally netted off only requests that were
*still open* — so marking ₹1,500 paid put ₹1,500 back in the wallet and a second
₹1,500 request sailed through the ceiling check: the same commission could be
withdrawn repeatedly. `20260919120000` redefines both functions (same
signatures, so grants and callers are untouched) to net off every payout request
the desk has not cancelled or rejected, and adds `cleared_paise` — the gross
past-clearance figure — so the Withdrawals hero can still say "₹1,250 cleared ·
₹600 reserved by an open request" next to a ₹650 wallet without the page
subtracting the reservation twice. `tests/partnerPortalSectionSql.test.ts`
re-requests the paid money and expects `Withdrawal exceeds available balance`.

**Marketing downloads are not public.** `partner-support` (created by
`20260918035349`) and `partner-marketing-assets` (created by the 20260919120000
follow-up, which existed as a column default but as no bucket) are both private,
and neither carries a storage policy for `authenticated`: a download link is signed per request
for exactly one file the caller is allowed to see (60 seconds), and only after
the asset id appears in `get_partner_marketing_assets` for that partner.
Without storage configured the route answers 503 `storage_unavailable` and the
row says so inline.

**The local gateway does not run this SQL — a dedicated suite does.**
`LOCAL_GROWTH_CHAIN` (`server/localSupabase.ts`) deliberately stops at
`20261006`: adding eight more `partner_*` tables would silently widen the
Part 3 guards that enumerate which tables can hold partner/referral state, and
those invariants belong to that phase, not to the portal. So
`tests/partnerPortalSectionSql.test.ts` replays both migrations on PGlite
against that same chain and asserts the contract the pages rely on — the ₹500
floor, one open request at a time, cancel limited to the caller's own row,
ticket bounds, own-row RLS, the leaderboard's ranks and the tier unlock rules.

That means `npm run dev` with no Supabase project shows `PARTNER_SCHEMA_HINT` on
all seven sections — the honest state for a project without the migrations,
never a fake wallet. Against a real project, put the payout lifecycle through in
the order the backend guarantees it:

```sql
-- 1. a cleared subscription payment earns 15% (worker / SQL Editor)
select public.record_partner_subscription_commission('<partner_referrals.id>', 'inv-1001', 1000000, now());
-- 2. after the 7-day clearance the row becomes withdrawable (service_role only)
select public.release_partner_earnings(now() + interval '8 days');
-- 3. the partner requests it on /partner/withdrawals — ₹500 floor, one at a time
```

Tests: `tests/partnerPortalOperations.test.ts` (transport priority, fallback
rules, exact RPC argument names, normalizers, error translation, the ₹500 floor
mirrored from the SQL), `tests/partnerPortalRoutesApi.test.ts` (every registered
route: 401 before any parsing, 503 with no project, param binding, status
mapping, no partner id in any path or body), and the jsdom flows in
`tests/dom/partnerPortalModulesBrowserFlow.test.ts`.

### 7.4 "Could not verify your Growth Partner access. Please try again."

That card is `/partner/login`'s error state, and it is what the *verification*
step prints when the backend read throws. Three different causes used to look
identical; the page now separates them, and each has its own fix:

| What the page shows | Cause | Fix |
| --- | --- | --- |
| "…database setup is missing on this project… must apply the Growth Partner migrations" | PostgREST answered `PGRST202` for `get_my_growth_partner` / `ensure_my_growth_partner` — the migration was never applied (or PostgREST's schema cache is stale) | apply the migrations below, then `notify pgrst, 'reload schema';` |
| "Growth Partners only" **plus** the same "database setup is missing" notice | the verification read worked, but the *self-enrollment* RPC is missing: the account genuinely has no partner row yet and cannot provision itself | apply `20260922091000_direct_growth_partner_dashboard_access.sql` |
| "Please try again." | a genuinely transient failure (network, 5xx, expired session) | retry; if it persists check the browser console for the RPC error |

The enrollment pair, in order (each file is idempotent):

```sql
-- in the Supabase SQL Editor, or: supabase db push
-- 1. supabase/migrations/20260922085236_enable_growth_partner_open_enrollment.sql
-- 2. supabase/migrations/20260922091000_direct_growth_partner_dashboard_access.sql
select public.ensure_my_growth_partner();   -- run as a signed-in user, not the SQL Editor
```

Confirm it is there before blaming the client:

```bash
npm run verify:growth-partner -- .env
```

`ensure_my_growth_partner` is one of the probes: it is reported as missing
(`PGRST202`) when the migration was never applied, it is reported as refused
when an anonymous caller tries it, and the script now also checks that the
project host can be reached at all — an unreachable project is reported as a
network problem instead of a schema problem.

Notes:

* `ensure_my_growth_partner()` takes **no arguments** — it acts on `auth.uid()`
  only. There is no way to name another account from the browser, and it is
  `SECURITY DEFINER` with a pinned `search_path`.
* An existing suspended partner is **not** reactivated by it: `is_active = false`
  stays false. Only an admin can lift a suspension
  (`select public.provision_growth_partner('<auth uid>', null, true);`).
* Open enrollment (`20260922085236`) is what makes the signup form approve
  immediately; the manual KYC queue from §4 still works for projects that prefer
  review-first, because a pending application is no longer a hard stop — the
  denial screen offers "Become a Growth Partner" instead.

### 7.5 "/partner/dashboard" cannot load — the screen now names the cause

The area gate (`/partner/dashboard`, and the legacy `/growth-partner` sections)
used to answer every failure with one sentence — *"Could not load the Growth
Partner area. Could not load this section. Please try again."* — which is a dead
end for the two causes it most often is: a migration that was never applied, and
a grant refused for that account. Both need an administrator, not a refresh, and
the report of "hard refresh and incognito did not help" is exactly what that
sentence produces.

The failure screen now classifies the error and states **who can fix it**:

| What the screen shows | Cause | Who fixes it |
| --- | --- | --- |
| "The Growth Partner database setup is missing on this project" | `PGRST202`/`PGRST205`, or schema drift (`relation/column … does not exist`) | administrator — step 3, then `notify pgrst, 'reload schema';` |
| "You are signed in, but the database refused this read" | `42501` — missing/inactive partner row or a missing grant | administrator / support — step 4 |
| "This account is not an active Growth Partner" | signed in, no approved+active `growth_partners` row | support — step 4 |
| "Your session expired" | `401` / `PGRST301` | the user — sign in again |
| "Could not reach the Growth Partner service" | transport failure (offline, VPN, ad blocker, DNS) | the user — connection |
| "The Growth Partner service returned an error" | `5xx` | the platform — retry shortly |

Every one of those screens also offers **Run diagnostic**, which probes the live
service from the signed-in session (browser connection → session → partner table
→ `get_my_growth_partner` → `get_my_partner_dashboard`) and prints a per-call
result plus a **Copy report for support** button. The report carries the cause,
the error code, the route, the project host, the masked account and the check
list — never a key, token or address. `ensure_my_growth_partner()` is
deliberately *not* probed (it can create the partner row), and the screen says so
instead of pretending it was checked.

To reproduce the same sequence from a terminal, with the project's env file:

```bash
npm run diagnose:partner-dashboard -- .env
PARTNER_DIAG_PASSWORD='…' npm run diagnose:partner-dashboard -- .env --email you@example.com
```

Step-by-step triage, the SQL checks for the account and the full migration list:
**`GROWTH_PARTNER_DASHBOARD_ACCESS_FIX.md`**.

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| "Growth Partner area needs a live connection" | mock mode: `SUPABASE_URL`/keys missing or placeholders | step 1, then restart |
| "Sign in to open the Growth Partner area" | no session on `/growth-partner` | sign in (or use `/growth-partner/login`) |
| "Growth Partners only" | signed in, but no `growth_partners` row | step 4 |
| "Growth Partner access is paused" | `is_active = false` | re-provision with `p_active => true` |
| "Could not verify your Growth Partner access. Please try again." | the verification/enrollment read threw — see 7.4 to tell a missing migration from a real outage | 7.4 |
| "…database setup is missing on this project…" on `/partner/login` | `PGRST202` for `get_my_growth_partner` / `ensure_my_growth_partner` | 7.4: apply `20260922091000_direct_growth_partner_dashboard_access.sql`, then reload the schema cache |
| `PGRST202` / "function … not found" in the verifier | a migration was never applied | step 3, in order |
| Every operational section says "These records need the partner portal migrations" | `20260918035349_partner_portal_operations.sql` (and the 20260919120000 follow-up) are missing, or they were applied before `20260928`/`20260929` | step 3, in order — see 7.3 for the dependency |
| Marketing download says storage is not configured (503) | no `partner-marketing-assets` bucket / no service-role storage credentials | apply the portal migration and set `SUPABASE_SERVICE_ROLE_KEY`; locally this refusal is expected |
| "Could not load the Growth Partner area" | the gate read threw — the screen now names which of the six causes it is (see 7.5) | read the cause off the screen, press **Run diagnostic**, or run `npm run diagnose:partner-dashboard -- .env` |
| "The Growth Partner database setup is missing on this project" | `PGRST202`/`PGRST205` or schema drift — the migration was never applied (or the schema cache is stale) | 7.5: apply the migrations in step 3, then `notify pgrst, 'reload schema';` |
| "You are signed in, but the database refused this read" | `42501` — no/inactive `growth_partners` row for that account, or a missing grant | 7.5 + `GROWTH_PARTNER_DASHBOARD_ACCESS_FIX.md` §5 |
| "The Growth Partner service returned an error" | the API answered `5xx` | retry shortly; it is not an account or cache problem |

## Known, intentional gaps

* **Commission** section reports that no partner-commission model exists — there
  are no tables, RPCs or config for it (`ARCHITECTURE.md`). It is not a bug.
* **Referrals** is a plain referred-users roll; status filtering and name search
  live in **Customers** (server-side, one implementation).
* There is **no admin UI** for reviewing applications — review is SQL/service
  role by design (`review_growth_partner_application` has no EXECUTE grant for
  `authenticated`).

### Public partner referral codes (Sections 5–6)

Apply `supabase/migrations/20260921_public_partner_referral_codes.sql` after the
20260920 migration. The local gateway includes it automatically. Existing codes
stay unchanged; new approvals receive a random `NEXORA-` code independent of the
partner's database ID. Admin-only provisioning accepts explicit codes such as
`NEXORA-RAHUL25`. Validation trims and uppercases input, and database constraints
prevent duplicate ownership. Provisioning is serialized to preserve codes across
simultaneous approvals. Existing RLS and admin-only code-change permissions remain.

The canonical page is `/partner/referral` (`/partner/referral-code` still works).
It shares `/signup?ref=CODE` on the current origin, with copy, WhatsApp, email and
native sharing. Unsupported or failed sharing falls back to copying; cancelling
native sharing does not copy. Clipboard failures offer manual-copy guidance.

### Referral link attribution (Section 7)

Apply `supabase/migrations/20260922_referral_link_attribution.sql` after 20260921,
then deploy both API and frontend. The local gateway applies the same migration.
No additional signing secret or service-role key is needed for attribution.

- Opening `/signup?ref=CODE` calls the same-origin `POST /api/referral-attribution`
  before signup is rendered or the query is removed. The database normalizes and
  validates the active partner, creates a random one-use capability and stores
  its hash in the RLS-locked `growth_referral_attributions` table.
- The cookie is host-only, HttpOnly, SameSite=Lax, Path=/, and Secure on HTTPS and
  in production (plain HTTP is supported only for local development). The first
  valid referral wins for **seven days**, without extending expiry on navigation.
  An invalid later link does not replace a still-valid first attribution.
- Signup preparation uses `GET /api/referral-attribution` to recover the cookie
  capability, not a URL/localStorage value. Cross-origin requests are rejected;
  responses are not cached. API/database failures show a retry error rather than
  silently submitting a signup with missing attribution.
- The capability is included in Supabase signup metadata. An `AFTER INSERT` trigger
  on `auth.users` locks and consumes it in the same transaction as account
  creation. Thus attribution is saved even when email confirmation is required,
  before a browser has an authenticated session. A failed signup transaction
  rolls back consumption. User-supplied partner IDs/codes are never trusted.
- Expired, reused, forged, inactive-partner or rotated-code capabilities cannot
  create a relationship. Metadata updates cannot change an existing relationship.
  Accounts created without valid attribution retain the existing manual referral
  flow. This mechanism applies to new accounts, not login to existing accounts.
- Permanent storage reuses `growth_onboarding`: `user_id` = `referred_user_id`,
  `growth_partner_id` = `partner_id`, `referral_code`, and `linked_at` = `referred_at`.
  The RLS-respecting `partner_referral_attribution` view exposes those exact four
  field names. Existing referral dashboards and handoff flows use the same data.

Maintenance: periodically remove temporary records whose `expires_at < now()`
using a trusted database maintenance job. This never removes permanent referral
relationships. Configure normal signup/public-RPC abuse protections and request
rate limits at the deployment/Supabase gateway; database expiry is authoritative.

### Fraud safeguards and private referred-user table (Sections 8–10)

Apply `supabase/migrations/20260923_referral_fraud_privacy.sql` after 20260922.
Deploy the frontend after the migration; the local gateway includes it as well.

- The existing user primary key and atomic linking/one-use signup capability
  prevent duplicate referrals and completed-signup replays. A database CHECK
  additionally rejects self-referrals. Existing self-referral rows, if any, make
  migration validation fail rather than being silently reassigned.
- A database trigger freezes the referred account, partner, referral code and
  referral timestamp once linked. Ordinary milestone updates remain allowed
  through the existing authorized RPCs. Clients have no direct write grants.
  New attribution must match an active partner's database referral code; normal
  frontend requests never choose a partner ID. The cookie API explicitly rejects
  unexpected fields such as `partner_id`.
- Exceptional corrections use
  `admin_correct_growth_referral(p_referred_user_id, p_code, p_reason)` from a
  **trusted administrative backend only**. The function requires both EXECUTE
  access (not granted to anon/authenticated) and the existing `private.is_admin()`
  check. It resolves the new partner by code, requires an audit reason, preserves
  the signup referral timestamp and milestones, and writes a private audit row.
  No administrative correction UI or client-writable admin flag is added.
- `/partner/referrals` is now the canonical Referred Users link.
  `/partner/referred-users` and `/growth-partner/referrals` still work. The table
  supports horizontal scrolling on narrow screens, pagination, refresh and
  loading/error/empty states. Columns: User, Email / masked contact, Joined Date,
  Referral Code, Status, Conversion Status, Last Activity.
- `get_my_partner_referrals` still derives identity **only from auth.uid()** and
  rejects anonymous, non-partner and paused accounts. All filters, search and
  pagination remain constrained to the caller's referrals. It returns an explicit
  field allowlist; masking is done in SQL, not merely hidden in the UI.
- Contact is masked email (e.g. `ra***@gmail.com`), or unavailable. Joined Date is
  account creation; Last Activity is the latest referral/website milestone, not
  authentication logs. Converted means **website/template completed**, not a sale
  or payment. Internal IDs do not dominate the table, and no full auth records,
  credentials, tokens, payment information, administrative audit records or other
  partners' referrals are returned.

Tests: `tests/referralFraudPrivacy.test.ts` runs the full local migration chain to
verify self/repeat/completed-signup rejection, immutable ownership, audited admin
correction, RLS isolation, masked payloads, pagination and the table contract.

### Referral lifecycle and themed badges (Section 11)

Apply `supabase/migrations/20260924_referral_lifecycle.sql` after 20260923 before
releasing the updated portal. The local database includes the migration.

Referral lifecycle is deliberately separate from the forward-only website
onboarding state machine. Existing rows need no destructive status rewrite:

| Referral status | Source | Shared semantic theme |
| --- | --- | --- |
| Pending | Registered/linked; website not started | Amber/yellow |
| Active | `template_started` | Blue |
| Converted | `template_completed` | Emerald/green |
| Inactive | Explicit admin disposition | Slate/gray |
| Cancelled | Explicit admin disposition | Slate/gray |
| Rejected | Explicit admin disposition | Rose/red |

`Clicked` and `Registered` have shared descriptors for future event surfaces.
In v1 anonymous clicks remain temporary attribution records, not referred users;
registered users appear as Pending. Inactivity is **not** guessed from elapsed
time, and Converted continues to mean website completion, not a payment.

The list RPC returns `referral_status` in addition to its legacy onboarding
`status`. Filters, count queries and badges use the effective referral status.
Old `in_progress`/`completed` filter keys remain compatible (Active/Converted).
The Referral Status summary uses dedicated `referral_status_counts`; older
website milestone KPI fields remain unchanged. Conversion Status in the referred
users table still reports historical website completion, even if a referral is
subsequently marked Inactive/Rejected.

`admin_set_growth_referral_status(p_referred_user_id, p_status, p_reason)` is a
trusted-backend-only operation, with both restricted EXECUTE permission and the
existing `private.is_admin()` check. It accepts inactive/cancelled/rejected or
NULL to resume the real milestone-derived lifecycle. A reason is mandatory;
changes are recorded in the RLS-locked `growth_referral_status_audit` table.
Partners cannot force conversion or set dispositions, and future website updates
do not clear an admin disposition. Ownership and original referral date are
never changed by this function.

`src/lib/statusTheme.ts` centralizes the existing booking status palette, reused
without changing booking colors. `src/lib/referralStatus.ts` owns referral labels,
descriptions and theme-tone selection. All referral badges show text as well as
color; unknown values render neutral “Unknown”, never a misleading success badge.

### Counted status tabs on Referred Users (Section 12)

Apply `supabase/migrations/20260925_referral_status_tabs.sql` after 20260924, then
deploy the frontend. The local gateway applies it automatically.

The primary Referred Users page (`/partner/referrals`) now includes **All,
Pending, Active, Converted and Inactive** tabs, each with its database count.
No separate page is needed. The existing detailed `/partner/referral-status`
page remains available.

`get_my_partner_referrals` now includes a `status_counts` object in the same
snapshot as the selected rows and filtered `total`. Counts are scoped to the
active partner from `auth.uid()`, respect name search when provided, and ignore
the selected status and page offset/limit. All includes Cancelled and Rejected
referrals too; those can still be viewed in All or the detailed status page.

Tab selection re-queries the server and resets pagination to page one. Counts
stay visible while switching tabs, loading another page or retrying a failed
request; they are discarded when the viewer changes. Late responses cannot
replace the currently selected tab. A missing count is shown as unavailable
(`—`), not a fabricated zero. Zero-result tabs retain navigation and show a
status-specific empty state. Tabs support Arrow Left/Right, Home and End keys,
selected-state semantics, labelled panels and visible keyboard focus.

Verification: `tests/referralStatusTabs.test.ts` covers real-database counts,
filter/page independence, search, zero counts, refresh and partner isolation.
`tests/dom/referralStatusTabsBrowserFlow.test.ts` exercises the real page's
filter RPCs, pagination reset, keyboard controls, out-of-order responses and
error/retry behavior.

### Search, advanced filters and read-only details (Sections 13–14)

Apply `supabase/migrations/20260926_referral_search_details.sql` after 20260925,
then deploy the frontend. The local gateway includes the same migration.

`/partner/referrals` now has an Apply/Clear search-and-filter form:

- Case-insensitive literal substring search across **name, email and referral
  code**. Email searching happens inside the database; returned contacts remain
  masked. Search text is bounded to 254 characters; SQL/LIKE wildcard characters
  are not interpolated into a query.
- Existing status tabs plus Joined Date and Conversion Status (all / converted /
  not converted). Today, Last 7 Days and Last 30 Days use local calendar days,
  including today. Custom Range includes both chosen dates. The browser converts
  local day boundaries to UTC; the database applies an inclusive start and
  exclusive next-day boundary. Invalid/inverted ranges are rejected.
- Newest and Oldest sort by **signup date**. Recently Active sorts by the latest
  referral/website milestone, not private authentication activity. Every order
  has a deterministic tie-breaker and pagination remains server-side.
- Applying filters resets pagination. Counts reflect search/date/conversion
  filters, but remain independent of the selected status and page. Clear filters
  restores all dates, all conversions, newest-first and the All status tab.

The new `get_my_partner_referrals_filtered` RPC implements these reads; the old
four-argument `get_my_partner_referrals` delegates to it for compatibility. Both
resolve the active partner solely from `auth.uid()`.

Click a user's name for a **read-only details drawer**. It loads fresh data via
`get_my_partner_referral_detail(p_referral_id)` using a random referral-record ID,
not the account ID. The same generic unavailable result covers nonexistent and
other partners' records. The drawer shows name, masked contact, referral/signup
dates, current status, conversion status, last activity and code used. No status
editing controls or partner write grants are added. Escape/backdrop/close dismiss
it, keyboard focus is contained and restored, and failures have a retry action.

The timeline uses recorded timestamps: Referral Clicked, Account Registered,
Account Activated (website onboarding started), and Converted (website completed,
not a payment). Missing events say “Not recorded”/“Not yet recorded”. New signup
attribution copies its click timestamp into the permanent referral row; available
older consumed-attribution timestamps are backfilled before temporary-record
cleanup. Clicks already deleted before this migration cannot be reconstructed and
are not fabricated. Status overrides and private administrator reasons are not
presented as user activity.

Tests: `tests/referralSearchDetails.test.ts` verifies filtering, ordering, date
boundaries, pagination, masked payloads, durable click history and owner isolation.
`tests/dom/referralSearchDetailsBrowserFlow.test.ts` exercises the actual form,
server request parameters, drawer, timeline, no-edit contract, focus/escape and
error/retry behavior.

### Empty states and editable partner profile (Sections 15–16)

Apply `supabase/migrations/20260927_growth_partner_profile.sql` after 20260926,
then deploy the frontend. The local gateway includes this migration.

The empty Referred Users page now shows “No referrals yet.” and “Start sharing
your referral link to grow your network.” Its **Copy Referral Link** action uses
the authenticated partner's saved code and the current app origin. Clipboard
failures expose the link for manual copying instead of reporting success.
Search/filter misses show “No matching referrals found.” and **Clear Filters**,
which resets search/date/conversion/sort, status, pagination and the form controls.

`/partner/profile` now loads fresh data from `get_my_growth_partner_profile`:
name, Auth email, contact phone, partner ID, referral code, account status, partner
joined date and profile photo. Role and approval status are read-only. The active
partner gate remains enforced for both read and save operations.

`save_my_growth_partner_profile(p_patch)` accepts **only** full_name, phone and
photo_path. It derives identity from `auth.uid()` and never writes the partner
record or authentication email. Unknown/protected keys are rejected atomically,
not silently ignored. Name and phone use the existing `profiles` row; phone is a
contact number, not a change to any phone-authentication credential. Displayed
partner authority is derived from the approved partner row, never form data or
user-editable auth metadata.

Photo upload reuses `compressPartnerAvatar` (JPG/PNG/WebP, 5 MB maximum, 500px)
and the existing public `partner-avatars` bucket. `profiles.partner_avatar_path`
stores only the uploaded key. The server verifies an existing object in the
caller's own UUID folder, rejecting external URLs, embedded data and other
users' files. The UI derives its public URL from the configured Supabase project.
The migration idempotently creates the bucket/owner policies if Storage exists.
It does not change an existing bucket's administrative configuration. Failed,
confirmed-uncommitted uploads are cleaned up; a committed photo is not deleted
when the save response is lost. Uncertain/old uploads can be cleaned by a trusted
maintenance job after checking current references.

Email changes use the existing **Supabase Auth `updateUser({ email })`** flow,
not any profile RPC. Keep **Secure Email Change** enabled in Supabase Auth and
allow the deployed `/partner/profile` confirmation redirect. Confirmation and
identity verification stay with Auth; the UI does not optimistically replace the
current email. Profile reads always use `auth.users.email` after confirmation.

Local development limitation: the SQL-only gateway has no Storage/email delivery
service. Basic name/phone edits work there, but photo uploads require live
Supabase Storage and email changes explicitly return HTTP 501 requiring live Auth
(rather than the former misleading no-op success). No secret/service-role key is
sent to the frontend.

Tests: `tests/growthPartnerProfileBasics.test.ts` checks real SQL isolation,
allowlisted fields, photo ownership, upload cleanup and Auth-only email requests.
`tests/dom/partnerProfileEmptyStatesBrowserFlow.test.ts` covers read-only protected
fields, form saves, photo removal/format validation, confirmation messaging,
empty-state copy/fallback and Clear Filters wiring. Local HTTP tests verify that
unsupported email changes do not modify the login email.

### Physical partner referral ledger (Section 18)

Apply `supabase/migrations/20260928_partner_referrals_table.sql` after 20260927.
The local gateway includes the migration and exposes the table through its
existing RLS-enforced read gateway. The migration is transactional and rerunnable.

`public.partner_referrals` is a **table**, not a view, with the requested columns:
`id`, `partner_id`, `referred_user_id`, `referral_code`, `status`,
`conversion_status`, `first_clicked_at`, `registered_at`, `converted_at`,
`last_activity_at`, `created_at`, and `updated_at`. Status/conversion/registration
CHECK constraints reject inconsistent rows, and update timestamps are maintained
by a database trigger.

#### ID compatibility and foreign keys

The existing partner schema has `user_id` as its primary key. This migration adds
an independent, generated, immutable **`growth_partners.id` UUID with a unique
index** without changing `user_id` or its existing foreign keys.

- `partner_referrals.partner_id` → **`growth_partners.id`**.
- `partner_referrals.referred_user_id` → **`auth.users.id`**, nullable before signup.
- Existing `growth_onboarding.growth_partner_id` and temporary-attribution
  `partner_id` still reference the partner's Auth `user_id` for compatibility.
  The write-through adapter explicitly joins `growth_partners.user_id` to resolve
  the new internal `id`; these two namespaces must not be confused.
- Existing profile/login RPC contracts are unchanged. Referral detail IDs remain
  `growth_onboarding.referral_id`, now also the physical ledger row's `id`.

#### Population and uniqueness

A newly validated anonymous attribution creates a `Clicked` row. Reusing its
first-touch capability does not create another row. The Auth signup trigger
promotes **that same row** with the referred account ID and registration timestamp
in the account-creation transaction, including email-confirmation-required
accounts. Failed signup transactions roll back promotion/consumption. Manual
code linking creates a registered/Pending row with no fabricated click date.

Existing registered referrals and unconsumed temporary attributions are
backfilled. Existing detail IDs, historical codes and known click timestamps are
preserved. Ordinary onboarding progress, conversion, admin disposition changes
and authorized attribution corrections synchronize the ledger transactionally.
There are no frontend write grants and no second independent attribution API:
continue using the existing validated signup/link/progress/admin workflows, not
independent edits to the ledger. The existing portal reads remain compatible.

Indexes include:

- Primary key on `id`.
- **Global unique partial index on `referred_user_id WHERE referred_user_id IS NOT
  NULL`**, preventing a second successful attribution for the same account even
  under another partner or after a status change.
- Unique temporary-capability-to-ledger reference, so one capability cannot
  represent multiple ledger records.
- Partner/status/registration-date, partner/creation-date and partner/activity-date
  indexes for reporting and ordering.

`referral_code` is deliberately **not unique** in this table: multiple legitimately
referred accounts use the same partner code. Multiple anonymous visitors can also
have separate rows; success becomes unique when an account ID is attached.

RLS permits active partners to select only their own ledger rows, resolving
ownership via `growth_partners.id` + `growth_partners.user_id = auth.uid()`.
Anonymous and ordinary referred users cannot enumerate the table. All clients are
denied direct inserts/updates/deletes and helper execution. Self-referrals and
post-registration identity changes are also rejected by database guards.

Temporary-attribution cleanup does not delete permanent ledger data. Auth account
deletion cascades its registered referral consistently with the existing onboarding
cleanup. Anonymous click history has independent retention; token expiry still
controls whether signup may claim attribution, not the presence of a ledger row.

`tests/partnerReferralsTable.test.ts` verifies the physical schema/FKs, ID mapping,
nullable pre-signup rows, same-row promotion, duplicate rejection, transactional
rollback, admin/milestone synchronization, RLS isolation, cleanup, backfill and
migration rerun stability against the real Postgres engine used locally.

### Sections 19–20 — Referral events and database ownership fences

Deploy `supabase/migrations/20260929_partner_referral_events_rls.sql` **after
20260928** and before deploying the updated referral-attribution API. It is
transactional and rerunnable; the local gateway loads it automatically. No
production migration is applied by the repository changes.

`partner_referral_events` has the five requested columns: UUID `id`, UUID
`referral_id` (FK to `partner_referrals.id`, cascading on deletion), checked text
`event_type`, JSONB `event_metadata` (default `{}`), and finite `created_at`.
All seven types are supported: `link_clicked`, `signup_started`,
`signup_completed`, `account_activated`, `business_created`,
`subscription_started`, and `converted`.

Events are **first-occurrence funnel milestones**, not raw click counters or
recurring subscription transactions. A unique `(referral_id, event_type)` key
makes retries idempotent; indexes support referral timelines and event/time
analytics. Updates are rejected by a database guard. Trusted retention deletes
and cascading account deletion remain possible.

- Validated attribution records the first known click.
- GET `/api/referral-attribution` uses `prepare_growth_referral_signup(p_token)`
  to record signup preparation once. This validates the live, unconsumed bearer
  capability and its active partner/current code; callers cannot choose the
  referral ID or metadata. Preparation is not proof of completed registration.
- Successful signup, verified onboarding activation, and conversion record their
  corresponding milestones transactionally. Failed signup rolls events back.
- Existing known click, registration, activation and conversion timestamps are
  backfilled with `source: "migration", backfilled: true`. Unknown signup-start,
  business and subscription history is **not inferred**. Reruns preserve events.
- `business_created` and `subscription_started` are future integration hooks;
  this application has no authoritative source wired for those events yet.

Trusted server integrations may call
`record_partner_referral_event(p_referral_id, p_event_type, p_event_metadata,
p_created_at)`. EXECUTE is restricted to `service_role` (and the database owner);
never expose the service key or an arbitrary recorder proxy to clients. The
recorder returns the existing event ID on retry, requires a registered referral
for post-signup types, and accepts only metadata keys `source` (one of
`attribution`, `signup`, `onboarding`, `business`, `subscription`, `migration`)
and boolean `backfilled`. Do not store tokens, emails, payment payloads or other
secrets in this partner-readable metadata. Richer future analytics should use an
explicit reviewed schema extension, not unrestricted payload storage.

RLS is enabled on `growth_partners`, `partner_referrals`,
`partner_referral_events`, and legacy `growth_onboarding`. Authenticated clients
receive SELECT only:

- A partner can read only the gate/profile row with `user_id = auth.uid()`.
- Referral ownership resolves through `partner_referrals.partner_id =
  growth_partners.id`, then `growth_partners.user_id = auth.uid()`; the owned
  partner must also be active. Events resolve through the same referral join.
- A paused partner can read their own gate row, but not referrals/events.
  Audited attribution corrections transfer event visibility with the referral;
  no stale partner ID is copied into event metadata.
- Legacy onboarding retains the ordinary user's own onboarding read; partner
  access to other onboarding rows requires active ownership.

Restrictive owner fences supplement permissive read policies. Restrictive
anonymous and authenticated-write fences also block access if broad grants or
permissive policies are accidentally added later. Isolation does not rely on
frontend filters. Trusted database owners/security-definer workflows and the
server service role remain the intentional bypass boundary; RLS is not forced
on the owner. These credentials must never be browser-accessible.

`tests/partnerReferralEventsRls.test.ts` exercises actual local PostgreSQL event
transactions, metadata validation, retries, upgrade/backfill/rerun stability,
cascades, ownership transfers, paused partners, and isolation under intentionally
broad policies and grants. Existing attribution, ledger, profile and portal
regression tests remain applicable.

### Sections 23–26 — Dashboard metrics, responsive UI and loading states

Apply `20260930_partner_dashboard_metrics.sql` after `20260929`. It replaces
`get_my_partner_dashboard()` without changing its caller-derived authorization
or removing existing response fields. It adds top-level numeric aggregates:

```json
{
  "totalReferrals": 127,
  "activeReferrals": 72,
  "pendingReferrals": 13,
  "convertedReferrals": 38
}
```

These are illustrative values, not defaults. All four fields are computed by
PostgreSQL for the authenticated active partner. `totalReferrals` counts registered
accounts in the existing canonical onboarding relationship, not anonymous click
rows or events. The other fields count the effective lifecycle status, including
admin dispositions. Consequently, inactive/cancelled/rejected accounts remain in
the total but not these three status counts; the three need not sum to the total.
A historical conversion event or legacy `kpis.completed` can still exist for a
currently inactive referral. These metrics do not represent paid subscriptions.

The UI reads these fields directly. Rolling-upgrade fallbacks use only older
backend aggregate fields, never the current list page or recent-activity array.
Missing status aggregates display an em dash, not a fabricated zero. Initial
requests show skeletons; refreshes retain previously loaded totals with a loading
indicator, and failed refreshes label those totals as previously loaded and offer
retry. Dashboard data is scoped to the current signed-in user in component state.

The existing portal shell remains fixed-sidebar at `lg` (1024px+) and drawer
below it. Mobile navigation locks background scrolling, keeps keyboard focus
inside, supports Escape, restores focus on close, and closes when resized to
desktop. Header menus are viewport-bounded on mobile. Cards stack at narrow
widths; referral tables scroll within their own labelled region, not the page.
Long codes/contact values wrap or truncate, filters wrap, and primary code/link
copy controls retain at least 44px touch height. Status pills keep readable,
non-wrapping labels and explanatory titles.

`PartnerLoading` supplies accessible, decorative, reduced-motion-aware skeletons
for dashboard cards, referral-link acquisition, the referral list, profile and
referral details. Unavailable/error/empty states appear only after loading has
settled. Copy and profile-save actions have non-blocking dismissible toast
confirmations plus inline feedback; secure email confirmation behavior is
unchanged. Components reuse the existing rounded cards, slate palette, semantic
status colors and spacing, with no added animation dependency.

Verification includes real local database aggregate/authorization tests and DOM
tests with deliberately unresolved requests, refresh failures, mobile drawer
focus cycling and copy confirmation. DOM tests verify behavior and responsive
class contracts, not pixel rendering on physical devices.

### Sections 27–30 — Safe failures, URL aliases and immutable ownership

Both `/signup?ref=NEXORA-ABC123` and `/register?ref=NEXORA-ABC123` enter the
same onboarding signup flow. Session restoration now happens **before** referral
capture. Signed-out visitors finish validated cookie capture before the canonical
onboarding redirect. The existing HttpOnly, SameSite=Lax, seven-day first-valid
capability survives onboarding navigation/remounts; signup preparation retrieves
it without trusting URL IDs, localStorage or caller-supplied partner metadata.
Invalid codes show an actionable error and a “Continue without a referral” option;
service/network failures offer retry and do not clear an existing cookie.

A visitor who already has an authenticated session sees **“This account is already
registered.”** Opening the link neither captures a new capability nor submits or
prefills its code for that account. Continuing goes to the existing account's
backend-resolved onboarding state. Existing manual code entry for an *unattributed*
account remains an explicit action, not a URL side effect. If an account already
has an owner, even manual relinking is rejected in the database.

The verified lifecycle is unchanged:

- Successful Auth insertion atomically promotes the captured ledger row to a
  registered account (`registered_at`, `signup_completed`). The existing stored
  and displayed lifecycle name at this stage remains **Pending**, not a new
  incompatible `registered` status.
- Verified onboarding start promotes it to **Active** (`account_activated`).
- The application's currently configured conversion milestone is verified website
  completion, promoting it to **Converted**. This does not imply payment or an
  unimplemented business/subscription integration.

Immutable onboarding identity guards, the physical ledger's global successful-
account uniqueness, and same-row synchronization remain enforced by migrations
20260923/20260928/20260929. Editing Auth metadata, clicking another URL, replaying a
capability, or calling the link RPC cannot change a registered owner. The only
supported exception remains `admin_correct_growth_referral`: trusted service-role
execution **plus** administrator authorization, a required reason, and a durable
old/new owner/code/actor audit. No browser grant or unaudited replacement path was
added. The referred user ID and original registration time survive corrections.

Error boundaries cover session expiry, absent/unauthorized partner access, paused
or suspended access, invalid codes, RPC/database failures and transport failures.
A missing partner row remains an access-required state rather than exposing any
other account's existence. Profile, login, onboarding boot/forms, details and
partner gate failures use fixed reviewed copy; rejected promises are sanitized
as well as SDK `{ error }` results. Mid-request suspension returns to the paused
access gate. Async Auth refresh failures are caught rather than leaking an
unhandled rejection. Existing retry, close/sign-in and support actions remain.

Server diagnostics:

- Referral-cookie API failures return safe 503 copy plus `X-Request-ID`; no SQL,
  Supabase details, stack, capability, or request payload reaches the UI.
- The local gateway's RPC/table failures also emit a correlated server diagnostic
  and fixed response copy rather than SQL text or schema/overload details.
- `server/partnerErrorLog.ts` writes structured request ID, operation, SQLSTATE/
  provider code, status, category, timestamp and a stable error fingerprint.
  Messages, SQL, stacks, cookies, Authorization headers, arguments, Auth metadata
  and contact information are **not logged**. A broken log sink cannot break the
  safe response. Protect server log access and retention as operational data.
- Production direct Supabase RPC/Auth/Storage calls run on Supabase, not this Node
  gateway; use the project's restricted provider logs for server-side diagnosis.
  No anonymous client-error ingestion endpoint or browser service credential was
  introduced. Client-only offline failures cannot produce a server log because
  they never reach the server.

No new SQL migration is required for Sections 27–30. Deploy the application/server
changes with the existing chain through `20260930_partner_dashboard_metrics.sql`.
Tests cover both route aliases, existing linked/unlinked visitors, delayed and
failed capture, safe error/log redaction, full verified lifecycle, and rejected
reassignment followed by an explicitly audited correction.

### Sections 31–34 — Basic analytics, sharing feedback and security review

Apply **`20261001_partner_dashboard_activity.sql` after `20260930`**. Existing
canonical onboarding/profile tables are reused; no analytics table is created.
The dashboard RPC keeps all existing keys and adds:

```ts
referralActivity: {
  recentReferrals: Array<{ referralId: string; name: string; date: string; status: string }>;
  last7DaysReferrals: number;
  dailyReferrals: Array<{ date: string; count: number }>;
  window: { from: string; asOf: string; timeZone: 'UTC' };
}
```

“Recent Referrals” shows the latest ten registered referred accounts, ordered by
**credited/referral date (`linked_at`)**, then opaque referral ID for ties. Names
come from the linked profile; missing names become “Referred user.” Contact/Auth
fields are not included. Effective status honors administrator dispositions.

“Last 7 Days Referrals” counts today and the preceding six **UTC calendar days**,
with today counted only up to the database statement time. Null/unknown and future
referral dates are excluded. This is a count of credited account relationships,
not clicks, event rows or the ten-row preview. An existing account manually linked
today is credited today, regardless of its original signup date. The SQL also
returns seven zero-filled daily buckets with explicit bounds, ready for future
graphs; the frontend does not derive authoritative metrics from displayed rows.
Missing analytics during a rolling upgrade shows an em dash/unavailable state,
not a synthetic zero. Loading continues to use the dashboard skeleton.

Copy actions share one clipboard helper across the dashboard, referral-code page
and empty states. Successful writes announce exactly **“Referral code copied”**
or **“Referral link copied”** through the dismissible toast. Repeated copies can
re-announce; stale asynchronous writes cannot overwrite the latest action's
feedback. Failed writes show a safe inline error/manual-copy fallback, never a
success toast or `alert()` popup.

See `GROWTH_PARTNER_SECURITY_AUDIT.md` for the threat matrix, fixed development-
gateway session weaknesses, local-vs-production boundaries, and deployment checks.
Local refresh tokens now rotate, logout/password changes revoke local sessions,
and gateway restarts require a fresh login. The optional
`LOCAL_SUPABASE_JWT_SECRET` must have at least 32 bytes; without it a random
process key is used. Supabase production authentication is unchanged.

Migration upgrade/rerun tests preserve accounts, referrals, events and unrelated
salon/booking/service rows. The new migration has no data rewrites or destructive
DDL; deploy its ordinary index build in an appropriate maintenance window for
large datasets. No production migration has been applied by these code changes.

### Sections 38–39 — Reusable components and regression coverage

The partner module now has dedicated `PartnerRouteGuard`, `PartnerStatusScreen`,
`PartnerStatCard`, `ReferralTable` and shared presentation helpers, alongside the
existing reusable layout/nav/header, badge, filters, details and profile surfaces.
Legacy exports are preserved so existing callers do not need mass renames.
See `GROWTH_PARTNER_TEST_PLAN.md` for the component map and scenario coverage.

The common protected-page gate also completes the overlapping account-status
behavior: the user's own pending application shows “Your Growth Partner
application is under review.”; rejected shows “Your Growth Partner application
was not approved.”; suspended shows “Your Growth Partner account is currently
suspended. Please contact support for assistance.” None can trigger protected
section queries. “Check status” re-verifies approval instead of changing local
permissions. Unauthenticated and expired sessions redirect to the namespace's
login route. A changed identity hides old data synchronously until reverified.

Run `npm run test:partner` for the database/HTTP/DOM coverage in Section 39, then
`npm run typecheck` and `npm run build`. No new SQL migration is needed for this
component/guard work; existing Auth/RLS and migrations through 20261001 remain
required. No production migration or data modification has been performed.

### Sections 40–41 — final acceptance and scope

Run `npm run test:partner:acceptance` for the integrated local 15-step journey, or `npm run test:partner` for every partner-related suite (its test count moves as coverage is added, so it is deliberately not quoted here). Evidence and remaining production/browser checks: `GROWTH_PARTNER_FINAL_ACCEPTANCE.md`. Financial/payout/ranking modules remain out of scope; no new migration was introduced for this acceptance work.

### Section 42 — the seven planned modules became live

The seven sidebar entries listed in 7.3 are no longer placeholders: the shell's
planned-slot registry and its disabled/`Soon` rendering were deleted, each
section got a real page under `src/components/partner/`, a real path in
`src/lib/router.ts`, and a real read/write path
(`src/lib/partnerPortalOperations.ts` → `/api/partner/*` → the section RPCs).
`20260919120000_partner_portal_section_reads.sql` is the one new migration this
needed; like its predecessor it has **not** been applied to any project by these
code changes — applying migrations stays an operator step (§3). No production
data was modified.
