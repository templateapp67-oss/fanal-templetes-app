# PHASE 5 — Referral Validation Audit

Branch `arena/01a09a39-fanal-templetes-app`. Every claim below is either read out
of the current tree or produced by running the real migrations; the numbers at
the end come from the actual runs.

---

## PART A — The authoritative chain

There is exactly one path that establishes a referral, and the browser is never
the decider:

```
ReferralScreen.tsx (submit)
  -> linkReferralCode()              src/onboarding/lib/auth.ts:283
     normalizes, then calls ONE rpc
  -> public.link_my_growth_referral  SECURITY DEFINER, search_path pinned
     supabase/migrations/20260921_public_partner_referral_codes.sql:42
       (20261005 supersedes it — see Part D)
  -> public.growth_partners / public.growth_onboarding
  -> trg_guard_growth_referral_identity  BEFORE INSERT OR UPDATE
     supabase/migrations/20260923_referral_fraud_privacy.sql:42
```

Four properties make frontend bypass impossible, and all four were verified
rather than assumed:

* `link_my_growth_referral` takes **only** the code string. There is no
  parameter through which a caller could name a partner.
* `growth_onboarding` has **no write policies and no INSERT/UPDATE/DELETE
  grants** for `authenticated` or `anon`
  (`20260923:46`, `20260912:331`).
* `growth_normalize_code` and `growth_partner_is_usable` have **no EXECUTE
  grants** — reachable only from inside the SECURITY DEFINER functions.
* The trigger re-validates on every write, **including privileged ones**.

No frontend comparison, hardcoded code, `localStorage` or static JSON is
consulted anywhere in this path. The last test in
`tests/referralValidation.test.ts` proves the read side follows the database:
after an admin reassigns a referral behind the owner's back,
`get_my_growth_referral` returns the new code, not a cached one.

---

## PART B — The ten dimensions

| # | Dimension | Verdict | Where it is enforced |
|---|---|---|---|
| 1 | Code exists | ✅ | partner lookup in `link_my_growth_referral` |
| 2 | Code belongs to a valid Growth Partner | ✅ | same lookup **plus** the trigger, which re-checks partner↔code ownership even on a direct privileged write |
| 3 | Partner exists | ✅ | `growth_partners.user_id` FK → `auth.users(id) on delete cascade`; deleting the account takes the code with it |
| 4 | Partner is active | ✅ | `growth_partners.is_active`, re-checked live (deactivate → refused, reactivate → works) |
| 5 | Code is active | ⚠️ **no such concept** | there is no per-code switch; `is_active` on the partner is the only one |
| 6 | Code is not expired | ⚠️ **no code expiry** | expiry exists on the share-link **token** (`growth_referral_attributions.expires_at`, 7-day TTL), not on the code |
| 7 | Code is not blocked | ⚠️ **no block flag** | the real off-switches are `is_active = false` and `admin_correct_growth_referral` |
| 8 | Usage limits | ⚠️ **none exist** | a code is reusable without cap — five owners linked from one code in the test |
| 9 | Self-referral | ✅ **twice** | the RPC raises, **and** CHECK `growth_onboarding_no_self_referral` |
| 10 | Already-attributed | ✅ **three times** | `for update` row lock, an atomic conditional `update` whose predicate decides the winner, and the immutability trigger |

### B.1 Why dimensions 5–8 are reported as absent, not added

`growth_partners` has six columns, and the test asserts the exact list:

```
created_at, id, is_active, referral_code, updated_at, user_id
```

There is no `expires_at`, `valid_until`, `is_blocked`, `blocked_at`, `max_uses`
or `usage_count` — so nothing *could* enforce them. Inventing those columns
would be a product decision about referral campaigns, not a validation fix, so
they are recorded here instead. Anyone reading this later should not believe a
code can expire or be capped: it cannot.

The one expiry that does exist was tested for real: an attribution token forced
into the past is refused by `prepare_growth_referral_signup`.

