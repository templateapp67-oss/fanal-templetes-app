# Phase 12 — API Hardening Audit & Remediation

Scope: every API endpoint involved in salon creation, owner provisioning,
profile update, website state, branding, avatar, services, booking
configuration, referral generation, partner profile, and account settings.

## 1. Status-code contract (enforced everywhere)

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 400  | Validation / malformed body / missing required fields           |
| 401  | Unauthenticated — missing / expired / invalid bearer token      |
| 403  | Authenticated but unauthorized (wrong role, not the owner, etc.)|
| 404  | Resource not found (salon, service, booking, referral, route)   |
| 409  | Conflict (duplicate slug/email, already-processed booking, etc.)|
| 422  | Syntactically valid but semantically invalid state transition   |
| 500  | Unexpected server error — logged w/ stack, generic client reply |
| 503  | Transient downstream unavailability (Supabase, Gemini, YouTube, Razorpay) — retryable |

**Rule:** Failed mutations never return HTTP 200. All errors flow through a
central `sendSafeError()` middleware that maps to the status-code table above.

## 2. Infrastructure that already existed (kept & trusted)

| File | Role |
| ---- | ---- |
| `server/expressSafety.ts`  | `asyncRoute` — wraps every async handler; rejected promises + synchronous throws both hit the error middleware. Also guards against double-responses when a timeout already ended the reply. |
| `server/safeError.ts`      | `classifySafeError`, `safeDatabaseError`, `sendSafeError`. Translates Postgres error codes (23505→409, 23503→422, 42P01→503, etc.) into the correct HTTP response; never leaks DB internals. |
| `server/backendContext.ts` | `BackendError(status, message, code)` — the semantic error type already thrown by booking/auth/dashboard routes. |
| `server/dbGuard.ts`        | Request timeouts (`withRequestTimeout`) that send a JSON 504 *before* the hosting platform kills the request, and `responseAlreadyEnded(res)` guards against double-sends. |
| `server/cors.ts`           | Proper CORS + preflight handling (OPTIONS returns 204, not 404). |
| `server/bookingCreate.ts`, `bookingRoutes.ts`, `bookingMine.ts`, `bookingCheckin.ts`, `customerRoutes.ts`, `partnerPortalRoutes.ts`, `websiteSave.ts`, `ownerDashboard.ts`, `referralAttribution.ts` | All of these already use try/catch with `BackendError` / `sendSafeError` / `fail()` and return correct status codes; audited and left intact. |
| Global error middleware in `server.ts` and `api/index.ts` | Final safety net; sends a JSON 500 / malformed-JSON 400 / 413 for any exception that escaped. |

## 3. What was broken (returned HTTP 200 with `{success:false,...}`) — FIXED

These handlers were catching exceptions and replying with 200 plus a fallback
or error message, so the UI could not distinguish "saved" from "failed" by
status code and the spec *"Failed mutations must not return 200"* was violated.
All have been replaced with hard-fail semantics: input validation throws 400,
missing third-party keys throw 503, provider/network failures throw 500,
empty-model outputs throw 422, and success returns the real content with 200.

### `server.ts` (dev server) and `api/index.ts` (Vercel serverless)

