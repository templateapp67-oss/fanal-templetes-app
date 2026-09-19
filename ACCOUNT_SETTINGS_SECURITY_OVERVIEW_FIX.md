# Fix: "Could not load your security overview. Please retry." on `/partner/account-settings`

**Symptom.** The Account Settings page showed the error
`Could not load your security overview. Please retry.` and nothing else — no
Change Email, no Change Password, no 2FA, no Sessions, no Danger Zone. Pressing
**Retry** re-ran the same doomed fetch and the page stayed empty.

## 1. The component and the call

| | |
|---|---|
| Route | `/partner/account-settings` |
| Page component | `src/components/PartnerAccountSettingsPage.tsx` (`PartnerAccountSettingsPage`, rendered by `GrowthPartnerPage` for the `account-settings` section) |
| Data layer | `src/lib/partnerAccountSecurity.ts` → `fetchPartnerSecurityOverview()` |
| The one network call | `supabase.rpc('get_my_partner_security_overview')` (no arguments; the partner is derived from `auth.uid()` server-side) |
| Backend | `supabase/migrations/20260919130000_partner_account_security_settings.sql` |

The overview is **one of four** things the page renders. The other three —
Change Email, Change Password, 2FA enrollment, and the Danger Zone — talk to
Supabase Auth or their own RPCs and never needed it.

## 2. Why the whole page disappeared (the UI defect)

The page ended with an all-or-nothing gate:

```tsx
if (loading) return <PartnerLoading … />;
if (!overview) return <error card with Retry />;   // ← the whole route
```

So a single failed read unmounted every section. Three more state defects made
it worse:

1. **Silent stale data** — a refresh that failed *after* a successful load set
   `loadError`, but the JSX only rendered the error when `overview` was null,
   so the page kept showing old rows with no indication anything was wrong.
2. **Refresh remounted the route** — the effect called `setLoading(true)` on
   every refresh, and `if (loading)` returned the loader, so *every* save
   (password change, 2FA toggle, session revocation, deactivation) blanked the
   page and reset each section's local state (the old Danger Zone test even
   depended on that remount to collapse the panel).
3. **Unstable effect input / stuck spinner** — `resolvedClient` was an effect
   dependency (any inline client object re-fetched on every render), and the
   `cancelled` early-return skipped `setLoading(false)`, which could strand the
   page on "Loading…".

## 3. Why the call itself failed (the backend cause)

The SQL is correct — `tests/partnerAccountSettingsBackend.test.ts` exercises
`get_my_partner_security_overview` against the real migration chain on PGlite
and passes. The failure is environmental, and one of the causes is a genuine
migration bug:

**`20260919130000_partner_account_security_settings.sql` creates five RPCs but
never reloads PostgREST's schema cache.** Its neighbours do
(`20260911094853`, `20260911101201`, `20260919120000` … all end with
`notify pgrst, 'reload schema';`). PostgREST caches the schema at startup, so on
a project where this migration was applied while PostgREST was already running,
the browser's `rpc('get_my_partner_security_overview')` is answered with

```
PGRST202  Could not find the function public.get_my_partner_security_overview()
          in the schema cache
```

…until the cache expires or somebody reloads it by hand. That is exactly the
text behind the generic "Could not load your security overview" message, and
why pressing Retry never helped. Fixed by
`supabase/migrations/20260919130100_reload_postgrest_schema_partner_security.sql`
(registered in `LOCAL_GROWTH_CHAIN`).

The other three causes, verified against the running local gateway
(`curl` against `/rest/v1/rpc/…`):

| Cause | What the browser gets | New UI copy |
|---|---|---|
| Migration not applied / stale schema cache | `PGRST202` (404) | "The security overview is not available on this project yet — the account security functions are not installed." |
| Caller is not an **active** partner (pending / rejected / deactivated application) | `42501` (403) | "Security details are unavailable because your partner account is not active." |
| No usable JWT (signed out / expired) | `PGRST301`, 401 | "Your session expired. Please sign in again." |
| Transport blip | `fetch failed`, timeouts | "Network error. Check your connection and try again." + **one automatic retry** |

Run `npm run diagnose:partner-security` to see, for any environment, which of
these it is: it checks the tables, the six security RPCs and (locally) the real
call as an active partner, and prints the remediation next to each failure.

