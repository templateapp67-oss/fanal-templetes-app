import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * A failed website save must say WHICH field failed and must not throw the
 * whole payload away over something with an obvious repair:
 *
 *   • saveViaWebsiteApi / the server route repair the content (default image for
 *     an empty gallery slot, trimmed links, dropped stale team assignments) and
 *     report what they still cannot fix field by field;
 *   • runSalonSavePipeline turns a database rejection into those exact fields;
 *   • summarizeSaveError names the part of the editor instead of the old
 *     catch-all "…could not be validated" sentence.
 */
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test-key';

const { saveViaWebsiteApi, runSalonSavePipeline, summarizeSaveError } = await import('../src/lib/autoSave');
const { handleWebsiteSave } = await import('../server/websiteSave');
const { DEFAULT_GALLERY_IMAGE_URL } = await import('../src/lib/websiteValidation');

const OWNER_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const TOKEN = 'owner-access-token-for-tests';

const profile = {
  businessType: 'hair_salon', businessName: 'New Salon', ownerName: 'Sonu', phone: '+91 98450 77654',
  subdomain: 'new-salon', city: 'Jaipur', address: '100 Studio Road', email: 'a@b.co',
};
const services = [{ id: 'svc-1', name: 'Luxury Spa Pedicure', category: 'Nails', durationMinutes: 45, price: 750, description: '', icon: 'scissors' }];
const stylist = { id: 'st-1', name: 'Asha', role: 'Stylist', avatarUrl: '', specialties: [], rating: 5, commissionRate: 10, status: 'Available' };

function payloadWith(patch: { profile?: any; services?: any; stylists?: any } = {}) {
  return {
    ownerId: OWNER_ID,
    selectedTemplateId: 'hair_salon',
    profile: { ...profile, ...patch.profile },
    services: patch.services ?? services,
    stylists: patch.stylists ?? [stylist],
    loyaltyConfig: { programEnabled: false },
  } as any;
}

// The exact state the editor holds after "Add gallery image" (left empty), a
// link pasted with spaces, and a team member added through the old modal.
const MESSY = payloadWith({
  profile: {
    ownerPhotoUrl: '  https://example.com/owner.jpg  ',
    gallery: [
      { id: 'g1', url: '', title: 'New showcase', tag: 'Studio' },
      { id: 'g2', url: ' https://example.com/b.jpg \n', title: 'Work', tag: 'Hair' },
    ],
  },
  stylists: [
    { ...stylist, assignedServices: ['Luxury Spa Pedicure', 'Gel Polish Overlay'] },
    { ...stylist, id: 'st-draft', name: '   ' },
  ],
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// saveViaWebsiteApi
// ---------------------------------------------------------------------------
test('saveViaWebsiteApi sends repaired content: default gallery image, trimmed links, real team assignments, no unnamed drafts', async () => {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return jsonResponse(200, { success: true, timestamp: 1 });
  }) as any;
  const result = await saveViaWebsiteApi(MESSY, { fetchImpl });
  assert.equal(result.ok, true);
  const sent = bodies[0].salonData;
  assert.deepEqual(sent.profile.gallery.map((p: any) => p.url), [DEFAULT_GALLERY_IMAGE_URL, 'https://example.com/b.jpg'],
    'the empty slot is saved with the default image instead of being dropped or rejecting the save');
  assert.equal(sent.profile.ownerPhotoUrl, 'https://example.com/owner.jpg');
  assert.deepEqual(sent.stylists.map((s: any) => s.name), ['Asha']);
  assert.deepEqual(sent.stylists[0].assignedServices, ['svc-1'],
    'a service name is matched to the real service (by ID); a demo name that is not on the menu is dropped');
  assert.equal(sent.profile.subdomain, 'new-salon');
});

