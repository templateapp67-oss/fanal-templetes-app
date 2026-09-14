# PHASE 2 — Owner Sign-Up: Audit & Fix

Repo: `fanal-templetes-app` · Branch: `arena/01a09a39-fanal-templetes-app`
Covers **2.1 Supabase Auth**, **2.2 Profile Provisioning**, and the sign-up
form itself. Nothing was rebuilt and no second signup system was created.

> **Correction carried in this revision.** An earlier draft of this phase
> seeded `profiles.owner_role = 'Salon Owner'` at signup. Inspecting the schema
> properly showed that was wrong, and it has been reverted — see §7.

---

## 1. Where owner signup actually lives

| Concern | File | Function / object |
|---|---|---|
| Sign-up screen | `src/onboarding/screens/SignupScreen.tsx` | `SignupScreen` |
| Validation | `src/onboarding/lib/flow.ts` | `validateSignup`, `isValidEmail`, `isValidPhone`, `normalizePhone`, `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` |
| Supabase call | `src/onboarding/lib/auth.ts` | `signUpWithEmail()` → `supabase.auth.signUp({ email, password, options })` |
| Confirmation re-send | `src/onboarding/lib/auth.ts` | `resendSignupConfirmation()` → `auth.resend({ type: 'signup', … })` |
| Safe error copy | `src/onboarding/lib/flow.ts` | `toSafeAuthError(error, 'signup'\|'login'\|'reset'\|'resend')` |
| Referral capability | `src/onboarding/lib/referralAttribution.ts` | `prepareSignupAttribution()` → httpOnly cookie |
| Profile row creation | `00001_init.sql:84-105`, replaced by `supabase/migrations/20261003_signup_profile_fields.sql` | `public.handle_new_user()`, trigger `on_auth_user_created` |
| Canonical owner role | `20261002_owner_workspace_provisioning.sql:160` | `organization_members.role` |
| Display title | `00001_init.sql:33` | `profiles.owner_role` |
| Auth client singleton | `src/lib/supabaseClient.ts` | `supabase`, `isMockSupabase`, `isProductionBuild`, `allowMockAuth` |
| Session persistence | `src/lib/authRememberStorage.ts` | `createRememberAwareAuthStorage()` |
| Local gateway | `server/localSupabase.ts` | `registerLocalSupabaseGateway()`, `LOCAL_GROWTH_CHAIN` |

---

## 2. Sign-up form checks

| # | Check | Before | After |
|---|---|---|---|
| 1 | Form validation | email / password / confirm only | + full name, + phone, + password max length, + password ≠ email |
| 2 | Email | OK | unchanged |
| 3 | Password | min 6 only | min 6, **max 72** (bcrypt truncates above it), rejects password == email |
| 4 | Confirm password | OK | unchanged |
| 5 | Full name | **MISSING** — never collected, so `handle_new_user()` wrote `full_name = ''` on every funnel account | required, ≤ 120 chars, sent as `full_name` metadata |
| 6 | Phone | **MISSING** | required, 7–15 digits, normalised, sent as `phone_number` metadata |
| 7 | Terms acceptance | **Not required anywhere** — no terms/privacy control exists in `src/` | **nothing added** |
| 8 | Referral code | OK | unchanged |
| 9 | Loading state | **BROKEN** — see §3.1 | fixed |
| 10 | Double submission | guarded by React state only | ref-backed `createSingleFlight()` |
| 11 | Supabase auth signup | OK | + `options.emailRedirectTo` |
| 12 | Profile creation | **INCOMPLETE** | `20261003` replaces the trigger |
| 13 | Owner role | — | see §7: the canonical role is already granted correctly, and `profiles.owner_role` is deliberately **left NULL** |
| 14 | Error handling | OK | + `'resend'` action, bcrypt too-long, GoTrue rate-limit wording |
| 15 | Post-signup routing | OK — `resolveOnboardingRoute()` never sends a signed-in user back to Sign Up | unchanged |
| 16 | Email verification | inbox screen was terminal: no resend, no `emailRedirectTo` | + resend, + redirect target |
| 17 | Refresh behaviour | **BROKEN** — a reload dropped an owner with an account back onto a blank form | per-tab `sessionStorage` marker |

