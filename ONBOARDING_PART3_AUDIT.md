# PART 3 — Existing Onboarding Flow: Audit, Gap Analysis and Fixes

Audited against `main` @ `118cbee` (working branch
`arena/01a09a39-fanal-templetes-app`). Every file path, function name, RPC
name and line reference below was read out of the repository, not inferred
from the existing reports. Where an older report and the code disagreed, the
code won and the disagreement is listed in §4.

**Nothing was rebuilt.** The onboarding app already existed at
`src/onboarding/`; the work below is fixes inside it.

---

## 1. The actual existing flow (mapped from code)

| Step in the required flow | Where it actually happens |
|---|---|
| **Route surface** | `src/lib/router.ts` — `isOnboardingPath()`, `matchOnboardingRoute()`, `onboardingPath()`, `isTemplateHandoffPath()`, `matchTemplateHandoffQuery()`. Mounted in `src/App.tsx:1472` (handoff) and `:1483` (onboarding), both **ahead of** the owner editor, the public site and the customer app. |
| **Sign Up** | `src/onboarding/screens/SignupScreen.tsx` → `signUpWithEmail()` in `src/onboarding/lib/auth.ts` → `client.auth.signUp({email, password, options.data.growth_referral_token})`. Client-side rules in `validateSignup()` (`src/onboarding/lib/flow.ts`, `MIN_PASSWORD_LENGTH = 6`). |
| **Login** | `src/onboarding/screens/LoginScreen.tsx` → `signInWithEmail()` → `client.auth.signInWithPassword`. Reset: `ForgotPasswordScreen.tsx` → `sendPasswordReset()` → `auth.resetPasswordForEmail`. |
| **Auth methods used** | Supabase Auth only: `signUp`, `signInWithPassword`, `resetPasswordForEmail`, `signOut`, `getSession`, `onAuthStateChange`. No custom password table anywhere. |
| **Session restore** | Onboarding: `loadViewer()` (`onboarding/lib/auth.ts`) on boot + `sb.auth.onAuthStateChange`. Template App: `observeAuthSession()` in `src/lib/restoreAuthSession.ts` (revision-guarded, 3 exponential retries). |
| **Owner profile creation** | `public.handle_new_user()` trigger on `auth.users` — `supabase/migrations/00001_init.sql:84-105`. Runs for every sign-up, including onboarding sign-ups. |
| **Owner role assignment** | Two places: `profiles.owner_role` written by `toProfileRow()` (`src/lib/salonSync.ts:77`); and `organization_members.role = 'owner'` — **which nothing in the repo ever wrote before this audit** (see §3, G1). |
| **Salon / workspace resolution** | Normalized: `public.nexora_owner_salon_ids()` → consumed by `public.nexora_save_owner_workspace()` (`20260909142000`). Legacy: `profiles` + `services.owner_id` written by `syncSalonToSupabase()` (`src/lib/salonSync.ts:267`). Server readers: `server/backendContext.ts:33`, `server/ownerBookings.ts:32`, `server/ownerDashboard.ts:138`, `server/siteLookup.ts:206`. |
| **Organization membership** | `public.organization_members` (`organization_id, user_id, role, status`). Read by the four server modules above and by `template_website_is_complete()`. **No committed migration created this table** (see §3, G1). |
| **Referral code entered** | `src/onboarding/screens/ReferralScreen.tsx` → `ReferralForm` → `linkReferralCode()`. |
| **Referral code read from URL** | `readSharedReferralCode()` in `src/onboarding/OnboardingApp.tsx:69` — reads `?ref=`, captured once into state on mount before the router redirect drops the query. Canonical share link `/signup?ref=CODE` is built by `partnerReferralShareLink()` (`src/lib/partnerReferralLink.ts:12`). |
| **Referral validation** | Two server paths. (a) Post-login: `link_my_growth_referral(p_code)` — hardened in `20260917_part1b_link_atomicity.sql`, redefined in `20260921`. (b) Pre-sign-up: `POST /api/referral-attribution` (`server/referralAttribution.ts`) → `capture_growth_referral(p_code, p_token)`; then `GET` → `prepare_growth_referral_signup(p_token)`; consumed by the `trg_signup_growth_referral` trigger (`20260922_referral_link_attribution.sql`). |
| **Attribution stored** | `public.growth_onboarding` (one row per user, immutable partner link) + `public.partner_referrals` (partner-facing ledger) + `public.growth_referral_attributions` (hash-only one-use capability, 7-day TTL). |
| **Growth Partner linked** | `growth_onboarding.growth_partner_id`; `get_my_growth_referral()` returns `{growth_partner_id, referral_code, linked_at, status, partner_name}`. |
| **Onboarding state stored** | `public.growth_onboarding.status`: `not_started → linked → template_started → template_completed`. Read by `get_my_onboarding_status()`; app-side mapping `phaseFromOnboardingState()`; routing decision `resolveOnboardingRoute()` — database is the source of truth, never localStorage. |
| **Template selection starts** | `exchange_template_handoff(p_token)` (`20260913_template_handoff.sql`) advances the row to `template_started` exactly once, atomically. |
| **Reaching the editor** | `TemplateHandoffPage` (`src/components/TemplateHandoffPage.tsx`) → `exchangeTemplateHandoff()` → `history.replaceState('/')` → `navigate('/')` into the existing Template App on the existing session. |
| **Completion recorded** | `src/components/WebsiteEditor.tsx:200` — `recordTemplateCompletion()` (`src/lib/growthPartner.ts:365`) fires after the explicit cloud save → `complete_template_onboarding()` → verified by `template_website_is_complete()` (`20260914_template_completion.sql`). |
| **Completion callback / status** | Exists as a pull, not a push: `get_my_onboarding_status` (owner) and `get_my_partner_dashboard` / `get_my_partner_referrals` (partner). `complete_template_onboarding()` returns the full status jsonb including `completed`. |