## 4. The fix

| File | Change |
|---|---|
| `src/lib/partnerAccountSecurity.ts` | `classifySecurityOverviewFailure()` maps any rejection to a typed `PartnerSecurityOverviewError` (`session` / `forbidden` / `unavailable` / `network` / `unknown`) with reviewed copy — raw Postgres text never ships. `fetchPartnerSecurityOverviewWithRetry()` retries transport failures (3 attempts, 400 ms → 1200 ms) and refuses to hammer missing functions or authorization refusals. |
| `src/lib/usePartnerSecurityOverview.ts` *(new)* | The read as React state: newest-request-wins (request-id + unmount guard), `loading` only for the very first load, `error` always surfaced (never silent staleness), a manual `retry()` that counts attempts, and the client read through a ref so an injected object literal cannot restart the fetch on every render. |
| `src/components/PartnerSectionErrorBoundary.tsx` *(new)* | A class-component error boundary (React has no hook equivalent) so a render-time throw in one card shows a fallback for that card instead of blanking the route. |
| `src/components/PartnerAccountSettingsPage.tsx` | The route no longer has an all-or-nothing gate. Only the first load owns the page; afterwards a failed read degrades the security sections only. Adds the classified error card with a working **Retry** (`data-account-action="retry-security-overview"`), three-state 2FA (`on` / `off` / **unknown** — an unreadable status is never shown as "2FA off"), "could not be loaded" states for Sessions and the Security Log, and per-section error boundaries. |
| `supabase/migrations/20260919130100_reload_postgrest_schema_partner_security.sql` *(new)* | `notify pgrst, 'reload schema';` after the security migration (registered in `LOCAL_GROWTH_CHAIN`). |
| `scripts/diagnose-partner-security-overview.mjs` *(new)* | `npm run diagnose:partner-security` — the four-cause diagnostic described above. |
| `tests/dom/partnerAccountSettingsSecurityFailure.test.ts` *(new)* | Four browser-level tests: the page keeps working when the read fails, a refusal is classified, **Retry re-fetches and the page heals**, and a transient failure is retried automatically. |
| `tests/partnerAccountSecurity.test.ts` | Classification table (eight causes → kind + retryability + "no raw text") and the retry policy (retries blips, one attempt for refusals, aborts cleanly). |
| `tests/dom/partnerAccountSettingsBrowserFlow.test.ts` | Updated the Danger Zone assertion: a refresh no longer remounts the page, so the open panel stays open and offers the request action again immediately. |

### Verifying by hand

```bash
VITE_LOCAL_SUPABASE=true npm run dev      # http://localhost:3000
```

1. Sign in at `/partner/login` (the seeded local gateway has an approved demo
   partner: `demo.partner@example.com` / `Partner#12345`; admin review account
   `admin@nexora.local` / `Admin#12345`).
2. Open **Account Settings** — sessions, security log, 2FA and the danger zone
   render.
3. To see the degraded path: stop the gateway (or sign out in another tab so the
   session is gone) and reload. The page still renders Change Email and Change
   Password, the error card names the cause, and **Retry** restores the security
   sections when the backend answers again.

## 5. Notes and follow-ups

* `npm run lint` (`tsc --noEmit`) is clean. `tests/partnerAccountSecurity*`,
  `tests/dom/partnerAccountSettings*` and `tests/growthPartnerPage.test.ts`
  all pass (20 + 5 + 22 assertions groups respectively).
* `npm run test:partner` has **6 pre-existing failures** in the onboarding /
  referral journey DOM tests (`onboardingJourneyBrowserFlow`,
  `part3GrowthPartnerJourneyBrowserFlow`, `partnerExistingReferralBrowserFlow`,
  `partnerFinalAcceptance`, `referralAttributionPersistence`,
  `resumeOnboardingBrowserFlow`). They fail identically on the untouched base
  commit `709b2df`, so they are out of scope here.
* The repo builds without `@types/react`, so a class component cannot see its
  inherited `props` / `setState` (the existing `src/main.tsx` boundary works
  around this with `props: any`). `PartnerSectionErrorBoundary` declares them
  explicitly for the same reason. Adding `@types/react@19` would fix this
  properly but surfaces 43 pre-existing type errors elsewhere — a worthwhile
  separate change.