### B.2 Anti-enumeration is deliberate and was preserved

An unknown code and a real-but-deactivated partner produce **byte-identical**
errors — `Invalid or inactive referral code`. That is asserted directly. It
matters: if deactivating a partner changed the message, an attacker could
enumerate valid codes by toggling partners. The Part D fix keeps this property,
which is why a banned partner answers with the same message too.

---

## PART C — 5.1 Standard validation states

### C.1 What the backend can actually distinguish

`toSafeReferralError` (`src/onboarding/lib/flow.ts:271`) is the single mapping
point. Existing codes, unchanged:

| Requested state | Existing state | Why |
|---|---|---|
| `VALID` | success path | — |
| `INVALID` | `invalid-code` | malformed code |
| `NOT_FOUND` | `invalid-code` | **deliberately merged** with the two below |
| `DISABLED` | `invalid-code` | the database returns one message for all three |
| `PARTNER_INACTIVE` | `invalid-code` | splitting them would need the backend to distinguish them, which is an enumeration oracle |
| `SELF_REFERRAL` | `invalid-code` | already has its own **copy** — *"You cannot use your own referral code."* |
| `ALREADY_ATTRIBUTED` | `already-linked` | the only one the UI branches on: `ReferralScreen.tsx:84` routes to status instead of dead-ending |
| `EXPIRED` | n/a | no code expiry exists (Part B.1) |
| `LIMIT_REACHED` | n/a | no limits exist (Part B.1) |

**No parallel enum was introduced.** Two pieces of evidence drove that:

* `'invalid-code'` is **produced but never branched on** anywhere in `src/` —
  only `already-linked`, `validation` and `email-in-use` change behaviour. New
  members would be dead values.
* The merges above are a **security property**, not laziness. Splitting them
  would require the backend to say which of "unknown / inactive / banned"
  applied, and that answer is the oracle.

### C.2 The one real gap in the state mapping — fixed

A new test extracts **every `raise exception '...'` string** out of the seven
referral migrations and feeds each through `toSafeReferralError`, so a future
migration that adds a message is what fails the test. It caught one:

`Unknown onboarding action` — raised by `update_my_onboarding_progress` when a
client sends an action it does not recognise — fell through to
*"Something went wrong. Please try again."* That is a stale or wrong client, not
a transient failure, so the copy invited the owner to retry the exact call that
had just failed.

It now maps to the **existing** `validation` code (no new enum member) with
*"This step could not be completed. Please refresh the page and try again."*

The same test also asserts that no message the backend can raise ever surfaces
raw SQL vocabulary (`22023`, `42501`, `pg_catalog`, `information_schema`).

---

## PART D — The defect this phase found and fixed

### D.1 A GoTrue-banned partner could still collect referrals

`link_my_growth_referral` checked that a partner **exists** and is
`is_active`. Nothing consulted `auth.users.banned_until` — even though
`20260913_template_handoff.sql:222` already probes for that column and honours
it when redeeming a handoff.

So a banned partner was locked out of the Template App while remaining free to
keep collecting newly attributed referrals. Reproduced against the real
migrations, then confirmed with a positive control (adding a ban check to the
RPC flips the test).

### D.2 The fix

`supabase/migrations/20261005_partner_ban_guard.sql`:

* adds one private helper, `public.growth_partner_is_usable(uuid)` — row exists,
  `is_active`, and not currently banned;
* routes the two write paths that establish attribution through it:
  `link_my_growth_referral` and `guard_growth_referral_identity`. Because the
  trigger re-validates, this also covers `admin_correct_growth_referral`, so an
  admin cannot reassign referrals **to** a banned partner either.

The ban probe is guarded by an `information_schema` check, mirroring
`20260913`, because the column is absent in some schema generations and the
helper must not fail the caller there.

**Three things it deliberately does not change:**