---

## 2. What was already genuinely working

Verified by execution, not by reading the old reports:

- Full signup → attribution → immutable link → status, through real React +
  real HTTP + real RPC/RLS on PGlite (previously only up to step 8 of
  `tests/dom/partnerFinalAcceptance.test.ts`).
- The one-time handoff: 64-hex token, hash-only storage, 5-min TTL,
  single-active supersede, atomic consume, owner/destination/expiry/ban/live-
  referral checks (`20260913`), and safe error mapping in
  `toSafeHandoffError()`.
- Backend-driven routing with no redirect loops, and the
  `already-linked`-is-not-a-dead-end path in `ReferralScreen`.
- The completion check `template_website_is_complete()` and idempotent
  `complete_template_onboarding()`.

---

## 3. Gaps found, by category

### BROKEN

**B1 — the deployed serverless API graph did not resolve.**
`src/lib/bookingStatus.ts:1` imported `'./statusTheme'` with no extension.
That module is reachable from `api/index.ts` (via `server/bookingRoutes.ts`,
`bookingCreate.ts`, `bookingMine.ts`, `bookingOps.ts`), and Vercel runs that
graph as native Node ESM, which does not resolve extensionless relative
specifiers. The repository's own test `tests/apiEsmImports.test.ts` was
**failing on `main`**: `npm test` → `1200 pass / 1 fail`. **Fixed** (`.js`
added, with a comment explaining why it is load-bearing).

### MISSING

**G1 — owner/salon workspace resolution did not exist anywhere.**
This is the step the required flow names between "secure continuation" and
"onboarding completion", and it was absent:

- No committed migration creates `public.organizations`,
  `public.organization_members`, `public.salons` or
  `public.nexora_owner_salon_ids()` (`grep` over `supabase/migrations/`
  returns nothing; `server/localSupabase.ts:69` says so in a comment).
- No code path ever inserted a row into them (`grep` for
  `insert into public.salons` / `from('organizations')` → only reads).
- Therefore `nexora_save_owner_workspace()` raises
  `Select a salon owned by this account` for a newly onboarded owner, and
  `template_website_is_complete()` branch 1 (active owner/manager org +
  named, slugged salon + active service) can never be satisfied. Completion
  was reachable only through the legacy `profiles` + `services.owner_id`
  branch — i.e. only if the live project still has those columns.

**Fixed** by `supabase/migrations/20261002_owner_workspace_provisioning.sql`:
creates the three tables **only when absent**, creates
`nexora_owner_salon_ids()` **only when absent** (an existing definition is
never replaced), and adds `ensure_owner_workspace()` +
`get_my_owner_workspace()`. Wired at `TemplateHandoffPage` entry and as a
targeted retry in `saveOwnerEditorState`.

**G2 — `/api/referral-attribution` had no rate limit.** It is the funnel's
only unauthenticated writer: every valid POST inserts a
`growth_referral_attributions` row and returns a fresh capability, with no
cleanup job in the repo. Unlimited, it is both a table-growth vector and a
code-brute-forcing oracle. **Fixed** with a bounded in-memory per-client
fixed-window limiter (30 / 10 min, `Retry-After`, 429), placed after the
origin gate and before the RPC.

### INSECURE

