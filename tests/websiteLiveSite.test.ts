import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNSAVED_CHANGES_TITLE,
  getLiveSiteNotice,
  getLiveSiteUrl,
  publishedAddressOf,
} from '../src/lib/liveSite';
import { INITIAL_SALON_PROFILE } from '../src/mockData';
import type { SalonProfile } from '../src/types';

// ============================================================================
// "Open Site" is navigation: it reads the published address and never depends on
// a save. These are the rules behind which address it opens and when the
// "You have unsaved changes" notice appears next to it.
// ============================================================================

const profile = (patch: Partial<SalonProfile> = {}): SalonProfile =>
  ({ ...INITIAL_SALON_PROFILE, businessName: 'Vijay Kumar', subdomain: 'vijay-kumar', customDomain: undefined, ...patch }) as SalonProfile;

const LIVE = 'https://fanal-templetes-app.vercel.app/?site=vijay-kumar';

test('the published address is what the cloud holds, trimmed — and nothing when there is no address', () => {
  assert.deepEqual(publishedAddressOf({ subdomain: '  vijay-kumar ' }), { subdomain: 'vijay-kumar', customDomain: '' });
  assert.deepEqual(publishedAddressOf({ subdomain: '', customDomain: ' salon.example.com ' }), { subdomain: '', customDomain: 'salon.example.com' });
  assert.equal(publishedAddressOf({ subdomain: '   ' }), null);
  assert.equal(publishedAddressOf({}), null);
  assert.equal(publishedAddressOf(null), null);
  assert.equal(publishedAddressOf(undefined), null);
});

test('the live URL is the canonical production link for the saved slug', () => {
  assert.equal(getLiveSiteUrl(profile(), publishedAddressOf({ subdomain: 'vijay-kumar' })), LIVE);
});

test('a draft address that was never saved does not change where Open Site leads', () => {
  const draft = profile({ subdomain: 'vijay-salon' });
  assert.equal(getLiveSiteUrl(draft, publishedAddressOf({ subdomain: 'vijay-kumar' })), LIVE, 'the live address wins over the typed one');
  assert.equal(getLiveSiteUrl(draft, null), 'https://fanal-templetes-app.vercel.app/?site=vijay-salon', 'before anything is confirmed, the draft address is all there is');
  assert.equal(getLiveSiteUrl(draft), 'https://fanal-templetes-app.vercel.app/?site=vijay-salon');
});

test('a custom domain is live only once it was saved', () => {
  const draft = profile({ customDomain: 'new.example.com' });
  assert.equal(getLiveSiteUrl(draft, publishedAddressOf({ subdomain: 'vijay-kumar' })), LIVE);
  assert.equal(getLiveSiteUrl(draft, publishedAddressOf({ subdomain: 'vijay-kumar', customDomain: 'new.example.com' })), 'https://new.example.com');
});

test('the notice says what is not live — and only for states that do not resolve by themselves', () => {
  const idle = { busy: false, draftUrl: LIVE, liveUrl: LIVE };

  // A save that is scheduled or running finishes on its own; the status pill already says so.
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'pending', busy: true }), null);
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'saving', busy: true }), null);
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'error', busy: true }), null, 'while a retry runs there is nothing new to report');

  // Nothing ahead of the live site.
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'saved' }), null);
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'idle' }), null);
  assert.equal(getLiveSiteNotice({ ...idle, saveStatus: 'saved_local' }), null);

  // A save that failed leaves the draft ahead of the live site.
  const failed = getLiveSiteNotice({ ...idle, saveStatus: 'error' });
  assert.equal(failed?.kind, 'failed');
  assert.equal(failed?.title, UNSAVED_CHANGES_TITLE);
  assert.match(failed!.detail, /live website still shows the version you published before/);
  assert.match(failed!.detail, /marked in red/);

  // A new address is not live until it is saved.
  const moved = getLiveSiteNotice({ ...idle, saveStatus: 'idle', draftUrl: 'https://fanal-templetes-app.vercel.app/?site=vijay-salon' });
  assert.equal(moved?.kind, 'address');
  assert.equal(moved?.title, UNSAVED_CHANGES_TITLE);
  assert.match(moved!.detail, /goes live when you save/);
  assert.match(moved!.detail, /Open Site opens the address that is live now/);

  // The failure is the more important thing to say — but when the address typed is not the live one, it still names it.
  const both = getLiveSiteNotice({ ...idle, saveStatus: 'error', draftUrl: 'https://x.test/?site=other' });
  assert.equal(both?.kind, 'failed');
  assert.equal(both?.liveAddressDiffers, true, 'so the link never seems to disagree with the address on the card');
  assert.equal(failed?.liveAddressDiffers, false, 'nothing to name when the card already shows the live address');
  assert.equal(moved?.liveAddressDiffers, true);
});

test('an unknown address on either side never produces a notice', () => {
  assert.equal(getLiveSiteNotice({ saveStatus: 'idle', busy: false, draftUrl: '', liveUrl: LIVE }), null);
  assert.equal(getLiveSiteNotice({ saveStatus: 'idle', busy: false, draftUrl: LIVE, liveUrl: '' }), null);
});