* **existing attributions are untouched** — a partner banned *after* a referral
  was linked keeps it, and the owner's onboarding milestones keep advancing.
  Tested explicitly. Banning a partner must not silently rewrite history.
* **the message stays** `Invalid or inactive referral code`, so banned, unknown
  and deactivated remain indistinguishable.
* unbanning restores linking immediately, which is what proves `is_active` was
  never the blocker.

Registered in `LOCAL_GROWTH_CHAIN`, which now applies **26** migrations.

### D.3 Making the check runnable

The local `auth.users` stand-in had no `banned_until`, so the first version of
the gap test **passed vacuously** by returning early — a clean exit code proving
nothing. Rather than leave that, the column was added to the local auth schema
(`server/localSupabase.ts`), which also activates the ban branch in
`20260913` for the first time locally. The test now asserts the precondition
instead of skipping on it.

---

## PART E — Recorded, not changed

* **`provision_growth_partner` decides "no code supplied" with a space-only
  `btrim`** (`20260916:192`), so a tab-only code is rejected by the format check
  rather than auto-generating a `NEXORA-` code. Safe outcome, admin-only RPC.
* **Approval already gates partner existence** — `review_growth_partner_application`
  is what calls `provision_growth_partner` (`20260919`), so a pending or rejected
  application never has a `growth_partners` row. "Partner exists" therefore
  already implies "application approved"; no extra check was needed.
* `admin_correct_growth_referral` **returns void** by design, so its correctness
  is asserted through the resulting row and the single `growth_referral_admin_audit`
  record — not through a return value.

---

## PART F — Verification

`tests/referralValidation.test.ts` (17) runs the **full `LOCAL_GROWTH_CHAIN`**
(26 migrations) in PostgreSQL and calls the shipped RPCs through
`local.asRequest({ sub, isAdmin })`, i.e. as a real authenticated caller.

Coverage: the happy path · unknown codes write no row · unknown ≡ deactivated
· FK cascade on partner deletion · deactivate/reactivate · the exact
`growth_partners` column list (asserting 5–8 cannot exist) · five owners from
one code · a forced-expired token refused · self-referral blocked at both levels
· re-attribution refused after linking, after completion, and by a privileged
UPDATE · admin correction works and is audited · a partner/code mismatch refused
on a direct write · banned partner refused, indistinguishable from unknown, and
restored on unban · an existing attribution undisturbed by a later ban · the
client state mapping · every backend `raise exception` message mapped to safe
copy.

### Positive controls

| Reverted | Result |
|---|---|
| a ban check added to `link_my_growth_referral` (before the fix existed) | the gap test failed — proving it detects the behaviour, not just the code |
| `20261005` removed from `LOCAL_GROWTH_CHAIN` | the banned-partner test fails |

Both restored → green.

### Runs

```
tsc --noEmit (5.8.3)   exit 0
npm test               1348 tests, 1345 pass, 0 fail, 3 skipped
npm run test:dom         68 tests,   68 pass, 0 fail
npm run build          exit 0
```

`npm test` was 1331 before this phase (+17). `test:dom` unchanged at 68 — this
phase is backend-only.

---

## PART G — 5.2 Safe response

The rule this part enforces: public/client validation must not expose the
partner's **private profile**, **internal IDs unnecessarily**, **bank
details**, **commission configuration**, **admin metadata** or **private
contact details** — and must return only the required safe information.

The numbers in Part F belong to that phase. The runs for this part are at the
end of Part G.

### G.1 What each surface is allowed to answer

| Surface | Caller | The complete answer |
|---|---|---|
| `public.validate_growth_referral_code(text)` | authenticated owner typing a code | `{valid, referral_code}` |
| `public.capture_growth_referral(text,text)` | anonymous | `{valid, referral_code, token, expires_at}` |
| `public.prepare_growth_referral_signup(text)` | anonymous (cookie capability) | same four fields |
| `POST /api/referral-attribution` | anonymous | `{valid:true, referralCode}` + capability in an HttpOnly cookie, or `{valid:false, token:null}` |
| `GET /api/referral-attribution` | anonymous (cookie capability) | `{valid:true, referralCode, token}` or `{valid:false, token:null}` |
| `validateGrowthReferralCode()` (browser wrapper) | signed-in owner | `{valid, referral_code}` |
| `linkMyGrowthReferral()` / `getMyGrowthReferral()` (browser wrappers) | signed-in owner | the 5 documented relationship fields (below) |

