import { dom } from './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { WebsiteIssuesProvider } from '../../src/components/WebsiteIssues';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';
import { prepareWebsiteStateForSave } from '../../src/lib/websiteContentNormalize';
import type { SaveStatus } from '../../src/lib/autoSave';
import type { SalonService } from '../../src/types';

// ============================================================================
// "Open Site" in the website editor.
//
// It used to run a full publish first and, when that failed, refuse to open the
// site with "Publish did not complete, so the live site was not opened." Now it
// is a plain new-tab link to the address that is live, whatever the draft holds;
// "Save & Update Website" is the only thing that validates and publishes, and it
// names the exact field that stops it.
// ============================================================================

const LIVE = 'https://fanal-templetes-app.vercel.app/?site=vijay-kumar';
const DRAFT = 'https://fanal-templetes-app.vercel.app/?site=vijay-salon';
const OLD_ERROR = /Publish did not complete|live site was not opened|Could not open the live site/i;

interface Options {
  saveStatus?: SaveStatus;
  siteUrl?: string;
  /** Pass `null` to leave the prop out entirely. */
  publishedSiteUrl?: string | null;
  onSave?: () => Promise<boolean>;
  services?: SalonService[];
  revealed?: boolean;
}

async function mount(options: Options = {}) {
  const toasts: string[] = [];
  const calls = { saves: 0 };
  const services = options.services ?? INITIAL_SERVICES;
  const profile = { ...INITIAL_SALON_PROFILE };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  // Records whether anything — the app's own handlers — cancelled the click before it
  // reached the document. A cancelled click would mean the link was intercepted.
  const clicks: boolean[] = [];
  const record = (event: Event) => { clicks.push(event.defaultPrevented); };
  document.addEventListener('click', record);

  const props: Record<string, unknown> = {
    profile, setProfile: () => {}, services, setServices: () => {}, stylists: [], setStylists: () => {},
    saveStatus: options.saveStatus ?? 'idle', lastSavedAt: null, onComplete: () => {},
    siteUrl: options.siteUrl ?? LIVE,
    onSave: options.onSave ?? (async () => { calls.saves++; return true; }),
    onBackToDashboard: () => {}, showToast: (message: string) => { toasts.push(message); }, isAuthenticated: true,
  };
  if (options.publishedSiteUrl !== null) props.publishedSiteUrl = options.publishedSiteUrl ?? LIVE;
  const issues = prepareWebsiteStateForSave({ profile, services, stylists: [] }).issues;
  await act(async () => {
    root.render(React.createElement(WebsiteIssuesProvider, { issues, revealed: !!options.revealed }, React.createElement(WebsiteEditor, props as any)));
  });
  return {
    container, toasts, calls, clicks,
    openSite: () => container.querySelector('[data-testid="open-live-site"]') as HTMLAnchorElement,
    notice: () => container.querySelector('[data-testid="live-site-notice"]') as HTMLElement | null,
    saveButtons: () => Array.from(container.querySelectorAll('button')).filter((b) => /Save & Update Website|Saving…/.test(b.textContent || '')),
    cleanup: async () => { document.removeEventListener('click', record); await act(async () => root.unmount()); container.remove(); },
  };
}

test('Open Site is a plain new-tab link to the published address — not a button that saves', async () => {
  const t = await mount();
  try {
    const link = t.openSite();
    assert.ok(link, 'Open Site renders');
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), LIVE);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(link.getAttribute('rel') || '', /\bnoopener\b/);
    assert.match(link.textContent || '', /Open Site/);
    assert.ok(!Array.from(t.container.querySelectorAll('button')).some((b) => /Open Site/.test(b.textContent || '')), 'there is no Open Site button left to gate on a save');
    assert.equal(link.getAttribute('aria-disabled'), null);
  } finally { await t.cleanup(); }
});

test('clicking Open Site never saves, never shows a publish error and is never intercepted', async () => {
  const t = await mount({ saveStatus: 'error', onSave: async () => { t.calls.saves++; return false; } });
  try {
    await act(async () => t.openSite().click());
    assert.equal(t.calls.saves, 0, 'viewing the site must not trigger a save');
    assert.deepEqual(t.clicks, [false], 'no handler cancelled the click, so the browser opens the link');
    assert.equal(t.toasts.filter((m) => OLD_ERROR.test(m)).length, 0);
    assert.doesNotMatch(t.container.textContent || '', OLD_ERROR);
    assert.equal(t.openSite().getAttribute('href'), LIVE);
  } finally { await t.cleanup(); }
});

test('Open Site stays available, with the same address and label, while a save is running', async () => {
  let release!: (saved: boolean) => void;
  const t = await mount({ onSave: () => new Promise<boolean>((resolve) => { release = resolve; }) });
  try {
    await act(async () => t.saveButtons()[0].click());
    assert.match(t.saveButtons()[0].textContent || '', /Saving…/, 'the save really is in flight');
    const link = t.openSite();
    assert.equal(link.getAttribute('href'), LIVE);
    assert.match(link.textContent || '', /Open Site/);
    assert.doesNotMatch(link.textContent || '', /Saving/);
    t.clicks.length = 0; // only the click on the link is of interest from here on
    await act(async () => link.click());
    assert.deepEqual(t.clicks, [false], 'the click on the link was not cancelled while the save ran');
    await act(async () => release(false));
    assert.equal(t.toasts.filter((m) => OLD_ERROR.test(m)).length, 0);
  } finally { await t.cleanup(); }
});

