import { dom } from './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WebsiteIssuesPanel, WebsiteIssuesProvider, focusWebsiteField } from '../../src/components/WebsiteIssues';
import { ContentImageField } from '../../src/components/ContentImageField';
import { WebsiteContentEditor } from '../../src/components/WebsiteContentEditor';
import { StaffPortfolioEditor } from '../../src/components/StaffPortfolioEditor';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';
import { prepareWebsiteStateForSave } from '../../src/lib/websiteContentNormalize';
import { DEFAULT_GALLERY_IMAGE_URL } from '../../src/lib/websiteValidation';
import type { SalonProfile, SalonService, Stylist } from '../../src/types';

// ============================================================================
// Field-level save problems in the editor: red inputs, messages next to the
// field, the summary panel, and the default-image note for empty gallery slots.
// ============================================================================

type EditorState = { profile: SalonProfile; services: SalonService[]; stylists: Stylist[] };
type Api = { state: EditorState; setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>; setServices: React.Dispatch<React.SetStateAction<SalonService[]>>; setStylists: React.Dispatch<React.SetStateAction<Stylist[]>> };

let latest!: EditorState;

/** Holds editor state and feeds the provider exactly like App does (same issue computation). */
function Harness({ initial, revealed, children }: { initial: EditorState; revealed: boolean; children: (api: Api) => React.ReactNode }) {
  const [profile, setProfile] = useState(initial.profile);
  const [services, setServices] = useState(initial.services);
  const [stylists, setStylists] = useState(initial.stylists);
  latest = { profile, services, stylists };
  const issues = useMemo(() => prepareWebsiteStateForSave({ profile, services, stylists }).issues, [profile, services, stylists]);
  return React.createElement(WebsiteIssuesProvider, { issues, revealed }, children({ state: latest, setProfile, setServices, setStylists }));
}