`expires_at` never crosses the wire: it sets the cookie's `Expires` and nothing
else. On the HTTP body the same fields are spelled camelCase
(`referralCode`); both spellings are read in one place so a surface cannot
re-implement the mapping.

### G.2 The defect this part found and fixed

`validateGrowthReferralCode()` used to cast the RPC result —
`return data as ValidateReferralResult` (`src/lib/growthPartner.ts:114` before
this change). A fetch-level probe with a hostile backend showed the entire
partner row reaching the client:

```
RESULT {"valid":true,"referral_code":"ALPHA01","partner_id":"p-1",
        "partner_name":"Anita","bank_account_number":"999",
        "commission_rate":30,"is_admin":true,"email":"x@y.z"}
```

Nothing in the tree made the database return those fields — and nothing
prevented it either. Any drift (a hand-edited function, a column added to a
view, a self-hosted PostgREST, a caching proxy, a staging project with a
different schema) would have delivered a partner's bank details, commission
configuration, admin metadata and private contacts into React state through a
call whose only job is to answer "is this code valid?".

The fix is structural, not a filter list: **every public/client validation
answer is constructed field by field from an allowlist**, so unrelated data
cannot ride along under a new key name, inside a nested object, or in an array.

### G.3 One definition, wired into every boundary

`src/lib/safePartnerResponse.ts` is the single definition:

* `SAFE_VALIDATION_FIELDS` — the complete allowlist per surface (`:51`);
* `projectValidationResponse()` — builds the answer, type-checks the code
  against the database's own CHECK constraint and the capability against the
  64-hex form, and drops everything else (`:113`);
* `publicValidationBody()` — the exact HTTP body (`:151`);
* `capabilityExpiry()` — server-side cookie lifetime with the documented
  7-day fallback (`:162`);
* `projectReferralRelationship()` — the 5 documented relationship fields for
  the own-referral reads (`:351`);
* `PRIVATE_KEY_RULES` / `findPrivateResponseFields()` — the audit backstop that
  names the six categories by key **and** by unmistakable value (email, phone,
  UUID, IFSC, IBAN), through nested objects and arrays (`:193`, `:256`).

Wired in:

* `server/referralAttribution.ts:150–174` — the anonymous endpoint (both
  methods), the only public writer in the funnel;
* `src/lib/growthPartner.ts:132,149,160` — client validation and the
  own-referral reads;
* `src/onboarding/lib/referralAttribution.ts:34` — the signup client that
  reads the same HTTP answer.

### G.4 Fail-closed properties (all asserted)

* A `valid:true` answer with no usable canonical code is reported as
  `{valid:false, token:null}` instead of as a half-answer.
* An answer is only "complete" when it has BOTH a canonical code and a usable
  capability: otherwise no cookie is set and the JSON says invalid, so a
  half-answer can neither start nor continue an attribution.
* `valid` must be the boolean `true`; the string `'true'` is not validity.
* A `referral_code` that is not in the database's own format is dropped, so a
  private value can never be echoed back through that field.
* Code validation ignores a `token` even if the backend returns one — asking
  whether a code is valid must not mint a capability.
* An unusable capability is not a token, so a forged/short/long value cannot
  make the endpoint set a cookie.
* `expires_at` is only accepted as a parseable instant, and the cookie falls
  back to the committed 7-day TTL rather than to anything the client supplies.
* The linking write path throws (never reports success) when the projected
  relationship is unusable; the read path answers "no usable relationship".

