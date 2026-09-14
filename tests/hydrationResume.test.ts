import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeHydratedSalonState,
  type HydratableSalonState,
} from '../src/lib/hydrationMerge';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyaltyData';

// The real defaults live in src/mockData.ts, which transitively imports .jpg
// assets and so cannot be loaded by the node test runner. These stand-ins have
// the same shape; nothing here depends on their exact values, only on the fact
// that they differ from the saved row.
const INITIAL_SALON_PROFILE = { businessType: 'hair_salon' } as const;
const INITIAL_SERVICES = [{ id: 'default-1', name: 'Haircut', price: 900, duration: 45 }];
const INITIAL_STYLISTS = [{ id: 'default-stf', name: 'Default Stylist', role: 'Stylist' }];

// ============================================================================
// PHASE 3.2 — RESUME EXISTING ONBOARDING
//
//   signup -> partial setup -> logout -> login again
//
// Expected: continue from the existing authoritative state. Do not restart
// onboarding from zero.
//
// The authoritative state is `owner_editor_state`, written by
// save_owner_editor_state and read back by get_owner_editor_state on login.
// These tests pin the merge that turns it back into the app's in-memory state.
// ============================================================================

/** What a brand-new device starts with: no localStorage, so all defaults. */
const freshDevice = (): HydratableSalonState => ({
  profile: { ...INITIAL_SALON_PROFILE, businessName: 'Nexora Studio', ownerName: 'Owner' },
  services: INITIAL_SERVICES,
  stylists: INITIAL_STYLISTS,
  loyaltyConfig: DEFAULT_LOYALTY_CONFIG,
  selectedTemplateId: INITIAL_SALON_PROFILE.businessType,
});

/** What the owner actually saved before logging out. */
const savedPartialSetup = {
  profile: {
    businessName: 'Glow Studio',
    ownerName: 'Uma Rao',
    ownerRole: 'Founder & Master Stylist',
    tagline: 'Cut. Colour. Confidence.',
    businessType: 'nail_studio',
    city: 'Bengaluru',
  },
  services: [{ id: 'svc-1', name: 'Gel Manicure', price: 1800, duration: 60 }],
  stylists: [{ id: 'stf-1', name: 'Priya', role: 'Senior Technician' }],
  loyaltyConfig: { ...DEFAULT_LOYALTY_CONFIG, pointsPerVisit: 25 },
  selectedTemplateId: 'nail_studio',
};

const merge = (
  current: HydratableSalonState,
  beforeRead: HydratableSalonState = current,
  saved: any = savedPartialSetup
) => mergeHydratedSalonState({ current, beforeRead, saved, userId: 'u-1' });

// ---------------------------------------------------------------------------
// The headline case
// ---------------------------------------------------------------------------

test('logging in on a fresh device restores the whole partial setup, not the defaults', () => {
  const next = merge(freshDevice());
  assert.ok(next, 'a saved row is applied');
  assert.equal(next.profile.businessName, 'Glow Studio', 'the salon name comes back');
  assert.equal(next.profile.tagline, 'Cut. Colour. Confidence.');
  assert.deepEqual(next.services, savedPartialSetup.services, 'the services come back');
  assert.deepEqual(next.stylists, savedPartialSetup.stylists, 'the staff come back');
  assert.equal(next.loyaltyConfig.pointsPerVisit, 25, 'the loyalty config comes back');
  assert.equal(next.selectedTemplateId, 'nail_studio', 'the chosen template comes back');
});

test('the chosen template is restored — this is the field hydration used to drop', () => {
  const next = merge(freshDevice())!;
  // On a new device selectedTemplateId starts as the default; the saved one
  // must win, otherwise the app believes the owner is on the wrong template
  // and the next auto-save persists that mistake over their real choice.
  assert.notEqual(next.selectedTemplateId, INITIAL_SALON_PROFILE.businessType);
  assert.equal(next.selectedTemplateId, 'nail_studio');
  // And it must agree with the profile it was saved alongside — the two used to
  // disagree, which is what made mergeTemplatePreservingUserData unsafe.
  assert.equal(next.selectedTemplateId, next.profile.businessType);
});

