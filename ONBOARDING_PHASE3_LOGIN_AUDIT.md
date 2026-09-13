# PHASE 2.3 & PHASE 3 — Signup recovery and login

Repo: `fanal-templetes-app` · Branch: `arena/01a09a39-fanal-templetes-app`
Builds on `ONBOARDING_PHASE2_SIGNUP_AUDIT.md`. Nothing rebuilt, no second
signup or login system.

---

## PART A — PHASE 2.3: signup recovery must not create duplicates

### A.1 Where the guarantees actually live

| Concern | Owner | Location |
|---|---|---|
| Double click | ref-backed single flight | `SignupScreen.tsx:84` `submitFlight = useRef(createSingleFlight())` |
| Network retry | Supabase Auth rejects the duplicate; the UI now routes to a recovery screen | `SignupScreen.tsx` error branch |
| Refresh | per-tab marker | `sessionStorage['nexora.onboarding.signup.pendingConfirmation']` |
| Auth user already created | GoTrue's unique index on `auth.users.email` | verified live: `422 user_already_exists` |
| Profile missing | `handle_new_user()` inserts | `20261003_signup_profile_fields.sql:93` |
| Profile already exists | `on conflict (id) do nothing` | `20261003_signup_profile_fields.sql:95` |
| Workspace partially provisioned | `ensure_owner_workspace()` | `20261002:255-460` |

### A.2 Results

| Case | Verdict | Evidence |
|---|---|---|
| **Double click** | ✅ one `signUp` | `loginAndSignupRecoveryBrowserFlow`: two `submit` events in one task → `calls.filter(signUp).length === 1`. `busy` alone cannot do this — both events read `busy === false` before the re-render. |
| **Network retry** | ⚠️ **was a dead end — fixed** | see A.3 |
| **Refresh** | ✅ | inbox screen restored from the marker (`onboardingSignupBrowserFlow`) |
| **Auth user already created** | ✅ no duplicate | live: second `signUp` → `422 {"error":"user_already_exists"}`; `profiles.full_name` stayed `Uma Rao`, and login with the attacker's password → `400` |
| **Profile missing** | ✅ created | `signupIdempotency` test 3, real trigger re-fired |
| **Profile already exists** | ✅ **not overwritten** | `signupIdempotency` test 2 |
| **Workspace partially provisioned** | ✅ completed in place | `signupIdempotency` tests 5-10 |

### A.3 The defect that was fixed: a retried signup stranded the owner

A retry whose first attempt actually landed gets `user_already_exists`. The
screen showed *"An account with this email already exists. Try logging in."* —
but with confirmation required the owner **cannot** log in yet, and the form
keeps rejecting them. Dead end.

Now `email-in-use` routes to the confirmation screen, which offers both a
resend and a "log in" path. Nothing is created: Supabase already refused the
second `signUp`, and the trigger is `on conflict (id) do nothing`.

**Positive control:** flipping `do nothing` to
`do update set full_name = excluded.full_name` makes test 2 fail with
`actual: 'ATTACKER NAME'` — so the assertion really detects an overwrite.

### A.4 Partial provisioning, exercised against real PostgreSQL

`tests/signupIdempotency.test.ts` (11 tests) drives `ensure_owner_workspace()`
through every half-built state:

| Starting state | Result |
|---|---|
| nothing | creates org + membership + salon, `reason=created` |
| 5 further calls | `reason=existing`, counts stay `1/1/1`, same `salon_id` |
| membership, **no salon** | salon created **in the same org** — never a second org |
| org + salon, membership `invited`/`staff` | promoted to `active`/`owner` in place, counts stay `1/1/1` |
| salon **soft-deleted** | a replacement salon in the same org |
| membership in a **shared tenant** | refused — a fresh workspace instead; the shared-tenant role is untouched |
| no profile row at all | falls back to `'My Salon'`, still idempotent |
| no session | raises `42501 Sign in required`, creates nothing |

The trigger is re-fired honestly, not called directly: a trigger function can
only run from a trigger, so the harness inserts into a `trigger_replay` table
carrying the columns `handle_new_user()` reads, which fires the real function
body with a real `NEW`.

---

## PART B — PHASE 3: login

### B.1 The existing flow (two paths, one authority)

| Path | Files |
|---|---|
| Onboarding funnel | `src/onboarding/screens/LoginScreen.tsx` → `signInWithEmail()` in `src/onboarding/lib/auth.ts` |
| Main app modal (owner dashboard + customer booking) | `src/components/AuthModal.tsx` |
| Shared session restore | `src/lib/restoreAuthSession.ts` `observeAuthSession()`, wired at `App.tsx:660` |
| Error mapping | `toSafeAuthError()` in `src/onboarding/lib/flow.ts` |
| Logout | `signOutViewer()` (`onboarding`), `supabase.auth.signOut()` at `App.tsx:1535` and `:1715` |