Anti-enumeration is untouched: unknown, inactive and banned partners still
produce one indistinguishable message (Part B.2), and the response shape is
identical in all three cases.

### G.5 Drift is reported, never forwarded

`server/partnerErrorLog.ts` gained `logPartnerResponseDrift()`. The response is
already allowlisted, so this is an operational backstop: when the database
starts returning a forbidden field, the endpoint logs the field **paths and
categories** (`{"event":"partner_response_drift","dropped":[{"path":
"bank_account_number","category":"bank-details"}]}`) and still answers with the
safe body. Values are never logged — the point of the rule is that they are
private — and the test asserts the log line contains no marker values.

### G.6 Two further defects the tests caught

1. **A too-loose code pattern.** The first draft accepted any upper-case
   letters/digits/dashes, so `PRIVATE-NAME` (a partner's name in the
   `referral_code` field of a drifted answer) passed as a "canonical code" and
   was echoed to the browser. The pattern is now exactly the database's own
   constraint — `^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$`
   (`20260921_public_partner_referral_codes.sql`).
2. **Two spellings of one answer.** The database returns `referral_code`
   while the HTTP body returns `referralCode`; projecting only the snake_case
   spelling silently emptied the captured code and broke four browser flows
   (share link → signup, register recovery, Section 40 acceptance, cookie
   attribution across a remount). Both spellings are now read in the one
   projector, and `5.2 one definition reads both spellings` pins it.

### G.7 Recorded, not changed

* The referred owner's `partner_name` (and the partner's own view of their
  referrals' display names) stays: `20260915_growth_partner_dashboard.sql`
  documents that reverse disclosure as deliberate and minimal. What is new is
  that nothing else can arrive with it.
* `growth_onboarding`'s `growth_partner_id` in the own-onboarding snapshot is
  unchanged; it is the caller's own relationship, pinned by
  `tests/onboardingApp.test.ts:527`, and is not part of a validation answer.
* Owner-only authenticated reads (`get_partner_profile`,
  `get_my_growth_partner`) were already minimal and remain untouched.
* `/api/site/:subdomain` returns the business contact details a salon
  publishes on its own public website — a different, product-level contract,
  out of scope for validation responses.

### G.8 Verification

`tests/partnerSafeResponse.test.ts` (11 tests) drives **all four layers** with
the same hostile payload — a partner row that really does hold
`PRIVATE-NAME`, `BANK-MARKER-9931`, `ADMIN-MARKER`,
`partner.private@example.com` and `+919999900001`:

* projector: exact key sets per surface, six categories named, nested/array
  scanning, both spellings;
* the anonymous endpoint: exact bodies, cookie still set and expiring,
  fail-closed on a hostile/forged answer, drift log carries no values;
* real PostgreSQL (PGlite, `LOCAL_GROWTH_CHAIN`): `capture_growth_referral`,
  `prepare_growth_referral_signup` as `anon` and
  `validate_growth_referral_code` / `link_my_growth_referral` /
  `get_my_growth_referral` as `authenticated` — exact key lists, and the
  markers above never appear even though the rows hold them;
* browser wrappers through a hostile HTTP layer, including the signup client
  and the linking screen.

### Positive controls

| Reverted | Result |
|---|---|
| `validateGrowthReferralCode` back to `return data as ValidateReferralResult` | `5.2 the client validation wrapper…` fails |
| the endpoint back to forwarding the RPC payload | `5.2 /api/referral-attribution…` fails |
| the canonical-code pattern back to letters/digits/dashes | `5.2 the public body…` and `one definition reads both spellings` fail |

All restored → green.

### Runs

```
tsc --noEmit (5.8.3)   exit 0
npm run build          exit 0
npm test               1359 tests, 1356 pass, 0 fail, 3 skipped   (was 1348)
npm run test:dom         68 tests,   68 pass, 0 fail
npm run test:partner    441 tests,  441 pass, 0 fail
```