**S1 — workspace provisioning could have become a privilege escalation.**
A naive "reuse any membership the caller has and promote it to owner" would
let a `staff` member of somebody else's organization promote themselves.
The shipped `ensure_owner_workspace()` only reuses a membership when the
caller is that organization's **sole** member; otherwise it creates a fresh
organization and leaves the foreign row untouched. Pinned by
`tests/ownerWorkspaceProvisioning.test.ts` ("a membership in somebody else's
organization is never promoted into ownership").

**S2 — `.env.example` shipped a live host for the handoff target** (see H1).

### HARDCODED

**H1 — `VITE_TEMPLATE_APP_URL="https://fanal-templetes-app.vercel.app"`**
in `.env.example`, contradicting `ARCHITECTURE.md` ("same deployment
default"). Anyone copying the file redirects every handoff to that domain,
and because the anti-CSRF `state` lives in `sessionStorage` (per-origin) the
Template App then reads a state it can never see — the check silently
degrades to "unknown". A test (`tests/templateHandoff.test.ts`) was actively
**pinning the hardcode**. **Fixed**: empty default + explanation; the test
now pins the safe default instead.

### NOT TESTED

**T1 — no end-to-end coverage of the handoff half of the funnel.** The
acceptance suite stops at attributed sign-up; `create_template_handoff` and
`exchange_template_handoff` were covered only as isolated RPCs and as SSR
renders. Nothing exercised *status screen → click → mint → redirect →
exchange → enter*. **Fixed** by
`tests/dom/onboardingJourneyBrowserFlow.test.ts`.

**T2 — a test name and assertion that asserted nothing true.**
`tests/onboardingApp.test.ts` had `the status screen … performs no Template
App handoff` with `assert.doesNotMatch(html, /handoff|template app/i)`,
rendered *without* a handoff handler — so it passed vacuously while the
screen does ship a handoff CTA. **Fixed**: renamed, and it now asserts both
variants.

### DISCONNECTED / dead

**D1 — `stripHandoffQuery()`** (`src/onboarding/lib/handoff.ts:232`) is
exported, commented as "the component applies it via
`history.replaceState`", and called only from tests — the component replaces
the URL with `'/'` instead. **Left in place** (removing tested public API is
churn with no user benefit) and recorded here as dead code.

**D2 — `updateMyOnboardingProgress()`** (`src/lib/growthPartner.ts:154`) has
no caller in `src/`; progress advances through the handoff exchange and
`complete_template_onboarding()` instead. Same disposition.

### NOT PRODUCTION READY (owner action required)

- `growth_referral_attributions` has no cleanup for expired rows. Clients
  have no grant on the table, so this must be a scheduled job
  (`delete … where expires_at < now()`) in the Supabase project.
- Live-database verification is still blocked: no project credentials in
  this sandbox. See §6.

---

## 4. Where the old reports disagreed with `main`

| Report claim | Reality on `main` |
|---|---|
| `ARCHITECTURE.md`: "This document matches the implementation on `arena/01a08be5-…`" | The branch merged into `main` is `arena/01a09952-…` (`118cbee`). The doc names a stale branch. |
| `ARCHITECTURE.md`: share link is `/onboarding/referral?ref=CODE` | `partnerReferralShareLink()` emits `/signup?ref=CODE`; three DOM tests assert that exact string. **Doc fixed.** (Both paths are accepted by the router, so nothing was broken — the doc was just wrong about the canonical form.) |
| `ARCHITECTURE.md`: "Organization / salon / services — Normalized production schema" | True of the *live* project, not of this repository: no migration here creates those tables. **Now created conditionally by `20261002`.** |
| `AUDIT_REPORT.md` / `GROWTH_PARTNER_FINAL_ACCEPTANCE.md`: flow complete | The handoff→workspace→save chain had an unbridged gap (G1) and the serverless graph did not resolve (B1). |
| `20260908_staff_performance_dashboard_backend.sql:14-20`: "salons → public.profiles; organizations DOES NOT EXIST" | Accurate for that migration's date, and it is the evidence that the normalized generation arrived later **without a committed migration**. |

---

## 5. Changes made

| File | Change |
|---|---|
| `src/lib/bookingStatus.ts` | `./statusTheme` → `./statusTheme.js` (B1). |
| `supabase/migrations/20261002_owner_workspace_provisioning.sql` | **New.** Conditional creation of `organizations` / `organization_members` / `salons` / `nexora_owner_salon_ids()`, plus `ensure_owner_workspace()` and `get_my_owner_workspace()`. Column-probed, advisory-locked, idempotent, never destructive. |
| `src/lib/ownerWorkspace.ts` | **New.** Best-effort client wrapper; never throws; maps a missing function to `reason: 'unsupported'`. |
| `src/components/TemplateHandoffPage.tsx` | `enter()` resolves the owner workspace after a successful exchange, before entering `/`. |
| `src/lib/ownerEditorState.ts` | On the specific `Select a salon owned by this account` failure only: resolve once, retry once, otherwise return the original error. |
| `server/referralAttribution.ts` | Per-client fixed-window rate limiter (G2). |
| `src/onboarding/screens/StatusScreen.tsx` | Copy no longer says "Nothing more to do" next to the handoff button; stale subtitle replaced. |
| `.env.example` | `VITE_TEMPLATE_APP_URL` defaults to empty (H1). |
| `ARCHITECTURE.md` | Share-link path corrected. |
| `server/localSupabase.ts` | `20261002` added to `LOCAL_GROWTH_CHAIN` so the chain is exercisable locally. |
| `tests/ownerWorkspaceProvisioning.test.ts` | **New**, 14 PGlite tests. |
| `tests/dom/onboardingJourneyBrowserFlow.test.ts` | **New**, end-to-end PART 3 journey. |
| `tests/referralAttribution.test.ts` | +2 rate-limiter tests. |
| `tests/ownerWorkspaceRpc.test.ts` | +4 workspace-retry tests. |
| `tests/onboardingApp.test.ts`, `tests/templateHandoff.test.ts` | Stale name/assertions corrected (T2, H1). |

---

## 6. Verification actually run

```
npx tsc --noEmit     → clean
npm test             → 1224 tests, 1221 pass, 0 fail, 3 skipped   (was 1200/1)
npm run test:dom     → 43 tests, 43 pass, 0 fail                  (was 42)
npm run build        → vite build OK + esbuild server bundle OK
```

Code paths these commands executed:

- `tests/apiEsmImports.test.ts` walks `api/index.ts` → … →
  `src/lib/bookingStatus.ts` and now resolves `./statusTheme.js` (B1).
- `tests/ownerWorkspaceProvisioning.test.ts` runs the real `20261002` SQL in
  PGlite and calls `ensure_owner_workspace()` / `get_my_owner_workspace()`
  as `authenticated`, including the privilege-escalation and
  foreign-schema-shape cases.
- `tests/dom/onboardingJourneyBrowserFlow.test.ts` mounts the real
  `OnboardingApp` and `TemplateHandoffPage`, and drives
  `capture_growth_referral` → `signUp` → `link_my_growth_referral` →
  `get_my_onboarding_status` → `create_template_handoff` →
  `exchange_template_handoff` → `get_my_owner_workspace` over real HTTP.
- `tests/ownerWorkspaceRpc.test.ts` executes the retry branch of
  `saveOwnerEditorState`.
- `tests/referralAttribution.test.ts` drives the limiter through a real
  Express server and asserts 429 + `Retry-After` + zero RPC calls.

**Not verified here (no credentials):** application of `20261002` to the live
project, live Razorpay capture, Supabase Auth URL allow-list, Vercel env
presence. `20261002` is written to be a no-op on a project that already has
the normalized tables, but it has only been executed against PGlite.

### Live run against the dev server

`npm run dev` with `LOCAL_SUPABASE=true` (PGlite running all 23 committed
migrations, including `20261002`), driven over real HTTP with `curl`:

```
1.  admin signed in
2.  partner provisioned, code=NEXORA-2BBE28BE6709
3.  capture from share link:  {"valid":true,"referralCode":"NEXORA-2BBE28BE6709"}
4.  signup capability recovered from httpOnly cookie: b25f472e5fa44f84...
5.  visitor signed up
6.  status after signup:     linked=true status=linked referral_code=NEXORA-2BBE28BE6709
7.  workspace BEFORE entry:  resolved=false salon_id=null          ← the gap
8.  handoff minted:          a0252b9156bc966c...
9.  exchange:                onboarding_status=template_started
10. replay of same token:    {"code":"22023", …}                   ← refused
11. ensure_owner_workspace:  provisioned=true reason=created slug=my-salon
12. workspace AFTER entry:   resolved=true salon_id=17f8b2ca-…     ← the fix
13. final status:            status=template_started
14. partner sees referral:   status=template_started
15. 35 rapid captures:      200 ×28 then 429 ×7                    ← limiter
```

Steps 7 → 11 → 12 are the direct before/after evidence for G1. Step 15 is
the evidence for G2 (28 rather than 30 because the earlier capture and
prepare in the same script consumed two of the window's budget).

This run is the local gateway, not the production Supabase project. It
proves the SQL, the RPC contracts and the HTTP surface; it does not prove
the live project's column shapes, which is exactly why `20261002` probes
every column before writing it.
