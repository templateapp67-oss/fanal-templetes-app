# 1.3 — Current State Matrix (post-fix re-audit)

Repository: `fanal-templetes-app` · branch `arena/01a09a39-fanal-templetes-app`

Workflow followed: **AUDIT → FIND GAPS → FIX GAPS → TEST → RE-AUDIT → FINAL
REPORT.** Every cell was read out of the working tree in this session. Status
values are *after* the fixes in §2; the pre-fix value is given in the Gap
column so the delta is visible.

Severity: **BLOCKER** (flow cannot complete) · **CRITICAL** (data/security
integrity) · **HIGH** (unusable for a real user segment) · **MEDIUM**
(incomplete/fragile) · **LOW** (polish). `—` = no gap.

---

## A. Auth

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| Signup | `src/onboarding/screens/SignupScreen.tsx` → `signUpWithEmail()` (`src/onboarding/lib/auth.ts`); routes `/onboarding/signup`, `/signup`, `/register` via `matchOnboardingRoute()` (`src/lib/router.ts`) | Email + password + confirm only; client rules in `validateSignup()` (`onboarding/lib/flow.ts`, `MIN_PASSWORD_LENGTH = 6`); passes `options.data.growth_referral_token` when a capability cookie exists | `auth.users`; `handle_new_user()` (`00001_init.sql:84-105`); `trg_signup_growth_referral` (`20260922`) | Working — exercised end to end over HTTP | — | — | None |
| Login | `src/onboarding/screens/LoginScreen.tsx` → `signInWithEmail()` → `auth.signInWithPassword` | Client rules in `validateLogin()`; failures mapped by `toSafeAuthError()` | `auth.users` | Working | No client-side throttling; relies on Supabase Auth's own limits | LOW | Optional |
| Forgot Password | Request: `ForgotPasswordScreen.tsx` → `sendPasswordReset()` (`auth.ts`, `redirectTo = <origin>/onboarding/login`) → `auth.resetPasswordForEmail`. **Completion: `src/onboarding/screens/SetPasswordScreen.tsx` → `setNewPassword()` → `auth.updateUser`**, driven by `PASSWORD_RECOVERY` in `OnboardingApp.tsx` | Two halves. Request half never reveals account existence; completion validates min length + match, maps failures via `toSafeAuthError(…, 'reset')` | `auth.users` | **FIXED.** Was BROKEN: the reset email pointed at `/onboarding/login`, which had no `PASSWORD_RECOVERY` handler — only the partner portal did (`PartnerPortalLogin.tsx:780`, `partnerPortalAuth.ts:289`). Clickers landed on a login form holding an unusable recovery session | Recovery half did not exist in the Onboarding App | **BLOCKER** → resolved | **Done** — new screen, `setNewPassword()`, `updateUser` on the client interface, `PASSWORD_RECOVERY` branch, URL sync suppressed during recovery. Reset request verified live (HTTP 200) |
| Session Restore | `loadViewer()` (`onboarding/lib/auth.ts`) on boot + `onAuthStateChange`; Template App `observeAuthSession()` (`src/lib/restoreAuthSession.ts`) | `getSession()` then live events; revision-guarded, 3 exponential retries; expired JWT drops to signed-out so the resolver routes to login | `auth.users` (JWT) | Working | — | — | None |