Both call `supabase.auth.signInWithPassword` and nothing else. `part1cSecurity`
C10 pins the shared client singleton; `loginFlow` now asserts `signInWithEmail`
contains no `signUp`, no `rpc`, no `.from(`.

### B.2 Checklist

| Item | Verdict | Evidence |
|---|---|---|
| email/password login | ✅ | live: `200` with `access_token` + `refresh_token`, `expires_in 604800` |
| session creation | ✅ | `signInWithEmail` **refuses a user with no session** — a user object is not a login |
| session refresh | ✅ | live: `grant_type=refresh_token` → `200`, new access token, **refresh token rotated** |
| `getSession`/`getUser` | ✅ | live `/auth/v1/user` → `200`. `observeAuthSession` has a revision guard: a stale failed read cannot log out an owner a newer event already signed in |
| wrong password | ✅ | live `400 invalid_grant / "Invalid login credentials"` → "Invalid email or password. Please try again." |
| invalid credentials | ✅ | a non-existent address returns the **identical** error — no enumeration |
| unverified email | ⚠️ **fixed** | live `400 email_not_confirmed / "Email not confirmed"`. The mapper only matched the spaced spelling; see B.4 |
| expired token | ⚠️ **fixed** | live `400 invalid_grant / "Invalid Refresh Token"` and `401 invalid_token / "Sign in required"`. Both fell through to "Login failed. Please try again."; see B.3 |
| network error | ✅ | `"Failed to fetch"` → "Network error…", and the retry succeeds (nothing latched) |
| rate limit | ✅ copy / ❓ enforcement | see B.5 |
| logout | ✅ | live `204`; the old refresh token then returns `invalid_grant` |
| login again | ✅ | live: same `user.id`, same single `profiles` row |
| **no reprovisioning** | ✅ | see B.6 |

### B.3 Fix 1 — an expired session was reported as a failed login

`toSafeAuthError` had no branch for expired/revoked tokens, so an owner whose
tab sat overnight got *"Login failed. Please try again."* and a form that
fails identically. They are now told *"Your session expired. Please sign in
again."* (`code: 'session'`), distinct from wrong-password.

### B.4 Fix 2 — error matching depended on which half of the response arrived

GoTrue returns **both** `error` (`email_not_confirmed`, `user_already_exists`)
and `error_description` (`Email not confirmed`, `User already registered`). The
JS client prefers the description, but when it is absent the code form reaches
the mapper — and every matcher was written against the spaced spelling, so
`email_not_confirmed` fell through to the generic message.

`toSafeAuthError` now matches a normalised `text` that contains both
spellings. Verified for 12 inputs, spaced and underscored, all mapping
correctly.

### B.5 Fix 3 — the main app modal

`AuthModal` was inconsistent with the funnel on four counts:

| | Before | After |
|---|---|---|
| Errors | `setError(err.message \|\| …)` — **raw GoTrue/Postgres text rendered to the customer** | `toSafeAuthError(err, …)` |
| Writes without a session | `setStoredAuthenticatedProfile` + `profiles.upsert` ran whenever `data.user` existed | gated on `data.session` |
| Double submit | `disabled={loading}` only (React state) | ref-backed `createSingleFlight` |
| Password length | uncapped | capped at `MAX_PASSWORD_LENGTH` (bcrypt truncates above 72) |

**Why the session gate matters.** With confirmation required, GoTrue answers a
duplicate-email `signUp` with the **existing** user and no session, and does not
say whether the address was taken. A user object is therefore not proof this
browser owns the account, so writing the form's values to the stored profile —
and upserting `profiles` — from an unauthenticated sign-up form could overwrite
an existing owner's details. `loginFlow` pins the ordering (guard before both
writes) and that the guard `return`s.

The same single-flight guard was added to `LoginScreen`, which had the identical
state-only bug that `SignupScreen` already had fixed.

### B.6 The invariant: logging in never reprovisions an existing account

Login is read-only. Verified three ways:

1. **Behavioural** — `loginFlow` records every call a fake client receives
   across login → logout → login-again: zero `rpc`, zero `table:*`, zero
   `signUp`.
2. **Structural** — `ensure_owner_workspace` has exactly one call site
   (`resolveOwnerWorkspace`), reached only from `TemplateHandoffPage` and from
   `saveOwnerEditorState`'s `42501` fallback. No login path reaches it.
3. **Live** — signup → logout → login → third login, then a duplicate signup:

```
login again -> id: acc0882c-…  same account: True
profiles    -> [{"full_name":"Uma Rao","phone_number":"+919845077654","owner_role":null}]
third login -> rows visible to owner: 1   (unchanged)
duplicate signUp -> HTTP 422 user_already_exists
full_name still: Uma Rao                  (the retry's "ATTACKER" name was not written)
login with the attacker password -> HTTP 400
ensure_owner_workspace -> created, then existing, same salon, salon_count=1
```

### B.7 Finding, not changed: logout is global

`supabase.auth.signOut()` defaults to `scope: 'global'`, and the live run
confirms the refresh token is revoked server-side — so logging out on one
device ends the session on every device. That is a defensible default for an
owner dashboard and it is what the current code intends, so it was left alone.
Switching to `{ scope: 'local' }` is a one-line change if per-device logout is
wanted.

---

## Verification

```
tsc --noEmit (5.8.3)   exit 0
npm test               1282 tests, 1279 pass, 0 fail, 3 skipped
npm run test:dom         62 tests,   62 pass, 0 fail
npm run build          OK, production artifact inspected
```

New test files:

| File | Tests | Covers |
|---|---|---|
| `tests/loginFlow.test.ts` | 18 | every checklist item, the session-restore revision guard, and the no-reprovisioning invariant (behavioural + source contract) |
| `tests/signupIdempotency.test.ts` | 11 | trigger idempotency and every partial-provisioning state, on real PostgreSQL |
| `tests/dom/loginAndSignupRecoveryBrowserFlow.test.ts` | 10 | double click, the recovery route, and each login error's rendered copy |

Also updated: `part1cSecurity` C13 (its `setTimeout`-specific assertion was
over-specified — it now pins the fabrication's *position* relative to the
refusal and the gate, with a positive control).

### Two test bugs found by running them, both in my own tests

* `templateHandoff.test.ts` scans browser sources for `/refresh_token|access_token\s*[:=]/i`. My new regex literal `refresh_token_not_found` tripped it. Removed — the underscore normalisation makes the literal unnecessary, and the comment that mentions it is stripped by the scanner.
* The `sessionStorage` pending-confirmation marker survives a mount by design, so three DOM tests inherited the first test's inbox screen until each cleared it.

### Not verified here, and why

* **Login rate limiting.** The local gateway does not rate-limit `/auth/v1/*`
  at all — the only `429` in this repository is in
  `server/referralAttribution.ts`. 34 consecutive password attempts all
  returned `400`. The client-side copy is verified; the actual limit is a
  GoTrue project setting and cannot be exercised against PGlite.
* **The GoTrue duplicate-signup response shape.** Real GoTrue returns the
  existing user with no session when confirmation is required; the local
  gateway returns `422 user_already_exists`. The `AuthModal` session gate is
  correct under both, which is why it was fixed by gating rather than by
  pattern-matching one response shape.
* **Email confirmation itself** — the gateway sends no mail and has no
  `/auth/v1/verify`, so the confirm *click* is unexercisable.
* **Applying `20261002` + `20261003` to the live project** — no credentials in
  this sandbox.

---

## PART C — PHASE 3.1: login routing

### C.1 The defect

A successful login left every owner on the same screen. Concretely:

* `App.tsx:243` starts at `currentView = 'landing'`;
* `TemplateHandoffPage.tsx:182` ends the handoff with an unconditional
  `navigate('/')`;
* `AuthModal`'s success handler is `onSuccess={(u) => setUser(u)}` — it sets the
  user and nothing else;
* and **every one of the 22 `setCurrentView` call sites in `App.tsx` was a user
  click** (`onBackToDashboard`, `onExploreSalons`, `LandingPage`…). No effect
  consulted the owner's state. (There are 23 now; `App.tsx:722` is the one
  state-driven call this phase added.)

So an owner who had already published a website saw the marketing landing page,
and an owner who had never built anything saw exactly the same thing.

The only state-based decision anywhere was `handleBuildWebsiteClick`, and it
read `localStorage[ONBOARDING_COMPLETED_KEY]` — per-device. On a new phone that
says "not completed" for an owner who published last week.

### C.2 The fix

New module `src/lib/ownerEntryRoute.ts`. Three pieces:

| Export | Role |
|---|---|
| `readOwnerEntryFacts(client)` | four **read-only** queries for the owner's state |
| `classifyOwnerEntry(facts)` | the state, from the matrix below |
| `decideOwnerEntry({path, alreadyRouted, facts})` | the whole decision, including *when* it is allowed to move anybody |

`App.tsx` only does the plumbing: read the facts once per `user.id`, ask the
decider, apply the answer.

### C.3 The state matrix

Most blocking first — the owner is sent to the earliest unfinished thing.