test('a failed save shows "You have unsaved changes" beside the link, and the link still opens the live site', async () => {
  const t = await mount({ saveStatus: 'error' });
  try {
    const notice = t.notice();
    assert.ok(notice, 'the notice is shown');
    assert.equal(notice!.getAttribute('data-notice-kind'), 'failed');
    assert.equal(notice!.getAttribute('role'), 'status');
    assert.match(notice!.textContent || '', /You have unsaved changes/);
    assert.match(notice!.textContent || '', /live website still shows the version you published before/);
    assert.equal(t.openSite().getAttribute('href'), LIVE, 'the link is not affected by the notice');
    assert.ok(t.container.contains(notice) && notice!.compareDocumentPosition(t.openSite()) & dom.window.Node.DOCUMENT_POSITION_PRECEDING, 'the notice sits after the link, never in front of it');
  } finally { await t.cleanup(); }
});

test('"Save now" in the notice runs the explicit save — and only that does', async () => {
  const t = await mount({ saveStatus: 'error', onSave: async () => { t.calls.saves++; return false; } });
  try {
    const save = Array.from(t.notice()!.querySelectorAll('button')).find((b) => /Save now/.test(b.textContent || ''));
    assert.ok(save, 'the notice offers a way to save');
    await act(async () => save!.click());
    assert.equal(t.calls.saves, 1);
    await act(async () => t.openSite().click());
    assert.equal(t.calls.saves, 1, 'opening the site afterwards saves nothing more');
  } finally { await t.cleanup(); }
});

test('a new address that is not live yet is named, and Open Site keeps leading to the live one', async () => {
  const t = await mount({ saveStatus: 'idle', siteUrl: DRAFT, publishedSiteUrl: LIVE });
  try {
    assert.equal(t.openSite().getAttribute('href'), LIVE, 'never the address that does not exist yet');
    assert.match(t.container.textContent || '', new RegExp(DRAFT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the editor still shows the address being typed');
    const notice = t.notice();
    assert.equal(notice?.getAttribute('data-notice-kind'), 'address');
    assert.match(notice!.textContent || '', /You have unsaved changes/);
    assert.match(notice!.textContent || '', /goes live when you save/);
    assert.equal(notice!.querySelector('[data-testid="live-site-notice-url"]')?.textContent, `Live now: ${LIVE}`);
  } finally { await t.cleanup(); }
});

test('a failed save with an address that is not live yet still tells which address Open Site opens', async () => {
  const t = await mount({ saveStatus: 'error', siteUrl: DRAFT, publishedSiteUrl: LIVE });
  try {
    assert.equal(t.notice()?.getAttribute('data-notice-kind'), 'failed');
    assert.equal(t.notice()!.querySelector('[data-testid="live-site-notice-url"]')?.textContent, `Live now: ${LIVE}`);
    assert.equal(t.openSite().getAttribute('href'), LIVE);
  } finally { await t.cleanup(); }
  const same = await mount({ saveStatus: 'error' });
  try {
    assert.equal(same.notice()!.querySelector('[data-testid="live-site-notice-url"]'), null, 'no extra line when the card already shows the live address');
  } finally { await same.cleanup(); }
});

test('no notice while saving by itself, and none when nothing is ahead of the live site', async () => {
  for (const saveStatus of ['pending', 'saving'] as const) {
    const t = await mount({ saveStatus, siteUrl: DRAFT, publishedSiteUrl: LIVE });
    try {
      assert.equal(t.notice(), null, `${saveStatus}: the status pill already says Saving…`);
      assert.equal(t.openSite().getAttribute('href'), LIVE);
    } finally { await t.cleanup(); }
  }
  for (const saveStatus of ['idle', 'saved'] as const) {
    const t = await mount({ saveStatus });
    try {
      assert.equal(t.notice(), null, `${saveStatus}: everything is live`);
      assert.equal(t.openSite().getAttribute('href'), LIVE);
    } finally { await t.cleanup(); }
  }
});

test('before an address is confirmed, Open Site uses the address shown in the editor', async () => {
  const t = await mount({ siteUrl: DRAFT, publishedSiteUrl: null });
  try {
    assert.equal(t.openSite().getAttribute('href'), DRAFT);
    assert.equal(t.notice(), null, 'with nothing to compare against there is nothing to warn about');
  } finally { await t.cleanup(); }
});

test('a save blocked by invalid content marks the exact field, and the live link is unaffected', async () => {
  const services = [{ ...INITIAL_SERVICES[0], name: '   ' }, { ...INITIAL_SERVICES[1] }] as SalonService[];
  const t = await mount({ saveStatus: 'error', services, revealed: true, onSave: async () => { t.calls.saves++; return false; } });
  try {
    // The owner sees which field to fix …
    const field = t.container.querySelector('[data-field-path="services[0].name"]') as HTMLInputElement;
    assert.equal(field.getAttribute('aria-invalid'), 'true');
    assert.match(field.className, /border-red-500/);
    assert.match(t.container.querySelector('[data-field-error="services[0].name"]')?.textContent || '', /Enter a service name/);
    assert.match(t.container.querySelector('[data-testid="website-issues-panel"]')?.textContent || '', /Service 1(?: .*)? › Name/);

    // … the unsaved-changes notice is there …
    assert.match(t.notice()?.textContent || '', /You have unsaved changes/);

    // … and neither the explicit save nor the link ever produces the old generic publish error.
    await act(async () => t.saveButtons()[0].click());
    assert.equal(t.calls.saves, 1);
    await act(async () => t.openSite().click());
    assert.equal(t.calls.saves, 1);
    assert.equal(t.openSite().getAttribute('href'), LIVE);
    assert.equal(t.toasts.filter((m) => OLD_ERROR.test(m)).length, 0);
    assert.doesNotMatch(t.container.textContent || '', OLD_ERROR);
  } finally { await t.cleanup(); }
});
