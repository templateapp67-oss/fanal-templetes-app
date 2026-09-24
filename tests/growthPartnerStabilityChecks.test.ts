// ============================================================================
// Four stability checks on the Growth Partner area, pinned instead of argued.
//
// The checklist behind this file asked four questions:
//
//   1. Where do "Could not load the Growth Partner area" and "Could not load
//      this section" come from — and does an RPC failure reach them, when they
//      should describe a render crash only?
//   2. Does the area load before the session hydrates, and does it re-run when
//      the session arrives?
//   3. Is a failed RPC still diagnosable, or does the fallback hide the cause?
//   4. Phase 14: in empty/unprovisioned states, is any referral or website link
//      rendered — and is a share URL ever built from a fallback slug?
//
// The answers are structural, so they are asserted here:
//
//   • The two strings are the REVIEWED COPY for a failed read (and, for the
//     first, the access gate's screen). The render-crash path is a real React
//     boundary with different copy, and no component converts a rejection into
//     either string.
//   • Every load in the area keys on the auth-provided user id — no component
//     decides identity from a one-shot getSession().
//   • A failed read keeps its classified cause + diagnostic panel; only the
//     unclassified case falls back to the generic sentence.
//   • Share links exist only when a real referral code does. No fallback slug
//     is constructed anywhere in the partner surface.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { partnerReferralShareLink } from '../src/lib/partnerReferralLink';
import { PARTNER_SECTION_ERROR_MESSAGE } from '../src/lib/growthPartner';
import { GROWTH_PARTNER_ERROR_TITLE } from '../src/components/PartnerStatusScreen';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed — what the compiler actually sees. */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

/** Every .ts/.tsx file under src/, as repo-relative paths. */
const sourceFiles = (): string[] => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry) ? [path.relative(ROOT, full).split(path.sep).join('/')] : [];
    });
  return walk(path.join(ROOT, 'src')).sort();
};

/** Files whose comment-stripped source contains `needle`. */
const filesContaining = (needle: string): string[] =>
  sourceFiles().filter((file) => code(file).includes(needle));

// ---------------------------------------------------------------------------
// 1. The crash path is a real render boundary, and it never wears the
//    failed-read copy.
// ---------------------------------------------------------------------------

const PARTNER_COMPONENTS = [
  'src/components/PartnerSectionErrorBoundary.tsx',
  'src/components/PartnerStatusScreen.tsx',
  'src/components/PartnerRouteGuard.tsx',
  'src/components/GrowthPartnerPage.tsx',
  'src/components/GrowthPartnerSections.tsx',
  'src/components/GrowthPartnerLogin.tsx',
  'src/components/PartnerPortalLogin.tsx',
  'src/components/PartnerAccountSettingsPage.tsx',
  'src/components/ReferralTable.tsx',
  'src/components/ReferralEmptyState.tsx',
  'src/components/ReferralDetailsDrawer.tsx',
];