test('saveViaWebsiteApi passes the server\'s field-level issues back to the caller', async () => {
  const issues = [{ path: 'services[0].price', section: 'Services', label: 'Service 1 (“Cut”) › Price', message: 'Enter a price of 0 or more, using numbers only.', severity: 'error' }];
  const fetchImpl = (async () => jsonResponse(400, { success: false, code: 'INVALID_WEBSITE_CONTENT', error: 'Service 1 (“Cut”) › Price: Enter a price of 0 or more, using numbers only.', issues })) as any;
  const result = await saveViaWebsiteApi(payloadWith(), { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.deepEqual(result.issues, issues);
  assert.match(result.error!, /Service 1 .* Price/);
});

// ---------------------------------------------------------------------------
// runSalonSavePipeline
// ---------------------------------------------------------------------------
test('a database rejection of the team assignment is reported as that exact field, never the generic sentence', async () => {
  const rejection = 'Assigned service is not available in this salon | code: 22023';
  const outcome = await runSalonSavePipeline({
    payload: payloadWith({ stylists: [stylist] }),
    sync: async () => ({ ok: false, errors: [rejection], blockedByAuth: false }),
    saveViaApi: async () => ({ ok: false, status: 400, error: 'Assigned service is not available in this salon' }),
    writeDraft: () => ({ ok: true }),
    isMockMode: false,
    authenticated: true,
  } as any);
  assert.equal(outcome.target, 'local_draft');
  assert.equal(outcome.issues?.length, 1);
  assert.equal(outcome.issues![0].section, 'Team');
  assert.match(outcome.issues![0].label, /Assigned services/);
  assert.match(outcome.issues![0].message, /assigned to a service that is not on your service list/);
});

test('with the editor state the pipeline names the exact item that the database would reject', async () => {
  const broken = payloadWith({ stylists: [{ ...stylist, avatarUrl: 'h' }] });
  const outcome = await runSalonSavePipeline({
    payload: broken,
    sync: async () => ({ ok: false, errors: ['Invalid staff image URL | code: 22023'], blockedByAuth: false }),
    saveViaApi: async () => ({ ok: false, status: 400, error: 'Invalid staff image URL' }),
    writeDraft: () => ({ ok: true }),
    isMockMode: false,
    authenticated: true,
  } as any);
  assert.equal(outcome.issues?.[0].path, 'stylists[0].avatarUrl');
  assert.match(outcome.issues![0].label, /Team member 1 \(“Asha”\) › Portrait image/);
});

test('issues from the server win, and unrelated failures produce no content issues', async () => {
  const serverIssues = [{ path: 'profile.gallery[1].url', section: 'Gallery', label: 'Gallery image 2 › Image link', message: 'This image link is not valid.', severity: 'error' }];
  const withServerIssues = await runSalonSavePipeline({
    payload: payloadWith(),
    sync: async () => ({ ok: false, errors: ['Invalid gallery image | code: 22023'], blockedByAuth: false }),
    saveViaApi: async () => ({ ok: false, status: 400, error: 'Invalid gallery image', issues: serverIssues as any }),
    writeDraft: () => ({ ok: true }),
    isMockMode: false,
    authenticated: true,
  } as any);
  assert.deepEqual(withServerIssues.issues, serverIssues);

  const network = await runSalonSavePipeline({
    payload: payloadWith(),
    sync: async () => ({ ok: false, errors: ['TypeError: fetch failed'], blockedByAuth: false }),
    saveViaApi: async () => ({ ok: false, error: 'fetch failed' }),
    writeDraft: () => ({ ok: true }),
    isMockMode: false,
    authenticated: true,
  } as any);
  assert.deepEqual(network.issues, []);
});

// ---------------------------------------------------------------------------
// summarizeSaveError
// ---------------------------------------------------------------------------
test('summarizeSaveError names the part of the editor for every database content rejection', () => {
  const cases: Array<[string, RegExp]> = [
    ['Assigned service is not available in this salon | code: 22023', /Team › Assigned services/],
    ['Invalid staff schedule time range | code: 22023', /Team › Weekly schedule/],
    ['Invalid staff image URL', /Team › Portrait image/],
    ['Staff name is required', /Team › Name/],
    ['Invalid gallery image', /Gallery:/],
    ['Invalid lookbook image', /Lookbook:/],
    ['Invalid profile image URL', /Profile images:/],
    ['Invalid service image URL', /Services › Image/],
    ['Invalid service price or duration', /Services › Price \/ duration/],
    ['Service name is required', /Services › Name/],
    ['Invalid testimonial', /Testimonials:/],
    ['Use a valid YouTube link', /Videos:/],
    ['Invalid YouTube video details', /Videos:/],
    ['Video limit exceeded', /Videos:/],
    ['Invalid brand color', /Brand › Colours/],
    ['Invalid favicon letter', /Favicon letter/],
    ['Website text exceeds allowed length', /owner biography 2,000/],
    ['Invalid website subdomain', /Website address:/],
    ['invalid input syntax for type integer: "4.5"', /Numbers:/],
  ];
  for (const [detail, expected] of cases) {
    const text = summarizeSaveError(detail);
    assert.match(text, expected, detail);
    assert.doesNotMatch(text, /could not be validated|empty gallery image, invalid URL/, `${detail} must not collapse into the old generic sentence`);
  }
});

test('an unnamed content rejection is still explained, and other failures keep their own advice', () => {
  assert.match(summarizeSaveError('something odd | code: 22023'), /did not say which field/);
  assert.match(summarizeSaveError('POST /api/website/save failed (HTTP 400) | INVALID_WEBSITE_CONTENT'), /did not say which field/);
  assert.match(summarizeSaveError('Website content is too large; use smaller images'), /too large/);
  assert.match(summarizeSaveError('fetch failed while loading a youtube embed'), /Network error/);
  assert.match(summarizeSaveError('Database schema missing: column youtube_channel does not exist (42703)'), /Database schema missing/);
});

// ---------------------------------------------------------------------------
// POST /api/website/save
// ---------------------------------------------------------------------------
class FakeRes {
  statusCode = 200;
  body: any = null;
  headersSent = false;
  status(code: number) { this.statusCode = code; return this; }
  json(payload: any) { this.body = payload; this.headersSent = true; return this; }
}

async function withFetch<T>(rpc: (state: any) => Response, run: (rpcCalls: any[]) => Promise<T>): Promise<T> {
  const originalFetch = (globalThis as any).fetch;
  const rpcCalls: any[] = [];
  (globalThis as any).fetch = (async (url: string, init: any) => {
    if (String(url).includes('/auth/v1/user')) return jsonResponse(200, { id: OWNER_ID, aud: 'authenticated' });
    if (String(url).includes('/rpc/save_owner_editor_state')) {
      const body = JSON.parse(init.body);
      rpcCalls.push(body.p_state);
      return rpc(body.p_state);
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try { return await run(rpcCalls); } finally { (globalThis as any).fetch = originalFetch; }
}

const headers = { authorization: `Bearer ${TOKEN}` };

test('the route repairs content and saves it instead of rejecting the whole payload', async () => {
  await withFetch(() => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }), async (rpcCalls) => {
    const res = new FakeRes();
    await handleWebsiteSave({ mockSalons: {} })({ body: { salonData: MESSY }, headers }, res as any);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0].profile.gallery.map((p: any) => p.url), [DEFAULT_GALLERY_IMAGE_URL, 'https://example.com/b.jpg']);
    assert.deepEqual(rpcCalls[0].stylists.map((s: any) => s.name), ['Asha']);
    assert.deepEqual(rpcCalls[0].stylists[0].assignedServices, ['svc-1']);
  });
});

test('the route answers content it cannot repair with the exact fields (400 + issues), before touching the database', async () => {
  await withFetch(() => new Response('null', { status: 200 }), async (rpcCalls) => {
    const res = new FakeRes();
    const bad = payloadWith({
      profile: { ownerBio: 'x'.repeat(2100), gallery: [{ id: 'g', url: 'htp:/bad', title: 'x', tag: 'y' }] },
      services: [{ ...services[0], price: -1 }],
    });
    await handleWebsiteSave({ mockSalons: {} })({ body: { salonData: bad }, headers }, res as any);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVALID_WEBSITE_CONTENT');
    const paths = res.body.issues.map((issue: any) => issue.path).sort();
    assert.deepEqual(paths, ['profile.gallery[0].url', 'profile.ownerBio', 'services[0].price'].sort());
    assert.match(res.body.error, /\(\+2 more/);
    assert.equal(rpcCalls.length, 0, 'nothing is sent to the database');
  });
});

test('a database content rejection is returned with field-level issues too', async () => {
  await withFetch(
    () => jsonResponse(400, { code: '22023', message: 'Invalid YouTube video details' }),
    async () => {
      const res = new FakeRes();
      await handleWebsiteSave({ mockSalons: {} })({ body: { salonData: payloadWith() }, headers }, res as any);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_WEBSITE_CONTENT');
      assert.equal(res.body.error, 'Invalid YouTube video details');
      assert.equal(res.body.issues[0].section, 'Videos');
    }
  );
});

// ---------------------------------------------------------------------------
// Wiring that cannot be mounted in a unit test (App owns the save engine)
// ---------------------------------------------------------------------------
test('App: the pre-flight check repairs then names blocking fields, reveals them in the editor, and surfaces pipeline issues', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  // The old pre-flight threw away the field and toasted one sentence.
  assert.doesNotMatch(app, /websiteContentError/);
  assert.match(app, /prepareWebsiteStateForSave\(\{\s*profile: state\.profile,\s*services: state\.services,\s*stylists: state\.stylists,\s*\}\)/);
  assert.match(app, /if \(prepared\.errors\.length\) \{[\s\S]*setIssuesRevealed\(true\);[\s\S]*return \{ published: false, localDraft: false, failed: true, error: blockedBy \};/);
  // A database rejection is shown field by field, and a success clears the markers and reports repairs.
  assert.match(app, /cloud\.issues/);
  assert.match(app, /setPinnedSaveIssues\(contentIssues\);\s*setIssuesRevealed\(true\);/);
  assert.match(app, /\.\.\.prepared\.notes\]\.join\(' '\)/);
  // Every screen can show them.
  assert.match(app, /<WebsiteIssuesProvider issues=\{websiteIssues\} revealed=\{issuesRevealed\}>/);
});

test('the editor renders the summary panel, and Add Staff no longer ships demo service names', () => {
  assert.match(readFileSync('src/components/WebsiteEditor.tsx', 'utf8'), /<WebsiteIssuesPanel \/>/);
  const modal = readFileSync('src/components/AddStaffModal.tsx', 'utf8');
  assert.doesNotMatch(modal, /Luxury Spa Pedicure|Gel Polish Overlay|Lash Lift/);
  assert.match(modal, /useState<string\[\]>\(\[\]\)/);
});

test('a taken website address is the website-address field, whichever layer words the rejection', async () => {
  const { classifyWebsiteSaveError, describeWebsiteSaveFailure, summarizeWebsiteIssues } = await import('../src/lib/websiteSaveErrors');
  const phrasings = [
    'Subdomain already in use',                                                        // save_owner_editor_state (SQLSTATE 23505)
    'Subdomain already in use | code: 23505',
    'That website address is already in use. Choose another address.',                 // POST /api/website/save (409)
    'WEBSITE_ADDRESS_CONFLICT',
    'This subdomain is already taken — please choose a different one.',                // what summarizeSaveError says
    'duplicate key value violates unique constraint "salons_slug_key"',
  ];
  for (const detail of phrasings) {
    const issue = classifyWebsiteSaveError(detail);
    assert.equal(issue?.path, 'profile.subdomain', detail);
    assert.equal(issue?.label, 'Website address', detail);
    assert.match(issue!.message, /already used by another salon/, detail);
    assert.equal(describeWebsiteSaveFailure(detail)[0].path, 'profile.subdomain', `${detail} is a content rejection, so it becomes a field issue`);
  }
  assert.match(summarizeWebsiteIssues(describeWebsiteSaveFailure('Subdomain already in use')), /^Website address: This website address is already used by another salon/);
  // an unrelated unique-violation is not mistaken for it
  assert.equal(classifyWebsiteSaveError('duplicate key value violates unique constraint "bookings_pkey"'), null);
});