### 3.1 The loading state never showed

```ts
try { …; return signUpWithEmail(client, { … }); }   // ← no await
finally { setBusy(false); }
```

In an `async` function a bare `return <promise>` runs the `finally` block
without waiting, so `setBusy(false)` fired the instant the request was *sent*:
the button re-enabled and "Creating account…" never rendered, mid-flight. Found
by the DOM test `an in-flight submit shows the busy state and the fields lock`,
not by reading. Now `return await`.

---

## 6. PHASE 2.1 — authentication authority

Every alternative authority on the checklist was checked against the code.

| Authority | Verdict | Evidence |
|---|---|---|
| **Supabase Auth** | ✅ The only one | `signUpWithEmail` → `client.auth.signUp`; `signInWithEmail` → `client.auth.signInWithPassword`; `loadViewer` → `auth.getSession`; `observeAuthSession` → `auth.onAuthStateChange`. `part1cSecurity` C10 already asserts every auth site imports the shared singleton and that no file outside a 4-entry allowlist calls `createClient(`. |
| **localStorage** | ✅ Not an authority in live mode | `App.tsx:352` restored a cached user object **only** when mock: `if (!isMockSupabase) return null`. `App.tsx:654` states the rule: *"The restored SDK session, not a cached user object, controls authentication."* `authRememberStorage.ts` only chooses *which* browser store holds the **Supabase** token — it grants nothing. `getStoredAuthenticatedProfile()` is read only by `mergeTemplatePreservingUserData()` to pre-fill template defaults. `ONBOARDING_COMPLETED_KEY` only decides wizard-vs-preview. |
| **mock session** | ⚠️ **was** reachable from a production bundle — **fixed** | See below. |
| **frontend-only object** | ✅ | `setUser` is driven by `observeAuthSession`; `App.tsx:866` — *"Only the auth listener changes login state; a data read cannot log the user out."* |
| **hardcoded account** | ✅ server, ⚠️ client **fixed** | `LOCAL_DEV_ADMIN_EMAIL/PASSWORD` exist only in `server/localSupabase.ts`, which throws at `NODE_ENV === 'production'` (`:439`). The client's `mock-user-123` had no such guard — fixed. |
| **manual password storage** | ✅ none | No app-side password storage anywhere. The only hashing is the local gateway's `hashPassword()` = **scrypt + 16-byte random salt**, compared with `timingSafeEqual`, written to GoTrue's own `auth.users.encrypted_password` column, in a module that refuses to run in production. |
| **custom plaintext password table** | ✅ none | Zero password/credential tables across all 49 migrations. `part1cSecurity` C10 asserts this: comments are stripped and every migration is matched against `/password/i`. |

### 6.1 The one real defect: the client could fabricate a session in production

`server.ts:77` already had the right guard:

```ts
const allowMockBookingAuth = isMockSupabase && !isVercelRuntime;
```

and `server/bookingAuth.ts` only honours a `mock:` bearer token when that is
true. The **client** had no equivalent. `isMockSupabase` is true whenever a
deployment is missing `SUPABASE_URL`/anon key — so a production deploy that
simply forgot its environment variables would let `AuthModal` mint
`{ id: 'mock-user-123' }` for *any* email and *any* (even empty) password, and
`App.tsx` would cache and restore it from `localStorage['nexora_auth_user_v1']`.

The Onboarding App already failed closed in exactly this situation
(`OnboardingMockNotice`), so the two sign-up paths disagreed.

**Fix** — a client-side mirror of the server rule, in `src/lib/supabaseClient.ts`:

```ts
export const isProductionBuild = /* import.meta.env.PROD === true, read defensively */;
export function canFabricateSession(isMock, isProdBuild) { return isMock && !isProdBuild; }
export const allowMockAuth = canFabricateSession(isMockSupabase, isProductionBuild);
```

`AuthModal` now refuses with an actionable message when
`isMockSupabase && !allowMockAuth`, and fabricates only when `allowMockAuth`.
`App.tsx` restores the cached user only when `allowMockAuth`. **Demo data
(appointments, clients, templates) still keys off `isMockSupabase`**, so
offline previews keep working — only *session fabrication* is gated.

