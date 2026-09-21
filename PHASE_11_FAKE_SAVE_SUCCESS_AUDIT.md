# Phase 11 — Remove Fake Save Success (UI audit & fix)

Scope: every owner-app UI situation where **React state changed successfully or
localStorage changed successfully but database persistence failed** (or was
never attempted at all). Companion to `PHASES_8_9_10_SAVE_AUDIT.md` and
`AUDIT_REPORT.md`, which covered the pipeline internals (server-side false
success, lifecycle logs, `[SAVE ERROR]` vocabulary). Phase 11 covers the
**presentation layer** above that pipeline.

Mandate (user's terms):

- The UI must differentiate exactly three states: **`Saving…` / `Saved` /
  `Save failed`**.
- A successful local state update is **NOT** a successful cloud save.
- On save failure: (a) retain the unsaved UI state, (b) present an actionable
  retry, (c) preserve the actual server error internally (`[SAVE ERROR]`
  console log — never fabricated client-side), (d) **do NOT falsely display
  "Saved"**.

## Verdict

The save **pipeline** (Phases 8–10) already reports the real outcome —
`published` / `localDraft` / `failed` plus summarized + structured error logs.
What was broken was that several UI screens **ignored that report and toasted
success the moment React state changed** — and one screen (Loyalty "Save
Configuration Changes") tosted success **with no persistence call at all**.
All sites below are fixed: the components now route their saves through the
real pipeline and only claim success when the pipeline confirms it.

## Findings & fixes

### New shared contract — `src/lib/autoSave.ts`

```ts
/** End-state of the real persistence pipeline (client or API fallback). */
export interface SalonPersistResult {
  published: boolean;   // database (or service-role API) accepted the state
  localDraft: boolean;  // cloud unreachable — device holds it (honest "saved on this device")
  failed: boolean;      // nothing durable: state retained locally, retry available
}
/** Partial snapshot of the editor state to persist (overrides hydration). */
export interface SalonEditorStatePatch {
  profile?; services?; stylists?; loyaltyConfig?; selectedTemplateId?;
}
```

Early-skip paths (auth not ready, coalesced auto-save, no-op) resolve
`{ false, false, false }` — the caller must treat that as "not persisted",
not as success.

### `src/App.tsx` — `persistSalonState` now returns the real result

- `persistSalonState(state, opts)` → `Promise<SalonPersistResult>`; accepts
  `explicitState?: SalonEditorStatePatch` so components can persist the exact
  snapshot they just edited (instead of relying on the next hydrated state).
- Return mapping: hydration in progress → `failed` (retry after auth settles);
  auth-not-ready / coalesced-auto / no-op-auto → all-false; localStorage /
  hard-fail / unexpected catch → `failed`; pipeline end-state →
  `publishedToCloud ? published : localDraft`.
- New entry point **`persistChange(message, explicitState?)`** — the single
  component-facing call: runs the real pipeline, toasts the **real** outcome
  (success only after the cloud accepts, "saved on this device" for a local
  draft, "Save failed: …" otherwise), and returns the result so the component
  can branch (close modal vs keep open + retry).
- `handleSaveNow` (explicit Save) still resolves a boolean — via
  `.then(r => r.published)` — for the existing `WebsiteSavedModal` flow
  (unchanged behavior, unchanged strings).
- Header profile save and `UserProfileSettingsModal` onSave no longer toast
  "saved successfully" themselves — they merge into state and call
  `persistChange`; the engine toasts the real outcome.

### Component pattern (proven in `ServiceManagement`, replicated elsewhere)

1. Compute the `next` slice from **closure state** (not functional updates) —
   that is the snapshot that gets persisted.
2. `setX(next)` immediately — the UI never loses the edit.
3. `await onPersistChange(message, { slice: next })`.
4. `result.published || result.localDraft` → close the modal / clear the
   error. Otherwise → **keep the form open**, show an inline `role="alert"`
   failure banner with a **Retry** button, and disable the submit button
   while in flight ("Saving…").
5. Components **never toast success themselves** — the engine does, with the
   passed `message`, only after the cloud accepts. Defensive `!onPersistChange`
   branch: close silently, claim nothing (auto-save still reports).

Failure copy always states the change is **kept on this device** and that the
exact server error is in the console (`[SAVE ERROR]` from the pipeline) — the
component never invents server details, and the summarized toast comes from
the engine.

### Per-site findings

| # | Site | Was (fake) | Now (real) |
|---|------|-----------|-----------|
| 1 | `LoyaltyManagement` — "Save Configuration Changes" button | `onClick={() => showToast('✓ Loyalty rules and tier parameters saved successfully!')}` — **no persistence call at all** | `handleSaveConfig()` → `onPersistChange('✓ … saved successfully.', { loyaltyConfig })`; button shows "Saving…"; on failure a section banner + Retry; config retained in state |
| 2 | `LoyaltyManagement` — reward add/edit form (`handleSaveReward`) | `showToast('✓ Added/Updated …')` on state change; modal closed instantly | Async persist with the edited `loyaltyConfig` snapshot; on failure the modal stays open (title/value retained) with an inline alert + resubmit; success resets & closes |
| 3 | `LoyaltyManagement` — delete reward | `showToast('Removed reward threshold …')` on state change | Awaited persist of the filtered config; on failure the removal is retained in state, section banner + Retry, no "removed" claim |
| 4 | `ServiceManagement` — add/edit service (`handleSaveService`) | `showToast('Added/Updated … successfully')` on state change | Async persist of the `services` snapshot; modal stays open on failure with in-modal alert + resubmit; section banner + Retry; submit button "Saving…" while in flight |
| 5 | `ServiceManagement` — delete service | success toast on state change | Awaited persist; on failure retention + banner + Retry, no "deleted" claim |
| 6 | `TeamManagement` — add stylist (`handleSaveNewStaffMember`) | `showNotification('… onboarding complete')` on state change | Async persist of the `stylists` snapshot; on failure the card stays + section banner + Retry |
| 7 | `TeamManagement` — edit stylist (`handleSaveEditStylist`) | `showNotification('… updated!')` on state change; modal closed instantly | Async persist; modal closes only on success; on failure the edit form stays open (values retained) with a banner + "Saving…" button state |
| 8 | `TeamManagement` — delete stylist (`handleDeleteStylist`) | `showNotification('… removed from team.')` on state change | Awaited persist; the confirmation modal closes first (it's a local UI step), but the "removed" claim is made only via the pipeline message — on failure retention + banner + Retry, no "removed" claim |
| 9 | `SaaSDashboard` — logo/hero "Save & Update Website" toasts | "… & saved!" fired on local state change | Reworded to "… & applied to your profile — auto-saving…"; the real Save still runs `handleSaveNow` → `WebsiteSavedModal` with the honest status (`Website saved successfully!` only when the pipeline actually published — that string is asserted by `tests/templateCompletion.test.ts` / `tests/websiteSavedModal.test.ts` and untouched) |
| 10 | `SocialConnectivityStep` — add video | "New social video added successfully to your website feed!" on profile state change | "New social video added to your website feed — auto-saving…" (the auto-save engine reports the real outcome) |
| 11 | `UserProfileSettingsModal` — fallback when `onSave` missing | "User profile settings saved successfully!" | "Profile updated — changes will be published automatically…" (no save claimed when no save pipeline is wired; in App the `onSave` path routes through `persistChange`) |

Each of the three managers (`ServiceManagement`, `TeamManagement`,
`LoyaltyManagement`) received the optional prop
`onPersistChange?: (message, overrides?) => Promise<SalonPersistResult>` —
threaded from `SaaSDashboard` (which receives it from `App`) — so the
components persist **explicitly** on user-initiated saves and can branch on
the real result, while passive state edits still ride the existing
auto-save engine (which already reports honestly).

## Intentionally NOT changed

- **`WebsiteSavedModal`** and the `Website saved successfully!` string — that
  modal is driven by `handleSaveNow` → `published` from the real pipeline;
  the string is asserted by `tests/templateCompletion.test.ts` and
  `tests/websiteSavedModal.test.ts`.
- **`LOCAL_DRAFT_STATUS_LABEL`** / the `saved_local` vocabulary — asserted by
  `tests/savePipeline.test.ts`.
- **Partner-side pages** (`GrowthPartnerProfilePage`, `PartnerProfileModal`,
  `PartnerAccountSettings*`) — already fixed and tested in Phase 10.
- **`WebsiteEditor`** save flow — already the correct reference pattern from
  Phase 10.
- The `Avatar image compressed and loaded successfully!` toast in
  `UserProfileSettingsModal` — describes a synchronous local operation that
  genuinely succeeded (compression + state load), not a save.

## Testing notes (recorded for future maintainers)

`tests/dom/saveSuccessIntegrity.test.ts` mounts the real components with a
controllable persist stub (the exact `onPersistChange` contract App provides)
and asserts the three-state behavior end-to-end. Two non-obvious gotchas cost
real debugging time:

1. **Never assert on a DOM node object with `node:assert`.** A failed
   `assert.equal(element, null)` formats `actual` at `depth: Infinity`;
   inspecting a live jsdom element expands its whole ancestor subtree —
   ~100–190 MB of string for the service catalog, minutes of CPU. Convert to
   booleans/strings first.
2. **Under jsdom's no-op `requestAnimationFrame`, `AnimatePresence` exit
   animations never complete**, so a closing modal lingers in the DOM. Assert
   success via the behavioral signal (form state reset on reopen, failure
   banner cleared), not via node removal.

## Verification

- `npx tsc --noEmit` — zero new errors (the pre-existing errors in
  `AuthModal` / `GrowthPartnerPage` / `salonStore` / two legacy test files are
  unchanged and exist on the base commit).
- `tests/dom/saveSuccessIntegrity.test.ts` — 6/6 pass (loyalty config
  Saving…/failed/retained/retry; loyalty config success & local-draft; loyalty
  reward form failure retention + retry; service add in-flight/failure
  retention/retry/success; team delete failure retention/retry; source guard
  that the old fake-success strings are gone).
- Existing DOM suites (`websiteEditorSessionNotice`, `websiteEditorResponsive`,
  `bookingSelectionState`) — all pass.
- `tests/templateCompletion.test.ts` + `tests/websiteSavedModal.test.ts` —
  24/24 pass (the real "Website saved successfully!" flow is intact).
- `tests/savePipeline.test.ts` + `tests/autoSave.test.ts` — identical results
  to the base commit (37 pass / 7 pre-existing environment failures related
  to the Node-side localStorage draft cache, unrelated to this change).
- `tests/authSessionRefresh`, `bookingDetail`, `corsApi`,
  `ownerWorkspaceRpc`, `phase7ClientStateCrossAccountLeak`, `salonSync`,
  `stylistAvatarUpload` — 94/94 pass.
