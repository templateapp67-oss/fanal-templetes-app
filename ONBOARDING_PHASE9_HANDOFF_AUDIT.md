# PHASE 9 — SECURE HANDOFF / SECURE CONTINUATION

Branch `arena/01a09e6f-fanal-templetes-app`. Everything below is read out of the
current tree or executed by `tests/secureContinuation.test.ts` (new, 7 tests) and
the existing `tests/templateHandoff.test.ts` (30 tests) against real PostgreSQL
built from the committed migrations.

## The verdict, up front

**1. What "handoff" is here.** This repository *is* both applications. The
Onboarding App (`src/onboarding/*`) and the Template App (`src/App.tsx` + the
editor) are the same codebase, and **one origin by default** —
`.env.example:56-72` says it in as many words: *"LEAVE THIS EMPTY for the default
single deployment. When it is empty the handoff uses the CURRENT ORIGIN… Set it
ONLY for a genuine split deployment, where the Onboarding App and the Template
App are two separate hosts that both serve this same codebase."*

**2. Therefore 9.1 governs the product as deployed: no new token was created in
this phase, and none is needed.** Authenticated session → referral attribution
verified → owner workspace resolved → correct template/editor route is exactly
what the code already does, with identity coming from `auth.uid()` on every step
(9.1b: none of the eight entry points even *has* an identity parameter).

**3. 9.2's mechanism already exists and already meets all eight requirements.**
When the split deployment is switched on, the cross-origin transfer uses
`20260913_template_handoff.sql` — short-lived (5 min), single-use (atomic),
server-validated, cryptographically random (64 hex from `gen_random_uuid()`,
hash-only storage), bound to the user *and* to the live referral, replay-
protected, and rejected after expiry. It was **audited, not rewritten**: no new
system, and no change to the existing one.

**4. One finding worth acting on, outside the onboarding path.** The repo-wide
"never trust `?userId= ?email= ?ownerId= ?salonId=`" sweep found exactly one
place that treats a query parameter as a tenant selector without authentication:
`resolveOwnerScope()` (and the check-in handler's copy of it) in the **legacy,
non-normalized** booking generation. It is **unreachable in this deployment**
(`server.ts` hard-wires `normalizedBookings: true` at all three call sites, and
the normalized handlers authenticate from the bearer token first), but it is dead
code whose safety depends on that flag. Recommendation in PART D.

---

## PART A — "Handoff", candidate by candidate

| Candidate meaning in the brief | In this repo | Mechanism |
|---|---|---|
| auth screen → template selection | **exists**, one origin | `SignupScreen`/`LoginScreen` → `StatusScreen` (referral + progress) → the editor's wizard, `wizardStartingStep` 1 → 2. Session only; no token. |
| partner referral landing → signup | **exists** | `/onboarding/signup?ref=CODE`; an anonymous visitor's click is captured server-side into `growth_referral_attributions` + an HttpOnly cookie (`20260922`). Attribution — never identity. |
| signup → business setup | **exists** | The business details *are* the editor save: `save_owner_editor_state()` → `nexora_save_owner_workspace()` writes `owner_editor_state.state.profile`, `salons.name/data.editor_profile`, `profiles` contacts (PHASE 8 PART A). |
| business setup → template editor | **exists** | `TemplateHandoffPage` → exchange → `resolveOwnerWorkspace()` → editor. This is the "handoff" the Phase 4 code means. |
| main/onboarding route → editor route | **exists** | `src/lib/router.ts` paths + `src/lib/ownerEntryRoute.ts` (login routing by backend stage; PHASE 8 PART D). Session only. |
| separate deployed origin → Template App | **opt-in only** | `VITE_TEMPLATE_APP_URL` (empty by default ⇒ current origin). Split mode: two hosts serving this same codebase and the same Supabase project. The shipped deployment is single-origin — see PART B0. |

So of the six candidates, five are same-origin continuations and only the last is
a genuine cross-origin transfer — and it is off unless an operator turns it on.

## PART B0 — production topology: one deployment, one origin

The 9.1-vs-9.2 decision turns on whether production really moves users between
origins, so it was checked against the deployment configuration rather than
inferred from the code defaults (now pinned by test 9.1d):

| Evidence | What it shows |
|---|---|
| `vercel.json` | **One** project: `buildCommand: "vite build"`, `outputDirectory: "dist"`, and exactly **two** rewrites — `/api/(.*)` → `/api/index.ts` (the one serverless entry) and `/(.*)` → `/index.html` (the SPA fallback). No rewrite destination is an absolute or protocol-relative URL, i.e. no request path leaves the origin. |
| one app root | A single `index.html` (`<div id="root">`), a single `package.json` with **no** `workspaces`, and one client build. A split deployment would have to appear here first (a second app root, a second build, a second Vercel project). |
| one bundle | `src/App.tsx` imports `./onboarding/OnboardingApp` and `./components/TemplateHandoffPage` and renders the handoff route before the onboarding surface — both surfaces are branches of the same SPA, so `/onboarding/handoff` and the editor are the same origin by construction. |
| operator documentation | `ARCHITECTURE.md:121` lists `VITE_TEMPLATE_APP_URL` as *"same deployment default"*; `:145-147` instructs the deployer to use *"SPA rewrites (already in `vercel.json`), serverless `/api` entry (`api/index.ts`)"* — one project, and the split env var is not part of the required checklist. |

Conclusion: in the architecture as shipped, **9.1 is the production path** and
the cross-origin mechanism is dormant configuration — so adding a second token
system would be exactly the redundancy the brief forbids.


The required flow, and where each step is enforced:

```
Authenticated user            Supabase Auth session (GoTrue). Every RPC below derives the caller
                              from auth.uid(); there is no user-id parameter to pass.
        ↓
Referral attribution verified growth_onboarding.growth_partner_id, written by the signup consume
                              trigger or link_my_growth_referral(); read by get_my_onboarding_status().
                              create_template_handoff() REFUSES without it (9.1c).
        ↓
Owner workspace resolved      get_my_owner_workspace() / ensure_owner_workspace() — derived live from
                              organization_members(role,status) + salons(deleted_at is null).
                              The save path's own retry (ownerEditorState.ts) is the only provisioner.
        ↓
Correct template/editor route ownerEntryView(ownerEntryStage) → wizard step 2 / dashboard / preview.
```

New evidence (`tests/secureContinuation.test.ts`):

* **9.1a** — a referred owner with a resolved workspace reaches the editor
  through session-scoped reads only, and the same-origin continuation **creates
  no `template_handoffs` row at all** (count = 0). The handoff route is the
  Template App's own route in the same bundle (`App.tsx` matches it before the
  onboarding surface — pinned again here).
