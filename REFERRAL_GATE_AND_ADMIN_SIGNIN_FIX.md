# Fix: /admin dead Sign in button (regression) + /onboarding/referral referral-gate trap

Two user-visible failures on the Vercel deployment, fixed together in one branch.

---

## 1. `/admin` — the "Nexora Admin" sign-in card did nothing when clicked

**What the user saw:** the staff sign-in card whose **Sign in** button set state
that mounted nothing. An anonymous staff member could never reach the panel.

**Root cause:** this is the exact bug PR #148 fixed. PR #149 reverted #148
wholesale (`git revert -m 1`), which silently brought the dead button back.

**Fix (re-applies #148's product code):**
- `src/App.tsx` — render `<AuthModal purpose="admin">` inside the `isAdmin`
  early-return branch, so the card's `onRequireAuth` actually mounts a modal.
- `src/components/AuthModal.tsx` — new `purpose="admin"`: staff copy, login-only
  (staff accounts come from Super Admin onboarding links), and never writes
  salon-owner profile state (`isOwner` gates replace the old `!isCustomer`).
- `tests/dom/adminSignInBrowserFlow.test.ts` — restored: mounts the REAL App at
  `/admin`, clicks Sign in, signs in, and proves the Super Admin shell renders.
- `scripts/dev-preview.mjs` + `npm run dev:preview` — restored one-command
  offline preview (writes a local-gateway `.env` when absent, installs deps,
  starts the dev server).

Verified: sign in at `/admin` with the seeded gateway account
(`admin@nexora.local`) opens the Super Admin shell.

## 2. `/onboarding/referral` — "Enter Referral Code" was a dead end

**What the user saw:** a signed-in account with no linked referral was stranded
on the referral-code form with exactly two exits: link a code or sign out. Any
organically created account (no partner code), returning owner or staff member
hit this wall on every `/onboarding/*` visit.

**Fix — the gate is a funnel step, not a trap:**
- `ReferralScreen` gained **"Continue without a referral"** (`onSkip`), always
  visible, so no account is ever stranded again.
- `OnboardingApp` remembers the dismissal per browser
  (`localStorage`, key `nexora_referral_gate_dismissed`): after skipping, this
  browser lands on the **status screen** instead of the gate — including on
  refresh and later visits. A successfully linked code retires the flag.
- `StatusScreen` gained an honest **pending** variant ("Your account is ready."
  / "No referral code is linked yet." — never fake "linked" copy) plus a
  **"Link a referral code"** button that reopens the form, so the skip is a
  reversible choice, not a one-way door.

The referral funnel itself is unchanged for owners who HAVE a code: share-link
prefill, server validation and attribution all behave exactly as before.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (same command Vercel runs).
- New suites: `tests/dom/referralSkipBrowserFlow.test.ts` (4),
  `tests/dom/referralGateSkipJourney.test.ts` (2 — full OnboardingApp skip →
  status → refresh → link-a-code journey), restored
  `tests/dom/adminSignInBrowserFlow.test.ts` (1). All pass.
- Deploy-guard set (62 tests) and the auth/Autofill DOM suites (60) pass.
- 4 pre-existing stale expectations in `tests/onboardingApp.test.ts` were
  aligned with the current implementation (optional phone, current safe-error
  copy, 64-hex capability metadata, the Phase-4 referral field on signup);
  that file now passes 33/33.
- The 7 source-scan failures in `part1SharedBackend`/`part1cSecurity` and the
  jsdom-redirect failure in `onboardingJourneyBrowserFlow` fail identically on
  pristine `main` — pre-existing, untouched by this branch.
