# Growth Partner application submission — "Application failed. Please try again."

**Surface:** `/partner/dashboard` → *Become a Growth Partner* (and the
`/growth-partner/login` → *Apply as a Growth Partner* sign-up form).
**Symptom:** submitting Full Name / Phone / KYC Document Type / KYC Reference
Number always ended in one generic sentence, `Application failed. Please try
again.`, whatever the real problem was.

This document is the diagnosis, the fix, and the exact SQL to apply.

---

## 1. Diagnosis — reproduced against the real migrations

`node --import tsx scripts/reproduce-partner-application-error.mjs` boots the
local Supabase-compatible gateway (PGlite + the committed migrations), signs a
user up over real HTTP and drives the **real** frontend submission function
through `@supabase/supabase-js`. Result before the fix:

```
✅ 1. valid application (aadhaar, 12 digits / phone, 10 digits)
✅ 2. duplicate submission by the same user          ← silently overwritten
✅ 3. another user reusing a registered Aadhaar       ← accepted
✅ 4. malformed Aadhaar (11 digits)                  ← accepted and stored
✅ 5. malformed phone (5 digits)                     ← accepted and stored
❌ 6. submission with no session                     → "Application failed. Please try again."
❌ 7. backend object absent (migration not applied)  → "Application failed. Please try again."
❌ 8. network failure                                → "Application failed. Please try again."

3 of 3 failure(s) are hidden behind "Application failed. Please try again."
```

Five defects, all in the same code path:

| # | Defect | Where |
| --- | --- | --- |
| 1 | **No validation at all.** The form sent whatever was typed; the RPC accepted anything non-empty. An 11-digit "Aadhaar" number and a 5-digit phone number were stored. | `src/components/PartnerPortalLogin.tsx`, `src/lib/growthPartnerLogin.ts`, `submit_growth_partner_application` |
| 2 | **Every error was replaced by one sentence.** The RPC's real answer (`22023 Invalid Aadhaar…`, `42501 Sign in required`, `PGRST202`, a fetch failure) was discarded twice — once in the client, once in the page's message mapper. | `submitGrowthPartnerApplication` + `safePartnerErrorMessage(…, 'Application failed. Please try again.')` |
| 3 | **No identity/session check.** Nothing proved a live session before the write, so an expired session was reported as a generic failure instead of "sign in again". | `src/lib/growthPartnerLogin.ts` |
| 4 | **Duplicate submissions were overwritten.** `ON CONFLICT (user_id) DO UPDATE` reset an existing pending application; the same KYC number could be registered by any number of accounts. | `submit_growth_partner_application` |
| 5 | **No busy state worth the name.** The old form disabled nothing while the request was in flight except the submit button on some paths, and the fields stayed editable. | `ExistingUserApplicationForm` |

---

## 2. The fix

### 2.1 Frontend

| File | What it does |
| --- | --- |
| `src/lib/partnerApplicationValidation.ts` **(new)** | One pure, testable source of truth for the field rules: sanitization (control chars, whitespace runs, length caps), phone normalization (`+91…`, `0091…`, `0…`, spaces → 10 national digits), per-document KYC normalization (separators removed, uppercased) and formats — Aadhaar `^[0-9]{12}$`, PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, passport/licence/registration `^[A-Z0-9]{6,20}$`. Returns `values` **only** when every field passed, so unvalidated input cannot be sent. |
| `src/lib/partnerApplicationErrors.ts` **(new)** | Classifies any thrown value into a `kind` the UI acts on (`session`, `validation`, `duplicate`, `approved`, `network`, `schema`, `rate-limit`, `suspended`, `unknown`) plus exact reviewed copy. Raw database/driver text never reaches the screen. |
| `src/lib/growthPartnerLogin.ts` | `submitGrowthPartnerApplication` rewritten: (1) validate + sanitize, (2) prove a live session via `auth.getSession()` — a *throwing* read is left for the write to classify so a transport failure is never called "signed out", (3) refuse a duplicate using the caller's own application row (a **rejected** applicant may reapply), (4) send only the four sanitized values — no `user_id`, no `status`, (5) classify every failure, including a *rejecting* `rpc()` promise (postgrest-js rejects on transport errors instead of resolving with `{ error }`). `signUpGrowthPartner` now returns `applicationError` instead of throwing, so "account created" and "application refused, here is why" are both reported. |
| `src/components/PartnerPortalLogin.tsx` | `ExistingUserApplicationForm` replaced by `PartnerApplicationForm`: inline field errors, the document-type hint/placeholder, `aria-invalid`/`aria-describedby`/`aria-busy`, every field **and** the button disabled with a spinner while pending (double submission impossible), the typed values preserved on failure, a *Sign in* action when the failure is a session one, and a `PartnerApplicationPending` screen ("Application Pending Approval") after success. |
| `src/components/GrowthPartnerLogin.tsx` | `validateGrowthPartnerSignupInput` now shares the application rules, so the sign-up form reports "Invalid Aadhaar number" too, and surfaces `applicationError` with the real reason. |
| `src/lib/partnerUiErrors.ts` | The new messages added to the safe-copy allowlist, so no call site can degrade them back to a catch-all. |
| `server/partnerErrorLog.ts` | The local gateway now returns a raised `22023`/`23505` message verbatim (PostgREST does), but only for the reviewed strings — so local development shows the same copy as production. |