## B. Owner / workspace

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| Owner Profile | `public.handle_new_user()` — `00001_init.sql:84-105` | `after insert on auth.users` → `profiles(id, email, full_name)`, `on conflict do nothing` | `public.profiles` | Working for every sign-up path | — | — | None |
| Owner Role | Label: `profiles.owner_role` (`00001_init.sql:33`), written by `toProfileRow()` (`salonSync.ts:87`), read `App.tsx:762`, `server/siteLookup.ts:115`. **Authorization:** `organization_members.role`, set `'owner'` by `ensure_owner_workspace()` | Two similarly-named, unrelated concepts | `profiles.owner_role`, `organization_members.role` | Working | `owner_role` is free text consulted by no authorization check; the name implies otherwise | LOW | Rename/document; no schema change made |
| Organization | `public.organizations` — `supabase/migrations/20261002_owner_workspace_provisioning.sql` | Created **only when absent**; an existing table is never altered | `public.organizations` | **FIXED.** Was MISSING: no committed migration created it and nothing inserted a row | See left | **BLOCKER** → resolved | **Done** |
| Organization Membership | `public.organization_members` + `ensure_owner_workspace()` (`20261002`) | `(organization_id, user_id, role, status)`, unique per pair; inserts `role='owner', status='active'`, or promotes the caller's membership **only when they are that organization's sole member** | `public.organization_members` | **FIXED.** Was MISSING. A naive "promote any membership" would have been a privilege escalation — closed and pinned by a test | See left | **CRITICAL** → resolved | **Done** |
| Salon Provisioning | `ensure_owner_workspace()` (`20261002`); client `src/lib/ownerWorkspace.ts` → `resolveOwnerWorkspace()` | Idempotent; name from `profiles.salon_name`→`business_name`→`full_name`→`'My Salon'`; slug via `owner_workspace_slugify()` with random-suffix retry ×8 on collision; per-caller advisory lock | `public.salons` | **FIXED.** Was MISSING: `nexora_save_owner_workspace()` raised `Select a salon owned by this account` for every newly onboarded owner. Verified live: `resolved=false` before entry → `provisioned=True slug=my-salon` → `resolved=true` | See left | **BLOCKER** → resolved | **Done** — called from `TemplateHandoffPage.enter()` and as a targeted retry in `saveOwnerEditorState` |
| Multiple Salon Resolution | Save target: `nexora_save_owner_workspace()` (`20260909142000`, lines 24-29) matches `salons.slug` to `profile.subdomain`, else requires exactly one salon, else raises. Read: `get_my_owner_workspace()` now returns `salon_count`, `ambiguous`, `salons[]`; `ownerEditorState.ts` maps the failure to `AMBIGUOUS_WORKSPACE_MESSAGE` + the candidate slugs | Deterministic for 0 or 1 salon; for 2+ the owner is told which salons exist and what to do | `salons.slug`, `nexora_owner_salon_ids()` | **IMPROVED.** Was HIGH: 2+ salons failed with the opaque raw SQL error and resolution silently returned the oldest | Still no salon-picker **UI** — the owner must set the website address to one of the listed slugs | **HIGH** → **MEDIUM** | Partially done (diagnosable + actionable). A picker needs a product decision |

## C. Referral

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| Referral Input | `ReferralScreen.tsx` → `ReferralForm` → `linkReferralCode()` | Asks for the code and nothing else; single-flight; `already-linked` treated as success | `link_my_growth_referral(text)` | Working | — | — | None |
| Referral URL Capture | `readSharedReferralCode()` (`OnboardingApp.tsx:69`); link from `partnerReferralShareLink()` (`partnerReferralLink.ts:12`) → `/signup?ref=CODE` | Captured once into state on mount before the router redirect drops the query; >64 chars rejected, not truncated; capability then survives in an httpOnly cookie | `capture_growth_referral`, `growth_referral_attributions` | Working (re-mount without `?ref` proven in the acceptance suite) | — | — | None |
| Referral Validation | `link_my_growth_referral` (`20260912`, atomic claim `20260917`, redefined `20260921`); `POST /api/referral-attribution` (`server/referralAttribution.ts`) → `capture_growth_referral` → `prepare_growth_referral_signup` (`20260929`) | All server-side; the browser supplies only a raw code — no parameter can select a partner | `growth_partners`, `growth_referral_attributions` | Working | — | — | None |
| Referral Attribution | `trg_signup_growth_referral` → `consume_signup_growth_referral()` (`20260922`) | md5 hash-only token, 7-day TTL, one-use, `for update` consume; rejects stale tokens after rotation/deactivation; untrusted `partner_id` metadata cannot override | `growth_referral_attributions` | Working | **No cleanup job for expired rows**; clients hold no grant on the table | MEDIUM | Owner action: scheduled `delete … where expires_at < now()` |
| Referral Lock | `growth_onboarding` PK on `user_id` + `growth_onboarding_referral_consistent` check + link RPC refusing overwrite | Immutable after first link | `growth_onboarding` | Working — a second link returns `22023`, verified live | — | — | None |
| Growth Partner Mapping | `growth_onboarding.growth_partner_id`; `get_my_growth_referral()` → `partner_name` via `growth_partner_display_name()` | One partner per user from the immutable row | `growth_partners`, `profiles.full_name` | Working | — | — | None |
| Onboarding State | `growth_onboarding.status` (`not_started→linked→template_started→template_completed`); `get_my_onboarding_status`; `phaseFromOnboardingState()`; `resolveOnboardingRoute()` | Database is the only source of truth; localStorage never consulted for routing | `growth_onboarding` | Working | — | — | None |