| State | Stage | View | Wizard step |
|---|---|---|---|
| No `profiles` row | `no-profile` | `wizard` | 1 (choose) |
| Profile, no workspace | `no-workspace` | `wizard` | 1 |
| Several salons, none chosen | `workspace-ambiguous` | **no move** | — |
| Workspace, onboarding unfinished | `onboarding-incomplete` | `wizard` | 1 |
| Template chosen, nothing saved | `template-selected` | `wizard` | 2 (customise) |
| Editor state saved | `editor-started` | `wizard` | 2 |
| `template_completed` | `published` | `dashboard` | — |
| State unreadable | `unknown` | **no move** | — |

No new screen is introduced — `wizard`, `dashboard` and `landing` are existing
`AppView` values, and the wizard step split is the one `handleSelectCategory`
already uses.

Two deliberate choices:

* **`published` → `dashboard`, not `preview`.** The landing page already offers
  "build website" → preview; a published owner logging in is managing a
  business, not shopping for a template.
* **Ambiguous or unreadable → no move.** A wrong guess is worse than the
  landing page, because it moves somebody off a screen they chose. The
  ambiguous-salon decision belongs to `saveOwnerEditorState`, which already
  names the candidates when the owner next saves.

### C.4 Three rules it must not break

1. **Read-only.** Routing is a consequence of logging in, not a state change,
   so it calls `get_my_owner_workspace()` — declared `stable` at
   `20261002:485` — and never `ensure_owner_workspace()`. The provisioning
   boundary stays exactly where PART 3 put it: the handoff exchange, and the
   `42501` save fallback. `tests/ownerEntryRoute.test.ts` asserts the reader
   issues exactly four reads and that neither `App.tsx` nor
   `ownerEntryRoute.ts` mentions `ensure_owner_workspace`.

2. **Once per owner, entry point only.** Keyed on `user.id`, and it acts only
   while the URL is `/`. A deep link (`/my-bookings`, `/partner/dashboard`,
   `/customer/booking/:id`) and any deliberate navigation are left alone, and a
   token refresh cannot yank the owner off a screen they navigated to.

3. **A failed read is not a fact.** The first draft of this module used
   `hasProfile: false` for both "no row" and "the read failed", which would
   have sent an owner with a perfectly good account into the setup wizard
   because one request failed. `profileReadOk` now separates the two, and an
   unreadable profile classifies as `unknown` — no move. The live run below
   exercises exactly that path.

### C.5 Verification

`tests/ownerEntryRoute.test.ts` (19 tests) — the matrix, the ordering rules
(completion beats a half-filled editor; a missing profile outranks everything),
the pre-`20261002` fallback, every "no move" case, the deep-link and
already-routed rules, the reader's four reads, and two positive controls: a
genuine permission error must **not** be excused as "old database", and the
`localStorage` fallback must sit **after** the backend stage.

Then the **real shipped functions** over real HTTP against the local gateway:

```
A: fresh signup                 stage=no-workspace profile=yes workspace=missing onboarding=not_started
                                  -> view=wizard step=1
B: after workspace provisioning stage=onboarding-incomplete profile=yes workspace=resolved
                                  -> view=wizard step=1
B on /my-bookings                 -> view=(no move) skip=deep-link
C: signed out (anon key only)   stage=unknown profile=unread onboarding=unread
                                  -> view=(no move) skip=no-confident-answer
```

Case C is the `profileReadOk` guard working under real conditions: with no
session the `profiles` read is refused, and the owner is not moved.

`editor-started` and `published` are covered by the matrix rather than live,
because `20260909045308_contact_profile_wiring.sql` (which defines
`get_owner_editor_state`) is not in `LOCAL_GROWTH_CHAIN`. The classifier's
fallback for that gap is itself tested: `template_started` with no readable
editor state still classifies as `editor-started` at step 2.

```
tsc --noEmit (5.8.3)   exit 0
npm test               1301 tests, 1298 pass, 0 fail, 3 skipped
npm run test:dom         62 tests,   62 pass, 0 fail
npm run build          OK, routing present in the production bundle
```

### C.6 Two things noticed and left alone

* **`admin@nexora.local` gets `42501` reading `profiles`** where a normally
  signed-up owner gets their row. The bootstrap admin is created directly in
  `auth.users` with no `profiles` row; under `id = auth.uid()` a SELECT should
  return `[]`, not a permission error. Local-dev only — the owner path is
  correct — so it is reported, not fixed. With `profileReadOk` the app's
  behaviour is the safe one either way: no move.
* **`TemplateHandoffPage` still calls `resolveOwnerWorkspace`** (which
  provisions) before `navigate('/')`. That is correct and unchanged: the
  handoff *is* the provisioning boundary. The routing added here runs after it
  and only reads.
