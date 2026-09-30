# Admin & Manager management — complete setup

The admin panel (`/admin`) plus the manager-onboarding pipeline that feeds it:
a Super Admin generates a public link, a candidate fills
**`/admin/onboard-manager?token=…`** with their KYC and payout details, the
Super Admin approves or rejects, and approval creates the Supabase Auth user
with an `area_manager` / `sub_admin` role and a territory-scoped dashboard.

Everything is in this repository: the SQL (RLS + RPCs + audit), the Express
routes, the client, and the tests. A deployment has to add three things:

1. **A live Supabase connection** (`.env`) — without it the API answers
   `503 backend_unavailable` for every write and the panel renders the
   *"needs a live connection"* state.
2. **The two admin migrations**, applied after the Growth Partner / portal set.
3. **At least one `super_admin` row** — every admin route is fail-closed
   (`admin_members` is the only source of truth; a signed-in non-staff account
   gets the "Nexora staff accounts" refusal, never a silent success).

---

## 1. Environment

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | the operator's session; every read goes through RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-side only** — approving an application (`auth.admin.createUser`) and minting the 60-second signed URL for a private document |

Server-side rules that depend on the service role and answer honestly when it
is absent:

| Missing | Behaviour |
| --- | --- |
| Supabase project | every `/api/admin/*` mutation → `503 backend_unavailable`; the client falls back to RPC so the panel still works when PostgREST is reachable |
| `SUPABASE_SERVICE_ROLE_KEY` | approve → `503` with a message naming the key, and the application is **not** marked approved; document download → `503 storage_unavailable` |
| admin migrations | `501 schema_not_applied` with the exact two filenames to apply |

Restart the dev server after editing `.env` — the mode is decided once at
startup (`src/lib/supabaseClient.ts` logs `Supabase keys are missing…`).

---

## 2. Migrations

```bash
supabase db push        # applies supabase/migrations/ in filename order
```

**No CLI / no linking?** Paste one file into the SQL Editor instead —
**`supabase/apply_admin_management.sql`** is the byte-for-byte concatenation of
both migrations (2.6k lines) plus the prerequisites, the verification query and
the next step in its header. Run that query afterwards; on this schema it must
return:

| `admin_tables` | `admin_role_enum` | `admin_rpcs` | `buckets` | `reward_tiers` |
| --- | --- | --- | --- | --- |
| 6 | 1 | 21 | 2 | 3 |

The bundle is generated — after editing either migration, run
`node scripts/bundle-admin-sql.mjs` so the two never drift. It is safe to paste
twice (every statement is idempotent).

| Order | File | Contains |
| --- | --- | --- |
| 1 | `supabase/migrations/20261101000000_admin_management_core.sql` | `admin_role` enum, `admin_members`, `manager_onboarding_links`, `manager_onboarding_applications`, `partner_audit_logs`, `private` RBAC helpers, RLS, the `manager-documents` bucket + policies, the audit trigger |
| 2 | `supabase/migrations/20261101000100_admin_partner_operations.sql` | directory / report / moderation / bank / payout / audit / export RPCs, the reward tiers seed, `get_manager_onboarding_link` + `submit_manager_onboarding_application` |

Both files are idempotent (`if not exists`, `create or replace`, guarded
`do $$` blocks), so re-running them is safe.

> **If this project previously ran the broken portal batch**, re-apply the five
> idempotent `20260930*` portal migrations after the push — they were clobbered
> by a later file in that batch. Details and the symptom list are in
> `PARTNER_OPERATIONS_MIGRATION_FIX.md`.

Verify at a glance (PGlite, no project needed):

```bash
npx node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit \
  --disable-warning=ExperimentalWarning tests/adminManagementSql.test.ts
```

---

## 3. First Super Admin

`public.current_admin_role()` resolves the caller like this, in order:

1. `app_metadata.is_admin = true` on the JWT → `super_admin` (the legacy flag,
   kept so an existing deployment is not locked out);
2. the local gateway's `app.is_admin` setting (mock mode only);
3. an active row in `public.admin_members`.

So bootstrap a Super Admin by creating the Auth user first (dashboard →
Authentication → Add user, or sign them up), then attaching the membership:

