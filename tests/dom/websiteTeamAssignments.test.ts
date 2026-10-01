import { dom } from './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeamManagement } from '../../src/components/TeamManagement';
import type { SalonPersistResult, SalonEditorStatePatch } from '../../src/lib/autoSave';
import { prepareWebsiteStateForSave } from '../../src/lib/websiteContentNormalize';
import type { SalonService, Stylist } from '../../src/types';

// ============================================================================
// Adding a team member must not poison every later save.
//
// The Add Staff modal used to pre-select two hard-coded demo service NAMES
// ("Luxury Spa Pedicure", "Gel Polish Overlay") — even while the optional
// section was collapsed — so each new team member was saved with assignments to
// services that exist in nobody's menu. The database answers that with
// "Assigned service is not available in this salon" (22023), which the editor
// used to show as one generic "…could not be validated" toast, and because the
// whole save is one transaction NOTHING else (services, gallery, photos) was
// ever published.
// ============================================================================

const services: SalonService[] = [
  { id: 'srv-cut', name: 'Signature Haircut', category: 'Hair', durationMinutes: 45, price: 800, description: '', icon: 'Scissors' },
  { id: 'srv-color', name: 'Colour Glaze', category: 'Hair', durationMinutes: 90, price: 2500, description: '', icon: 'Scissors' },
];

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
const byText = (scope: ParentNode, text: string) => {
  const found = [...scope.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes(text));
  assert.ok(found, `button "${text}"`);
  return found as HTMLButtonElement;
};

async function mountTeam(result: SalonPersistResult | null) {
  const calls: { message: string; overrides?: SalonEditorStatePatch }[] = [];
  function Harness() {
    const [stylists, setStylists] = useState<Stylist[]>([]);
    return React.createElement(TeamManagement, {
      stylists, setStylists, services, primaryAccentColor: '#C20E5A', isAuthenticated: true,
      onPersistChange: async (message: string, overrides?: SalonEditorStatePatch) => {
        calls.push({ message, overrides });
        return result ?? { published: true, localDraft: false, failed: false };
      },
    } as any);
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => byText(container, 'Add New Stylist').click());
  return { container, calls, cleanup: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test('a team member added with just a name has no service assignments and saves cleanly against the real service list', async () => {
  const { container, calls, cleanup } = await mountTeam(null);
  try {
    await act(async () => setValue(document.querySelector('input[placeholder="e.g. Sarah Jenkins"]') as HTMLInputElement, 'Asha Verma'));
    await act(async () => byText(document.body, 'Add Staff Member').click());
    assert.equal(calls.length, 1);
    const added = calls[0].overrides!.stylists!.find((s) => s.name === 'Asha Verma')!;
    assert.deepEqual(added.assignedServices, [], 'no hard-coded demo service names');
    const prepared = prepareWebsiteStateForSave({ profile: {}, services, stylists: calls[0].overrides!.stylists });
    assert.deepEqual(prepared.errors, []);
    assert.deepEqual(prepared.changes.filter((c) => c.kind === 'service_assignment_removed'), [], 'nothing needed repairing');
  } finally { await cleanup(); }
});

test('the assigned-services list is the salon\'s own services and stores their IDs', async () => {
  const { container, calls, cleanup } = await mountTeam(null);
  try {
    await act(async () => setValue(document.querySelector('input[placeholder="e.g. Sarah Jenkins"]') as HTMLInputElement, 'Ravi'));
    await act(async () => byText(document.body, 'Add optional photo, contact, services & schedule').click());
    const dialog = document.getElementById('add-staff-modal-container')!;
    const options = [...dialog.querySelectorAll('button[aria-pressed]')].map((b) => (b.textContent || '').trim());
    assert.ok(options.some((text) => text.startsWith('Signature Haircut')));
    assert.ok(options.some((text) => text.startsWith('Colour Glaze')));
    assert.ok(!/Luxury Spa Pedicure|Gel Polish Overlay|Lash Lift/.test(dialog.textContent || ''), 'the demo services are gone');
    await act(async () => byText(dialog, 'Colour Glaze').click());
    await act(async () => byText(document.body, 'Add Staff Member').click());
    const added = calls[0].overrides!.stylists!.find((s) => s.name === 'Ravi')!;
    assert.deepEqual(added.assignedServices, ['srv-color']);
  } finally { await cleanup(); }
});

test('working hours that end before they start are marked on their row and block the submit', async () => {
  const { container, calls, cleanup } = await mountTeam(null);
  try {
    await act(async () => setValue(document.querySelector('input[placeholder="e.g. Sarah Jenkins"]') as HTMLInputElement, 'Meera'));
    await act(async () => byText(document.body, 'Add optional photo, contact, services & schedule').click());
    const monday = document.querySelector('[data-schedule-day="Monday"]') as HTMLElement;
    const [from, to] = [...monday.querySelectorAll('select')] as HTMLSelectElement[];
    await act(async () => { setValue(from, '06:00 PM'); setValue(to, '09:00 AM'); });
    assert.equal(monday.getAttribute('aria-invalid'), 'true');
    assert.match(monday.className, /border-red-400/);
    assert.match(document.querySelector('[data-field-error]')?.textContent || '', /Monday: the closing time must be after the opening time/);
    await act(async () => byText(document.body, 'Add Staff Member').click());
    assert.equal(calls.length, 0, 'nothing is saved until the hours are fixed');
    assert.match(document.body.textContent || '', /Fix the weekly schedule before saving\. Monday: the closing time must be after the opening time/);
    await act(async () => setValue(to, '07:00 PM'));
    assert.equal(document.querySelector('[data-field-error]'), null);
    await act(async () => byText(document.body, 'Add Staff Member').click());
    assert.equal(calls.length, 1);
  } finally { await cleanup(); }
});

test('when the save is rejected the banner names the field instead of the generic sentence', async () => {
  const { cleanup } = await mountTeam({
    published: false, localDraft: false, failed: true,
    error: 'Team member 1 (“Asha Verma”) › Portrait image: This image link is not valid. Paste a full image link that starts with https://, upload a JPG, PNG or WebP, or leave it empty.',
  });
  try {
    await act(async () => setValue(document.querySelector('input[placeholder="e.g. Sarah Jenkins"]') as HTMLInputElement, 'Asha Verma'));
    await act(async () => byText(document.body, 'Add Staff Member').click());
    const text = document.body.textContent || '';
    assert.match(text, /Save failed: Team member 1 \(“Asha Verma”\) › Portrait image: This image link is not valid/);
    assert.doesNotMatch(text, /could not be validated/);
  } finally { await cleanup(); }
});
