// ============================================================================
// Partner portal SHELL (Part 2.2) — the /partner/dashboard layout.
//
//   • The sidebar menu is EXACTLY the six required entries (Dashboard, My
//     Referral Code, Referred Users, Referral Status, Profile, Logout) and
//     the expandability contract is pinned: the eight future modules
//     (Earnings, Commission, Withdrawals, Marketing Materials, Partner
//     Levels, Leaderboards, Notifications, Support) already have registry
//     slots — shown as disabled "Soon" entries, never fake links.
//   • Server-rendered output pins the professional layout: desktop sidebar +
//     top header + main content, the mobile drawer (closed by default) and
//     its hamburger toggle, active-item state, identity and logout actions.
//   • The new sections render real content: My Referral Code (code + copy +
//     share link + how it works) and Referral Status (KPI chips + legend +
//     the real list). The share link pre-fills the onboarding referral
//     screen (?ref=CODE) — tested here at the helper + screen level.
//   • The portal section model maps every menu section to real content
//     (partnerPortalContentSection) — the shell can grow without redesign.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PARTNER_PORTAL_MENU_SECTIONS,
  PARTNER_PORTAL_SECTIONS,
  matchPartnerPortalRoute,
  partnerPortalPath,
} from '../src/lib/router';
import {
  PARTNER_PORTAL_NAV,
  PARTNER_PORTAL_PLANNED,
  PARTNER_PORTAL_SECTION_TITLES,
  PartnerNotificationsPanel,
  PartnerPortalShell,
  PartnerProfileMenu,
  partnerPortalContentSection,
  shortPartnerId,
} from '../src/components/PartnerPortalShell';
import {
  PartnerReferralCodeSection,
  partnerReferralShareLink,
  PartnerReferralStatusSection,
} from '../src/components/PartnerPortalSections';
import { ReferralScreen } from '../src/onboarding/screens/ReferralScreen';
import type { PartnerActivityEntry, PartnerDashboardData } from '../src/lib/growthPartner';

const render = (element: React.ReactElement) => renderToStaticMarkup(element);

// ---------------------------------------------------------------------------
// 1. Section model — menu sections, URL sections, aliases, content mapping
// ---------------------------------------------------------------------------

test('the portal section model keeps menu, URL and content sections in sync', () => {
  // URL sections = the five menu sections + the two still-URL-reachable ones.
  assert.deepEqual([...PARTNER_PORTAL_SECTIONS], [
    'dashboard',
    'referral-code',
    'referred-users',
    'referral-status',
    'profile',
    'performance',
    'commission',
  ]);
  // The sidebar shows exactly the five menu sections (Logout is an action).
  assert.deepEqual([...PARTNER_PORTAL_MENU_SECTIONS], [
    'dashboard',
    'referral-code',
    'referred-users',
    'referral-status',
    'profile',
  ]);
  // Every menu section maps to real content — no orphan menu entries.
  assert.equal(partnerPortalContentSection('dashboard'), 'dashboard');
  assert.equal(partnerPortalContentSection('referral-code'), 'referral-code');
  assert.equal(partnerPortalContentSection('referred-users'), 'referrals');
  assert.equal(partnerPortalContentSection('referral-status'), 'customers');
  assert.equal(partnerPortalContentSection('profile'), 'profile');
  assert.equal(partnerPortalContentSection('performance'), 'performance');
  assert.equal(partnerPortalContentSection('commission'), 'commission');
  // Canonical paths for every section.
  for (const section of PARTNER_PORTAL_SECTIONS) {
    assert.equal(partnerPortalPath(section), `/partner/${section}`);
  }
  // Legacy aliases keep resolving (no broken links from the earlier model).
  assert.equal(matchPartnerPortalRoute('/partner/referrals'), 'referred-users');
  assert.equal(matchPartnerPortalRoute('/partner/customers'), 'referral-status');
});

