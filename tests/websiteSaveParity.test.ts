import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATION_LEVELS, actor, openParityDatabase, salon, type MigrationLevel } from './helpers/websiteParityDatabase';
import { prepareWebsiteStateForSave } from '../src/lib/websiteContentNormalize';
import { describeWebsiteSaveFailure } from '../src/lib/websiteSaveErrors';
import { DEFAULT_GALLERY_IMAGE_URL, WEBSITE_LIMITS, formatWebsiteIssue } from '../src/lib/websiteValidation';
import { createBlankSalonProfile } from '../src/lib/ownerSalonResolution';
import { applyPublicWebsiteContent } from '../server/websiteContent';
import { TEMPLATE_REGISTRY } from '../src/data/templates';

// ============================================================================
// The client-side check and repair must agree with the REAL database function.
//
// Every scenario below is saved twice — as the editor holds it, and as the save
// would send it after prepareWebsiteStateForSave — against the actual SQL of
// both migration levels. The invariant that keeps the generic "could not be
// validated" toast from coming back:
//
//     the client reports NO blocking issue  ⇒  the database accepts the payload
//
// and whatever the database would reject is either repaired or named.
// ============================================================================

const profile = { ownerId: actor, businessName: 'New Salon', businessType: 'hair_salon', ownerName: 'Sonu', subdomain: 'new-salon', phone: '9876543210', address: 'Road 1', city: 'Jaipur' };
const services = [
  { id: 'svc-1', name: 'Luxury Spa Pedicure', price: 500, durationMinutes: 30 },
  { id: 'svc-2', name: 'Color', price: 900, durationMinutes: 60 },
];
const stylist = { id: 'st-1', name: 'Asha', avatarUrl: '', specialties: [], assignedServices: ['svc-1'] };
/** An owner-added service: `ServiceManagement` gives those random v4 UUID ids while template services keep short ones. */
const ownerService = { id: '8d3f6c1e-2b7a-4c53-9a0e-5f1d2c7b9e64', name: 'Facial', price: 700, durationMinutes: 45 };
/** Another owner-added service, but one that has since been deleted. */
const deletedOwnerServiceId = '1c5b9f04-7e2d-4a86-b3c1-6d0e8f2a4b97';

type State = { profile: any; services: any[]; stylists: any[] };
const base = (): State => ({ profile: { ...profile }, services: services.map((s) => ({ ...s })), stylists: [{ ...stylist }] });
const withProfile = (patch: any): State => ({ ...base(), profile: { ...profile, ...patch } });
const withStylist = (patch: any): State => ({ ...base(), stylists: [{ ...stylist, ...patch }] });
const withOwnerService = (patch: any): State => ({ ...base(), services: [...services.map((s) => ({ ...s })), { ...ownerService }], stylists: [{ ...stylist, ...patch }] });
const withService = (patch: any): State => ({ ...base(), services: [{ ...services[0], ...patch }], stylists: [{ ...stylist, assignedServices: [] }] });

interface Scenario {
  name: string;
  state: State;
  /** Migration levels at which the state, saved as-is, really is rejected. */
  rawRejectedOn: MigrationLevel[];
  /** Repairable: the prepared payload has no blocking issue. */
  repaired?: true;
  /** Not repairable: the first blocking issue must be at this exact field. */
  blockedAt?: string;
}

/**
 * The keyword list EVERY new website started with (606 characters — 106 over what the database
 * accepts). It was hard-coded into the blank profile, so the first save of every new owner failed
 * with "Website text exceeds allowed length" for a field the owner never wrote.
 */
const LEGACY_DEFAULT_KEYWORDS = [
  'Nexora SalonOS', 'Nexora', 'salon management system', 'white label salon software', 'salon website builder',
  'online salon booking app', 'beauty parlor management system', 'barber shop software', 'hair studio booking app',
  'spa booking software', 'ayurvedic wellness center website', 'luxury hair salon management', 'salon billing software',
  'salon appointment scheduling', 'automated whatsapp booking notifications', 'salon loyalty program software',
  'best salon software in india', 'salon booking app india', 'salon billing and inventory software',
  'unisex salon management software', 'beauty parlor billing software', 'top salon website template',
].join(', ');

