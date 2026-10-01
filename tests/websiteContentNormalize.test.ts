import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GALLERY_IMAGE_URL,
  cleanImageUrlInput,
  clockToSeconds,
  databaseYouTubeId,
  formatWebsiteIssue,
  isSafeImageUrl,
  scheduleProblems,
  trimmedSafeImageUrl,
  validateWebsiteContent,
  websiteContentError,
} from '../src/lib/websiteValidation';
import { normalizeWebsiteContent, prepareWebsiteStateForSave } from '../src/lib/websiteContentNormalize';
import { fitSeoKeywords } from '../src/lib/seoKeywords';
import { createBlankSalonProfile } from '../src/lib/ownerSalonResolution';
import { WEBSITE_LIMITS } from '../src/lib/websiteValidation';

const services = [
  { id: 'svc-1', name: 'Luxury Spa Pedicure', price: 500, durationMinutes: 30 },
  { id: 'svc-2', name: 'Haircut', price: 300, durationMinutes: 45 },
];
const asha = { id: 'st-1', name: 'Asha', avatarUrl: '', assignedServices: ['svc-1'] };
const clean = () => ({ profile: { businessName: 'Studio', subdomain: 'studio' } as any, services: services.map((s) => ({ ...s })) as any[], stylists: [{ ...asha }] as any[] });

// ---------------------------------------------------------------------------
// Image links: whitespace, empty values, missing scheme
// ---------------------------------------------------------------------------
test('image links are trimmed before validation and an empty value means "no image"', () => {
  for (const ok of ['', '   ', '\n', ' https://example.com/a.jpg ', '\thttps://example.com/a.jpg\n', ' /image.png ', '/image.png']) {
    assert.equal(isSafeImageUrl(ok), true, JSON.stringify(ok));
  }
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1) ', 'data:text/html,a', '//evil.test/image', 'https:///x', 'https://', 'http:/example.com/a.jpg', 'photo.jpg', 'https://user:pass@example.com/i.jpg', 'ftp://example.com/a.jpg', 42, {}, null, undefined]) {
    assert.equal(isSafeImageUrl(bad), false, String(bad));
  }
  assert.equal(trimmedSafeImageUrl('  https://example.com/a.jpg  '), 'https://example.com/a.jpg');
  assert.equal(trimmedSafeImageUrl('   '), '');
  assert.equal(trimmedSafeImageUrl('javascript:alert(1)'), undefined);
});

test('a pasted link without https:// is completed only when it clearly is host/path', () => {
  assert.equal(cleanImageUrlInput(' www.example.com/a.jpg '), 'https://www.example.com/a.jpg');
  assert.equal(cleanImageUrlInput('cdn.example.co.in/photos/1.png?w=400'), 'https://cdn.example.co.in/photos/1.png?w=400');
  for (const untouched of ['photo.jpg', 'example.com', 'images/photo.png', 'https://example.com/a.jpg', '/local.png', 'javascript:alert(1)', 'my photo.com/a b.jpg']) {
    assert.equal(cleanImageUrlInput(untouched), untouched.trim(), untouched);
  }
});

test('working-hours times understand 24-hour and 12-hour AM/PM values', () => {
  assert.equal(clockToSeconds('09:00'), 9 * 3600);
  assert.equal(clockToSeconds('9:30:15'), 9 * 3600 + 30 * 60 + 15);
  assert.equal(clockToSeconds('09:00 AM'), 9 * 3600);
  assert.equal(clockToSeconds('06:00 PM'), 18 * 3600);
  assert.equal(clockToSeconds('12:00 AM'), 0);
  assert.equal(clockToSeconds('12:30 pm'), 12 * 3600 + 30 * 60);
  assert.equal(clockToSeconds('24:00'), 24 * 3600);
  for (const bad of ['', '25:00', '13:00 PM', '00:00 AM', '9', 'noon', '09:60', null, undefined, 900]) assert.equal(clockToSeconds(bad), null, String(bad));
  assert.deepEqual(scheduleProblems([
    { day: 'Monday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Tuesday', enabled: true, fromTime: '06:00 PM', toTime: '09:00 AM' },
    { day: 'Wednesday', enabled: false, fromTime: '', toTime: '' },
    { day: 'Thursday', enabled: true },
    { day: 'Funday', enabled: true, fromTime: '09:00', toTime: '10:00' },
  ]).map((problem) => [problem.index, problem.day]), [[1, 'Tuesday'], [3, 'Thursday'], [4, 'Funday']]);
});