test('the shell nav registry mirrors the router menu and adds no extra live items', () => {
  assert.deepEqual(
    PARTNER_PORTAL_NAV.map((item) => item.section),
    [...PARTNER_PORTAL_MENU_SECTIONS],
    'the sidebar registry and the router menu must be the same list'
  );
  assert.deepEqual(
    PARTNER_PORTAL_NAV.map((item) => item.label),
    ['Dashboard', 'My Referral Code', 'Referred Users', 'Referral Status', 'Profile'],
    'the exact sidebar menu labels, in order'
  );
  for (const item of PARTNER_PORTAL_NAV) {
    assert.ok(item.icon, `${item.section} has an icon`);
    assert.equal(PARTNER_PORTAL_SECTION_TITLES[item.section], item.label);
  }
});

test('the planned-module registry holds the eight future sections without faking them', () => {
  assert.deepEqual(
    PARTNER_PORTAL_PLANNED.map((item) => item.label),
    [
      'Earnings',
      'Commission',
      'Withdrawals',
      'Marketing Materials',
      'Partner Levels',
      'Leaderboards',
      'Notifications',
      'Support',
    ],
    'the future modules named in the Part 2 plan, as expandable slots'
  );
  // A planned slot must never shadow a live MENU item — promotion (moving the
  // entry into PARTNER_PORTAL_NAV) stays a safe, local change. (A planned id
  // may equal a URL-reachable section, e.g. commission, which already serves
  // its honest empty state but is not a sidebar item yet.)
  const liveMenu = new Set(PARTNER_PORTAL_MENU_SECTIONS as string[]);
  for (const item of PARTNER_PORTAL_PLANNED) {
    assert.equal(liveMenu.has(item.id), false, `${item.id} collides with a live menu item`);
    assert.ok(item.icon, `${item.id} has an icon`);
  }
});

// ---------------------------------------------------------------------------
// 2. Shell SSR — sidebar + top header + main content + mobile drawer
// ---------------------------------------------------------------------------

const noop = () => {};

const SHELL_PARTNER_ID = 'a18d0df6-58b5-4bdc-a518-3a597d5b7195';

function renderShell(section: (typeof PARTNER_PORTAL_SECTIONS)[number], children?: React.ReactNode) {
  return render(
    React.createElement(
      PartnerPortalShell,
      {
        section,
        displayName: 'Meera Partner',
        email: 'meera@example.com',
        partnerId: SHELL_PARTNER_ID,
        notifications: [
          { type: 'website_completed', ref: '…00000001', display_name: 'User One', at: '2026-09-10T10:00:00Z' },
          { type: 'referral_added', ref: '…00000002', display_name: null, at: '2026-09-11T10:00:00Z' },
        ],
        navigate: noop,
        onLogout: noop,
        accentHex: '#C20E5A',
      },
      children ?? React.createElement('p', null, 'Main content goes here')
    )
  );
}

test('the shell renders the professional dashboard layout (sidebar, header, main)', () => {
  const html = renderShell('dashboard');
  // Desktop sidebar: brand + area label.
  assert.match(html, /<aside[^>]*>/);
  assert.match(html, /Nexora/);
  assert.match(html, /Growth Partner/);
  // Every required menu entry is present exactly once per nav surface
  // (desktop sidebar + mobile drawer both render the registry).
  for (const label of ['Dashboard', 'My Referral Code', 'Referred Users', 'Referral Status', 'Profile', 'Logout']) {
    assert.ok((html.match(new RegExp(`>${label}<`, 'g')) || []).length >= 2, `${label} appears in sidebar + drawer`);
  }
  // Top header: eyebrow + section title + identity + logout.
  assert.match(html, /<header[^>]*>/);
  assert.match(html, /Growth Partner<\/p>/);
  assert.match(html, /<h1[^>]*>Dashboard<\/h1>/);
  assert.match(html, /Meera Partner/);
  assert.match(html, /aria-label="Logout"/);
  // Main content slot renders the section content.
  assert.match(html, /<main id="partner-portal-main"[^>]*>/);
  assert.match(html, /Main content goes here/);
  // The active item is marked for assistive tech.
  const active = html.match(/<button[^>]*data-partner-nav="dashboard"[^>]*>/);
  assert.ok(active, 'the dashboard nav button exists');
  assert.match(active![0], /aria-current="page"/);
});