test('the restored profile is bound to the signing-in owner', () => {
  assert.equal(merge(freshDevice())!.profile.ownerId, 'u-1');
});

test('a saved row that never recorded a template leaves the current one alone', () => {
  // An owner whose state predates the selectedTemplateId field must not be
  // reset to a default — an absent value is not a choice.
  const legacy = { ...savedPartialSetup, selectedTemplateId: undefined };
  const next = merge(freshDevice(), undefined, legacy)!;
  assert.equal(next.selectedTemplateId, freshDevice().selectedTemplateId);
  assert.equal(next.profile.businessName, 'Glow Studio', 'the rest still restores');
});

test('a blank saved template id is ignored, not applied', () => {
  for (const blank of ['', '   ']) {
    const next = merge(freshDevice(), undefined, { ...savedPartialSetup, selectedTemplateId: blank })!;
    assert.equal(next.selectedTemplateId, freshDevice().selectedTemplateId, `blank ${JSON.stringify(blank)}`);
  }
});

test('no saved row at all applies nothing', () => {
  assert.equal(merge(freshDevice(), undefined, null), null);
  // The caller must be able to tell "applied nothing" from "applied an empty
  // state" — otherwise a brand-new owner's defaults would be wiped.
});

// ---------------------------------------------------------------------------
// Edits made while the read was in flight must survive
// ---------------------------------------------------------------------------

test('a profile key the owner typed during the read is not overwritten', () => {
  const beforeRead = freshDevice();
  const current = {
    ...beforeRead,
    profile: { ...beforeRead.profile, tagline: 'Typed while it loaded' },
  };
  const next = merge(current, beforeRead)!;
  assert.equal(next.profile.tagline, 'Typed while it loaded', 'the keystroke survives');
  assert.equal(next.profile.businessName, 'Glow Studio', 'everything else still comes from the cloud');
});

test('startup defaults on a new device are NOT mistaken for edits', () => {
  // The distinction that makes resume work at all: on a fresh device every
  // profile key differs from the cloud row, but none of them are edits — the
  // owner never touched them. beforeRead === current is what proves it.
  const state = freshDevice();
  const next = merge(state, state)!;
  assert.equal(next.profile.businessName, 'Glow Studio');
  assert.equal(next.profile.city, 'Bengaluru');
  assert.equal(next.profile.ownerRole, 'Founder & Master Stylist');
});

test('arrays replaced during the read are kept', () => {
  const beforeRead = freshDevice();
  const editedServices = [{ id: 'local-1', name: 'Added just now', price: 500, duration: 30 }];
  const current = { ...beforeRead, services: editedServices };
  const next = merge(current, beforeRead)!;
  assert.deepEqual(next.services, editedServices, 'the local array wins');
  assert.deepEqual(next.stylists, savedPartialSetup.stylists, 'the untouched one still restores');
});

test('a template picked during the read is kept', () => {
  const beforeRead = freshDevice();
  const current = { ...beforeRead, selectedTemplateId: 'beauty_spa' };
  const next = merge(current, beforeRead)!;
  assert.equal(next.selectedTemplateId, 'beauty_spa', 'the owner chose after the read started');
});

// ---------------------------------------------------------------------------
// Re-login must be stable
// ---------------------------------------------------------------------------

test('logging in twice in a row is a no-op the second time', () => {
  // The second login hydrates a state that already IS the saved state, so the
  // merge must return something identical — otherwise every re-login would look
  // like an edit and trigger another save.
  const first = merge(freshDevice())!;
  const second = merge(first, first)!;
  assert.deepEqual(second.profile, first.profile);
  assert.deepEqual(second.services, first.services);
  assert.deepEqual(second.stylists, first.stylists);
  assert.deepEqual(second.loyaltyConfig, first.loyaltyConfig);
  assert.equal(second.selectedTemplateId, first.selectedTemplateId);
});