```sql
insert into public.admin_members (user_id, email, full_name, role, work_area, is_active)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', ''), 'super_admin', null, true
  from auth.users u
 where u.email = 'owner@example.com'
on conflict (user_id) do update
   set role = 'super_admin', is_active = true, email = excluded.email;

select public.get_my_admin_access();   -- signed in as that user: is_admin = true, role = super_admin
```

A row with `user_id = null` grants **nothing** — entitlements are matched on
`user_id` — and only the approval flow fills it (for an applicant it creates the
Auth user from the application's email, which is why a duplicate email is
refused with *"An admin with this email already exists"*). Use the
`app_metadata.is_admin` flag instead when you need a temporary break-glass
account, and turn it off again afterwards.

Local mock mode (`npm run dev`, no `.env`) already seeds a Super Admin:

| | |
| --- | --- |
| URL | `http://localhost:3000/admin` |
| Email | `admin@nexora.local` |
| Password | `Admin#12345` |

---

## 4. Specification names → the tables that actually exist

The admin layer was built **on top of** the objects the live partner portal
already writes. A parallel `partners` / `partner_bank_details` schema would need
dual writes from a portal that is already in production.

| Spec name | Real object |
| --- | --- |
| `admin_roles` | `public.admin_role` enum (`super_admin`, `admin`, `area_manager`, `sub_admin`) |
| `admin_users` | `public.admin_members` (+ `auth.users` for the login) |
| `partners` | `public.growth_partners` (identity) + `public.profiles` (name / photo / contact) |
| `manager_onboarding_requests` | `public.manager_onboarding_applications` |
| `onboarding_links` | `public.manager_onboarding_links` (single-use token, revocable, expiring) |
| `partner_bank_details` | `public.partner_account_settings` (`bank_*` + `upi_id`, RLS-scoped) |
| `payout_requests` | `public.partner_payout_requests` (already the live payout queue) |
| `partner_audit_logs` | `public.partner_audit_logs` (append-only) |
| `reward_milestones` | `public.partner_reward_tiers` + `public.partner_rewards` |

Territory = `admin_members.work_area` matched against
`growth_partners.work_area`; a manager without an area sees nothing, and every
SQL function re-derives the caller's area instead of trusting the request body.

---

## 5. Permissions

| Action | super_admin | admin | area_manager / sub_admin | growth partner |
| --- | --- | --- | --- | --- |
| Read directory / report / audit | every area | own `work_area` only | own `work_area` only | ✗ (own portal only) |
| Moderation (approve / unapprove / ban / unban) | ✔ | own area | own area | ✗ |
| Soft delete / restore | ✔ (reason mandatory) | ✗ | ✗ | ✗ |
| Bank / UPI correction | ✔ | own area | ✗ (money gate) | ✗ |
| Payout queue + mark paid (UTR ≥ 6) / reject (note ≥ 3) | ✔ | own area | ✗ (money gate) | own requests only |
| Excel/CSV export | ✔ (logged) | ✗ | ✗ | ✗ |
| Onboarding links: generate / list / revoke | ✔ | ✗ | ✗ | ✗ |
| Application queue: read / approve / reject | ✔ | ✗ | ✗ | ✗ |

`admin` and `area_manager` behave the same on purpose — the only difference is
the money gate (`private.can_manage_partner_money()`), which is one function to
widen later if the business decides otherwise. Every role keeps its territory:
the directory forces `current_admin_area()` for anyone who is not a Super Admin,
and a member with a blank `work_area` reads nothing at all.

Enforced twice: in the Express handler (`requireAdmin`, super-admin and money
checks before any DB call) **and** in every SQL function (`42501`), so a direct
PostgREST call is refused identically. `admin_members.is_active = false`
removes access without deleting history.

---

## 6. Storage

`manager-documents` is **private**. A candidate has no session, so uploads go
one file at a time through
`POST /api/public/manager-onboarding/:token/documents` (base64, ≤ 10 MB,
kind ∈ `photo | aadhaar_front | aadhaar_back | pan_card`), and only a Super
Admin can mint a download URL — `GET /api/admin/manager-documents/:path`
answers a `302` to a 60-second signed URL. Do not make the bucket public and do
not widen the policy: the Aadhaar and PAN scans live there.