test('the header carries the page title, partner name, partner id, bell, avatar and dropdowns (closed)', () => {
  const html = renderShell('dashboard');
  // Page title.
  assert.match(html, /<h1[^>]*>Dashboard<\/h1>/);
  // Partner name + partner id next to the avatar (compact form, full id in
  // the tooltip), exactly as the header spec lists them.
  const profileButton = html.match(/<button[^>]*data-partner-profile-button[^>]*>/);
  assert.ok(profileButton, 'the profile (avatar) button exists');
  assert.match(profileButton![0], /aria-haspopup="menu"/);
  assert.match(profileButton![0], /aria-expanded="false"/, 'dropdown starts closed');
  assert.match(profileButton![0], /aria-controls="partner-profile-menu"/);
  const profileSegment = html.slice(html.indexOf('data-partner-profile-button'));
  assert.match(profileSegment, /Meera Partner/, 'the partner name is in the header identity');
  assert.match(profileSegment, /ID a18d0df6…7195/, 'the compact partner id is displayed');
  assert.match(profileSegment, new RegExp(`title="Partner ID: ${SHELL_PARTNER_ID}"`), 'the full id is a tooltip');
  // Notification icon (bell) with its controlled panel id.
  const bell = html.match(/<button[^>]*data-partner-notifications[^>]*>/);
  assert.ok(bell, 'the notifications bell exists');
  assert.match(bell![0], /aria-label="Notifications"/);
  assert.match(bell![0], /aria-expanded="false"/);
  assert.match(bell![0], /aria-controls="partner-notifications-panel"/);
  // Logout affordance in the header.
  assert.match(html, /aria-label="Logout"/);
  // Closed dropdowns render neither panel nor backdrop.
  assert.doesNotMatch(html, /data-partner-profile-menu/);
  assert.doesNotMatch(html, /data-partner-notifications-panel/);
  assert.doesNotMatch(html, /data-partner-menu-backdrop/);
  // Mobile: hamburger + logo + avatar (the title block and quick logout are
  // sm+, the sidebar brand is lg+ — the header logo fills the gap).
  assert.match(html, /data-partner-mobile-logo/);
  const mobileLogo = html.slice(html.indexOf('data-partner-mobile-logo'));
  assert.match(mobileLogo.slice(0, 400), /Nexora/, 'the mobile header shows the logo');
});