## D. Continuation, completion, conversion

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| Template Selection Entry | `exchange_template_handoff()` (`20260913`) records `template_started`; the real template choice lives in the Template App (`selectedTemplateId`, `App.tsx:383`) | No template-selection step exists in the Onboarding App | `growth_onboarding.template_started_at` | Working, label misleading | `template_started` means "entered the app", not "chose a template", yet the partner dashboard reads it as progress | LOW | Rename in a future migration or document the definition |
| Editor Entry | `TemplateHandoffPage.tsx` → `exchangeTemplateHandoff()` → `resolveOwnerWorkspace()` → `replaceState('/')` → `navigate('/')`; wizard gate `handleBuildWebsiteClick` / `ONBOARDING_COMPLETED_KEY` (`App.tsx:23`) | Enters the existing Template App on the existing session with a workspace already resolved; token scrubbed with replace, not push | `template_handoffs`, `growth_onboarding` | Working | — | — | None |
| Secure Handoff / Secure Continuation | `create_template_handoff(p_state)` + `exchange_template_handoff(p_token)` (`20260913`); client `onboarding/lib/handoff.ts` | 64-hex token, hash-only storage, 5-min TTL, single-active supersede, atomic `for update` + conditional consume; checks owner = `auth.uid()`, destination, consumed, expiry, account exists, not banned, live referral matches; URL carries only token + anti-CSRF state | `template_handoffs` (RLS fully closed, `revoke all`) | Working — replay refused (`22023`), forged token refused, state mismatch fails closed before any RPC | — | — | None |
| Completion Status | `complete_template_onboarding()` + `template_website_is_complete(uuid)` (`20260914`); caller `WebsiteEditor.tsx:200` → `recordTemplateCompletion()` (`lib/growthPartner.ts`) | Fires after the explicit cloud save; server decides; idempotent; no row → no-op; referral ownership untouched | `growth_onboarding`, `organization_members`, `salons`, `services` | Working | — | — | None |
| Completion Callback | Read side only: `get_my_onboarding_status`, `get_my_partner_dashboard`, `get_my_partner_referrals` | **Pull, not push.** No `pg_notify`/webhook/HTTP callback on `template_completed` (verified absent across all migrations) | `growth_onboarding` | Incomplete | An open Onboarding tab never learns of completion without a refresh; the partner dashboard updates on its next load | MEDIUM | Optional: `pg_notify` + realtime channel, or a poll endpoint |
| Referral Conversion | `growth_effective_referral_status(p_onboarding, p_override)` (`20260924`, lines 8-13) | `template_completed→'converted'`, `template_started→'active'`, else `'pending'`; an admin override wins | `growth_onboarding.status`, `referral_status_override` | Working — verified live: partner sees `status=template_started` | — | — | None |
| Partner Credit / Conversion | `GrowthPartnerSections.tsx:58-60` — `GROWTH_PARTNER_NO_COMMISSION_TITLE = 'No commission earned yet.'` | **No Growth Partner commission model exists** — no tables, RPCs or rate config; the UI says so instead of inventing numbers (staff commission is a separate, real domain) | none | Not built, honestly reported | Conversion is tracked; nothing is credited or payable | MEDIUM (product gap) | Needs a qualifying event + amount basis + rate config before any UI |

