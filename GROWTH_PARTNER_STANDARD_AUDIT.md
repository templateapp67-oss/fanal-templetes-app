# Growth Partner standard — line-level audit

Audited revision: **`f9f1907`** (branch `arena/01a0c8e6-fanal-templetes-app`).
Method: grep census over `src/` + `supabase/migrations/`, `tsc --noEmit`, `npm test`,
`npm run test:dom`, `npm run test:partner`. Every claim below names the file and line it
comes from, so it can be marked up and contradicted point by point.

## Verdict

| # | Checklist item | Verdict | Section |
|---|---|---|---|
| 1 | Client layer calls RPCs, not raw table routes | **PASS** — via the "intentionally RLS-supported" branch | [§1](#1-client-layer) |
| 2 | One table `public.growth_partners`, unique per user | **PASS**, stronger shape than the checklist (`user_id` *is* the key) | [§2](#2-table) |
| 3 | RLS on, own-row policies, nothing broad | **PASS** — no `using(true)` / `with check(true)` / `to anon` / `to public` | [§3](#3-rls) |
| 4 | `get_my_growth_partner` invoker · `ensure_my_growth_partner` definer + 42501 | **PASS** | [§4](#4-rpcs) |
| 5 | Canonical `/api/growth-partner/me` + `/ensure` routes | **DEVIATION** — no such routes exist; `.rpc()` is the transport | [§5](#5-routes) |
| 6 | `growthPartner.ts` checklist | **1 violation found → FIXED + pinned** (row missing after ensure) | [§6](#6-growthpartnerts) |
| 7 | One canonical naming, front to back | **PASS** | [§7](#7-naming) |

Exactly one item failed the standard as written. It is fixed, not argued: see §6.
The three deviations (2, 5, and the shape inside 1) are deliberate and each is *stricter*
or *simpler* than the checklist, never a relaxation — see [§8](#8-deviations-and-why).

## 1. Client layer

**Rule**: call RPCs, not raw table routes; a raw `.from('growth_partners')` is acceptable
only where it is intentionally RLS-supported. **Verdict: pass, on that branch.**

Raw select sites — 10, in 4 files, **all `select`-only**:

| File | Lines |
|---|---|
| `src/components/PartnerAuditDiagnosticPanel.tsx` | 95 |
| `src/lib/growthPartnerProfile.ts` | 113, 134 |
| `src/lib/partnerAccountSecurity.ts` | 105, 429, 455, 523, 551, 589 |
| `src/lib/partnerAreaDiagnostics.ts` | 225 |

Writes on that table: **0**. The `.insert`/`.upsert` hits elsewhere in `src/` target
`partner_account_settings` and `partner_deactivation_requests`, not `growth_partners`:

```
$ grep -rn "from('growth_partners')\.\(insert\|update\|upsert\|delete\)" src/ | wc -l
0
```

Each select is scoped to the caller (`eq('user_id', userId)` on the signed-in id, or a
`head: true` existence check) and is backed by the policy + grant in §3, which is the
checklist's explicitly allowed case. Writes are RPC-only everywhere, including the
provisioning path (§4).

## 2. Table

`supabase/migrations/20260912_growth_partner_onboarding.sql:119-120`

```sql
create table if not exists public.growth_partners (
  user_id uuid primary key references auth.users(id) on delete cascade,
```

**Deviation (stronger than the checklist):** there is no surrogate `id` primary key with a
separate unique index on `user_id` — `user_id` **is** the primary key, so uniqueness is
structural and no extra index can drift out of sync with the table. `20260928:8-12` later
adds an internal `id uuid` + `growth_partners_id_key` for cross-table references; it is
not the identity of the row:

```sql
create unique index if not exists growth_partners_id_key on public.growth_partners(id);
```

`referral_code` is `not null` + `check (referral_code ~ '^[A-Z0-9]{6,12}$')` with a
case-insensitive unique index (`20260921_public_partner_referral_codes.sql:8`). There is
no singular `growth_partner` table anywhere, in SQL or in code.

## 3. RLS

Enabled for `growth_partners` in **three** migrations — `20260912:212`, `20260916:166`,
`20260929:147`.

`supabase/migrations/20260929_partner_referral_events_rls.sql:151-159`

```sql
revoke all on public.growth_partners, … from public, anon, authenticated;
grant select on public.growth_partners, … to authenticated;

drop policy if exists growth_partners_select_own on public.growth_partners;
create policy growth_partners_select_own on public.growth_partners for select to authenticated
using(user_id=(select auth.uid()));
drop policy if exists growth_partners_owner_fence on public.growth_partners;
create policy growth_partners_owner_fence on public.growth_partners as restrictive for select to authenticated
using(user_id=(select auth.uid()));
```

- `using(true)` / `with check(true)` on this table: **none** (grep: 0 hits).
- `to anon` / `to public` policies on this table: **none**; anonymous access is closed by a
  RESTRICTIVE `using(false) with check(false)` fence (`:196-197`).
- No insert/update/delete policy exists by design, and the same block installs RESTRICTIVE
  `with check(false)` / `using(false)` fences for insert/update/delete by `authenticated`
  (`:198-203`), so even a stray write grant cannot be exercised from a client.

## 4. RPCs

`get_my_growth_partner()` — `supabase/migrations/20260911092650_…production.sql:2-10`:
`security invoker`, `stable`, `set search_path = ''`, scoped to `(select auth.uid())`,
`revoke … from public, anon` then `grant execute … to authenticated`.

`ensure_my_growth_partner()` — `supabase/migrations/20260922091000_…access.sql:5-37`:
`security definer`, `set search_path = pg_catalog, public, pg_temp`, `actor uuid := auth.uid()`,
`raise exception 'Sign in required' using errcode = '42501'` at `:16`, idempotent
(a second call returns the existing row), never reactivates a suspended row (`:21-31`),
`revoke … from public, anon` + `grant execute … to authenticated` (`:36-37`),
`notify pgrst, 'reload schema'` (`:42`).

Identity is never a parameter: neither function takes an argument, so no caller can name
another account. The admin path `provision_growth_partner(p_user_id, …)` is revoked from
`public, anon, authenticated` (`20260912:538`) and is reachable only by `service_role`.

## 5. Routes

**Deviation.** There is no `/api/growth-partner/me` or `/api/growth-partner/ensure` route,
and none is needed: the client talks to the database through `.rpc()` with the session
token, which is strictly less code and less attack surface than a route that would have to
re-derive the same identity. The canonical API prefix in this repo is `/api/partner`
(31 references); `/api/growth-partner/*` appears nowhere.

The security property the checklist wants from those routes — *identity comes from the
session, never the body* — holds globally: no server route reads a caller-supplied id.

```
$ grep -rn "body\.user_id\|req\.body\.userId\|body\[.user_id.\]" server/ src/lib/*.ts
(no matches)
```

and the RPCs at §4 take no identity argument at all.

## 6. `growthPartner.ts`

| Checklist item | Verdict | Line |
|---|---|---|
| consistent `get*`/`ensure*` naming | pass | `getMyPartner` :462, `getDashboard` :481, `getReferrals` :497, `getEarnings` :528 |
| no singular table references | pass | 0 hits for `'growth_partner'` as a table |
| no client-provided `user_id` | pass | every read takes zero arguments |
| **row missing after ensure must be an ERROR** | **FAILED → fixed** | `src/lib/growthPartner.ts:300-329` |
| no service-role key in the frontend | pass | `supabaseClient.ts:100-101, 285-290` |
| no overly broad policies | pass | §3 |
| one canonical naming | pass | §7 |

### The violation, and the fix

Before: `ensureMyGrowthPartner()` ended in `return data as GrowthPartner`. An RPC that
resolved `null` — or `{}`, or any object without an identity — came back *typed as a
partner row*. The gate then read it as "signed in, not a partner" and rendered the sign-up
surface, which is precisely the silent-failure class this area exists to remove. Nothing
was logged, because nothing looked wrong.

After (`src/lib/growthPartner.ts:320-328`):

```ts
const row = normalizeGrowthPartnerRow(data);
if (!row || !row.user_id) {
  const raised = partnerContractMismatch('user_id');
  logPartnerAreaFailure(raised, {
    operation: 'gate.provision-partner-row',
    call: 'ensure_my_growth_partner',
  });
  throw raised;
}
return row;
```

- Payloads `null`, `{}`, `{referral_code:…}`, `{is_active:true}` → `partnerContractMismatch('user_id')`,
  one `[growth-partner] gate.provision-partner-row failed — ensure_my_growth_partner` log
  line, surfaced to the page as a non-retryable contract mismatch owned by the
  administrator.
- Real rows normalize through unchanged; an inactive row stays inactive.

Pinned by `tests/growthPartnerEnsureRowContract.test.ts` (7/7), including a
comment-stripped source assertion that `return data as GrowthPartner` cannot come back.
The DOM fixture that mocked this RPC with `{}` through a catch-all was corrected to return
a real row — the mock was wrong, not the validation.

Service-role key in the frontend: `SUPABASE_SERVICE_ROLE_KEY` is read only from the
non-public names (`supabaseClient.ts:100-101`), never a `VITE_`/`NEXT_PUBLIC_` alias; the
admin client returns `null` when `process` is undefined (`:285`), i.e. in the browser; and
the environment diagnostics raise `SECURITY ALERT: SUPABASE_SERVICE_ROLE_KEY is detected in
browser client environment!` if a public alias is ever set (`authSession.ts:344-350, 394-396`).

## 7. Naming

`grep -rhoE "\.rpc\(\s*'[a-z_0-9]+'" src/` yields 69 distinct names; every Growth Partner
one resolves to a function in `supabase/migrations/` — `get_my_growth_partner`,
`ensure_my_growth_partner`, `get_my_growth_partner_profile`, `get_my_partner_dashboard`,
`get_my_partner_referrals(_filtered)`, `get_my_partner_performance`,
`get_my_partner_reward_dashboard`, `get_my_partner_onboarding_rewards`,
`get_my_partner_referral_detail`, `get_my_partner_account_settings`,
`get_my_partner_security_overview`, `save_my_partner_account_settings`,
`request_my_partner_account_deactivation`, `cancel_my_partner_account_deactivation`,
`revoke_my_other_partner_sessions`, `set_my_partner_two_factor`,
`log_my_partner_security_event`. One legacy name is probed with an explicit fallback —
`get_owner_workspace` (`App.tsx:905`) falls back to the canonical `get_my_owner_workspace`
on error code `42883`; owner-side, intentional, actionable only by deleting the probe.
No client call is missing a backend definition.

## 8. Deviations, and why

1. **`user_id` is the primary key** (checklist wanted surrogate `id` + unique index on
   `user_id`). Uniqueness is a table constraint rather than an index that can be dropped
   or forgotten; a surrogate cannot express "one row per user" more strongly. The internal
   `id` the checklist's shape implies does exist (`20260928:12`), for foreign keys only.
2. **No `/api/growth-partner/*` routes** (§5). The checklist's own requirement — identity
   from the session, never the body — is enforced by having no caller-supplied identity in
   the RPC signatures at all, plus a repo-wide census of server routes that shows no route
   reads a body-supplied id.
3. **Direct selects remain** (§1). They are the checklist's RLS-supported branch: select
   grant to `authenticated` only, own-row policy, plus a RESTRICTIVE owner fence that makes
   any future permissive policy unable to widen it. Removing them would trade a
   policy-enforced boundary for an RPC wrapper that adds no protection.

## Reproduce

```bash
./node_modules/.bin/tsc --noEmit          # 0
npm test                                   # 1633 tests / 1614 pass / 16 fail / 3 skipped
npm run test:dom                           # 129 / 123 / 6
npm run test:partner                       # 670 / 659 / 11
```

The 16 + 6 + 11 failures are pre-existing and byte-identical to the sets recorded before
this work (bookingModal, onboardingApp, onboardingStateResolution, ownerEntryRoute,
part1SharedBackend, part1cSecurity, savePipeline, templateCompletion, templateHandoff,
plus the partner-suite baselines); the ensure-row fix and its fixture changed none of them.
