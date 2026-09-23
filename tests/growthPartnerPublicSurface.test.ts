// ============================================================================
// The Growth Partner public surface — and the wiring it promises.
//
// `src/services/growthPartner.ts` exists and every section reads through it.
// Two paths now advertise that layer:
//
//   • `src/types/growthPartner.ts`       — the TYPE surface (one import path)
//   • `src/components/GrowthPartner/`    — the UI entry point
//
// Both are RE-EXPORT surfaces. This file makes that structural, not hopeful:
// the moment either one defines its own version of a type or a component, the
// codebase has two sources of truth and this test fails. It also pins the
// promise that no component reaches around the facade to a raw RPC helper.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as typeSurface from '../src/types/growthPartner';
import * as componentsBarrel from '../src/components/GrowthPartner';
import * as sections from '../src/components/GrowthPartnerSections';
import * as page from '../src/components/GrowthPartnerPage';
import * as partnerModules from '../src/components/partner';
import * as failurePanel from '../src/components/PartnerAreaFailurePanel';
import * as routeGuard from '../src/components/PartnerRouteGuard';
import * as statusScreen from '../src/components/PartnerStatusScreen';
import * as portalLogin from '../src/components/PartnerPortalLogin';
import * as growthLogin from '../src/components/GrowthPartnerLogin';
import * as profilePage from '../src/components/GrowthPartnerProfilePage';
import * as accountSettings from '../src/components/PartnerAccountSettingsPage';
import * as facade from '../src/services/growthPartner';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed — what the compiler actually sees. */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
// 1. The type surface defines nothing
// ---------------------------------------------------------------------------

test('src/types/growthPartner.ts is a re-export surface, never a second definition', () => {
  const source = code('src/types/growthPartner.ts');

  // No `interface`, `type X =`, `class`, `const`, `function` declarations: the
  // single definitions live in lib/growthPartner.ts, lib/partnerPortalOperations.ts
  // and services/growthPartner.ts.
  assert.doesNotMatch(source, /^\s*interface\s/m, 'no interface may be defined here');
  assert.doesNotMatch(source, /^\s*type\s+\w+\s*=/m, 'no type alias may be defined here');
  assert.doesNotMatch(source, /^\s*(export\s+)?(class|const|let|function|enum)\s/m, 'no value may be defined here');
  assert.doesNotMatch(source, /^\s*export\s+default\s/m, 'no default export');

  // Everything that is exported comes from a real module, and there is a
  // meaningful number of them (an accidentally gutted file fails here).
  const sources = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.ok(sources.length >= 4, `expected several re-export sources, found ${sources.length}`);
  for (const from of sources) {
    assert.ok(from.startsWith('.'), `${from} must be a relative module`);
  }

  // The one value in the surface is the error class callers need for `instanceof`.
  assert.equal(typeSurface.GrowthPartnerServiceError, facade.GrowthPartnerServiceError);
});

test('the type surface covers the whole contract the sections rely on', () => {
  const source = read('src/types/growthPartner.ts');
  for (const name of [
    // identity + gate
    'GrowthPartner',
    'GrowthPartnerApplicationRow',
    'GrowthPartnerGate',
    // read models
    'PartnerDashboardData',
    'PartnerReferralEntry',
    'PartnerReferralList',
    'PartnerPerformanceData',
    // operations (money, all paise)
    'PartnerEarningsPayload',
    'PartnerEarningRow',
    'PartnerPayoutRequestsPayload',
    'PartnerLevelsPayload',
    'PartnerLeaderboardPayload',
    'PartnerNotificationsPayload',
    'PartnerMarketingAsset',
    'PartnerSupportTicketRow',
    // result contract + failure
    'GrowthPartnerResult',
    'GrowthPartnerSuccess',
    'GrowthPartnerFailure',
    'PartnerAreaFailure',
    'PayoutRequestInput',
    'PartnerReferralQuery',
  ]) {
    assert.match(source, new RegExp(`\\b${name}\\b`), `${name} must be reachable from the type surface`);
  }
  // The vocabulary this repo does NOT use is documented rather than aliased:
  // a `TransformedReferral` alias would compile and then read undefined fields.
  assert.match(source, /TransformedReferral/, 'the mapping note explains why it is not aliased');
});

// ---------------------------------------------------------------------------
// 2. The components entry point re-exports the real components
// ---------------------------------------------------------------------------