| Endpoint | Before | After |
| -------- | ------ | ----- |
| `POST /api/generate-bio`          | catch-all returned fallback tagline/bio as 200. Missing `businessName`/`businessType` silently produced garbage. Missing `GEMINI_API_KEY` returned fake content as 200. | 400 on invalid input, 503 if no API key, 500 on AI/JSON failure, 200 with parsed JSON on success. |
| `POST /api/recommend-brand-identity` | Catches swallowed AI errors → 200 with preset text (no way to know AI didn't run). | Input validation; deterministic preset returns with `fallback:true` flag when AI is not invoked (only when no key — flag is accurate), 200 with AI content otherwise. Errors during AI fall back *but still* mark `fallback:true` instead of lying. |
| `POST /api/generate-service-description` | Catches swallowed errors → 200 with fallback. | 400 if `serviceName` missing; returns `{description, fallback:boolean}`; exceptions never masquerade as success. |
| `POST /api/generate-promo-image`  | Missing API key returned 200 with `success:false, imageUrl:null`. Caught errors returned 200 `{success:false, error:...}`. Missing image parts returned 200 `{success:false,...}`. | 503 when no key, 400 on invalid aspect ratio, 500 on generation failure, 422 when the model returned no image part (retryable client state), 200 + data URL on success. |
| `POST /api/generate-promo-copy`   | Missing API key returned hardcoded copy as 200; catch returned fallback as 200; JSON parse failures silently became fallback. | 400 on missing business/service, 503 when no key, 500 on AI/parse failure, 200 with parsed JSON on success. |
| `POST /api/youtube/fetch-videos`  | Missing key returned 200 `{success:false,...}`. Fetch/parse errors swallowed, still returned 200 `{success:true,videos:[]}`. `maxResults` not validated. | 400 if `maxResults` out of range or URL not parseable, 503 when no YouTube key, 500 on upstream fetch/JSON failure, 200 with the video list on success. |
| `GET  /api/owner/salon`, `/api/owner/resolution` (`createOwnerSalonHandler`) | All non-401 errors collapsed to `res.status(error?.status||500)` but the body still contained `{status:'needs_onboarding', salon:null}`, which caused the UI to silently drop into the onboarding flow on 500 instead of surfacing a retry prompt. | Now passes every exception to `next(err)` so the centralized error middleware maps it to the proper code/status; 401 still returns a structured `needs_onboarding` body. |

## 4. New semantic error types added to `server/safeError.ts`

```ts
ApiError              // base: status, code, message, retryable, details
ApiValidationError    // 400 validation_error
ApiUnauthenticatedError // 401 auth_required
ApiForbiddenError     // 403 forbidden
ApiNotFoundError      // 404 not_found
ApiConflictError      // 409 conflict
ApiInvalidStateError  // 422 invalid_state
ApiUnavailableError   // 503 *_unavailable (retryable)
ApiServerError        // 500 unexpected_error
```

`classifySafeError` now recognizes these as authoritative (their `.status`,
`.code`, `.message` are forwarded verbatim), and `sendSafeError` forwards their
`.details` map so field-level validation errors can reach the UI. `BackendError`
from `backendContext.ts` is already shape-compatible (it carries `.status` and
`.code`), so the existing 100+ `throw new BackendError(...)` sites automatically
benefit — no rewrites were needed.

## 5. Endpoint-by-endpoint audit (Phase-12-scope)

| Domain | Endpoints | Status |
| ------ | --------- | ------ |
| Salon creation        | `POST /api/salons` is performed via the `save_owner_editor_state` RPC inside `handleWebsiteSave` (`POST /api/salon/save`, `/api/website/save`) | ✅ Already wrapped in try/catch; returns 400 for malformed arrays/required-field validation, 401 when bearer token mismatches `owner_id`, 503 when admin client missing, 503 on RPC failure after fallback, 200 on success. Audited, no changes needed. |
| Owner provisioning    | Supabase `handle_new_user()` trigger on sign-up + `ensure_owner_workspace` RPC (called from website save on 42501) | ✅ RPC failures fall through to service-role fallback; 401/403/422 already mapped. |
| Profile update        | `POST /api/owner/hours`, owner dashboard reads/writes, `POST /api/customer/me/profile` (write) | ✅ 400 for shape errors, 403 for non-owner/non-manager, 409 when upsert returns <7 rows, 503 on DB failure. Audited. |
| Website state         | `GET /api/salon/state`, `POST /api/salon|website/save` | ✅ 401/400/503/500 all returned with proper codes; catch block uses 503/500, never 200. Audited. |
| Branding              | Saved as `profile.theme_preset`, `profile.custom_accent_color`, etc. inside `/api/website/save` | ✅ Covered by website-save handler. AI brand recommendation (`/api/recommend-brand-identity`) hardened this phase. |
| Avatar                | Saved as `profile.owner_photo_url` / `cover_image_url` inside `/api/website/save` (upload is direct to Supabase Storage using scoped tokens) | ✅ Storage uploads use RLS; save path hardened this phase. |
| Services              | Written atomically through `save_owner_editor_state` inside website-save | ✅ 400 array-shape checks before any write; DB failures become 503. |
| Booking configuration | `POST /api/bookings/create`, `/api/bookings/update`, `/api/bookings/check-in`, `/api/bookings/mine/*`, `/api/owner/appointments`, `/api/customer/bookings/create` | ✅ All routes use `BackendError` + `safeDatabaseError`, returning 400/401/403/404/409/422/503/500 correctly. No 200-on-failure. |
| Referral generation   | `POST/GET /api/referral-attribution` (rate-limited, cookie capability, allowlisted response surface), plus `capture_growth_referral` / `link_my_growth_referral` RPCs | ✅ Returns 400/403/405/415/429/503, never 200 on failure; safe-response projection guarantees partner secrets never leak. |
| Partner profile       | `/api/partner/*` suite behind `registerPartnerPortalRoutes` | ✅ `sendPartnerError` maps BackendError→correct status, unknown→500; 400 on invalid UUID/pagination, 404 on missing asset, 503 on missing storage. Audited. |
| Account settings      | `/api/auth/owner-login`, `/api/auth/quick-access`, `/api/customer/me/profile`, `/api/me` via Supabase Auth | ✅ 400 for missing email, 401 on bad credentials, 500 for unavailable admin path. Customer profile write uses `fail()`→correct status. |
| AI assistants (bio / brand / service description / promo image / promo copy / re-engage / YouTube) | `/api/generate-bio`, `/api/recommend-brand-identity`, `/api/generate-service-description`, `/api/generate-promo-image`, `/api/generate-promo-copy`, `/api/ai/re-engage-clients`, `/api/youtube/fetch-videos`, `/api/fetch-youtube-meta` | ✅ Hardened this phase. `/api/ai/re-engage-clients` and `/api/fetch-youtube-meta` intentionally degrade to deterministic fallbacks (they are advisory, not mutations) but still surface structured responses — no HTTP 200 with `success:false`. |

## 6. Try/catch discipline

* Every async route is wrapped in `asyncRoute(...)` which converts promise
  rejections into `next(err)`. Synchronous throws are also caught.
* Inside controllers, `try { … } catch (err) { next(err); }` is used where the
  handler needs cleanup logic; otherwise the error is `throw`n directly and the
  wrapper delivers it to the error middleware.
* `catch { return res.json(fallback) }` patterns that swallowed errors were
  removed and replaced with typed `throw new Api*(…)` errors, with deterministic
  fallbacks (where UX requires them) flagged by `fallback:true` *in a successful
  response* so the UI can tell the difference.

## 7. Verification

```bash
npx tsc --noEmit       # passes for all server/API files (pre-existing
                       # src/components + test-file TS errors unrelated)
```

Manual request verification performed by code inspection — every `res.json(...)`
after a thrown error is now unreachable because the handler throws typed errors
up to the central middleware, and every catch block either re-throws or calls
`next(err)`. No remaining `catch { return res.json({success:false...}) }` sites
exist on mutated endpoints.
