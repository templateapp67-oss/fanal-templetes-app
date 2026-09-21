// ============================================================================
// PHASE 11 — "Remove fake save success" DOM tests.
//
// A successful React state update (or a localStorage write) is NOT a
// successful cloud save. These tests mount the REAL management components and
// assert the UI differentiates:
//
//   Saving…   — while the real persistence pipeline is in flight,
//   Saved     — only AFTER the pipeline reports the cloud (or service-role
//               API) accepted the state,
//   Save failed + retry — when the pipeline fails, with the local state
//   RETAINED (never rolled back) and an actionable retry.
//
// The persist pipeline is injected (onPersistChange) exactly as App.tsx wires
// it (App.persistChange → persistSalonState), with a controllable promise so
// the in-flight / failure / success states can be observed.
//
// Testing notes:
//   - Assertions compare STRINGS and plain values, never DOM nodes: node:assert
//     formats failed values at depth Infinity, and inspecting a live jsdom
//     element expands the whole rendered subtree (100 MB+ of text) — a slow,
//     misleading failure mode.
//   - Under jsdom's no-op requestAnimationFrame, AnimatePresence exit
//     animations never complete, so a closing modal may still linger in the
//     DOM after the success settle. Success is therefore asserted via the
//     behavioral signal (form state reset + no failure banner), not via node
//     removal.
// ============================================================================

import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoyaltyManagement } from '../../src/components/LoyaltyManagement';
import { ServiceManagement } from '../../src/components/ServiceManagement';
import { TeamManagement } from '../../src/components/TeamManagement';
import type { SalonPersistResult, SalonEditorStatePatch } from '../../src/lib/autoSave';
import type {
  LoyaltyConfig,
  SalonProfile,
  SalonService,
  Stylist,
} from '../../src/types';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

const PUBLISHED: SalonPersistResult = { published: true, localDraft: false, failed: false };
const LOCAL_DRAFT: SalonPersistResult = { published: false, localDraft: true, failed: false };
const FAILED: SalonPersistResult = { published: false, localDraft: false, failed: true };

const sampleProfile = {
  ownerId: 'owner-1',
  subdomain: 'demo-salon',
  businessName: 'Glam Studio',
  city: 'Mumbai',
  currency: '₹',
  phone: '9876543210',
} as SalonProfile;

const sampleLoyaltyConfig: LoyaltyConfig = {
  programEnabled: true,
  pointsPerVisit: 10,
  pointsPerHundredSpent: 5,
  tierThresholds: { bronze: 0, silver: 500, gold: 1500, platinum: 5000 },
  tierMultipliers: { bronze: 1, silver: 1.5, gold: 2, platinum: 3 },
  rewards: [
    {
      id: 'rew-1',
      title: 'Glow Kit',
      requiredPoints: 500,
      rewardType: 'percentage_discount',
      discountValue: 10,
      applicableCategory: 'All Services',
      description: '10% off voucher',
      isActive: true,
      couponCodePrefix: 'GLOW',
    },
  ],
};

const sampleServices: SalonService[] = [
  {
    id: 'srv-1',
    name: 'Signature Haircut',
    category: 'Precision Cuts',
    durationMinutes: 45,
    price: 800,
    description: 'Precision cut + finish',
    icon: 'Scissors',
  },
];