async function mount(initial: Partial<EditorState>, revealed: boolean, children: (api: Api) => React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const base: EditorState = { profile: { ...INITIAL_SALON_PROFILE } as SalonProfile, services: [], stylists: [], ...initial };
  await act(async () => root.render(React.createElement(Harness, { initial: base, revealed, children })));
  return { container, cleanup: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const profileWith = (patch: Partial<SalonProfile>) => ({ ...INITIAL_SALON_PROFILE, gallery: [], socialVideos: [], testimonials: [], ...patch }) as SalonProfile;
const blur = (el: Element) => el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

test('an invalid gallery link turns its input red, shows the exact message and opens the row', async () => {
  const gallery = [{ id: 'g1', url: 'htp:/bad', title: 'Front desk', tag: 'Studio' }];
  const { container, cleanup } = await mount({ profile: profileWith({ gallery }) }, true, ({ state, setProfile, setServices }) =>
    React.createElement(WebsiteContentEditor, { profile: state.profile, setProfile, services: state.services, setServices }));
  try {
    const input = container.querySelector('[data-field-path="profile.gallery[0].url"]') as HTMLInputElement;
    assert.ok(input, 'the link input is addressable by its save path');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.match(input.className, /border-red-500/);
    assert.doesNotMatch(input.className, /border-slate-300/, 'the neutral border is replaced, not just added to');
    const message = container.querySelector('[data-field-error="profile.gallery[0].url"]');
    assert.match(message?.textContent || '', /This image link is not valid.*clear it to use the default image/);
    assert.equal(input.getAttribute('aria-describedby'), message?.id);
    const row = input.closest('details') as HTMLDetailsElement;
    assert.equal(row.open, true, 'the row opens by itself so the error is visible');
    assert.match(row.querySelector('summary')?.textContent || '', /Front desk.*Needs attention/);
  } finally { await cleanup(); }
});

test('nothing turns red before a save was attempted and blocked', async () => {
  const gallery = [{ id: 'g1', url: 'htp:/bad', title: 'Front desk', tag: 'Studio' }];
  const { container, cleanup } = await mount({ profile: profileWith({ gallery, ownerBio: 'x'.repeat(2500) }) }, false, ({ state, setProfile, setServices }) =>
    React.createElement(React.Fragment, null,
      React.createElement(WebsiteIssuesPanel),
      React.createElement(WebsiteContentEditor, { profile: state.profile, setProfile, services: state.services, setServices })));
  try {
    assert.equal(container.querySelector('[data-field-error]'), null);
    assert.equal(container.querySelector('[aria-invalid="true"]'), null);
    assert.equal(container.querySelector('[data-testid="website-issues-panel"]'), null);
    assert.equal((container.querySelector('details') as HTMLDetailsElement).open, false);
  } finally { await cleanup(); }
});

test('an empty gallery slot shows the default-image note; a slot already using it shows the placeholder with an empty link box', async () => {
  const empty = await mount({ profile: profileWith({ gallery: [{ id: 'g1', url: '', title: 'New showcase', tag: 'Studio' }] }) }, false, ({ state, setProfile, setServices }) =>
    React.createElement(WebsiteContentEditor, { profile: state.profile, setProfile, services: state.services, setServices }));
  try {
    assert.match(empty.container.querySelector('[data-default-image-note]')?.textContent || '', /A default image is shown on your website until you add one/);
  } finally { await empty.cleanup(); }

  const filled = await mount({ profile: profileWith({ gallery: [{ id: 'g1', url: DEFAULT_GALLERY_IMAGE_URL, title: 'New showcase', tag: 'Studio' }] }) }, false, ({ state, setProfile, setServices }) =>
    React.createElement(WebsiteContentEditor, { profile: state.profile, setProfile, services: state.services, setServices }));
  try {
    const input = filled.container.querySelector('[data-field-path="profile.gallery[0].url"]') as HTMLInputElement;
    assert.equal(input.value, '', 'the placeholder file path is not leaked into the link box');
    assert.equal(filled.container.querySelector('img[alt="Gallery image (default image)"]')?.getAttribute('src'), DEFAULT_GALLERY_IMAGE_URL);
    assert.match(filled.container.querySelector('[data-default-image-note]')?.textContent || '', /Using the default image/);
    const row = filled.container.querySelector('details')!;
    assert.ok(![...row.querySelectorAll('button')].some((b) => /Remove image/.test(b.textContent || '')), 'there is nothing to remove');
  } finally { await filled.cleanup(); }
});

test('a link pasted without https:// is completed when the field loses focus', async () => {
  const seen: string[] = [];
  const { container, cleanup } = await mount({}, false, () => {
    function Field() {
      const [value, setValue] = useState('');
      return React.createElement(ContentImageField, { label: 'Cover', value, onChange: (next: string) => { seen.push(next); setValue(next); } });
    }
    return React.createElement(Field);
  });
  try {
    const input = container.querySelector('input[type="url"]') as HTMLInputElement;
    await act(async () => typeInto(input, 'cdn.example.com/photos/a.jpg'));
    assert.match(container.textContent || '', /Enter a complete http\(s\) image URL/);
    assert.match(input.className, /border-red-500/, 'a link that is not usable yet is marked while it is wrong');
    await act(async () => blur(input));
    assert.deepEqual(seen, ['https://cdn.example.com/photos/a.jpg']);
    assert.equal(input.value, 'https://cdn.example.com/photos/a.jpg');
    assert.doesNotMatch(container.textContent || '', /Enter a complete http\(s\) image URL/);
  } finally { await cleanup(); }
});

test('the owner biography shows its limit, turns red over it, and the panel jumps to the field', async () => {
  const { container, cleanup } = await mount({ profile: profileWith({ ownerBio: 'x'.repeat(2100), gallery: [{ id: 'g1', url: 'htp:/bad', title: 'Front desk', tag: 'Studio' }] }) }, true, ({ state, setProfile, setServices }) =>
    React.createElement(React.Fragment, null,
      React.createElement(WebsiteIssuesPanel),
      React.createElement(WebsiteContentEditor, { profile: state.profile, setProfile, services: state.services, setServices })));
  try {
    const bio = container.querySelector('[data-field-path="profile.ownerBio"]') as HTMLTextAreaElement;
    assert.equal(bio.getAttribute('aria-invalid'), 'true');
    assert.match(container.querySelector('[data-field-error="profile.ownerBio"]')?.textContent || '', /2,000 characters \(it is 2,100 now\)/);
    assert.match(container.querySelector('[data-char-counter]')?.textContent || '', /2,100 \/ 2,000 characters/);

    const panel = container.querySelector('[data-testid="website-issues-panel"]')!;
    assert.match(panel.querySelector('h2')?.textContent || '', /2 fields need fixing before your website can be saved/);
    const jump = [...panel.querySelectorAll('button')].find((b) => /Professional biography/.test(b.textContent || ''))!;
    assert.ok(jump, 'each problem is a button that names its field');
    await act(async () => jump.click());
    assert.equal(document.activeElement, bio, 'clicking the problem focuses the exact input');

    // Fixing the field clears its marker live.
    await act(async () => typeInto(bio, 'Short and sweet.'));
    assert.equal(container.querySelector('[data-field-error="profile.ownerBio"]'), null);
    assert.match(container.querySelector('[data-testid="website-issues-panel"] h2')?.textContent || '', /1 field needs fixing/);
  } finally { await cleanup(); }
});

test('the panel lists warnings separately and only appears when something blocks the save', async () => {
  const onlyWarning = await mount({ profile: profileWith({ instagramHandle: 'not a handle!' }) }, true, () => React.createElement(WebsiteIssuesPanel));
  try { assert.equal(onlyWarning.container.querySelector('[data-testid="website-issues-panel"]'), null); } finally { await onlyWarning.cleanup(); }

  const both = await mount({ profile: profileWith({ instagramHandle: 'not a handle!' }), services: [{ ...INITIAL_SERVICES[0], price: -1 }] }, true, () => React.createElement(WebsiteIssuesPanel));
  try {
    const text = both.container.textContent || '';
    assert.match(text, /1 field needs fixing/);
    assert.match(text, /Service 1(?: .*)? › Price/);
    assert.match(text, /Also worth checking \(these do not block saving\)/);
    assert.match(text, /Social links › Instagram/);
  } finally { await both.cleanup(); }
});

test('team members: unnamed drafts are flagged amber, bad portraits red, and a pasted portrait link is completed on blur', async () => {
  const stylists = [
    { id: 's1', name: 'Asha', role: 'Stylist', avatarUrl: 'h', specialties: [], rating: 5, bio: 'x', portfolioUrl: '#gallery-section' },
    { id: 's2', name: '', role: 'Stylist', avatarUrl: '', specialties: [], rating: 5, bio: 'x', portfolioUrl: '#gallery-section' },
  ] as unknown as Stylist[];
  const { container, cleanup } = await mount({ stylists }, true, ({ state, setStylists }) =>
    React.createElement(StaffPortfolioEditor, { stylists: state.stylists, setStylists }));
  try {
    const portrait = container.querySelector('[data-field-path="stylists[0].avatarUrl"]') as HTMLInputElement;
    assert.equal(portrait.getAttribute('aria-invalid'), 'true');
    assert.match(portrait.className, /border-red-500/);
    assert.match(container.querySelector('[data-field-error="stylists[0].avatarUrl"]')?.textContent || '', /full image link/);
    const name = container.querySelector('[data-field-path="stylists[1].name"]') as HTMLInputElement;
    assert.match(name.className, /border-amber-500/);
    assert.match(container.querySelector('[data-field-error="stylists[1].name"]')?.textContent || '', /not published on your website/);
    assert.equal(name.getAttribute('aria-invalid'), null, 'a warning is not an error');

    await act(async () => typeInto(portrait, 'www.example.com/asha.jpg'));
    await act(async () => blur(portrait));
    assert.equal(latest.stylists[0].avatarUrl, 'https://www.example.com/asha.jpg');
    assert.equal(container.querySelector('[data-field-error="stylists[0].avatarUrl"]'), null, 'the error clears once the link is usable');
  } finally { await cleanup(); }
});

test('StaffPortfolioEditor renders and stays safe when a parent passes no team list', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(StaffPortfolioEditor, {} as any)));
    assert.match(container.textContent || '', /Meet Your Stylist/);
    assert.equal(container.querySelectorAll('article').length, 0);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test('the editor marks the exact service field and the save panel leads the owner to it', async () => {
  const services = [{ ...INITIAL_SERVICES[0], name: '   ', durationMinutes: 1.5 }, { ...INITIAL_SERVICES[1] }] as SalonService[];
  const { container, cleanup } = await mount({ profile: profileWith({}), services }, true, ({ state, setProfile, setServices, setStylists }) =>
    React.createElement(WebsiteEditor, {
      profile: state.profile, setProfile, services: state.services, setServices, stylists: state.stylists, setStylists,
      saveStatus: 'error' as any, lastSavedAt: null, onComplete: () => {}, siteUrl: 'https://example.test/salon',
      onSave: async () => false, onBackToDashboard: () => {}, showToast: () => {}, isAuthenticated: true,
    }));
  try {
    const name = container.querySelector('[data-field-path="services[0].name"]') as HTMLInputElement;
    assert.ok(name, 'the service name input carries its save path');
    assert.equal(name.getAttribute('aria-invalid'), 'true');
    assert.match(name.className, /border-red-500/);
    assert.match(container.querySelector('[data-field-error="services[0].name"]')?.textContent || '', /Enter a service name/);
    assert.match(container.querySelector('[data-field-error="services[0].durationMinutes"]')?.textContent || '', /whole number of minutes/);
    assert.equal(container.querySelector('[data-field-path="services[1].name"]')?.getAttribute('aria-invalid'), null, 'valid services are left alone');

    const panel = container.querySelector('[data-testid="website-issues-panel"]')!;
    assert.match(panel.textContent || '', /Service 1(?: .*)? › Name/);
    const jump = [...panel.querySelectorAll('button')].find((b) => /› Duration/.test(b.textContent || ''))!;
    await act(async () => jump.click());
    const mins = container.querySelector('[data-field-path="services[0].durationMinutes"]') as HTMLInputElement;
    assert.equal(document.activeElement, mins);
  } finally { await cleanup(); }
});

test('focusWebsiteField falls back from a missing input to its card, and reports a miss', async () => {
  const { container, cleanup } = await mount({ stylists: [{ id: 's1', name: 'Asha', role: 'Stylist', avatarUrl: '', specialties: [], rating: 5, bio: 'x', portfolioUrl: '#g' } as unknown as Stylist] }, false, ({ state, setStylists }) =>
    React.createElement(StaffPortfolioEditor, { stylists: state.stylists, setStylists }));
  try {
    assert.equal(focusWebsiteField('stylists[0].schedule[2]', container), true, 'schedule rows have no input: the team member card is used');
    assert.equal(focusWebsiteField('profile.nothing.here', container), false);
  } finally { await cleanup(); }
});