test('the only partner error boundary is a React class boundary, and its copy is not the failed-read copy', () => {
  const boundary = code('src/components/PartnerSectionErrorBoundary.tsx');

  // A boundary, not a promise catch: React only routes render/lifecycle throws
  // here, which is exactly the "real render crash" case.
  assert.match(boundary, /static getDerivedStateFromError\s*\(/);
  assert.match(boundary, /componentDidCatch\s*\(/);
  assert.doesNotMatch(boundary, /\.catch\s*\(/);

  // Its fallback says which card failed and that the rest of the page is fine.
  assert.ok(boundary.includes('could not be displayed.'));
  assert.ok(boundary.includes('data-partner-section-error'));
  assert.ok(boundary.includes('data-partner-section-retry'));

  // Neither failed-read sentence appears on the crash path.
  assert.ok(!boundary.includes(GROWTH_PARTNER_ERROR_TITLE));
  assert.ok(!boundary.includes(PARTNER_SECTION_ERROR_MESSAGE));
});

test('the area title and the generic section sentence each have exactly one source, and no component catch produces them', () => {
  // Producing the strings anywhere else would mean a component inventing the
  // "crashed" story for a read that merely failed.
  assert.deepEqual(filesContaining(GROWTH_PARTNER_ERROR_TITLE), [
    'src/components/PartnerStatusScreen.tsx',
    'src/lib/partnerAreaFailure.ts',
  ]);
  assert.deepEqual(filesContaining(PARTNER_SECTION_ERROR_MESSAGE), ['src/lib/growthPartner.ts']);

  for (const file of PARTNER_COMPONENTS) {
    const source = code(file);
    assert.doesNotMatch(source, /catch\s*\(([^)]*)\)\s*=>\s*set\w*Error\s*\(/, `${file} sets an error state from a catch`);
    assert.doesNotMatch(source, /\.catch\s*\(\s*\(\)\s*=>\s*setError/, `${file} sets an error state from a catch`);
  }
});

test('a section failure degrades that section, and only the access gate owns the area screen', () => {
  // The area-level screen is the gate's: without the gate read there is no
  // access decision to make, so nothing smaller can degrade.
  assert.deepEqual(filesContaining('<GrowthPartnerLoadError'), ['src/components/PartnerRouteGuard.tsx']);

  // Everything else renders a section error in place, section by section.
  for (const file of ['src/components/GrowthPartnerPage.tsx', 'src/components/GrowthPartnerSections.tsx']) {
    const source = code(file);
    assert.ok(source.includes('<SectionError'), `${file} renders no SectionError`);
    assert.ok(!source.includes('<GrowthPartnerLoadError'), `${file} raises the area screen for a section failure`);
  }
});

// ---------------------------------------------------------------------------
// 2. Auth timing: loads key on the auth-provided user id, never on a one-shot
//    session read.
// ---------------------------------------------------------------------------

test('every partner load path keys on the auth-provided user id and re-runs when it changes', () => {
  const guard = code('src/components/PartnerRouteGuard.tsx');
  assert.ok(
    guard.includes('}, [gate, input.userId, input.isLoginPath, input.loginRoute, input.navigate]);'),
    'the guard must re-resolve when the user id changes (session hydration)'
  );

  const page = code('src/components/GrowthPartnerPage.tsx');
  assert.ok(page.includes('}, [userId, reloadKey, isLoginPath]);'), 'the provisioning gate effect must key on userId');
  assert.ok(page.includes('}, [ready, wantsDashboardData, userId, reloadKey]);'), 'the dashboard effect must key on userId');
  assert.ok(page.includes('[ready, contentSection, userId, referralOffset'), 'the referral effect must key on userId');

  // Identity is decided by the auth state that feeds `userId`, not by a session
  // read inside a component: getSession() resolves null before hydration, which
  // is the race that produces a spurious "not a partner" render.
  for (const file of ['src/components/PartnerRouteGuard.tsx', 'src/components/GrowthPartnerPage.tsx', 'src/components/GrowthPartnerSections.tsx']) {
    assert.ok(!code(file).includes('getSession('), `${file} decides identity from getSession()`);
  }
});

// ---------------------------------------------------------------------------
// 3. A failed read keeps its cause; the generic sentence is the last resort.
// ---------------------------------------------------------------------------

test('the failure the user sees is classified, and the raw cause is logged before any copy replaces it', () => {
  const source = code('src/lib/growthPartner.ts');

  // Raw error text is replaced by safe copy — after the raw failure is logged.
  assert.ok(source.includes('export function toSafePartnerSectionError'));
  assert.ok(source.includes('isPartnerAreaErrorLogged('));

  // The three causes the checklist names are named by the classifier itself.
  const classifier = code('src/lib/partnerAreaFailure.ts');
  assert.ok(classifier.includes("'PGRST202'"), 'schema-cache miss (missing notify pgrst) must be classified');
  assert.ok(classifier.includes("'42501'"), 'a refused grant must be classified');
  assert.ok(classifier.includes("'PGRST301'"), 'an expired session must be classified');
  assert.ok(/database setup is missing/.test(classifier), 'the schema-cache cause must say the setup is missing');
  assert.ok(/permission denied/.test(classifier), 'the refused-grant cause must be named');
});

// ---------------------------------------------------------------------------
// 4. Phase 14: no link without a real code, and never a fallback slug.
// ---------------------------------------------------------------------------

test('a share link is only produced from a real referral code, and never from a fallback slug', () => {
  // No code, no link — for every empty-ish shape a payload can carry.
  assert.equal(partnerReferralShareLink(''), '');
  assert.equal(partnerReferralShareLink('   '), '');
  assert.equal(partnerReferralShareLink(null as unknown as string), '');
  assert.equal(partnerReferralShareLink(undefined as unknown as string), '');

  // No origin (server render, tests) — still no relative link invented.
  assert.equal(partnerReferralShareLink('AB12CD34', ''), '');

  // A real code produces the canonical link: trimmed, uppercased, no slug logic.
  assert.equal(partnerReferralShareLink('  ab12cd34 ', 'https://nexora.test/'), 'https://nexora.test/signup?ref=AB12CD34');
});

test('every link render in the partner surface is gated on the code, and the area builds no site URL', () => {
  // The three places a partner share link can appear all guard on the code.
  assert.ok(code('src/components/PartnerPortalSections.tsx').includes("const shareLink = value ? partnerReferralShareLink(value, origin) : '';"));
  assert.ok(code('src/components/partner/PartnerMarketingMaterialsPage.tsx').includes("const shareLink = code ? partnerReferralShareLink(code) : '';"));
  assert.ok(code('src/components/ReferralEmptyState.tsx').includes("const link = referralCode ? partnerReferralShareLink(referralCode) : '';"));

  // The empty state says the link is unavailable rather than showing one.
  assert.ok(code('src/components/ReferralEmptyState.tsx').includes('Your referral link is not available yet.'));

  // Nothing in the partner surface renders a link or builds a ?site= URL: the
  // salon-site helper (with its name-derived slug fallback) stays owner-side.
  for (const file of [...PARTNER_COMPONENTS, 'src/components/partner/PartnerMarketingMaterialsPage.tsx']) {
    const source = code(file);
    assert.ok(!source.includes('href='), `${file} renders a hardcoded link`);
    assert.ok(!source.includes('?site='), `${file} builds a site URL`);
    assert.ok(!source.includes('getSiteUrl('), `${file} uses the salon-site helper`);
  }
});
