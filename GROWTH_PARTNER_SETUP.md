# Growth Partner area — complete setup

`/partner/dashboard` (Dashboard · My Referral Code · Referred Users · Referral Status · Profile), reached through the dedicated login page at **`/partner/login`** ("Growth Partner Login"). The older `/growth-partner/*` routes keep working as an alias of the same module — both namespaces share the same component, the same Supabase Auth and the same backend checks.

The frontend, the backend RPCs and the tests are all in this repository. What a
deployment must add is three things, in this order:

1. **A live Supabase connection** (`.env`) — without it the app runs in mock
   mode and the area shows *"Growth Partner area needs a live connection"*.
2. **The Growth Partner migrations**, applied in the order below.
3. **One approved partner row** for your account — the area is denied to every
   signed-in user who is not in `public.growth_partners`.

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
(*"Growth Partners only"*). Two ways in:

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

**b. Admin shortcut (no application needed).**

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

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| "Growth Partner area needs a live connection" | mock mode: `SUPABASE_URL`/keys missing or placeholders | step 1, then restart |
| "Sign in to open the Growth Partner area" | no session on `/growth-partner` | sign in (or use `/growth-partner/login`) |
| "Growth Partners only" | signed in, but no `growth_partners` row | step 4 |
| "Growth Partner access is paused" | `is_active = false` | re-provision with `p_active => true` |
| `PGRST202` / "function … not found" in the verifier | a migration was never applied | step 3, in order |
| "Could not load the Growth Partner area" | RPC error (see the message) | check the verifier output for the failing function |

## Known, intentional gaps

* **Commission** section reports that no partner-commission model exists — there
  are no tables, RPCs or config for it (`ARCHITECTURE.md`). It is not a bug.
* **Referrals** is a plain referred-users roll; status filtering and name search
  live in **Customers** (server-side, one implementation).
* There is **no admin UI** for reviewing applications — review is SQL/service
  role by design (`review_growth_partner_application` has no EXECUTE grant for
  `authenticated`).