const both: MigrationLevel[] = ['m28', 'm31'];
const scenarios: Scenario[] = [
  // ---- repaired automatically --------------------------------------------
  { name: 'team member with the demo service names AddStaffModal used to pre-select', state: withStylist({ assignedServices: ['Luxury Spa Pedicure', 'Gel Polish Overlay'] }), rawRejectedOn: both, repaired: true },
  { name: 'team member assigned to a real service by NAME', state: withStylist({ assignedServices: ['Luxury Spa Pedicure'] }), rawRejectedOn: both, repaired: true },
  { name: 'assignment to an owner-added service (random UUID id) next to template services', state: withOwnerService({ assignedServices: ['svc-1', ownerService.id] }), rawRejectedOn: [], repaired: true },
  { name: 'stale assignment to a deleted owner-added service while other services use short ids', state: withOwnerService({ assignedServices: ['svc-1', ownerService.id, deletedOwnerServiceId] }), rawRejectedOn: both, repaired: true },
  { name: 'stale assignment after a service was deleted', state: { ...base(), services: [services[0]], stylists: [{ ...stylist, assignedServices: ['svc-1', 'svc-2'] }] }, rawRejectedOn: ['m31'], repaired: true },
  { name: 'empty gallery slot', state: withProfile({ gallery: [{ id: 'g1', url: '', title: 'x', tag: 'y' }] }), rawRejectedOn: [], repaired: true },
  { name: 'whitespace-only gallery link', state: withProfile({ gallery: [{ id: 'g1', url: '   ', title: 'x', tag: 'y' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'gallery link pasted with surrounding spaces', state: withProfile({ gallery: [{ id: 'g1', url: ' https://example.com/a.jpg ', title: 'x', tag: 'y' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'gallery item without a link field', state: withProfile({ gallery: [{ id: 'g1', title: 'x', tag: 'y' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'gallery item without an id', state: withProfile({ gallery: [{ url: 'https://example.com/a.jpg', title: 'x', tag: 'y' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'two gallery items sharing an id', state: withProfile({ gallery: [{ id: 'g', url: 'https://example.com/a.jpg', title: 'x', tag: 'y' }, { id: 'g', url: 'https://example.com/b.jpg', title: 'x', tag: 'y' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'empty lookbook slot', state: withProfile({ lookbookPhotos: [{ id: 'l1', url: '', title: 'x', tag: 'y' }] }), rawRejectedOn: [], repaired: true },
  { name: 'service image link with surrounding spaces', state: withService({ imageUrl: ' https://example.com/a.jpg ' }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'service image cleared to null', state: withService({ imageUrl: null }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'owner photo link with a leading space', state: withProfile({ ownerPhotoUrl: ' https://example.com/a.jpg' }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'cover image cleared to null', state: withProfile({ coverImageUrl: null }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'team portrait pasted without https://', state: withStylist({ avatarUrl: 'www.example.com/a.jpg' }), rawRejectedOn: ['m31'], repaired: true },
  { name: 'team member with a blank name (unfinished draft)', state: { ...base(), stylists: [{ ...stylist }, { ...stylist, id: 'st-2', name: '   ', assignedServices: [] }] }, rawRejectedOn: both, repaired: true },
  { name: 'working hours that end before they start (12-hour AddStaffModal format)', state: withStylist({ schedule: [{ day: 'Monday', enabled: true, fromTime: '06:00 PM', toTime: '09:00 AM' }, { day: 'Tuesday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' }] }), rawRejectedOn: ['m31'], repaired: true },
  { name: 'schedule row with an unknown day', state: withStylist({ schedule: [{ day: 'Funday', enabled: true, fromTime: '09:00', toTime: '10:00' }] }), rawRejectedOn: both, repaired: true },
  { name: 'working day enabled without any times', state: withStylist({ schedule: [{ day: 'Monday', enabled: true }] }), rawRejectedOn: ['m31'], repaired: true },
  { name: 'valid 12-hour schedule is left alone', state: withStylist({ schedule: [{ day: 'Monday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' }, { day: 'Sunday', enabled: false, fromTime: '10:00 AM', toTime: '04:00 PM' }] }), rawRejectedOn: [], repaired: true },
  { name: 'YouTube link pasted without https://', state: withProfile({ socialVideos: [{ id: 'v', title: 't', youtubeUrl: 'youtube.com/watch?v=aqz-KE-bpKQ', categoryTag: 'SHORT' }] }), rawRejectedOn: ['m31'], repaired: true },
  { name: 'YouTube link from music.youtube.com', state: withProfile({ socialVideos: [{ id: 'v', title: 't', youtubeUrl: 'https://music.youtube.com/watch?v=aqz-KE-bpKQ', categoryTag: 'LONG' }] }), rawRejectedOn: ['m31'], repaired: true },
  { name: 'video without an id', state: withProfile({ socialVideos: [{ title: 't', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', categoryTag: 'SHORT' }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'testimonial without an id', state: withProfile({ testimonials: [{ name: 'A', comment: 'B', rating: 5 }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'testimonial photo cleared to null', state: withProfile({ testimonials: [{ id: 't', name: 'A', comment: 'B', rating: 5, avatarUrl: null }] }), rawRejectedOn: ['m28'], repaired: true },
  { name: 'the 606-character keyword list every new website used to start with', state: withProfile({ seoKeywords: LEGACY_DEFAULT_KEYWORDS }), rawRejectedOn: ['m31'], repaired: true },
  // ---- cannot be guessed: the exact field is named ------------------------
  { name: 'unusable team portrait link', state: withStylist({ avatarUrl: 'h' }), rawRejectedOn: ['m31'], blockedAt: 'stylists[0].avatarUrl' },
  { name: 'half-typed brand colour', state: withProfile({ customAccentColor: '#0F' }), rawRejectedOn: ['m31'], blockedAt: 'profile.customAccentColor' },
  { name: 'owner biography over 2,000 characters', state: withProfile({ ownerBio: 'x'.repeat(2001) }), rawRejectedOn: ['m31'], blockedAt: 'profile.ownerBio' },
  { name: 'about text over 4,000 characters', state: withProfile({ about: 'x'.repeat(4001) }), rawRejectedOn: ['m31'], blockedAt: 'profile.about' },
  { name: 'one SEO keyword that is itself over 500 characters', state: withProfile({ seoKeywords: 'x'.repeat(501) }), rawRejectedOn: ['m31'], blockedAt: 'profile.seoKeywords' },
  { name: 'testimonial rating of 4.5', state: withProfile({ testimonials: [{ id: 't', name: 'A', comment: 'B', rating: 4.5 }] }), rawRejectedOn: both, blockedAt: 'profile.testimonials[0].rating' },
  { name: 'negative service price', state: withService({ price: -5 }), rawRejectedOn: both, blockedAt: 'services[0].price' },
  { name: 'service duration of 1.5 minutes', state: withService({ durationMinutes: 1.5 }), rawRejectedOn: both, blockedAt: 'services[0].durationMinutes' },
  { name: 'service without a name', state: withService({ name: '  ' }), rawRejectedOn: both, blockedAt: 'services[0].name' },
  { name: 'gallery link that is not a link', state: withProfile({ gallery: [{ id: 'g', url: 'htp:/bad', title: 'x', tag: 'y' }] }), rawRejectedOn: both, blockedAt: 'profile.gallery[0].url' },
  { name: 'website address with capitals and symbols', state: withProfile({ subdomain: 'Bad_Slug!' }), rawRejectedOn: both, blockedAt: 'profile.subdomain' },
  { name: 'video without a title', state: withProfile({ socialVideos: [{ id: 'v', title: '', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', categoryTag: 'SHORT' }] }), rawRejectedOn: both, blockedAt: 'profile.socialVideos[0].title' },
  { name: 'favicon letter of three characters', state: withProfile({ faviconLetter: 'ABC' }), rawRejectedOn: ['m31'], blockedAt: 'profile.faviconLetter' },
];

for (const level of MIGRATION_LEVELS) {
  test(`[${level}] nothing the client lets through is rejected by the real save function, and what it rejects is repaired or named`, async () => {
    const { db, save } = await openParityDatabase(level);
    try {
      for (const scenario of scenarios) {
        const prepared = prepareWebsiteStateForSave(scenario.state);
        const rawOutcome = await save(scenario.state);
        if (scenario.rawRejectedOn.includes(level)) {
          assert.equal(rawOutcome.ok, false, `${scenario.name}: expected the unrepaired state to be rejected by ${level} (it is the failure being fixed)`);
        }
        const payloadOutcome = await save(prepared.payload);
        if (prepared.errors.length === 0) {
          assert.equal(payloadOutcome.ok, true, `${scenario.name}: the client reported no problem but ${level} rejected it: ${payloadOutcome.message}`);
        }
        if (scenario.repaired) {
          assert.deepEqual(prepared.errors.map(formatWebsiteIssue), [], `${scenario.name}: should be repaired, not blocked`);
        }
        if (scenario.blockedAt) {
          assert.equal(prepared.errors[0]?.path, scenario.blockedAt, `${scenario.name}: the blocking issue must name the exact field`);
          assert.match(prepared.errors[0].label, /\S/);
          assert.match(prepared.errors[0].message, /\S/);
        }
      }
    } finally { await db.close(); }
  });

  test(`[${level}] every template starter kit is accepted by the real save function after preparation`, async () => {
    const { db, save } = await openParityDatabase(level);
    try {
      for (const template of TEMPLATE_REGISTRY) {
        // Node's asset loader returns file: URLs; Vite emits same-origin /assets paths.
        const browser = JSON.parse(JSON.stringify(template.defaultData, (_, value) => typeof value === 'string' && value.startsWith('file:') ? '/assets/' + value.split('/').pop() : value));
        const state = { profile: { ...profile, socialVideos: browser.videos, gallery: browser.gallery, testimonials: browser.testimonials }, services: browser.services, stylists: browser.staff };
        const prepared = prepareWebsiteStateForSave(state);
        assert.deepEqual(prepared.errors.map(formatWebsiteIssue), [], template.id);
        const outcome = await save(prepared.payload);
        assert.equal(outcome.ok, true, `${template.id} on ${level}: ${outcome.message}`);
      }
    } finally { await db.close(); }
  });

  test(`[${level}] the profile a brand-new account starts with is accepted exactly as it is created`, async () => {
    const { db, save } = await openParityDatabase(level);
    try {
      const blank = createBlankSalonProfile({ id: actor, email: 'owner@example.com', user_metadata: { salon_name: 'New Salon', full_name: 'Sonu', phone_number: '9876543210', city: 'Jaipur' } });
      // The owner still has to give an address (the older migration asks for one); nothing else is needed.
      const state = { profile: { ...blank, address: 'Road 1' }, services: [], stylists: [] };
      assert.ok(Array.from(blank.seoKeywords ?? '').length <= WEBSITE_LIMITS.seoKeywords, 'the starting keywords fit the database limit');
      const asCreated = await save(state);
      assert.equal(asCreated.ok, true, `${level} rejected the profile a new account starts with: ${asCreated.message}`);
      const prepared = prepareWebsiteStateForSave(state);
      assert.deepEqual(prepared.errors.map(formatWebsiteIssue), []);
      assert.deepEqual(prepared.changes, [], 'and it needs no repair at all');
    } finally { await db.close(); }
  });
}

test('the repaired data lands where it should: pruned assignments, name-matched assignments, default gallery image, unnamed drafts skipped', async () => {
  const { db, save } = await openParityDatabase('m31');
  try {
    const demo = prepareWebsiteStateForSave(withStylist({ assignedServices: ['Luxury Spa Pedicure', 'Gel Polish Overlay', 'svc-2'] }));
    assert.equal((await save(demo.payload)).ok, true);
    const assigned = await db.query<any>(`select s.name from staff_services ss join services s on s.id = ss.service_id join staff st on st.id = ss.staff_id where ss.is_active order by s.name`);
    assert.deepEqual(assigned.rows.map((row) => row.name), ['Color', 'Luxury Spa Pedicure'], 'the name was matched to the real service; the demo service that does not exist was dropped');

    const owned = prepareWebsiteStateForSave(withOwnerService({ assignedServices: ['svc-1', ownerService.id, deletedOwnerServiceId] }));
    assert.deepEqual((owned.payload.stylists[0] as any).assignedServices, ['svc-1', ownerService.id], 'the live UUID service stays assigned; the deleted one is dropped');
    assert.equal((await save(owned.payload)).ok, true);
    const ownedRows = await db.query<any>(`select s.name from staff_services ss join services s on s.id = ss.service_id where ss.is_active order by s.name`);
    assert.deepEqual(ownedRows.rows.map((row) => row.name), ['Facial', 'Luxury Spa Pedicure']);

    const mixed = prepareWebsiteStateForSave({
      ...base(),
      profile: { ...profile, gallery: [{ id: 'g1', url: '', title: 'New showcase', tag: 'Studio' }, { id: 'g2', url: ' https://example.com/b.jpg ', title: 'Work', tag: 'Hair' }] },
      stylists: [{ ...stylist }, { ...stylist, id: 'st-draft', name: '', assignedServices: [] }],
    });
    assert.equal((await save(mixed.payload)).ok, true);
    const stored = (await db.query<any>('select state from owner_editor_state')).rows[0].state;
    assert.deepEqual(stored.profile.gallery.map((p: any) => p.url), [DEFAULT_GALLERY_IMAGE_URL, 'https://example.com/b.jpg']);
    assert.deepEqual(stored.stylists.map((s: any) => s.name), ['Asha'], 'the unnamed draft is not published');
    const active = await db.query<any>('select name from staff where is_active order by name');
    assert.deepEqual(active.rows.map((row) => row.name), ['Asha']);

    await db.exec('reset role');
    const publicProfile = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
    const mapped = applyPublicWebsiteContent({} as any, publicProfile);
    assert.deepEqual(mapped.gallery?.map((p) => p.url), [DEFAULT_GALLERY_IMAGE_URL, 'https://example.com/b.jpg'], 'the public site renders the default image for the empty slot');
  } finally { await db.close(); }
});

test('a database rejection of content is turned into the exact field (no generic sentence)', async () => {
  const { db, save } = await openParityDatabase('m31');
  try {
    const rejected = await save(withStylist({ assignedServices: ['Luxury Spa Pedicure', 'Gel Polish Overlay'] }));
    assert.equal(rejected.ok, false);
    const [issue] = describeWebsiteSaveFailure(`${rejected.message} | code: ${rejected.code}`);
    assert.equal(issue.section, 'Team');
    assert.match(issue.label, /Assigned services/);
    assert.doesNotMatch(`${issue.label} ${issue.message}`, /could not be validated|empty gallery image/i);

    const pinpointed = describeWebsiteSaveFailure(rejected.message!, withStylist({ avatarUrl: 'h' }));
    assert.equal(pinpointed[0].path, 'stylists[0].avatarUrl', 'with the editor state the exact team member and field are named');
    assert.match(pinpointed[0].label, /Team member 1 \(“Asha”\) › Portrait image/);
  } finally { await db.close(); }
});

for (const level of MIGRATION_LEVELS) {
  test(`[${level}] an address another salon already owns is named as the website address, not reported generically`, async () => {
    const { db, save } = await openParityDatabase(level);
    try {
      const state = withProfile({ subdomain: 'other' }); // the fixture's second salon owns "other"
      assert.deepEqual(prepareWebsiteStateForSave(state).errors, [], 'the address is well-formed, so only the database can know it is taken');
      const rejected = await save(state);
      assert.equal(rejected.ok, false, `${level} must refuse an address that belongs to another salon`);
      const [issue] = describeWebsiteSaveFailure(`${rejected.message} | code: ${rejected.code}`, state);
      assert.equal(issue.path, 'profile.subdomain', `${level}: "${rejected.message}" was not recognised`);
      assert.equal(issue.section, 'Website address');
      assert.match(issue.message, /already used by another salon/);
      assert.doesNotMatch(`${issue.label} ${issue.message}`, /could not be validated|empty gallery image/i);
    } finally { await db.close(); }
  });
}