## E. Resilience

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| Error Recovery | `toSafeAuthError()`, `toSafeReferralError()` (`onboarding/lib/flow.ts`), `toSafeHandoffError()` (`lib/handoff.ts`); `OnboardingBootError` + Retry + "Continue without a referral" | Every Supabase failure maps to fixed copy; raw SQL/driver text, tokens and ids never surface | — | Working | **No gap — my initial read was wrong.** Retry looks redundant next to an invalid-code error, but `tests/dom/partnerExistingReferralBrowserFlow.test.ts` drives backend `invalid → database → valid` and relies on Retry to recover a transiently failing capture. Removing it would strand users | — (attempted fix **reverted**) | None — pinned by a new test so it is not "fixed" again |
| Refresh Recovery | `loadViewer()` on boot; `TemplateHandoffPage.tsx:209-215` — on `handoff-used`, re-reads status and continues when `isEnteredOnboardingStatus()` | A refresh mid-exchange does not strand the user on "already used" | `growth_onboarding` | Working | — | — | None |
| Logout / Login Resume | `handleLogout` → `signOutViewer()` (`OnboardingApp.tsx:264-265`); re-login routed by `resolveOnboardingRoute()` from the DB phase | Linked users are never forced back to the referral screen; pending users return to it | `growth_onboarding` | Working | — | — | None |

## F. Security, configuration, tests

| Feature | Existing File / Function / Route | Current Implementation | Database Dependency | Current Status | Gap | Severity | Fix Required |
|---|---|---|---|---|---|---|---|
| RLS | Enabled in 20 migrations incl. `20261002`; `template_handoffs` and `growth_referral_attributions` `revoke all … from public, anon, authenticated`; `growth_partners` SELECT-own-row with no write policies or grants | `auth.uid()`-scoped throughout; user-facing RPCs are `security definer` with a pinned `search_path`, EXECUTE revoked from `public`/`anon` | all growth tables | Strong | `supabase/rls-test-disable.sql` ships in the repo (testing-only, loudly warned about) — dangerous if pasted into production | MEDIUM | Keep out of production; consider relocating |
| API Authorization | `server/referralAttribution.ts`: same-origin check (`Origin` vs host, `sec-fetch-site` cross-site rejected), httpOnly + SameSite=Lax cookie, `code`-only body allow-list, per-client fixed-window rate limiter (`createReferralRateLimiter`, 30/10 min, 429 + `Retry-After`). Bookings: `authenticateBookingRequest` (`server.ts:471,503,534`), mock auth gated by `allowMockBookingAuth = isMockSupabase && !isVercelRuntime` (`server.ts:77`); server DB via `getSupabaseAdmin()` (`server.ts:71`) | Credentialed cross-origin requests refused even from sibling sites; limiter sits after the origin gate and before the RPC | — | **FIXED.** Was HIGH: every valid POST inserted a row with no bound. Verified live: `200 ×28 then 429 ×4` | Server writes need `SUPABASE_SERVICE_ROLE_KEY`; without it the anon fallback is RLS-blocked | HIGH → LOW | **Done** for the limiter; the key is a deploy requirement |
| Production Configuration | `.env.example`, `ENV_SETUP.md`, `SUPABASE_SETUP.md`, `ARCHITECTURE.md`; `scripts/verify-supabase-connection.mjs`, `verify-growth-partner.mjs`, `verify-partner-profile.mjs`, `check-razorpay.mjs`, `setup-env.mjs` | Env documented and script-verifiable; `VITE_TEMPLATE_APP_URL` hardcode removed (empty = same-origin) | — | Mostly ready | **`20261002` has not been applied to the live project** — no credentials in this sandbox. No CI gate proving migrations were applied | **CRITICAL** until applied | Owner: run `20261002`, then `npm run verify:growth-partner -- .env` |
| Automated Tests | 92 files in `tests/*.test.ts`, 14 in `tests/dom/*.test.ts` (`npm test`, `npm run test:dom`) | PGlite runs the real migrations; DOM tests mount real components in jsdom with real events; commission math runs verbatim shipped bodies | — | Strong | jsdom only — no real Chromium in this sandbox | MEDIUM | Accept, or add Playwright in CI |
| E2E Tests | `tests/dom/partnerFinalAcceptance.test.ts` (15 steps) and `tests/dom/onboardingJourneyBrowserFlow.test.ts` (share link → sign up → link → handoff → exchange → workspace) | Real React + HTTP + Auth + RPC/RLS on disk-backed PostgreSQL | full growth chain + `20261002` | Working | Neither runs against the live Supabase project | MEDIUM | Same as above |