test('the merge is pure — it does not mutate the state it was given', () => {
  const current = freshDevice();
  const snapshot = JSON.stringify(current);
  merge(current);
  assert.equal(JSON.stringify(current), snapshot, 'the input is untouched');
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

test('App.tsx restores the template on hydration and keeps the template ref in step', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /mergeHydratedSalonState\(/, 'hydration uses the extracted merge');
  assert.match(app, /setSelectedTemplateId\(next\.selectedTemplateId/, 'and applies the restored template');

  // previousTemplateIdRef is what mergeTemplatePreservingUserData compares
  // against to decide which values are template defaults and which are the
  // owner's own. If it lags a render behind, picking a template right after
  // login treats the restored values as the OLD template's defaults and
  // replaces them — so it is set in the same block, not by the effect.
  const block = app.slice(app.indexOf('mergeHydratedSalonState({'));
  const setter = block.indexOf('setSelectedTemplateId(next.selectedTemplateId');
  const refSync = block.indexOf('previousTemplateIdRef.current = next.selectedTemplateId');
  assert.ok(setter > -1 && refSync > -1, 'both the state and the ref are set');
  assert.ok(refSync - setter < 600, 'and they are set together, in the same block');
});

test('the saved template id is what gets written back on the next save', () => {
  // The round trip: save sends state.selectedTemplateId, so restoring it on
  // hydration is what stops the next auto-save from persisting the default.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /selectedTemplateId: state\.selectedTemplateId/);
  const editorState = readFileSync(new URL('../src/lib/ownerEditorState.ts', import.meta.url), 'utf8');
  assert.match(editorState, /selectedTemplateId: payload\.selectedTemplateId/);
});

// ---------------------------------------------------------------------------
// Phase 12 — Template Change Data Safety (Code & Logic Verification)
// ---------------------------------------------------------------------------
test('Phase 12 — Template switching code preserves canonical business data and does not rebuild salon records', () => {
  const salonStoreCode = readFileSync(new URL('../src/lib/salonStore.ts', import.meta.url), 'utf8');
  const appCode = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  // 1. Preserves customized identity, contact & location fields
  assert.match(salonStoreCode, /export function mergeTemplatePreservingUserData/);
  assert.match(salonStoreCode, /keepIfCustomized\(prev\.businessName/);
  assert.match(salonStoreCode, /keepIfCustomized\(prev\.phone/);
  assert.match(salonStoreCode, /keepIfCustomized\(prev\.address/);
  assert.match(salonStoreCode, /keepIfCustomized\(prev\.city/);
  assert.match(salonStoreCode, /keepIfCustomized\(prev\.ownerName/);

  // 2. Spreads prev profile first to preserve payments, business hours, offers, custom domain & gallery
  assert.match(salonStoreCode, /\.\.\.prev,/);

  // 3. Preserves services & staff when customized
  assert.match(salonStoreCode, /export function areServicesCustomized/);
  assert.match(salonStoreCode, /export function areStylistsCustomized/);
  assert.match(salonStoreCode, /export function mergeTemplateServices/);
  assert.match(salonStoreCode, /export function mergeTemplateStylists/);

  // 4. App.tsx handleSelectTemplate updates in-memory state without rebuilding DB records
  assert.match(appCode, /const handleSelectTemplate = \(catId: BusinessTypeId\) =>/);
  assert.match(appCode, /mergeTemplatePreservingUserData\(prev, catId/);
  assert.match(appCode, /mergeTemplateServices\(prev, catId/);
  assert.match(appCode, /mergeTemplateStylists\(prev, catId/);

  const selectTmplFunc = appCode.slice(appCode.indexOf('const handleSelectTemplate ='), appCode.indexOf('const handleSelectCategory ='));
  assert.doesNotMatch(selectTmplFunc, /ensure_owner_workspace/, 'Template change must not provision or rebuild DB records');
});
