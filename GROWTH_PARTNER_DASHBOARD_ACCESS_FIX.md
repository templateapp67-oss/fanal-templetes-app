# `/partner/dashboard` shows "Could not load the Growth Partner area" — what it means and how to fix it

The reported failure:

> I am unable to access the Growth Partner area on the dashboard
> (`/partner/dashboard`). It repeatedly displays:
> **"Could not load the Growth Partner area. Could not load this section. Please
> try again."** Hard refreshing and clearing cache/incognito mode did not solve
> the issue. Could you please check if there is an account-level permission issue
> or an API outage on this route?

That second paragraph is the actual bug report: the screen said *"try again"* for
causes that retrying can never fix, and it showed nothing that could tell an
**account/permission problem** apart from a **missing migration** or an
**outage**. This document answers the question directly, and describes the
change that makes the app answer it by itself from now on.

---

## 1. The 60-second answer

The dashboard gate makes exactly three calls, in this order, using the signed-in
browser session and the public anon key:

| # | Call | What a failure means |
| --- | --- | --- |
| 1 | `get_my_growth_partner()` | `PGRST202` → the migration was never applied. `42501` → permission refused **for this account**. `401`/`PGRST301` → the session expired. |
| 2 | `ensure_my_growth_partner()` (only when call 1 returns *no row*) | same three readings. This is the call that provisions the caller's own partner row. |
| 3 | `get_my_partner_dashboard()` | the dashboard payload itself; a failure here is the section error, not the gate. |

So the message in the report maps to one of five real causes — and three of them
are not the user's to fix:

| Screen text | Real cause | Who fixes it |
| --- | --- | --- |
| "…database setup is missing on this project…" | one of the Growth Partner migrations was never applied to this Supabase project (`PGRST202`/`PGRST205`) | **administrator** — apply the migrations (§4) |
| "You are signed in, but the database refused this read" | `42501`: the account's partner row is missing/inactive, or a grant/migration is missing | **administrator / support** (§5) |
| "This account is not an active Growth Partner" | signed in, no approved+active `growth_partners` row | **support** (§5) |
| "Your session expired" | the saved sign-in is no longer accepted (401 / `PGRST301`) | **the user** — sign in again |
| "Could not reach the Growth Partner service" | transport failure: offline, VPN/firewall/ad blocker, DNS | **the user** — connection |
| "The Growth Partner service returned an error" | the service answered `5xx` | **platform** — retry shortly |

Clearing the browser cache or using incognito can only ever address the last
two rows — which is exactly why the reported attempts did not change anything.

## 2. Reproduce and diagnose with evidence

Run this from the project root, with the same env file the deployment uses
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`):

```bash
# anonymous probes: is the project reachable, and do the dashboard RPCs exist?
npm run diagnose:partner-dashboard -- .env

# plus the account-level answer: sign in as the affected account and walk the
# exact gate sequence (password is read from PARTNER_DIAG_PASSWORD, never argv)
PARTNER_DIAG_PASSWORD='…' npm run diagnose:partner-dashboard -- .env --email you@example.com
```

It prints one `PASS`/`FAIL` line per call and then the same verdict + report the
app now shows, including the migration file to apply. Exit code `1` means the
gate really is broken.

The broader readiness check remains:

```bash
npm run verify:growth-partner -- .env
```

## 3. In the app (what changed)

`/partner/dashboard` no longer collapses every failure into "Please try again":

* the failure screen **classifies** the error (`src/lib/partnerAreaFailure.ts`)
  and states the cause, **who can fix it** and the next step;
* a **Run diagnostic** button probes the live service from the signed-in session
  (`src/lib/partnerAreaDiagnostics.ts`) and prints a per-call result;
* the result can be copied as a support report — it contains the cause, the
  error code, the route, the project host, the masked account and the check
  list, and **no key, token or address**;
* section cards (Referrals, Customers, Performance, …) get the same treatment
  through the shared `SectionError`;
* one call is deliberately never probed: `ensure_my_growth_partner()` can create
  the partner record, and a diagnostic must not change the account it is
  diagnosing (pinned by `tests/partnerAreaDiagnostics.test.ts`).

### Every failure is now logged

The reason this issue kept returning is that the evidence was destroyed on the
way to the screen: the raw PostgREST answer (`PGRST202`, `42501`, `23505`, the
raised message) was replaced by safe copy and then dropped, so nobody — not the
console, not the logs — could see what the backend had actually said.

Now **every failure that reaches a screen is recorded exactly once**, in the
browser console and whatever it forwards to:

```
[growth-partner] earnings.load failed — get_my_partner_earnings
  { operation: 'earnings.load', call: 'get_my_partner_earnings',
    kind: 'schema-missing', owner: 'administrator', retryable: false,
    code: 'PARTNER_SCHEMA_MISSING', http: 404,
    postgrest: { code: 'PGRST202', message: 'Could not find the function …', status: 404 },
    shown: 'Database setup is missing' }