test('src/components/GrowthPartner/ defines no component of its own', () => {
  const source = code('src/components/GrowthPartner/index.ts');
  assert.doesNotMatch(source, /^\s*(interface|type\s+\w+\s*=|class|const|let|function|enum)\s/m, 're-exports only');
  assert.doesNotMatch(source, /<[A-Za-z]/, 'no JSX: this is a barrel, not a screen');
  assert.doesNotMatch(source, /useState|useEffect|fetch\(/, 'no logic of any kind');
  const sources = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.ok(sources.length >= 5, 'the barrel covers the area');
});

test('every barrel export IS the canonical component (identity, not a copy)', () => {
  // Each module is kept separate so a name exported by two of them cannot
  // silently mask the wrong module.
  const canonicalModules: Array<Record<string, unknown>> = [
    sections,
    page,
    partnerModules,
    failurePanel,
    routeGuard,
    statusScreen,
    portalLogin,
    growthLogin,
    profilePage,
    accountSettings,
  ];
  const exported = Object.entries(componentsBarrel);
  assert.ok(exported.length >= 30, `the barrel exposes the area (found ${exported.length})`);

  for (const [name, value] of exported) {
    // Identity equality is the whole point: a re-exported function is the SAME
    // object. A copy would be a different function and would diverge silently.
    const owners = canonicalModules.filter((module) => module[name] !== undefined);
    assert.ok(owners.length > 0, `${name} must come from a canonical module`);
    assert.ok(owners.some((module) => module[name] === value), `${name} must be the canonical export, not a fork`);
    if (name.startsWith('GROWTH_PARTNER_')) {
      // Copy constants (labels maps and message strings) are the only
      // non-component exports the barrel carries.
      assert.ok(
        typeof value === 'string' || (typeof value === 'object' && value !== null),
        `${name} is copy, not a component`
      );
    } else {
      assert.equal(typeof value, 'function', `${name} must be a component or hook`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The wiring census: sections read through the facade, never around it
// ---------------------------------------------------------------------------

/** Every component that renders partner data. */
function facadeWiredComponentFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.tsx') && !full.endsWith('index.ts')) files.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, 'src/components/partner'));
  return files;
}

test('every partner-data component imports the facade and never a raw RPC helper', () => {
  const wired = [
    'src/components/GrowthPartnerPage.tsx',
    'src/components/partner/PartnerEarningsPage.tsx',
    'src/components/partner/PartnerWithdrawalsPage.tsx',
    'src/components/partner/PartnerLevelsPage.tsx',
    'src/components/partner/PartnerLeaderboardsPage.tsx',
    'src/components/partner/PartnerNotificationsPage.tsx',
    'src/components/partner/PartnerSupportPage.tsx',
    'src/components/partner/PartnerMarketingMaterialsPage.tsx',
  ];
  // The census is generated, so a NEW partner-data module cannot quietly skip
  // the facade — and a module that stops importing it fails just as loudly.
  const discovered = facadeWiredComponentFiles().filter((file) => read(file).includes('services/growthPartner'));
  assert.deepEqual(discovered.sort(), wired.slice(1).sort(), 'every portal module is facade-wired, and only these are');

  const pageSource = code('src/components/GrowthPartnerPage.tsx');
  assert.ok(pageSource.includes('services/growthPartner'), 'the page must import the facade');
  // The page owns its gate + four section reads imperatively and branches on the
  // result object; the portal modules use the hooks. Both go through the facade.
  assert.match(pageSource, /unwrapPartnerResult|isServiceFailure/, 'the page consumes result objects');

  for (const file of wired.slice(1)) {
    const source = code(file);
    assert.match(source, /from '(\.\.\/)+services\/growthPartner'/, `${file} must import the facade`);
    assert.match(source, /usePartnerService(Query|Action)/, `${file} must use the service hooks`);
    // Reaching around the facade is what this test exists to catch.
    assert.doesNotMatch(source, /usePartnerQuery\(|usePartnerAction\(/, `${file} must not use the older throw-based hooks`);
    assert.doesNotMatch(source, /\bgetPartner[A-Z]\w*\(/, `${file} must not call a raw operations reader`);
    assert.doesNotMatch(source, /\bfetchMyPartner\w*\(/, `${file} must not call a raw lib wrapper`);
    // The floor constant (`PARTNER_MINIMUM_PAYOUT_PAISE`) and the payload TYPES
    // are welcome here — importing the same ₹500 the service enforces is what
    // keeps the form and the ledger in agreement. The RPC FUNCTIONS are not:
    // those are what the facade exists to own.
    const operationImports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*partnerPortalOperations'/g)];
    for (const match of operationImports) {
      const names = match[1].split(',').map((name) => name.trim().replace(/^type\s+/, '')).filter(Boolean);
      for (const name of names) {
        assert.doesNotMatch(
          name,
          /^(get|request|cancel|mark|submit|update)Partner[A-Z]/,
          `${file} must not import the RPC reader ${name} — call the facade instead`
        );
      }
    }
    assert.doesNotMatch(source, /\bsupabase\b/, `${file} must not touch the client directly`);
  }
});

test('the facade result contract is the only shape the sections consume', () => {
  // The page branches on the result object; a section receives the classified
  // failure from its service hook. Neither reads a thrown error's message.
  assert.match(code('src/components/GrowthPartnerPage.tsx'), /isServiceFailure|unwrapPartnerResult/);
  assert.match(code('src/components/partner/PartnerEarningsPage.tsx'), /failure=\{query\.failure\}/);
  // And the service namespace exposes the predicates bridges.
  for (const key of ['isServiceFailure', 'isServiceSuccess', 'unwrapPartnerResult'] as const) {
    assert.equal(typeof (facade.growthPartnerService as Record<string, unknown>)[key], 'function', `${key} must be bridged`);
  }
});