* **9.1b** — the eight entry points and their real signatures:
  `get_my_onboarding_status()`, `get_my_owner_workspace()`,
  `ensure_owner_workspace()`, `get_owner_editor_state()`,
  `complete_template_onboarding()` — no arguments at all;
  `save_owner_editor_state(p_state jsonb)`, `create_template_handoff(p_state text)`,
  `exchange_template_handoff(p_token text)` — the only arguments are the state
  and the token. Passing a user/owner id is not merely refused, it is
  **inexpressible** (`function does not exist`), which is asserted.
* **9.1c** — the gates are backend state: an unlinked owner is refused entry
  ("A verified referral is required…"), and a linked owner with no workspace
  cannot save into a workspace that does not exist ("Select a salon owned by this
  account") until `ensure_owner_workspace()` has run. No URL value influences
  either outcome.

For completeness, the two same-origin surfaces that *do* read the query string
are both non-authoritative: `?ref=`/`?code=`/`?referral=` selects which code to
capture (attribution), and `?site=`/`?subdomain=`/`?tenant=` selects a **public**
tenant view through `/api/site/:sub`. The editor UI itself is reachable without a
session, but every read and write behind it is not: `autoSave` deliberately
degrades to a local draft when unauthenticated, and every RPC requires
`auth.uid()`. Nothing in this path is granted by a URL.

## PART C — 9.2: the existing cross-origin mechanism, audited

`public.template_handoffs` + `create_template_handoff()` /
`exchange_template_handoff()` (`20260913_template_handoff.sql`).

| Requirement | How it is met | Evidence |
|---|---|---|
| short-lived | `expires_at = now() + interval '5 minutes'`, set server-side at mint | `20260913:144-148`, rejected at `:215-218`; handoff suite “expired tokens are rejected with the recovery message” |
| single-use | `consumed_at` + atomic `select … for update` then a conditional `update … where consumed_at is null` with a `row_count` check; racers cannot both win | `20260913:242-250`; handoff suite “consumed tokens are rejected and never reusable”, “the same token cannot be consumed twice, even concurrently” |
| server validated | redemption re-checks owner, destination, consumed, expiry, account existence, GoTrue ban and the *live* referral match; the client cannot supply or skip any of it | `20260913:203-240`; handoff suite cross-user / banned / wrong-destination tests |
| cryptographically secure | 64 lowercase hex from two UUIDv4 values (`md5(gen_random_uuid())` ×2) — 244 bits of Postgres CSPRNG; never derived from ids, timestamps or codes | `20260913:144`; handoff suite “no long-lived credentials ever enter the handoff URL”, “handoff state is unpredictable…” |
| bound to expected user | the row carries `user_id`; redemption requires `v_row.user_id = auth.uid()`; a wrong user gets the *same* message as a bad token (no oracle) and the grant is **not** burned | `20260913:205-208`; handoff suite “cross-user handoff is impossible and does not burn the grant” |
| bound to destination | `destination` column, checked against `'template-app'`; a row with another value is refused | handoff suite “a wrong destination is rejected” |
| replay protected | consumed rows are never re-usable; a new mint **supersedes** the caller's live grants (single active row per user); the hash is unique (`template_handoffs_token_hash_key`) | `20260913:141-142` (supersede), `:79` (unique hash index) |
| expires automatically | an expired token is rejected at redemption regardless of anything else; `purge_expired_template_handoffs()` deletes rows expired by more than a day (admin-only housekeeping) | `20260913:215-218`, `:280` |

What this phase adds to that record (`tests/secureContinuation.test.ts`):

* **9.2a — it is a continuation grant, not a session.** The redemption response
  carries exactly `{user_id, referral_code, growth_partner_id,
  onboarding_status, template_started_at}` — no access token, refresh token,
  JWT, password or key anywhere in it or in the stored row (`eyJ` absent). A
  token cannot be presented as a credential: `anon` cannot even call the
  workspace RPCs, and there is no RPC that accepts a token as an identity.
  This is why nothing here needs to "trust" the token beyond the one exchange —
  the destination origin still needs its **own** session, which is what
  `auth.uid()` reads.
* **9.2b — identity query parameters stay inert end to end.** `?token=…&state=…`
  plus `?userId= ?email= ?ownerId= ?salonId= ?partner_id=` parses to exactly
  `{token, state}`; extra arguments to the RPC cannot even be written; a bad
  token fails identically with or without them; the page reads nothing else from
  the query and never touches `localStorage`. (`stripHandoffQuery` removes
  `token`/`state` after use and deliberately leaves unrelated params alone —
  they are inert, and the token is gone.) The existing suite already pins the
  parser half of this at `tests/templateHandoff.test.ts` “handoff routes parse
  per the existing router conventions”.
* **9.2d — the split switch is opt-in and identity-free.** Same-origin default
  (`if (fromEnv) return normalizeBaseUrl(fromEnv)` … else current origin), the
  env value is `http(s)`-validated so a misconfiguration cannot become an open
  redirector, the built URL contains exactly `token` and `state`, and the URL
  builder mentions no identity field. One `createTemplateHandoff(` call site
  exists in the whole client (the status screen's continue action).

**Recorded, not changed** (both are properties, not defects):

1. In split mode the destination origin must already hold a session for the
   exchange to succeed; the token cannot bootstrap one. The `state` anti-CSRF
   value is per-origin `sessionStorage`, so across origins the check degrades to
   "unknown" — which `.env.example` warns about explicitly. The real protection
   is server-side and unaffected: the token only redeems for the account it was
   minted for.
2. `purge_expired_template_handoffs()` is admin-only housekeeping, not a
   scheduled job. Expired rows linger until an operator (or cron) runs it, and
   can never be redeemed in the meantime. Scheduling it is a one-line ops
   decision, not a security fix.

## PART D — the repo-wide identity-parameter sweep

Every query-string identity read in the tree, and what it actually authorizes:

| Parameter | Where | Verdict |
|---|---|---|
| `?owner_id=` `?email=` `?subdomain=` | `server/ownerBookings.ts:31` — checked **against** the bearer token (`req.query.owner_id !== userId` ⇒ **403**), `?subdomain` only narrows salons the caller already has an active membership in | **Not trusted.** Identity comes from `db.auth.getUser(token)`; a missing token is a 401. Pinned in 9.2c. |
| `?owner_id=` `?email=` `?subdomain=` | `server/bookingCheckin.ts` legacy branch (line 330+) | Never reached: `verifyBackendUser()` runs at the top of the normalized branch, before any query read (`indexOf` order asserted in 9.2c). |
| `?owner_id=` `?email=` `?subdomain=` | `server/bookingRoutes.ts` → `resolveOwnerScope()` (line 84) in `createBookingsListHandler` | **The finding.** In the legacy generation this function selects the tenant from the query string with no authentication, and the handler then lists that tenant's bookings on a service-role client. Unreachable today: the handler returns inside `if (deps.normalizedBookings)` first, and `server.ts` sets `normalizedBookings: true` in all **three** wirings (asserted: 3 × `true`, 0 × `false`). |
| `?token=` `?state=` | handoff route | The token is a single-use grant, `state` is anti-CSRF. Neither is a credential (9.2a). |
| `?ref=` `?code=` `?referral=` | `src/lib/referralQuery.ts` | Attribution only, and the *first* present parameter decides, so a link cannot be silently re-attributed (PHASE 6 lock). |
| `?site=` `?subdomain=` `?tenant=` `?view=public` | `src/App.tsx:533-570` | Public tenant read through `/api/site/:sub`; a live API's `found:false` is authoritative and the app renders rather than fabricating a site. No owner authority. |
| `?userId=` `?user_id=` `?partner_id=` `?salon_id=` | — | **Nowhere.** Not read by any client or server path; the handoff parser ignores them; the RPC surface has nowhere to put them. |
| `?tab=` | `MyBookingsPage` | UI state only. |

**Recommendation (not applied here):** delete `resolveOwnerScope()` and the
check-in handler's query-param fallback, or authenticate them the way
`loadOwnerBookings()` does (token first, then treat the parameter as a filter
that must agree). Until then, the guarantee is "unreachable by configuration",
which a single flag flip would end. This is a bookings-surface change outside
this phase's brief, so it is reported rather than made.

## PART E — Change list

| File | Change |
|---|---|
| `tests/secureContinuation.test.ts` (new, 8 tests) | 9.1a-d (session-only continuation, "no identity parameter exists", backend gates, and the single-deployment topology check), 9.2a-d (not-a-session, inert query params, repo-wide sweep, opt-in split switch) — on the full chain (live-schema fixture + the whole committed growth chain + PART 3 + the owner-state migrations) |
| `ONBOARDING_PHASE9_HANDOFF_AUDIT.md` (new) | this report |

**No production file was modified. No migration was added. No token system was
introduced, and the existing one was not changed** — the audit found it already
satisfies every requirement in 9.2, and 9.1 forbids adding a second mechanism
where the same-origin session already does the work.

## PART F — Verification

```
tsc --noEmit (5.8.3)   exit 0
npm run build          exit 0
npx tsx --test tests/secureContinuation.test.ts    8 tests, 8 pass, 0 fail   (~3.3s)
npx tsx --test tests/templateHandoff.test.ts      (unchanged, still green)
npm test               1394 tests, 1391 pass, 0 fail, 3 skipped   (was 1386)
npm run test:dom         70 tests,   70 pass, 0 fail
npm run test:partner    451 tests,  451 pass, 0 fail
```

### Where each 9.2 requirement is proven

Existing (unchanged, `tests/templateHandoff.test.ts`): mint/redeem lifecycle,
referral gating, single-active grant, invalid/expired/consumed tokens, concurrent
double-redemption, wrong destination, cross-user rejection without burning the
grant, banned accounts, `template_started` recorded exactly once, no regression
for owners already past entry, RPC-only table access, URL credential hygiene,
URL cleanup, CORS, no privileged key in browser code.

Added by this phase (`tests/secureContinuation.test.ts`): production is one
deployment (one build, one SPA, one API entry, no external rewrite), so 9.1 is
the shipped path; the same-app continuation needs no token and creates none; no identity parameter exists on the
continuation surface; the redemption is not a session and mints no credential;
identity query parameters are inert; the split-deployment switch is opt-in and
identity-free; and the repo-wide sweep with the legacy-branch finding.