```

* the first line is greppable (`grep 42501` / `grep PGRST202` lands on it) and
  names the operation and the call that failed;
* `postgrest` is the backend's own answer, before sanitizing — the evidence;
* `shown` is what the partner actually read, so the two can never drift apart;
* credentials, keys, JWTs, `apikey=` values and email addresses are **redacted**
  before anything is recorded (`redactPartnerAreaLogText`);
* the same failure crossing several layers (read wrapper → service facade →
  screen sanitizer) still produces **one** line, not three;
* a healthy call logs nothing.

The read paths are covered end to end: the facade (`settle()` in
`src/services/growthPartner.ts`), the throw-based reads the gate and login
screens use (`readPartnerPayload` / `ensureMyGrowthPartner` in
`src/lib/growthPartner.ts`), and `toSafePartnerSectionError` as the last
boundary before generic copy. Pinned by
`tests/partnerAreaFailureLogging.test.ts`.

## 4. Fix: apply the dashboard migrations (the most likely cause)

Migrations are ordered; each file is idempotent. In the Supabase SQL Editor, in
this order, after any earlier Growth Partner migration that is missing:

```text
20260912_growth_partner_onboarding.sql              -- growth_partners + RPCs
20260915_growth_partner_dashboard.sql               -- get_my_partner_dashboard
20260919_growth_partner_area_contract_alignment.sql -- the gate read, aligned with the shipped schema
20260922085236_enable_growth_partner_open_enrollment.sql
20260922091000_direct_growth_partner_dashboard_access.sql -- ensure_my_growth_partner
```

Then, always, reload PostgREST's schema cache — without this the new functions
are applied but still invisible to the API:

```sql
notify pgrst, 'reload schema';
```

Full order and context: **`GROWTH_PARTNER_SETUP.md` §3**.

## 5. Fix: check the account (the "account-level permission" question)

Run these in the Supabase SQL Editor. Replace `<AUTH-USER-UUID>` with the id from
*Authentication → Users* (the SQL Editor is not a signed-in browser session, so
`auth.uid()` is null there).

```sql
-- a. Are the dashboard RPCs installed, and may a signed-in user execute them?
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_my_growth_partner', 'ensure_my_growth_partner',
                    'get_my_partner_dashboard', 'get_my_partner_referrals',
                    'get_my_partner_performance')
order by p.proname;

-- b. Does THIS account have a partner row, and is it active? (friendliest form:
--    look the account up by the email in the support ticket)
select u.id as auth_user_id,
       u.email,
       gp.referral_code,
       gp.is_active,
       gp.created_at
from auth.users u
left join public.growth_partners gp on gp.user_id = u.id
where u.email = 'the-account-in-the-ticket@example.com';

-- b2. Same question with the uuid from Authentication → Users
select user_id, referral_code, is_active, created_at, updated_at
from public.growth_partners
where user_id = '<AUTH-USER-UUID>';

-- c. Is growth_partners the generation this repository ships?
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'growth_partners'
order by column_name;
```

Readings:

* **(a) returns no row** for a function → apply the migration that creates it (§4).
* **(a) shows `authenticated_can_execute = false`** → the grant is missing; the
  area will get `42501` for every signed-in user. Re-apply the migration that
  owns the function (they all re-assert their grants).
* **(b) returns no row** → the account is not a partner. Either it was never
  approved (approve it — `select public.review_growth_partner_application('<application id>', true);`
  or provision it directly) or self-enrollment never ran because
  `ensure_my_growth_partner()` is missing (§4).
* **(b) shows `is_active = false`** → suspended; reactivate:
  `select public.provision_growth_partner('<AUTH-USER-UUID>', null, true);`
* **(c) shows `status`/`partner_code` instead of `is_active`** → the project is on
  the older `growth_partners` generation; apply
  `20260919_growth_partner_area_contract_alignment.sql`, which serves both.

## 6. If it really is an outage

A `5xx` from the project (or an unreachable host) is the only case where waiting
is the fix. `npm run diagnose:partner-dashboard` reports it as
*"project reachable over HTTPS + REST: FAIL — Service error (HTTP 5xx)"* and the
app's screen says "The Growth Partner service returned an error", so an outage is
never confused with a missing migration again.