test('the database only reads four YouTube link shapes', () => {
  for (const ok of ['aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ', 'https://www.youtube.com/shorts/aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&feature=share', 'https://m.youtube.com/watch?x=1&v=aqz-KE-bpKQ']) {
    assert.equal(databaseYouTubeId(ok), 'aqz-KE-bpKQ', ok);
  }
  for (const no of ['youtube.com/watch?v=aqz-KE-bpKQ', 'https://music.youtube.com/watch?v=aqz-KE-bpKQ', 'https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ', '', null]) {
    assert.equal(databaseYouTubeId(no), null, String(no));
  }
});

// ---------------------------------------------------------------------------
// validateWebsiteContent — every problem names its field
// ---------------------------------------------------------------------------
test('validation names the exact field of each problem, with the item it belongs to', () => {
  const state = {
    profile: {
      subdomain: 'Bad_Slug!', ownerPhotoUrl: 'nope', customAccentColor: '#0F', faviconLetter: 'ABC',
      ownerBio: 'x'.repeat(2001), about: 'y'.repeat(4001), seoTitle: 'z'.repeat(121), seoDescription: 'd'.repeat(321), seoKeywords: 'k'.repeat(501),
      gallery: [{ id: 'g', url: 'htp:/bad', title: 'Front desk', tag: '' }],
      lookbookPhotos: [{ id: 'l', url: 'nope', title: '', tag: '' }],
      testimonials: [{ id: 't', name: '', comment: '', rating: 4.5, avatarUrl: 'nope' }],
      socialVideos: [{ id: 'v', title: '', youtubeUrl: 'https://example.com/x', categoryTag: 'NOPE', description: 'd'.repeat(2001) }],
    },
    services: [{ id: 's', name: ' ', price: -1, durationMinutes: 1.5, imageUrl: 'nope', originalPrice: 10 }],
    stylists: [{ id: 'a', name: 'Asha', avatarUrl: 'h', assignedServices: ['gone'], schedule: [{ day: 'Monday', enabled: true, fromTime: '18:00', toTime: '09:00' }] }],
  };
  const byPath = new Map(validateWebsiteContent(state).map((issue) => [issue.path, issue]));
  const expected: Array<[string, RegExp, RegExp]> = [
    ['profile.subdomain', /^Website address$/, /lowercase letters/],
    ['profile.ownerPhotoUrl', /Owner details › Portrait image/, /full image link/],
    ['profile.customAccentColor', /Brand › Accent colour/, /#C20E5A/],
    ['profile.faviconLetter', /Favicon letter/, /at most 2/],
    ['profile.ownerBio', /Professional biography/, /2,000 characters \(it is 2,001 now\)/],
    ['profile.about', /About text/, /4,000/],
    ['profile.seoTitle', /Page title/, /120/],
    ['profile.seoDescription', /Page description/, /320/],
    ['profile.seoKeywords', /Keywords/, /500/],
    ['profile.gallery[0].url', /Gallery image 1 \(“Front desk”\) › Image link/, /clear it to use the default image/],
    ['profile.lookbookPhotos[0].url', /Lookbook image 1 › Image link/, /full image link/],
    ['profile.testimonials[0].name', /Testimonial 1 › Client name/, /client’s name/],
    ['profile.testimonials[0].comment', /Testimonial 1 › Review/, /review text/],
    ['profile.testimonials[0].rating', /Testimonial 1 › Rating/, /1 to 5/],
    ['profile.testimonials[0].avatarUrl', /Client photo/, /full image link/],
    ['profile.socialVideos[0].youtubeUrl', /Video 1 › YouTube link/, /YouTube/],
    ['profile.socialVideos[0].title', /Video 1 › Title/, /Enter a video title/],
    ['profile.socialVideos[0].description', /Description/, /2,000/],
    ['profile.socialVideos[0].categoryTag', /Placement/, /where this video should appear/],
    ['services[0].name', /Service 1 › Name/, /Enter a service name/],
    ['services[0].price', /Service 1 › Price/, /0 or more/],
    ['services[0].durationMinutes', /Service 1 › Duration/, /whole number of minutes/],
    ['services[0].imageUrl', /Service 1 › Image/, /full image link/],
    ['stylists[0].avatarUrl', /Team member 1 \(“Asha”\) › Portrait image/, /full image link/],
    ['stylists[0].assignedServices', /Assigned services/, /“gone”/],
    ['stylists[0].schedule[0]', /Weekly schedule/, /Monday: the closing time must be after the opening time/],
  ];
  for (const [path, label, message] of expected) {
    const issue = byPath.get(path);
    assert.ok(issue, `${path} must be reported; got ${[...byPath.keys()].join(', ')}`);
    assert.equal(issue.severity, 'error', path);
    assert.match(issue.label, label, path);
    assert.match(issue.message, message, path);
  }
  // A regular price below the sale price is the other service price rule.
  const below = validateWebsiteContent({ profile: {}, services: [{ id: 's', name: 'Cut', price: 500, originalPrice: 400, durationMinutes: 30 }] });
  assert.deepEqual(below.map((issue) => issue.path), ['services[0].originalPrice']);
  assert.match(below[0].label, /Regular price/);
});

test('null and empty optional fields are valid; limits are checked in characters, not UTF-16 units', () => {
  const lenient = {
    profile: { ownerPhotoUrl: null, coverImageUrl: '', logoUrl: undefined, customFaviconUrl: '  ', primaryColor: '', faviconColor: null, ownerBio: '😀'.repeat(2000), gallery: [], lookbookPhotos: [], testimonials: [], socialVideos: [] },
    services: [{ id: 's', name: 'Cut', price: 0, durationMinutes: 30, imageUrl: null, originalPrice: null }],
    stylists: [{ id: 'a', name: 'Asha', avatarUrl: null }],
  };
  assert.deepEqual(validateWebsiteContent(lenient), []);
  assert.equal(websiteContentError(lenient), null);
  assert.ok(validateWebsiteContent({ ...lenient, profile: { ...lenient.profile, ownerBio: '😀'.repeat(2001) } }).some((i) => i.path === 'profile.ownerBio'));
});

test('social links that cannot be shown are warnings, never blockers', () => {
  const state = { profile: { instagramHandle: 'not a handle!', facebookPage: 'https://evil.test/salon', tiktokHandle: '@ok_name', youtubeChannel: 'my channel', googleBusinessUrl: 'https://g.page/salon' } };
  const issues = validateWebsiteContent(state);
  assert.deepEqual(issues.map((issue) => [issue.path, issue.severity]), [
    ['profile.instagramHandle', 'warning'],
    ['profile.facebookPage', 'warning'],
    ['profile.youtubeChannel', 'warning'],
  ]);
  assert.match(issues[0].message, /will not appear on your website/);
  assert.equal(websiteContentError(state), null, 'warnings do not block the save');
});

test('websiteContentError returns the first blocking problem as one sentence naming the field', () => {
  const message = websiteContentError({ profile: {}, services: [{ id: 's', name: 'Hair Spa', price: -3, durationMinutes: 30 }] });
  assert.equal(message, 'Service 1 (“Hair Spa”) › Price: Enter a price of 0 or more, using numbers only.');
  assert.equal(formatWebsiteIssue({ label: '', message: 'Only a message.' }), 'Only a message.');
});

// ---------------------------------------------------------------------------
// normalizeWebsiteContent / prepareWebsiteStateForSave
// ---------------------------------------------------------------------------
test('clean content comes back as the same objects with no changes (idempotent, no needless state updates)', () => {
  const state = clean();
  const first = normalizeWebsiteContent(state);
  assert.equal(first.state, state);
  assert.deepEqual(first.changes, []);
  const messy = { ...clean(), profile: { gallery: [{ id: 'g', url: '' }], ownerPhotoUrl: ' https://example.com/a.jpg ' } as any };
  const once = normalizeWebsiteContent(messy);
  const twice = normalizeWebsiteContent(once.state);
  assert.equal(twice.state, once.state);
  assert.deepEqual(twice.changes, []);
});

test('an empty gallery or lookbook slot gets the default image instead of rejecting the save', () => {
  const state = {
    profile: {
      gallery: [{ id: 'g1', url: '', title: 'New showcase', tag: 'Studio' }, { id: 'g2', title: 'No link key', tag: '' }, { id: 'g3', url: '  ', title: '', tag: '' }, { id: 'g4', url: ' https://example.com/ok.jpg ', title: '', tag: '' }],
      lookbookPhotos: [{ id: 'l1', url: '', title: '', tag: '' }],
    } as any,
  };
  const { state: healed, changes } = normalizeWebsiteContent(state);
  assert.deepEqual(healed.profile.gallery.map((p: any) => p.url), [DEFAULT_GALLERY_IMAGE_URL, DEFAULT_GALLERY_IMAGE_URL, DEFAULT_GALLERY_IMAGE_URL, 'https://example.com/ok.jpg']);
  assert.deepEqual(healed.profile.lookbookPhotos.map((p: any) => p.url), [DEFAULT_GALLERY_IMAGE_URL]);
  assert.equal(changes.filter((change) => change.kind === 'default_image').length, 4);
  assert.equal(validateWebsiteContent(healed).length, 0);
  assert.equal(state.profile.gallery[0].url, '', 'the input is never mutated');
  // The default is a real, valid image URL.
  assert.equal(isSafeImageUrl(DEFAULT_GALLERY_IMAGE_URL), true);
  // A link that is wrong (not empty) is NOT silently replaced: the owner is told.
  const wrong = normalizeWebsiteContent({ profile: { gallery: [{ id: 'g', url: 'htp:/bad' }] } as any });
  assert.equal(wrong.state.profile.gallery[0].url, 'htp:/bad');
  assert.equal(validateWebsiteContent(wrong.state)[0].path, 'profile.gallery[0].url');
});

test('missing and repeated internal IDs are reassigned without touching unique ones', () => {
  const { state } = normalizeWebsiteContent({ profile: {
    gallery: [{ id: 'gallery-1', url: 'https://example.com/a.jpg' }, { url: 'https://example.com/b.jpg' }, { id: 'gallery-1', url: 'https://example.com/c.jpg' }, { id: '  ', url: 'https://example.com/d.jpg' }],
    testimonials: [{ name: 'A', comment: 'B', rating: 5 }, { name: 'C', comment: 'D', rating: 4 }],
    socialVideos: [{ title: 'T', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', categoryTag: 'SHORT' }],
  } as any });
  const ids = (list: any[]) => list.map((item) => item.id);
  assert.equal(new Set(ids(state.profile.gallery)).size, 4);
  assert.equal(state.profile.gallery[0].id, 'gallery-1', 'the first holder of an ID keeps it');
  assert.equal(new Set(ids(state.profile.testimonials)).size, 2);
  assert.ok(ids(state.profile.socialVideos)[0]);
  assert.equal(validateWebsiteContent(state).length, 0);
});

test('links are trimmed, null images become empty, and YouTube links the database cannot read are standardised', () => {
  const { state } = normalizeWebsiteContent({
    profile: {
      ownerPhotoUrl: ' https://example.com/o.jpg\n', coverImageUrl: null, logoUrl: 'cdn.example.com/logo.png', instagramHandle: ' @studio ', tiktokHandle: ' @t ',
      socialVideos: [
        { id: 'a', title: 'A', youtubeUrl: 'youtube.com/watch?v=aqz-KE-bpKQ', categoryTag: 'LONG' },
        { id: 'b', title: 'B', youtubeUrl: 'https://www.youtube.com/shorts/aqz-KE-bpKQ', categoryTag: 'SHORT' },
        { id: 'c', title: 'C', youtubeUrl: '', videoId: 'aqz-KE-bpKQ', categoryTag: 'SHORT' },
      ],
    } as any,
    services: [{ id: 's', name: 'Cut', price: 1, durationMinutes: 30, imageUrl: ' /x.png ' }] as any,
    stylists: [{ id: 'a', name: 'Asha', avatarUrl: 'www.example.com/a.jpg' }] as any,
  });
  assert.equal(state.profile.ownerPhotoUrl, 'https://example.com/o.jpg');
  assert.equal(state.profile.coverImageUrl, '');
  assert.equal(state.profile.logoUrl, 'https://cdn.example.com/logo.png');
  assert.equal(state.profile.instagramHandle, '@studio');
  assert.equal(state.profile.tiktokHandle, '@t');
  assert.equal(state.profile.socialVideos[0].youtubeUrl, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(state.profile.socialVideos[0].videoId, 'aqz-KE-bpKQ');
  assert.equal(state.profile.socialVideos[1].youtubeUrl, 'https://www.youtube.com/shorts/aqz-KE-bpKQ', 'links the database already reads are left alone');
  assert.equal(state.profile.socialVideos[2].youtubeUrl, '', 'a video identified by its videoId only is readable as it is');
  assert.equal(state.services[0].imageUrl, '/x.png');
  assert.equal(state.stylists[0].avatarUrl, 'https://www.example.com/a.jpg');
});

test('team assignments are matched to real services by ID or name and dropped when the service is gone', () => {
  const state = { ...clean(), stylists: [{ ...asha, assignedServices: ['svc-2', ' luxury spa pedicure ', 'Gel Polish Overlay', 'deleted-id', 'svc-2', 7] }] as any };
  const { state: healed, changes } = normalizeWebsiteContent(state);
  assert.deepEqual(healed.stylists[0].assignedServices, ['svc-2', 'svc-1']);
  assert.ok(changes.some((c) => c.kind === 'service_assignment_fixed' && !c.notice));
  const removed = changes.find((c) => c.kind === 'service_assignment_removed');
  assert.ok(removed?.notice);
  assert.match(removed!.note, /Asha: removed 3 assigned services/);
  // Without a service list in the state nothing can be checked, so nothing is removed.
  const noServices = normalizeWebsiteContent({ profile: {}, stylists: [{ ...asha, assignedServices: ['unknown'] }] as any });
  assert.deepEqual((noServices.state.stylists as any[])[0].assignedServices, ['unknown']);
  // Owner-added services get random UUID ids while template services keep short ones, so lists mix both.
  // An assignment to a live UUID service stays; one to a service that was deleted is stale and is dropped.
  const liveId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const goneId = '9b2e7d10-6c4a-4f1b-8e35-0a7d3c91f2b8';
  const mixedServices = [...clean().services, { id: liveId, name: 'Facial', price: 1, durationMinutes: 30 }];
  const mixed = normalizeWebsiteContent({ ...clean(), services: mixedServices as any, stylists: [{ ...asha, assignedServices: ['svc-1', liveId, goneId] }] as any });
  assert.deepEqual((mixed.state.stylists as any[])[0].assignedServices, ['svc-1', liveId]);
  assert.match(mixed.changes.find((c) => c.kind === 'service_assignment_removed')!.note, /Asha: removed 1 assigned service that is not on your service list/);
  assert.deepEqual(prepareWebsiteStateForSave({ ...clean(), services: mixedServices as any, stylists: [{ ...asha, assignedServices: ['svc-1', liveId, goneId] }] as any }).errors, [], 'the repaired state has no blocking problem');
  // A malformed value becomes an empty list.
  assert.deepEqual(normalizeWebsiteContent({ ...clean(), stylists: [{ ...asha, assignedServices: 'svc-1' }] as any }).state.stylists[0].assignedServices, []);
});

test('invalid working hours are saved as a day off and unknown days are ignored — the rest of the week is kept', () => {
  const schedule = [
    { day: 'Monday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Tuesday', enabled: true, fromTime: '06:00 PM', toTime: '09:00 AM' },
    { day: 'Wednesday', enabled: true },
    { day: 'Funday', enabled: true, fromTime: '09:00', toTime: '10:00' },
    { day: 'Sunday', enabled: false, fromTime: '10:00 AM', toTime: '04:00 PM' },
  ];
  const { state, changes } = normalizeWebsiteContent({ ...clean(), stylists: [{ ...asha, schedule }] as any });
  assert.deepEqual(state.stylists[0].schedule.map((d: any) => [d.day, d.enabled]), [['Monday', true], ['Tuesday', false], ['Wednesday', false], ['Sunday', false]]);
  assert.equal(changes.filter((c) => c.kind === 'schedule_day_off').length, 2);
  assert.equal(changes.filter((c) => c.kind === 'schedule_day_removed').length, 1);
  assert.deepEqual(scheduleProblems(state.stylists[0].schedule), []);
});

test('prepareWebsiteStateForSave leaves unnamed team drafts out of the payload only, and reports what it did', () => {
  const state = {
    profile: { gallery: [{ id: 'g', url: '' }] } as any,
    services: services.map((s) => ({ ...s })) as any[],
    stylists: [{ ...asha }, { ...asha, id: 'draft', name: '  ', assignedServices: [] }, { ...asha, id: 'draft2', name: undefined, assignedServices: [] }] as any[],
  };
  const prepared = prepareWebsiteStateForSave(state);
  assert.deepEqual(prepared.payload.stylists.map((s: any) => s.id), ['st-1']);
  assert.deepEqual(prepared.healed.stylists.map((s: any) => s.id), ['st-1', 'draft', 'draft2'], 'the editor keeps the row the owner has just added');
  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(prepared.issues.filter((i) => i.severity === 'warning').map((i) => i.path), ['stylists[1].name', 'stylists[2].name']);
  assert.deepEqual(prepared.notes, [
    '1 gallery slot has no photo yet, so the default image is shown there.',
    '2 team members without a name were not published.',
  ]);
  assert.equal(state.stylists.length, 3, 'the input is never mutated');
  // Nothing to do → the very same object comes back.
  const tidy = clean();
  const untouched = prepareWebsiteStateForSave(tidy);
  assert.equal(untouched.payload, tidy);
  assert.deepEqual(untouched.notes, []);
});

test('what cannot be repaired stays a blocking error with a named field', () => {
  const prepared = prepareWebsiteStateForSave({
    profile: { gallery: [{ id: 'g', url: 'htp:/bad' }], ownerBio: 'x'.repeat(2500) } as any,
    services: [{ id: 's', name: '', price: 1, durationMinutes: 30 }] as any,
    stylists: [{ id: 'a', name: 'Asha', avatarUrl: 'h' }] as any,
  });
  assert.deepEqual(prepared.errors.map((issue) => issue.path).sort(), ['profile.gallery[0].url', 'profile.ownerBio', 'services[0].name', 'stylists[0].avatarUrl']);
  for (const issue of prepared.errors) assert.match(formatWebsiteIssue(issue), /›|:/);
});

// ---------------------------------------------------------------------------
// SEO keywords: the list a new website started with was longer than the database allows
// ---------------------------------------------------------------------------
const LIMIT = WEBSITE_LIMITS.seoKeywords;
const kw = (n: number, width = 24) => Array.from({ length: n }, (_, i) => `keyword number ${String(i).padStart(width - 15, '0')}`);

test('a keyword list is fitted by dropping whole keywords from the end — never by cutting one in half', () => {
  const list = kw(30); // 30 × 24 chars + separators = far over 500
  const fit = fitSeoKeywords(list.join(', '), LIMIT)!;
  assert.ok(Array.from(fit.value).length <= LIMIT);
  assert.equal(fit.total, 30);
  assert.deepEqual(fit.value.split(', '), list.slice(0, fit.kept), 'a prefix of the original list, in the original order');
  assert.ok(Array.from(list.slice(0, fit.kept + 1).join(', ')).length > LIMIT, 'and as many as fit: one more would not');
  // blanks and repeats are removed the way the rest of the app does it
  assert.equal(fitSeoKeywords(' a,  b ,, A , c ', LIMIT)!.value, 'a, b, c');
  // nothing fits: a single enormous "keyword" is a typing problem and is left alone
  assert.equal(fitSeoKeywords('x'.repeat(LIMIT + 1), LIMIT), null);
  assert.equal(fitSeoKeywords('', LIMIT), null);
});

test('keywords are counted in characters, like the database does, not in UTF-16 units', () => {
  const [a, b, c] = ['💇', '💈', '💅'].map((emoji) => emoji.repeat(200)); // 200 characters each, 400 UTF-16 units
  assert.equal(fitSeoKeywords(`${a}, ${b}`, LIMIT)!.kept, 2, '200 + 2 + 200 = 402 characters fit in 500');
  assert.equal(fitSeoKeywords(`${a}, ${b}, ${c}`, LIMIT)!.kept, 2, 'a third one (604) does not');
});

test('an over-long keyword list is repaired instead of blocking the save — and named when keywords were lost', () => {
  const state = { ...clean(), profile: { ...clean().profile, seoKeywords: kw(30).join(', ') } };
  assert.ok(validateWebsiteContent(state).some((i) => i.path === 'profile.seoKeywords' && i.severity === 'error'), 'as typed, it is a blocking error');

  const { payload, errors, changes, notes } = prepareWebsiteStateForSave(state);
  assert.deepEqual(errors, [], 'repaired, not blocked');
  assert.ok(Array.from(payload.profile.seoKeywords).length <= LIMIT);
  const change = changes.find((c) => c.kind === 'seo_keywords_shortened')!;
  assert.equal(change.path, 'profile.seoKeywords');
  assert.equal(change.notice, true, 'keywords were lost, so the owner is told after a manual save');
  assert.match(change.note, /the first \d+ of 30 keywords are published/);
  assert.ok(notes.some((n) => /SEO keywords/.test(n)));

  // idempotent: what was repaired needs no second repair, and clean lists keep their identity
  assert.equal(normalizeWebsiteContent({ ...state, profile: payload.profile } as any).changes.length, 0);
  const same = { ...clean(), profile: { ...clean().profile, seoKeywords: 'hair, spa, nails' } };
  assert.equal(normalizeWebsiteContent(same).state.profile, same.profile);
});

test('a list that is only over the limit because of spacing and repeats loses no keyword, so nothing is reported', () => {
  const padded = Array.from({ length: 60 }, (_, i) => `term${i % 9}`).join(' ,   ,  ');
  assert.ok(Array.from(padded).length > LIMIT);
  const { state, changes } = normalizeWebsiteContent({ ...clean(), profile: { ...clean().profile, seoKeywords: padded } });
  assert.equal(state.profile.seoKeywords, 'term0, term1, term2, term3, term4, term5, term6, term7, term8');
  assert.equal(changes.find((c) => c.kind === 'seo_keywords_shortened')?.notice, false);
});

test('a single over-long keyword is not cut blindly: it stays a blocking error that names the field', () => {
  const { errors, payload } = prepareWebsiteStateForSave({ ...clean(), profile: { ...clean().profile, seoKeywords: 'x'.repeat(LIMIT + 1) } });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'profile.seoKeywords');
  assert.equal(payload.profile.seoKeywords.length, LIMIT + 1, 'the owner decides what to do with it');
});

test('the keywords a new website starts with fit the database limit, most important first', () => {
  const blank = createBlankSalonProfile({ id: 'u', user_metadata: { salon_name: 'New Salon' } });
  const keywords = blank.seoKeywords!;
  assert.ok(Array.from(keywords).length <= LIMIT, `${Array.from(keywords).length} characters`);
  assert.ok(keywords.startsWith('Nexora SalonOS, Nexora, salon management system'), 'the most important keywords come first');
  assert.ok(keywords.split(', ').length >= 15, 'and most of the list is kept');
  assert.equal(prepareWebsiteStateForSave({ profile: blank as any, services: [], stylists: [] }).changes.filter((c) => c.kind === 'seo_keywords_shortened').length, 0, 'the default needs no repair');
});