---

## 2. What the fix phase changed

| Gap | Fix | Verified by |
|---|---|---|
| `./statusTheme` broke the serverless ESM graph | `.js` extension in `src/lib/bookingStatus.ts` | `tests/apiEsmImports.test.ts` (was failing on `main`) |
| No owner/salon workspace provisioning | `20261002` + `src/lib/ownerWorkspace.ts`, wired into `TemplateHandoffPage` and `saveOwnerEditorState` | `tests/ownerWorkspaceProvisioning.test.ts` (17), live HTTP run |
| Privilege-escalation risk in provisioning | Sole-member gate before promoting a membership | `tests/ownerWorkspaceProvisioning.test.ts` |
| Unbounded `/api/referral-attribution` | Per-client fixed-window limiter | `tests/referralAttribution.test.ts` (+2), live 429s |
| `.env.example` hardcoded handoff host | Empty same-origin default; the test that pinned the hardcode now pins the safe default | `tests/templateHandoff.test.ts` |
| StatusScreen contradicted its own CTA | Conditional copy | `tests/onboardingApp.test.ts` |
| Forgot Password dead-ended | `SetPasswordScreen` + `setNewPassword()` + `PASSWORD_RECOVERY` wiring | `tests/onboardingApp.test.ts` (+2), live HTTP 200 |
| Multi-salon failure was opaque | `salon_count` / `ambiguous` / `salons[]` + `AMBIGUOUS_WORKSPACE_MESSAGE` | `tests/ownerWorkspaceProvisioning.test.ts` (+3), `tests/ownerWorkspaceRpc.test.ts` (+1) |
| **Reverted:** removing Retry on invalid-code | Restored shipped behaviour | `tests/dom/partnerExistingReferralBrowserFlow.test.ts` caught the regression |

## 3. Verification actually run (this session)

```
tsc --noEmit (TypeScript 5.8.3, local)   → exit 0
npm test                                 → 1231 tests, 1228 pass, 0 fail, 3 skipped
npm run test:dom                         → 43 tests, 43 pass, 0 fail
npm run build                            → vite build OK + esbuild server bundle OK
live HTTP chain against `npm run dev`     → all 9 steps pass (see below)
```

Baseline before any of this work: `npm test` was **1200 pass / 1 fail**.

Live re-audit transcript (local gateway, 23 migrations, fresh database):

```
1. partner code=NEXORA-3D7E0A0ABE51
2. signed up + attributed: linked
3. workspace BEFORE: resolved=false salon_count=0 salons=[]
4. exchange -> template_started
5. ensure_owner_workspace: provisioned=True slug=my-salon
6. workspace AFTER: resolved=true salon_count=1 ambiguous=false
                    salons=[{slug: my-salon, salon_id: e8545e65-…}]
7. password reset request: 200
8. partner sees referral: 1, status=template_started
9. rate limiter: 200 ×28 then 429 ×4
```

**Not verified — no credentials in this sandbox:** applying `20261002` to the
live Supabase project, live Razorpay capture, Auth URL allow-list, Vercel env
presence. `20261002` probes every column before writing and is a no-op where
the normalized tables already exist, but it has only been executed against
PGlite.

## 4. Severity roll-up after the fix phase

| Severity | Before | After | Remaining |
|---|---|---|---|
| BLOCKER | 3 | 0 | — |
| CRITICAL | 2 | 1 | `20261002` not applied to the live project (needs credentials) |
| HIGH | 2 | 0 | — |
| MEDIUM | 6 | 7 | Multi-salon picker UI (downgraded from HIGH), attribution cleanup, completion callback, partner credit, RLS helper file, migration CI gate, browser fidelity |
| LOW | 4 | 4 | Login throttling, owner-role naming, template-entry semantics, (Retry item withdrawn — not a gap) |

Two items need the owner, not code: applying `20261002` to the live project,
and deciding whether multi-salon owners get a picker UI.