**Verified in the shipped production artifact**, not just in source. In
`dist/assets/index-*.js` Vite folded it to:

```js
GJ = (()=>{ try { return !0 } catch { return !1 } })();  // isProductionBuild === true
function KJ(e,t){ return e && !t }                        // canFabricateSession
const Y2 = KJ(Lt, GJ);                                    // allowMockAuth → false, always
… if (Lt && !Y2) { "Accounts are not connected to a database…" }
```

`part1cSecurity` C13 pins the truth table *and* asserts both call sites are
gated on `allowMockAuth`, so a revert to `isMockSupabase` fails the suite.

---

## 7. PHASE 2.2 — profile provisioning and the owner role

### 7.1 The schema, as it actually is

```
auth.users ──(trigger on_auth_user_created)──▶ public.handle_new_user()
                                                     │
                                                     ▼
                                              public.profiles   (1:1, RLS: id = auth.uid())
```

`00001_init.sql:84-105` creates the trigger; `20261003` replaces the function
body. `part1cSecurity` C10 asserts `profiles` is the **only** `*profile*` table
in any migration and that the trigger is attached to `auth.users`.

### 7.2 Two things are called a "role". Only one is a role.

| | `profiles.owner_role` | `organization_members.role` |
|---|---|---|
| Declared | `00001_init.sql:33`, `text`, NULLable | `20261002:160`, `text not null default 'owner' check (role in ('owner','manager','staff'))` |
| Read by | `src/App.tsx:762`, `server/siteLookup.ts:115`, rendered as a job title on the public site | `nexora_owner_salon_ids()`, `ensure_owner_workspace()`, `get_my_owner_workspace()`, `template_website_is_complete()`, `server/backendContext.ts`, `server/ownerBookings.ts`, `server/ownerDashboard.ts` |
| Grants anything? | **No.** With comments stripped, `owner_role` appears in the executable SQL of exactly **one** migration — the `00001` column declaration. No policy, function or grant reads it. | **Yes.** It is the authorization role. |
| Who writes it | the chosen template (`src/categoryTemplates.ts` via `mergeTemplatePreservingUserData`) and the editor (`SidePanelCustomizer`), persisted by `src/lib/salonSync.ts:87` | `ensure_owner_workspace()` at the handoff boundary |

So: **no `profiles.role` column was added** — none exists, and
`part1cSecurity` C14 now fails the build if one ever appears (its detector is
exercised against synthetic `create table public.profiles (role …)` /
`alter table public.profiles add column role` inputs first, so a green run
cannot be an artefact of a regex that never matches).

### 7.3 The inconsistency that was fixed

The first draft of this phase seeded `owner_role = 'Salon Owner'` from signup.
That was wrong, on inspection:

* it is not an authorization role — the canonical one was already granted
  correctly and was untouched;
* it is a display title with an existing owner (the template layer), so seeding
  it gave the field a **second writer**;
* `App.tsx:762` is `ownerRole: data.owner_role || prev.ownerRole` — the DB value
  wins, so every new owner's public site would have shown a generic
  "Salon Owner" instead of their template's title until their first editor
  save overwrote it;
* **NULL is the designed value**: it falls through to the template.

`20261003` now persists `full_name` and `phone_number` — the identity fields the
trigger already expected — and leaves `owner_role` alone.

### 7.4 Proven against real PostgreSQL

`tests/ownerRoleCanonical.test.ts` (7 tests) runs `20261002` + `20261003` on
PGlite and asserts:

1. a fresh signup resolves no workspace and owns no salon;
2. `ensure_owner_workspace()` creates exactly one `organization_members` row
   with `role='owner'`, `status='active'`, and resolution follows;
3. `role='superadmin'` is rejected by the check constraint;
4. **demoting to `role='staff'` immediately empties `nexora_owner_salon_ids()`
   and unresolves the workspace** — no cache, no client flag;
