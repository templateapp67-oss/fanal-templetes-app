# Growth Partner area — complete setup

`/growth-partner` (Dashboard · Referrals · Customers · Performance · Commission · Profile).

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
