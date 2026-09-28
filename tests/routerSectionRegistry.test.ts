// ============================================================================
// Router ↔ registry consistency (deploy guard).
//
// WHY THIS EXISTS: the failed Vercel builds of 2026-09-28 were not a Vercel
// problem. An intermediate commit shipped the Referral History page, its
// sidebar entry and its label while the router union (`GrowthPartnerSection` /
// `PartnerPortalSection`) and the section arrays never learned about it. The
// page then imported a helper the library does not export, `vite build` died
// with an unresolved-import error, and every preview/production deploy of that
// commit failed while `main` looked fine — nobody caught it because typecheck
// and build were never run before pushing.
//
// This test makes the drift itself the failure: a labelled section that is not
// a routable section (or a menu section with no canonical URL) fails here
// instead of at deploy time.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GROWTH_PARTNER_SECTIONS,
  PARTNER_PORTAL_MENU_SECTIONS,
  PARTNER_PORTAL_SECTIONS,
  growthPartnerPath,
  matchGrowthPartnerRoute,
  matchPartnerPortalRoute,
  partnerPortalPath,
} from '../src/lib/router';
import { GROWTH_PARTNER_SECTION_LABELS } from '../src/components/GrowthPartnerPage';
import {
  PARTNER_PORTAL_NAV,
  PARTNER_PORTAL_SECTION_TITLES,
  partnerPortalContentSection,
} from '../src/components/PartnerPortalShell';

test('every growth-partner label is a routable growth-partner section', () => {
  const sections = new Set<string>(GROWTH_PARTNER_SECTIONS as string[]);
  for (const section of Object.keys(GROWTH_PARTNER_SECTION_LABELS)) {
    assert.ok(sections.has(section), `"${section}" has a label but no route in GROWTH_PARTNER_SECTIONS`);
    if (section === 'dashboard') continue;
    assert.equal(
      matchGrowthPartnerRoute(growthPartnerPath(section as never)),
      section,
      `${growthPartnerPath(section as never)} must resolve back to "${section}"`
    );
  }
});

test('every portal menu section has a canonical URL that resolves to itself', () => {
  const urlSections = new Set<string>(PARTNER_PORTAL_SECTIONS as string[]);
  const menuSections = new Set<string>(PARTNER_PORTAL_MENU_SECTIONS as string[]);
  for (const section of PARTNER_PORTAL_MENU_SECTIONS) {
    assert.ok(urlSections.has(section), `menu section "${section}" is missing from PARTNER_PORTAL_SECTIONS`);
    const path = partnerPortalPath(section);
    assert.ok(path.startsWith('/partner/'), `"${section}" needs a real /partner URL`);
    assert.equal(matchPartnerPortalRoute(path), section, `${path} must resolve back to "${section}"`);
  }
  // The sidebar registry is the router menu — no extra live items, no orphans.
  assert.deepEqual(
    PARTNER_PORTAL_NAV.map((item) => item.section),
    [...PARTNER_PORTAL_MENU_SECTIONS],
    'sidebar registry and router menu must stay the same list'
  );
});

test('every routable portal section resolves to its own content and title', () => {
  for (const section of PARTNER_PORTAL_SECTIONS) {
    assert.ok(PARTNER_PORTAL_SECTION_TITLES[section], `"${section}" has no header title`);
    const content = partnerPortalContentSection(section);
    assert.ok(content, `"${section}" maps to no content section`);
    // A shared fallback is how a "live" menu entry renders the dashboard under a
    // different URL. The dashboard itself, and the two referral rolls that
    // intentionally reuse the referrals/customers pages, are the only cases.
    if (!['dashboard', 'referred-users', 'referral-status'].includes(section)) {
      assert.notEqual(content, 'dashboard', `"${section}" must not fall back to the dashboard`);
    }
  }
});