test('the profile dropdown offers My Profile, a planned Account Settings slot and Logout', () => {
  const html = render(
    React.createElement(PartnerProfileMenu, {
      displayName: 'Meera Partner',
      email: 'meera@example.com',
      partnerId: SHELL_PARTNER_ID,
      onNavigateProfile: noop,
      onLogout: noop,
    })
  );
  // User card: real identity — name, email, full partner id.
  assert.match(html, /Meera Partner/);
  assert.match(html, /meera@example\.com/);
  assert.match(html, new RegExp(`Partner ID: ${SHELL_PARTNER_ID}`));
  // Menu items in spec order.
  const profileItem = html.match(/<button[^>]*data-partner-menu-item="profile"[^>]*>/);
  assert.ok(profileItem, 'My Profile is a real button');
  assert.match(html, /My Profile/);
  // Account Settings: no module exists yet — a disabled "Soon" slot, never a link.
  const settings = html.match(/<span[^>]*data-partner-menu-item="account-settings"[^>]*>/);
  assert.ok(settings, 'Account Settings has a slot');
  assert.match(settings![0], /aria-disabled="true"/);
  assert.match(html, /Account Settings/);
  assert.match(html, /Soon/);
  assert.doesNotMatch(html, /href="\/partner\/account-settings/);
  // Logout action.
  assert.match(html, /Logout/);
  const logoutItems = html.match(/<button[^>]*data-partner-logout[^>]*>/);
  assert.ok(logoutItems, 'the dropdown logout is a real button');
});

test('the notifications panel shows the real recent-activity feed, empty and loading states', () => {
  const entries: PartnerActivityEntry[] = [
    { type: 'website_completed', ref: '…00000001', display_name: 'User One', at: '2026-09-10T10:00:00Z' },
    { type: 'referral_added', ref: '…00000002', display_name: null, at: '2026-09-11T10:00:00Z' },
  ];
  const html = render(React.createElement(PartnerNotificationsPanel, { entries }));
  assert.match(html, /Notifications/);
  assert.match(html, /Recent activity from your referrals/);
  // Backend event labels + who they refer to (name or masked ref).
  assert.match(html, /Website completed/);
  assert.match(html, /User One/);
  assert.match(html, /New referral added/);
  assert.match(html, /Referred user …00000002/);
  // Honest empty state — never invented notifications.
  const empty = render(React.createElement(PartnerNotificationsPanel, { entries: [] }));
  assert.match(empty, /No notifications yet/);
  assert.match(empty, /Activity from your referrals will appear here\./);
  // Loading says so instead of showing stale or fake entries.
  const loading = render(React.createElement(PartnerNotificationsPanel, { entries: [], loading: true }));
  assert.match(loading, /Loading your notifications…/);
});

test('shortPartnerId formats the id for display without losing the original', () => {
  assert.equal(shortPartnerId('a18d0df6-58b5-4bdc-a518-3a597d5b7195'), 'a18d0df6…7195');
  assert.equal(shortPartnerId('short-id'), 'short-id', 'short ids stay intact');
  assert.equal(shortPartnerId('  a18d0df6-58b5-4bdc-a518-3a597d5b7195  '), 'a18d0df6…7195', 'trimmed');
  assert.equal(shortPartnerId(null), '', 'no id → no display');
  assert.equal(shortPartnerId(''), '');
});

test('each portal section renders its own header title and active menu item', () => {
  const cases: Array<[string, string]> = [
    ['dashboard', 'Dashboard'],
    ['referral-code', 'My Referral Code'],
    ['referred-users', 'Referred Users'],
    ['referral-status', 'Referral Status'],
    ['profile', 'Profile'],
  ];
  for (const [section, title] of cases) {
    const html = renderShell(section as (typeof PARTNER_PORTAL_SECTIONS)[number]);
    assert.match(html, new RegExp(`<h1[^>]*>${title}</h1>`), `${section} header title`);
    const active = html.match(new RegExp(`<button[^>]*data-partner-nav="${section}"[^>]*>`));
    assert.ok(active, `${section} nav button exists`);
    assert.match(active![0], /aria-current="page"/, `${section} is the active item`);
    // Non-active items carry no stale aria-current.
    const others = (html.match(/<button[^>]*data-partner-nav="[^"]*"[^>]*>/g) ?? []).filter(
      (tag) => !tag.includes(`data-partner-nav="${section}"`)
    );
    assert.ok(others.length > 0);
    for (const tag of others) assert.doesNotMatch(tag, /aria-current/);
  }
});

test('the mobile drawer exists, starts closed, and is toggled by a labelled hamburger', () => {
  const html = renderShell('dashboard');
  const toggle = html.match(/<button[^>]*data-partner-nav-toggle[^>]*>/);
  assert.ok(toggle, 'the hamburger toggle exists');
  assert.match(toggle![0], /aria-expanded="false"/, 'drawer starts closed');
  assert.match(toggle![0], /aria-controls="partner-portal-drawer"/);
  assert.match(toggle![0], /aria-label="Open navigation"/);
  const drawer = html.match(/<div[^>]*data-partner-drawer[^>]*>/);
  assert.ok(drawer, 'the drawer element exists for aria-controls');
  assert.match(drawer![0], /aria-label="Growth Partner navigation"/);
  assert.match(drawer![0], /-translate-x-full/, 'closed drawer sits off-canvas');
  // No backdrop is rendered while closed.
  assert.doesNotMatch(html, /data-partner-nav-backdrop/);
});

test('future modules render as disabled "Soon" slots, never as links or buttons', () => {
  const html = renderShell('dashboard');
  assert.match(html, /Coming soon/);
  for (const item of PARTNER_PORTAL_PLANNED) {
    const slot = html.match(new RegExp(`<span[^>]*data-partner-planned="${item.id}"[^>]*>`));
    assert.ok(slot, `${item.label} has a sidebar slot`);
    assert.match(html, new RegExp(`>${item.label}<`));
  }
  const soonCount = (html.match(/>Soon</g) || []).length;
  assert.equal(soonCount, PARTNER_PORTAL_PLANNED.length * 2, 'Soon badge in sidebar + drawer, nothing more');
});

// ---------------------------------------------------------------------------
// 3. My Referral Code — code, copy, share link, how it works
// ---------------------------------------------------------------------------

test('the referral code page shows the real code big, copy actions and the funnel steps', () => {
  const html = render(
    React.createElement(PartnerReferralCodeSection, { code: 'ALPHA01', isActive: true, origin: 'https://app.example' })
  );
  // The code, verbatim and prominent.
  assert.match(html, /data-referral-code="ALPHA01"/);
  assert.match(html, /ALPHA01/);
  assert.match(html, /Your referral code/);
  // Copy affordances (code + link) — real clipboard use, no fake success.
  assert.match(html, /Copy code/);
  assert.match(html, /Copy link/);
  // The share link is a plain URL built from the partner's own code.
  assert.match(html, /https:\/\/app\.example\/onboarding\/referral\?ref=ALPHA01/);
  // Honest copy: the code is platform-managed.
  assert.match(html, /cannot be changed here/);
  // The funnel explanation.
  assert.match(html, /How it works/);
  assert.match(html, /Share your code or link/);
  assert.match(html, /They sign up with your code/);
  assert.match(html, /Track them in your portal/);
  // No paused banner for an active partner.
  assert.doesNotMatch(html, /currently paused/);
});

test('the referral code page adapts to paused partners and missing codes honestly', () => {
  const paused = render(
    React.createElement(PartnerReferralCodeSection, { code: 'ALPHA01', isActive: false, origin: 'https://app.example' })
  );
  assert.match(paused, /currently paused/);
  // The code is still shown (it identifies existing referrals) with the pause note.
  assert.match(paused, /ALPHA01/);

  const missing = render(React.createElement(PartnerReferralCodeSection, { code: null }));
  assert.match(missing, /Referral code not available\./);
  assert.doesNotMatch(missing, /data-referral-code=/);
  assert.doesNotMatch(missing, /Copy link/);
});

test('the share link helper builds a clean onboarding URL and degrades safely', () => {
  assert.equal(partnerReferralShareLink('ALPHA01', 'https://app.example'), 'https://app.example/onboarding/referral?ref=ALPHA01');
  assert.equal(
    partnerReferralShareLink('ALPHA01', 'https://app.example/'),
    'https://app.example/onboarding/referral?ref=ALPHA01',
    'trailing slashes on the origin are normalized'
  );
  assert.equal(partnerReferralShareLink('  ALPHA01  ', 'https://app.example'), 'https://app.example/onboarding/referral?ref=ALPHA01');
  // No origin (SSR/no browser) or no code → no link, never a broken one.
  assert.equal(partnerReferralShareLink('ALPHA01', ''), '');
  assert.equal(partnerReferralShareLink('', 'https://app.example'), '');
  // Codes with unusual characters are URL-encoded, not interpolated raw.
  assert.equal(partnerReferralShareLink('A B/01', 'https://app.example'), 'https://app.example/onboarding/referral?ref=A%20B%2F01');
});

test('without a browser origin the code page omits the link block instead of faking one', () => {
  const html = render(React.createElement(PartnerReferralCodeSection, { code: 'ALPHA01' }));
  assert.match(html, /ALPHA01/);
  assert.match(html, /Copy code/);
  assert.doesNotMatch(html, /Share your link/);
  assert.doesNotMatch(html, /onboarding\/referral/);
});

// ---------------------------------------------------------------------------
// 4. Referral Status — KPI chips + legend around the real list
// ---------------------------------------------------------------------------

const DASHBOARD_SAMPLE: PartnerDashboardData = {
  partner: { referral_code: 'ALPHA01', is_active: true, partner_since: '2026-09-01T00:00:00.000Z' },
  kpis: { total_referrals: 3, active_onboarding: 2, completed: 1 },
  recent_activity: [],
};

test('the referral status page shows backend KPIs, a status legend and the list', () => {
  const html = render(
    React.createElement(
      PartnerReferralStatusSection,
      { dashboard: DASHBOARD_SAMPLE, loading: false },
      React.createElement('p', null, 'THE LIST')
    )
  );
  // KPI chips carry the server counts.
  assert.match(html, /Total Referrals/);
  assert.match(html, /In Progress/);
  assert.match(html, /Completed/);
  assert.match(html, />3</);
  assert.match(html, />2</);
  assert.match(html, />1</);
  // The legend explains each status in plain words.
  assert.match(html, /What each status means/);
  assert.match(html, /onboarding not started yet/);
  assert.match(html, /the website is underway/);
  assert.match(html, /website is completed/);
  // The real list is rendered inside the page.
  assert.match(html, /THE LIST/);
});

test('the referral status KPIs show placeholders, never invented numbers, while loading', () => {
  const html = render(
    React.createElement(
      PartnerReferralStatusSection,
      { dashboard: null, loading: true },
      React.createElement('p', null, 'THE LIST')
    )
  );
  assert.match(html, /Total Referrals/);
  assert.match(html, /—/);
  assert.match(html, /THE LIST/);
});

// ---------------------------------------------------------------------------
// 5. The share link pre-fills the onboarding referral screen (?ref=CODE)
// ---------------------------------------------------------------------------

test('a shared code pre-fills the onboarding referral screen (server render)', () => {
  const html = render(
    React.createElement(ReferralScreen, { email: 'newbie@example.com', initialCode: 'ALPHA01' })
  );
  assert.match(html, /value="ALPHA01"/, 'the code input starts pre-filled from the link');

  const plain = render(React.createElement(ReferralScreen, { email: 'newbie@example.com' }));
  assert.match(plain, /value=""/, 'without a link the input starts empty');
});

test('the onboarding app captures the ?ref= parameter once and passes it to the referral screen', () => {
  const source = readFileSync(new URL('../src/onboarding/OnboardingApp.tsx', import.meta.url), 'utf8');
  assert.match(source, /readSharedReferralCode/, 'the app reads the shared code');
  assert.match(source, /useState<string>\(readSharedReferralCode\)/, 'captured once on mount, before any login redirect drops the query');
  assert.match(source, /initialCode=\{sharedReferralCode\}/, 'the referral screen receives the captured code');
  // The backend re-validates: the pre-fill must never be trusted as linked.
  assert.match(source, /re-validates (?:it )?on submit/);
});

test('the page wires the portal shell to the shared content sections', () => {
  const source = readFileSync(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /partnerPortalContentSection\(portalSection\)/, 'portal sections map to content sections');
  assert.match(source, /PartnerPortalShell/, 'the partner namespace renders the portal shell');
  assert.match(source, /GrowthPartnerShell/, 'the legacy namespace keeps its original shell');
  assert.match(source, /PartnerReferralCodeSection/, 'the My Referral Code page is rendered');
  assert.match(source, /PartnerReferralStatusSection/, 'the Referral Status page is rendered');
});