### 2.2 Database — `supabase/migrations/20261030000000_partner_applications_hardening.sql`

* Table `public.growth_partner_applications` — canonical, idempotent column set.
* CHECK constraints (status, KYC status, document type, name length, field
  lengths). Each is skipped **with a NOTICE** when legacy rows would violate
  it — no data is deleted or rewritten.
* Indexes: `UNIQUE (user_id)`, `UNIQUE (kyc_document_type, upper(kyc_number))`
  (created only when the existing data allows it), plus the read indexes the
  gate and the admin queue scan by.
* **RLS:** `INSERT` own row with `status = 'pending'`, `SELECT` own row
  (`auth.uid() = user_id`); no `UPDATE`/`DELETE` grant — approval stays the
  admin-only `review_growth_partner_application()`.
* `public.partner_applications` — a `security_invoker` **view** exposing exactly
  `id, user_id, full_name, phone, kyc_type, kyc_number, status, created_at`
  over the same rows. One table of truth; reporting can use the product's names.
* `submit_growth_partner_application` hardened — the same formats the client
  enforces (`normalize_partner_phone`, `normalize_partner_kyc_reference`),
  duplicates refused with **`23505`** (`unique_violation` → HTTP 409), still
  `SECURITY DEFINER` with a pinned `search_path` and `auth.uid()` as the only
  source of identity.

### 2.3 Before / after

| Situation | Before | After |
| --- | --- | --- |
| Aadhaar with 11 digits | stored, "success" | `Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.` (on the field, no request sent) |
| Phone with 5 digits | stored, "success" | `Enter a valid 10-digit mobile number.` |
| Applied twice | application silently overwritten | `You have already submitted an application.` (HTTP 409 / `23505`) |
| Someone else's Aadhaar reused | accepted | `That KYC document is already registered. Check the number and try again.` |
| Session expired | `Application failed. Please try again.` | `Your session expired. Please sign in again.` + a **Sign in** button |
| Migration not applied | `Application failed. Please try again.` | `Partner applications are not set up on this project yet. Apply supabase/migrations/…, then try again.` |
| Network down | `Application failed. Please try again.` | `Network error. Check your connection and try again.` |
| Success | form still on screen | **Application Pending Approval** (+ *Check application status*) |

---

## 3. Apply it

1. Run `supabase/migrations/20261030000000_partner_applications_hardening.sql`
   in the SQL Editor (or `supabase db push`). It is idempotent — running it
   twice changes nothing.
2. No frontend env change is needed; no new RPC name and no new table grant is
   required (the RPC is already granted to `authenticated`).
3. Verify on the project:

   ```bash
   npm run reproduce:partner-application   # local gateway + real migrations
   npm run test:partner                    # includes the new application suites
   npm run test:dom
   ```

---

## 4. Tests

| File | Covers |
| --- | --- |
| `tests/partnerApplicationValidation.test.ts` | phone/KYC/name normalization and every validation message |
| `tests/partnerApplicationSubmission.test.ts` | the database (formats, duplicate 409, cross-account KYC, reapply after rejection, RLS, view, idempotency) **and** the client submission layer (classification, session pre-check, duplicate pre-check, no identity in the payload) |
| `tests/dom/partnerApplicationFormBrowserFlow.test.ts` | the real form in jsdom: invalid Aadhaar → no request; busy state locks fields + spinner; duplicate/network/session copy; values preserved; **the reported flow end to end** (portal → apply → invalid → valid → *Application Pending Approval*) |
| `scripts/reproduce-partner-application-error.mjs` | the reproduction, kept as a regression harness |

## 5. Security notes

* The application payload still carries **no identity**: `user_id` is derived
  from `auth.uid()` inside the RPC. `tests/growthPartnerContract.test.ts` reads
  every `.rpc('…', { … })` call out of the client modules and fails if a
  `user_id`/`partner_id` ever appears — the payload is written inline in
  `growthPartnerLogin.ts` so that check keeps working.
* Client-side validation is a UX affordance, never a control: the RPC
  re-validates every value, and RLS decides who can insert and read what.
* The duplicate pre-check is a fast path only. The database (`UNIQUE` index +
  the RPC guard) remains the authority, so a stale screen cannot bypass it.
* Only reviewed strings reach the browser: SQLSTATEs are mapped inside
  `partnerApplicationErrors.ts`, and the local gateway passes through a raised
  message only when it is on the same allowlist.