The local PGlite gateway has **no `storage` schema**, so the bucket/policy
statements no-op there (by design, guarded with `to_regclass('storage.buckets')`).

---

## 7. Routes

Operator surface — 17 routes, all behind one `requireAdmin` gate, listed in
`ADMIN_ROUTES` (`server/adminRoutes.ts`):

```
GET    /api/admin/access
GET    /api/admin/onboarding-links
POST   /api/admin/onboarding-links
POST   /api/admin/onboarding-links/:id/revoke
GET    /api/admin/manager-applications
POST   /api/admin/manager-applications/:id/approve
POST   /api/admin/manager-applications/:id/reject
GET    /api/admin/partners
GET    /api/admin/report/summary
POST   /api/admin/partners/:id/state
POST   /api/admin/partners/:id/area
POST   /api/admin/partners/:id/bank-details
GET    /api/admin/payouts
POST   /api/admin/payouts/:id/process
GET    /api/admin/manager-documents/:path
GET    /api/admin/audit-logs
GET    /api/admin/partners/export.csv
```

Public surface — exactly three routes, `PUBLIC_ONBOARDING_ROUTES`, and the only
ones without a session (the token is the authorization, and the link's
`max_uses` rate-limits submission):

```
GET  /api/public/manager-onboarding/:token
POST /api/public/manager-onboarding/:token
POST /api/public/manager-onboarding/:token/documents
```

Status codes: `401 auth_required` (no/expired session), `403 admin_required`
(signed in, not staff), `403 super_admin_required` (staff, too low, **no DB
call made**), `400 invalid_request` with the field message, `501
schema_not_applied`, `502/503 backend_unavailable`. There is deliberately **no**
`POST /api/admin/partners/:id/delete` — hard deletion is not part of the
product; `state: 'deleted'` is a soft delete with a reason.

---

## 8. UI

| Path | Screen |
| --- | --- |
| `/admin` (`/admin/dashboard`) | overview, audit summary, reward tiers |
| `/admin/applications` | link generator + pending/reviewed applications |
| `/admin/staff` | team & roles (from `admin_members`) |
| `/admin/partners` | area-wise directory, moderation, bank/UPI, WhatsApp template, forecast |
| `/admin/payouts` | payout desk, UTR entry |
| `/admin/audit` | work & audit report, export |
| `/admin/onboard-manager?token=…` | **public** candidate form |

`/admin/*` never renders the owner app chrome. Every panel resolves the role
from `get_my_admin_access()` (never from the URL), the area filter is locked for
non-super-admin, the export button only exists for a Super Admin, and every
non-super-admin screen is wrapped in `SecurePanel` (selection + context menu
blocked, tiled `email · timestamp` watermark) — masking, never a substitute for
the RLS above.

---

## 9. Tests

```bash
# SQL: RBAC, links, approval, territory, moderation, payouts, export, idempotence
npx node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit \
  --disable-warning=ExperimentalWarning tests/adminManagementSql.test.ts

# Routes: anonymous refusal, role gates, approval identity, CSV escaping
npx node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit \
  --disable-warning=ExperimentalWarning tests/adminRoutesApi.test.ts

# Public form: real clicks in jsdom — dead links, validation, submission
npx node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit \
  --disable-warning=ExperimentalWarning tests/dom/adminOnboardingFormBrowserFlow.test.ts

npx tsc --noEmit
```

---

## 10. Next pass (not in this slice)

* **Reward tiers stay data-driven** — `partner_reward_tiers` is seeded
  (starter @3 = ₹2,000, growth @6 = ₹5,000, scale @12 = ₹12,000) and
  `admin_sync_partner_rewards` writes `partner_rewards`. The directory banner
  ("Needs 1 more salon for ₹2,000 bonus") is rendered from each partner's
  `milestones` by `rewardForecast()` (`src/lib/adminApi.ts`); editing the tiers
  needs no deploy.
* **True bulk broadcast** — the multi-select + shared template with
  `{{name}}` / `{{area}}` / `{{code}}` placeholders ships now, but each button
  opens one `wa.me` deep link (the operator sends it). An automatic, queued
  broadcast needs a Meta Cloud API token, which this deployment deliberately
  does not require.