const sampleStylists: Stylist[] = [
  {
    id: 'sty-1',
    name: 'Ananya',
    role: 'Senior Stylist',
    avatarUrl: 'https://example.test/avatar.jpg',
    specialties: ['Hair Cutting'],
    rating: 4.9,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Controllable persistence stub — records every call and lets the test
 * resolve the in-flight save with a chosen outcome (exactly the contract
 * App.persistChange provides to the components).
 */
function makePersistStub() {
  const calls: { message: string; overrides?: SalonEditorStatePatch }[] = [];
  let resolveNext: ((r: SalonPersistResult) => void) | null = null;
  const onPersistChange = (
    message: string,
    overrides?: SalonEditorStatePatch
  ): Promise<SalonPersistResult> => {
    calls.push({ message, overrides });
    return new Promise<SalonPersistResult>((resolve) => {
      resolveNext = resolve;
    });
  };
  return {
    calls,
    onPersistChange,
    /** Resolve the currently in-flight save (if any) with `result`. */
    settle(result: SalonPersistResult) {
      const resolve = resolveNext;
      resolveNext = null;
      return act(async () => {
        resolve?.(result);
        // Let the component's `await` continuation + state update flush.
        await Promise.resolve();
      });
    },
  };
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const buttons = Array.from(scope.querySelectorAll('button'));
  const btn = buttons.find((b) => (b.textContent || '').trim().includes(text));
  if (!btn) throw new Error(`button not found: "${text}"`);
  return btn as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!
    .set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function bodyText(): string {
  return document.body.textContent || '';
}

const SERVICE_NAME_INPUT_SELECTOR = 'input[placeholder="e.g. Master Precision Cut & Argan Wash"]';

/**
 * Harness = the parent (App) that owns the REAL React state. The component
 * under test receives lifted state + setters, exactly as SaaSDashboard wires
 * it, so state retention across a failed save behaves like production.
 */
function mountLoyaltyHarness(onPersistChange: (m: string, o?: SalonEditorStatePatch) => Promise<SalonPersistResult>) {
  function Harness() {
    const [cfg, setCfg] = useState(sampleLoyaltyConfig);
    return React.createElement(LoyaltyManagement, {
      clients: [],
      setClients: () => {},
      loyaltyConfig: cfg,
      setLoyaltyConfig: setCfg,
      profile: sampleProfile,
      onPersistChange,
    });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  return { container, root };
}

function mountServiceHarness(onPersistChange: (m: string, o?: SalonEditorStatePatch) => Promise<SalonPersistResult>) {
  const seen: SalonService[][] = [sampleServices];
  function Harness() {
    const [svcs, setSvcs] = useState(sampleServices);
    const track = (v: React.SetStateAction<SalonService[]>) => {
      seen.push(typeof v === 'function' ? (v as (p: SalonService[]) => SalonService[])(seen[seen.length - 1]) : v);
    };
    return React.createElement(ServiceManagement, {
      services: svcs,
      setServices: (v: React.SetStateAction<SalonService[]>) => {
        track(v);
        setSvcs(v);
      },
      primaryAccentColor: '#C20E5A',
      profile: sampleProfile,
      onPersistChange,
    });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  return { container, root, seen };
}

function mountTeamHarness(onPersistChange: (m: string, o?: SalonEditorStatePatch) => Promise<SalonPersistResult>) {
  const seen: Stylist[][] = [sampleStylists];
  function Harness() {
    const [sts, setSts] = useState(sampleStylists);
    const track = (v: React.SetStateAction<Stylist[]>) => {
      seen.push(typeof v === 'function' ? (v as (p: Stylist[]) => Stylist[])(seen[seen.length - 1]) : v);
    };
    return React.createElement(TeamManagement, {
      stylists: sts,
      setStylists: (v: React.SetStateAction<Stylist[]>) => {
        track(v);
        setSts(v);
      },
      primaryAccentColor: '#C20E5A',
      onPersistChange,
    });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  return { container, root, seen };
}

function unmount(container: HTMLElement, root: Root) {
  act(() => root.unmount());
  container.remove();
}

/**
 * The reward modal's title input (may be null if the modal was fully removed
 * from the DOM — the exit animation can complete in a faster environment).
 */
function rewardModalTitleInput(container: HTMLElement): HTMLInputElement | null {
  const heading = Array.from(container.querySelectorAll('h3')).find((h) =>
    (h.textContent || '').includes('Create New Reward Milestone')
  );
  if (!heading) return null;
  const modal = heading.closest('.fixed');
  if (!modal) return null;
  return (modal.querySelector('input[type="text"]') as HTMLInputElement | null) || null;
}

// ---------------------------------------------------------------------------
// LOYALTY — "Save Configuration Changes" (was a toast with NO persistence)
// ---------------------------------------------------------------------------

test('loyalty config save: Saving… in flight, no success claim before the cloud answers, failure retains state + offers retry', async () => {
  const stub = makePersistStub();
  const { container, root } = mountLoyaltyHarness(stub.onPersistChange);
  try {
    // Go to the "Earning Rules & Tier Thresholds" sub-tab.
    act(() => {
      buttonByText(container, 'Earning Rules & Tier Thresholds').click();
    });

    // Edit the silver tier threshold (500 → 600) — a real React state change.
    const silverInput = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    ).find((i) => i.value === '500');
    assert.ok(!!silverInput, 'silver threshold input rendered');
    act(() => {
      setInputValue(silverInput!, '600');
    });

    // Click "Save Configuration Changes" while the save is still in flight.
    act(() => {
      buttonByText(container, 'Save Configuration Changes').click();
    });

    // While in flight: the button reports Saving… and NOTHING claims the
    // save succeeded (the old code toasted "saved successfully!" here with
    // no persistence call at all).
    assert.match(buttonByText(container, 'Saving…').textContent || '', /Saving…/);
    assert.doesNotMatch(bodyText(), /saved successfully/i);
    assert.equal(stub.calls.length, 1);

    // The save went out with the EDITED snapshot (state retained + correct
    // payload — no stale pre-change state).
    assert.equal(stub.calls[0].overrides?.loyaltyConfig?.tierThresholds.silver, 600);

    // Cloud fails → "Save failed" + actionable retry, still no success claim.
    await stub.settle(FAILED);
    assert.doesNotMatch(bodyText(), /saved successfully/i);
    assert.match(bodyText(), /Save failed/);
    assert.match(bodyText(), /kept on this device/);
    assert.ok(buttonByText(container, 'Retry save'), 'retry button offered after failure');

    // Retry re-runs the real pipeline with the retained state.
    act(() => {
      buttonByText(container, 'Retry save').click();
    });
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[1].overrides?.loyaltyConfig?.tierThresholds.silver, 600);

    // Cloud accepts on retry → failure UI clears.
    await stub.settle(PUBLISHED);
    assert.doesNotMatch(bodyText(), /Save failed/);
  } finally {
    unmount(container, root);
  }
});

test('loyalty config save: success (cloud or local draft) claims no error and re-enables the button', async () => {
  const stub = makePersistStub();
  const { container, root } = mountLoyaltyHarness(stub.onPersistChange);
  try {
    act(() => {
      buttonByText(container, 'Earning Rules & Tier Thresholds').click();
    });
    act(() => {
      buttonByText(container, 'Save Configuration Changes').click();
    });
    await stub.settle(PUBLISHED);
    assert.doesNotMatch(bodyText(), /Save failed/);
    assert.ok(buttonByText(container, 'Save Configuration Changes'));
    assert.equal(stub.calls[0].message, '✓ Loyalty rules and tier parameters saved successfully.');

    // A local-draft outcome (cloud down, device holds it) is also NOT an
    // error — the engine presents the honest "saved on this device" variant.
    act(() => {
      buttonByText(container, 'Save Configuration Changes').click();
    });
    await stub.settle(LOCAL_DRAFT);
    assert.doesNotMatch(bodyText(), /Save failed/);
  } finally {
    unmount(container, root);
  }
});

test('loyalty reward form: a failed cloud save keeps the form open (state retained) without a fake success', async () => {
  const stub = makePersistStub();
  const { container, root } = mountLoyaltyHarness(stub.onPersistChange);
  try {
    // Open "Add Reward Threshold".
    act(() => {
      buttonByText(container, 'Add Reward Threshold').click();
    });
    assert.ok(!!rewardModalTitleInput(container), 'reward modal open');

    // Fill the title (required) and submit.
    act(() => {
      setInputValue(rewardModalTitleInput(container)!, 'VIP Glow Session');
    });
    act(() => {
      buttonByText(container, 'Create Threshold').click();
    });

    // In flight: Saving… on the submit button, no success claim anywhere.
    assert.match(buttonByText(container, 'Saving…').textContent || '', /Saving…/);
    assert.doesNotMatch(bodyText(), /saved successfully/i);

    // Failure: the modal stays open (the reward edit is RETAINED in state)…
    await stub.settle(FAILED);
    assert.ok(
      !!rewardModalTitleInput(container) && rewardModalTitleInput(container)!.value === 'VIP Glow Session',
      'reward form still open with the entered title after a failed save'
    );
    assert.match(bodyText(), /Saving the reward change failed/);
    assert.doesNotMatch(bodyText(), /saved successfully/i);

    // …and the persist call carried the new reward (retained, not lost).
    const overrides = stub.calls[0].overrides?.loyaltyConfig;
    assert.equal(overrides?.rewards.length, 2);
    assert.equal(overrides?.rewards[1]?.title, 'VIP Glow Session');

    // Resubmit (retry) → success closes the modal and resets the form. (The
    // exit animation may leave a lingering modal in the DOM under jsdom, so
    // the behavioral signal — the reset title field — is what we assert.)
    act(() => {
      buttonByText(container, 'Create Threshold').click();
    });
    await stub.settle(PUBLISHED);
    const titleAfter = rewardModalTitleInput(container);
    assert.equal(titleAfter ? titleAfter.value : '', '', 'reward form reset after the save succeeded');
    assert.doesNotMatch(bodyText(), /Saving the reward change failed/);
  } finally {
    unmount(container, root);
  }
});

// ---------------------------------------------------------------------------
// SERVICES — add a service (was an instant "successfully" toast)
// ---------------------------------------------------------------------------

test('service save: no "successfully" claim before the cloud answers; failure keeps the form open with the edit retained', async () => {
  const stub = makePersistStub();
  const { container, root, seen } = mountServiceHarness(stub.onPersistChange);
  try {
    act(() => {
      buttonByText(container, 'Add New Service').click();
    });

    const nameInput = container.querySelector(SERVICE_NAME_INPUT_SELECTOR) as HTMLInputElement | null;
    assert.ok(!!nameInput, 'service name input rendered');
    act(() => {
      setInputValue(nameInput!, 'Lash Lift & Tint');
    });

    act(() => {
      buttonByText(container, 'Create Service').click();
    });

    // In flight: the submit button says Saving… and nothing claims success.
    assert.match(buttonByText(container, 'Saving…').textContent || '', /Saving…/);
    assert.doesNotMatch(bodyText(), /successfully/i);
    assert.equal(stub.calls.length, 1);
    // The new service is in the payload (local state already applied).
    assert.equal(stub.calls[0].overrides?.services?.length, 2);
    assert.equal(stub.calls[0].overrides?.services?.[0]?.name, 'Lash Lift & Tint');

    // Cloud failure: the form STAYS OPEN (unsaved UI state retained), the
    // exact failure is surfaced with a retry — and never "successfully".
    await stub.settle(FAILED);
    const nameAfterFail = container.querySelector(SERVICE_NAME_INPUT_SELECTOR) as HTMLInputElement | null;
    assert.equal(
      nameAfterFail ? nameAfterFail.value : '',
      'Lash Lift & Tint',
      'service form still open with the entered name after a failed save'
    );
    assert.match(bodyText(), /Save failed/);
    assert.doesNotMatch(bodyText(), /successfully/i);

    // The retained state is visible: the new service is in local state.
    assert.equal(seen[seen.length - 1].length, 2);

    // Retry by resubmitting → success closes the form and clears the failure
    // banner. The app resets the form fields on OPEN, so the observable
    // consequence of the close is: reopening shows a FRESH form, not the
    // stale draft.
    act(() => {
      buttonByText(container, 'Create Service').click();
    });
    assert.equal(stub.calls.length, 2);
    await stub.settle(PUBLISHED);
    assert.doesNotMatch(bodyText(), /Save failed/);
    act(() => {
      buttonByText(container, 'Add New Service').click();
    });
    const reopened = container.querySelector(SERVICE_NAME_INPUT_SELECTOR) as HTMLInputElement | null;
    assert.ok(!!reopened, 'service form renders when reopened');
    assert.equal(
      reopened ? reopened.value : '',
      '',
      'reopened form is fresh after a successful save (the draft is not resurrected)'
    );
  } finally {
    unmount(container, root);
  }
});

// ---------------------------------------------------------------------------
// TEAM — delete a stylist (was an instant "removed from team" claim)
// ---------------------------------------------------------------------------

test('team delete: no "removed" claim until the cloud answers; failure retains the deletion with a retry', async () => {
  const stub = makePersistStub();
  const { container, root, seen } = mountTeamHarness(stub.onPersistChange);
  try {
    // Open the delete confirmation from the stylist card (trash icon).
    const trashIcon = container.querySelector('svg.lucide-trash-2');
    assert.ok(!!trashIcon, 'delete icon rendered');
    const deleteButton = trashIcon!.closest('button') as HTMLButtonElement;
    act(() => {
      deleteButton.click();
    });
    assert.ok(container.textContent?.includes('Remove Stylist?'));

    act(() => {
      buttonByText(container, 'Confirm Delete').click();
    });

    // In flight: nothing claims the stylist was removed.
    assert.doesNotMatch(bodyText(), /removed from team/i);
    assert.equal(stub.calls.length, 1);
    // The deletion is in the payload (local state already applied).
    assert.equal(stub.calls[0].overrides?.stylists?.length, 0);

    // Cloud failure: NO "removed" claim, a failure + retry is offered, and
    // the deletion is retained in local state (retry re-sends it).
    await stub.settle(FAILED);
    assert.doesNotMatch(bodyText(), /removed from team/i);
    assert.match(bodyText(), /Saving the removal of "Ananya" failed/);
    assert.ok(buttonByText(container, 'Retry save'), 'retry offered after a failed delete save');
    assert.equal(seen[seen.length - 1].length, 0, 'deletion retained in local state');

    // Retry → the cloud accepts → failure UI clears.
    act(() => {
      buttonByText(container, 'Retry save').click();
    });
    assert.equal(stub.calls.length, 2);
    await stub.settle(PUBLISHED);
    assert.doesNotMatch(bodyText(), /Save failed/);
  } finally {
    unmount(container, root);
  }
});

// ---------------------------------------------------------------------------
// Source guard — the specific fake-success strings are gone for good
// ---------------------------------------------------------------------------

test('the old fake-save-success strings are removed from the owner-app UI', () => {
  // Tests run from the repository root (see package.json scripts).
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  // The loyalty "Save Configuration Changes" button must not toast directly.
  const loyalty = read('src/components/LoyaltyManagement.tsx');
  assert.doesNotMatch(loyalty, /onClick=\{\(\) => showToast\('✓ Loyalty rules/);

  // The dashboard logo/hero toasts must not claim "& saved!".
  const dashboard = read('src/components/SaaSDashboard.tsx');
  assert.doesNotMatch(dashboard, /& saved!/);

  // The social step must not claim a successful website publish.
  const social = read('src/components/SocialConnectivityStep.tsx');
  assert.doesNotMatch(social, /added successfully to your website feed/);

  // The header profile save must not toast before the pipeline answers.
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /onProfileSaved=\{\(patch\) => \{ setProfile\(prev => \(\{ \.\.\.prev, \.\.\.patch \}\)\); showToast\('Profile saved successfully/);
});