5. deactivating the membership does the same;
6. setting `profiles.owner_role` to `'owner'`, `'manager'`, `'admin'`,
   `'superadmin'` or `'Founder & Master Stylist'` grants **nothing**, and cannot
   override a real demotion;
7. the real `handle_new_user()` persists `full_name`/`phone_number` and leaves
   `owner_role` NULL.

---

## 8. Verification

```
tsc --noEmit (5.8.3)   exit 0
npm test               1253 tests, 1250 pass, 0 fail, 3 skipped
npm run test:dom         52 tests,   52 pass, 0 fail
npm run build          OK  (+ the production artifact was inspected, §6.1)
```

Test files added or extended in this phase:

| File | Covers |
|---|---|
| `tests/signupProfileFields.test.ts` (7) | the real `20261003` SQL: persistence, the empty-string contract, blank normalisation, a legacy `profiles`, idempotence, `SECURITY DEFINER` retained, probe revoked |
| `tests/localSupabaseAuthGateway.test.ts` (6) | real HTTP: metadata → `raw_user_meta_data` → `profiles` through RLS, no-metadata contract, cross-owner/anon isolation, duplicate/missing-credential rejection, the confirmation-required shape, auto-confirm default |
| `tests/dom/onboardingSignupBrowserFlow.test.ts` (9) | double submit reaches Auth once, busy state + field lock, inbox screen, refresh keeps it, resend success/failure/retry, marker cleared on a confirmed session |
| `tests/ownerRoleCanonical.test.ts` (7) | §7.4 |
| `tests/part1cSecurity.test.ts` C13 + C14 (2) | §6.1 and §7.2 as permanent guards |

### Live run against the local Supabase gateway (PGlite, 24 migrations)

```
1. signup ok
2. profiles row, read back by the owner through RLS:
   [{"full_name":"Uma Rao","phone_number":"+91 98450 77654","owner_role":null,…}]
3. workspace BEFORE provisioning: resolved=false salon_count=0 salons=[]
5. ensure_owner_workspace: reason=created slug=uma-rao provisioned=true
6. workspace AFTER:  resolved=true salon_count=1 ambiguous=false salons=[{slug:uma-rao}]
8. ensure_owner_workspace again: provisioned=False reason=existing   (idempotent)
9. profiles.owner_role still null
```

Earlier in the phase, with `LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION=true`:

```
settings {"mailer_autoconfirm":false}
signup   → user present, NO access_token, email_confirmed_at=null
login    → 400 email_not_confirmed
resend   → 200 for a known and an unknown address, identical body (no enumeration)
resend   → 422 for a bad type
duplicate signup → 422 · signup with no password → 422 · rate limiter 29×200 then 429
```

### Not verified here, and why

* `save_owner_editor_state` could **not** be exercised over the gateway:
  `20260909142000_normalized_owner_workspace.sql` is not in `LOCAL_GROWTH_CHAIN`,
  so the function does not exist locally (`PGRST202`). Its role gate is covered
  instead by §7.4 against real PostgreSQL.
* The local gateway sends no email and has no `/auth/v1/verify`, so the confirm
  *click* is not exercisable — only the signup shape, the login refusal and the
  resend call.

---

## 9. Needs the owner, not code

1. **Apply `20261002` and `20261003` to the live Supabase project.** No project
   credentials in this sandbox; both have run only against PGlite. Until
   `20261003` is applied, production signup keeps writing a blank `full_name`.
2. **Add `<app-origin>/onboarding/login` to Auth → URL Configuration.**
   `emailRedirectTo` is now sent for the confirmation and reset mails; without
   the allow-list entry Supabase falls back to the Site URL.
3. **Existing owners are not backfilled.** The trigger fires only on
   `auth.users` INSERT. Accounts predating this change still have
   `full_name = ''`. A backfill would risk overwriting names owners set in the
   editor, so it is a deliberate decision, not something a signup fix should do
   silently.
4. **Set the Supabase environment variables on every deployment.** With
   `allowMockAuth` the app now fails closed instead of handing out
   `mock-user-123`, which is correct — but it also means a misconfigured
   deployment shows "Accounts are not connected to a database" rather than
   appearing to work.
