import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// The preview preloads the cover image with `new Image()`; jsdom has the class on its window only.
const jsdomWindow = (globalThis as any).window;
if (jsdomWindow?.Image && typeof (globalThis as any).Image === 'undefined') (globalThis as any).Image = jsdomWindow.Image;

import { SalonWebsitePreview, shortServiceDescription } from '../../src/components/SalonWebsitePreview';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { getStylistBio } from '../../src/components/StaffPortfolioEditor';
import { INITIAL_SALON_PROFILE } from '../../src/mockData';

// ============================================================================
// Content the database hands back with ONLY the required fields.
//
// `save_owner_editor_state` requires an id, a name, a price and a duration for a service (and an id and a
// name for a team member). Everything else is optional, and JSON drops `undefined`, so what comes back from
// the database on the next visit has no `description`, `category`, `bio`, … at all.
//
// Found in a real browser: the owner preview read `service.description.length`, so a service saved without
// a description blanked the whole editor ("Something went wrong") as soon as it was loaded.
// ============================================================================

const sparseServices = [
  { id: 'svc-1', name: 'Haircut', price: 300, durationMinutes: 30 },
  { id: 'svc-2', name: 'Beard trim', price: 150, durationMinutes: 20 },
] as any[];
const sparseTeam = [{ id: 'st-1', name: 'Asha' }] as any[];

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, cleanup: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test('a service card description is safe when the service has none, and still shortens long text', () => {
  assert.equal(shortServiceDescription(undefined, false), '');
  assert.equal(shortServiceDescription(null, true), '');
  assert.equal(shortServiceDescription('Short and sweet.', false), 'Short and sweet.');
  const long = 'x'.repeat(200);
  assert.equal(shortServiceDescription(long, false), `${'x'.repeat(147)}…`, 'cut at 147 characters plus an ellipsis');
  assert.equal(shortServiceDescription(long, true), long, 'the whole text while editing');
});

test('a team member saved with only an id and a name still gets a sensible bio (it used to throw)', () => {
  assert.equal(
    getStylistBio({ id: 'st-1', name: 'Asha' } as any),
    'Asha is a team member known for personalised care. Every appointment begins with a thoughtful consultation and finishes with tailored aftercare.'
  );
  assert.match(getStylistBio({ id: 'st-2', name: 'Ravi', role: 'Barber', specialties: ['Fades', '', 'Beards', 'Shaves'] } as any), /^Ravi is a Barber known for Fades and Beards\./);
  assert.equal(getStylistBio({ id: 'st-3', name: 'Mina', bio: '  Colour expert.  ' } as any), 'Colour expert.');
});

test('the owner preview shows services that were saved without a description (it used to throw)', async () => {
  const t = await mount(React.createElement(SalonWebsitePreview, {
    profile: { ...INITIAL_SALON_PROFILE, gallery: [], socialVideos: [], testimonials: [] } as any, setProfile: () => {},
    services: sparseServices, setServices: () => {}, stylists: sparseTeam, setStylists: () => {},
    onAddAppointment: () => {}, user: { id: '10000000-0000-4000-8000-000000000001' } as any, onRequireAuth: () => {},
    siteUrl: 'https://example.test/salon',
  } as any));
  try {
    const text = t.container.textContent || '';
    assert.match(text, /Haircut/);
    assert.match(text, /Beard trim/);
    assert.doesNotMatch(text, /Something went wrong/);
  } finally { await t.cleanup(); }
});

test('the editor opens with services and a team member that only have their required fields', async () => {
  const t = await mount(React.createElement(WebsiteEditor, {
    profile: { ...INITIAL_SALON_PROFILE, gallery: [], socialVideos: [], testimonials: [] } as any, setProfile: () => {},
    services: sparseServices, setServices: () => {}, stylists: sparseTeam, setStylists: () => {},
    saveStatus: 'idle' as any, lastSavedAt: null, onComplete: () => {}, siteUrl: 'https://example.test/salon',
    onSave: async () => true, onBackToDashboard: () => {}, showToast: () => {}, isAuthenticated: true,
  } as any));
  try {
    assert.equal((t.container.querySelector('[data-field-path="services[0].name"]') as HTMLInputElement)?.value, 'Haircut');
    assert.equal((t.container.querySelector('[data-field-path="services[1].name"]') as HTMLInputElement)?.value, 'Beard trim');
    assert.equal((t.container.querySelector('[data-field-path="stylists[0].name"]') as HTMLInputElement)?.value, 'Asha');
    assert.ok(t.container.querySelector('[data-testid="open-live-site"]'), 'and the page around them is intact');
  } finally { await t.cleanup(); }
});
