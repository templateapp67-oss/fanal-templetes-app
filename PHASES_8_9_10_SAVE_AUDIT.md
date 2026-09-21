# Phases 8–10 — Auth Session/JWT + Save Pipeline Audit & Instrumentation

Scope: the **Save & Update Website** pipeline (`persistSalonState` →
`saveSalonState` → `runSalonSavePipeline` → `saveOwnerEditorState` /
`POST /api/website/save` → database) and the auth/JWT handling around every
write path.

## Verdict

The pipeline was already in good health from prior phases: session pre-flight
refresh (`ensureFreshSession`), reactive retry (`refreshSessionForSave`), a
real local-vs-cloud status vocabulary (`saved` vs `saved_local`), session
binding for the service-role fallback (`verifyCallerIsOwner` against
`GET /auth/v1/user`, `token.user.id` must equal `owner_id`), and RLS-scoped
transaction RPCs (`save_owner_editor_state`, ownership resolved server-side
via `nexora_owner_salon_ids()`). **Client `ownerId` is a claim that is
verified; `getSession()` is never used as authorization; tokens are never
logged.**

Three genuine defects remained. All fixed in this change.

## Findings & fixes

### 1. CRITICAL — server-side false success (Phase 9/10)

`server/websiteSave.ts → persistWithAdminFallback()` wrapped every sub-write
in a try/catch that only `console.warn`'d, **ignored the `{ error }` object
supabase-js returns for PostgREST failures**, and returned
`{ success: true }` unconditionally.

Consequence: `POST /api/website/save` could answer `{ success: true }` with
**nothing persisted** — and the client would log "Stage 4 (API Fallback)
SUCCESS", show `All changes saved`, and clear the local draft. Data loss
presented as success.

**Fix:** every sub-write now checks its result object; every failure is
emitted as a structured `[SAVE ERROR] { stage, httpStatus, supabaseCode,
message, resource }`; `success: true` is returned **only when the canonical
store** (`owner_editor_state` — what hydration reads back) actually persisted.
Secondary-store failures are reported as `partial: […]` in the response
instead of being camouflaged as full success.

### 2. Phase 10 — canonical `[SAVE]` lifecycle + structured `[SAVE ERROR]`

Diagnostics existed but not in the mandated, grep-able lifecycle format. Added
alongside the existing narrative logs (dev-gated for steps, unconditional for
errors):

```
[SAVE] start → authenticated user resolved → tenant resolved →
payload validated → client state updated → local cache write →
cloud sync started → cloud sync completed →
API fallback started → API fallback result → complete
```

```
[SAVE ERROR] { stage, httpStatus, supabaseCode, message, resource }
```

`saveStep()` / `logSaveError()` live in `src/lib/autoSave.ts`; `App.tsx`
(`persistSalonState`) and `runSalonSavePipeline` emit them at the exact stage
boundaries. All meta passes through `redactSaveLogMeta()` — keys matching
token/jwt/password/secret/api-key/authorization/cookie/credential are masked,
JWT-shaped **values** are masked, strings truncated at 300 chars, and payload
bodies are never logged (keys + byte sizes only). The save success rule is
enforced end to end: **`ok` requires an authoritative write** (RPC success or
2xx API ack); `saved_local` (Local Draft) is a distinct, non-`saved` status.

### 3. Silent catches that hid real errors (Phase 9)

Replaced with logged, explicit behavior:

- `autoSave.loadLocalDraft` / `hasLocalDraft` — `catch { return null/false }`
  now `console.warn`s with the error (still recovering as "no draft").
- `websiteSave.handleGetSalonState` — comment-only catches
  (`// RPC failed`, `// ignore`) now log `code` + truncated message while the
  fallback read continues.

Intentionally kept: `catch {}` around `localStorage.removeItem` cleanup lines
(best-effort cache hygiene — no state judgment depends on them).

## Phase 8 confirmation (no change needed, verified)

- Identity on every protected server write comes from the verified JWT:
  `verifyCallerIsOwner` (Auth-server round trip), never from the request body.
- The browser save never trusts stale client identity: pre-flight
  `getSession()` is used *only* to obtain/refresh the token; the write itself
  carries the JWT, and PostgREST/RLS decide — a locally forged `auth` object
  cannot pass RLS.
- Mock mode (`isMockSupabase`) skips auth entirely by design for local dev; a
  production bundle additionally cannot fabricate sessions
  (`canFabricateSession` fail-closed). Note: a host deployed *with* mock mode
  and no `isVercelRuntime` guard would still accept unauthenticated saves —
  keep Supabase env configured on every public deploy.

## Verification

- `tsc --noEmit`: **0 errors in changed files** (8 pre-existing baseline
  errors in unrelated files: AuthModal, GrowthPartnerPage, salonStore:486,
  legacy test fixtures).
- Save/auth suites (Node 22): `autoSave` **17/17**, `websiteSaveAuth` **7/7**,
  `authSessionRefresh` **11/11**, `restoreAuthSession` **7/7**,
  `savePipeline` 20/27 — the 7 failures are pre-existing in this sandbox
  (8 failures on pristine `origin/main` under identical conditions; this
  change fixes one of them and regresses none).
- Sandbox note: tests that build a real Supabase client require Node ≥22
  (native WebSocket for realtime-js); the project targets Node 22+.
