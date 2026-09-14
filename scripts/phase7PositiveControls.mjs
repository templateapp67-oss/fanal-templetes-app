#!/usr/bin/env node
/**
 * PHASE 7 — PART 3 × Growth Partner positive controls.
 *
 * Applies each mutation below to the real migration in place, runs the one test
 * that must catch it, restores the file (byte-for-byte, from a backup), and
 * reports how long the run took. Run from the repo root:
 *
 *   node scripts/phase7PositiveControls.mjs
 *   node scripts/phase7PositiveControls.mjs conversion   # one control by name
 *
 * Every control must come back RED. The audits in
 * ONBOARDING_PHASE7_PART3_GROWTH_PARTNER_AUDIT.md (PART D) quote these results.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MIGRATIONS = 'supabase/migrations';

const read = (file) => {
  const source = join(MIGRATIONS, file);
  return { source, body: readFileSync(source, 'utf8') };
};

/** Replace the nth (1-based) occurrence of an anchor inside one migration. */
const convert = (file, from, to, nth = 1) => () => {
  const { source, body } = read(file);
  const count = body.split(from).length - 1;
  if (count < nth) throw new Error(`${file}: anchor appears ${count} time(s), wanted #${nth}`);
  let seen = 0;
  const mutated = body.replaceAll(from, (match) => (++seen === nth ? to : match));
  return { mutated, source, name: file };
};

/** Append a statement to a migration. */
const append = (file, sql) => () => {
  const { source, body } = read(file);
  if (body.includes(sql)) throw new Error(`${file}: control already present`);
  return { mutated: `${body}\n\n${sql}\n`, source, name: file };
};

/** Insert a statement after the first occurrence of an anchor. */
const insertAfter = (file, anchor, sql) => () => {
  const { source, body } = read(file);
  const count = body.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${file}: anchor appears ${count} time(s), wanted 1`);
  return { mutated: body.replace(anchor, `${anchor}\n${sql}`), source, name: file };
};

const controls = [
  {
    name: 'conversion',
    title: 'template_completed no longer converts',
    mutate: convert(
      '20260924_referral_lifecycle.sql',
      "case p_onboarding when 'template_completed' then 'converted'",
      "case p_onboarding when 'template_completed' then 'active'",
    ),
    test: { file: 'tests/part3GrowthPartnerIntegration.test.ts', pattern: '7.7' },
    domTest: { file: 'tests/dom/part3GrowthPartnerJourneyBrowserFlow.test.ts' },
    expect: "7.7 fails with expected 'converted', actual 'active'; the journey shows 0 Converted",
  },
  {
    name: 'masking',
    title: 'the partner list leaks the referred contact',
    // nth = 1 is the call site inside get_my_partner_referrals_filtered
    // (the effective list); the detail RPC has its own copy.
    mutate: convert(
      '20260926_referral_search_details.sql',
      'public.growth_mask_referral_email(u.email) as masked_contact,',
      'u.email as masked_contact,',
    ),
    test: { file: 'tests/part3GrowthPartnerIntegration.test.ts', pattern: '7.6' },
    expect: '7.6 fails because the payload carries the raw email',
  },
  {
    name: 'second-model',
    title: 'PART 3 grows a parallel referral table',
    mutate: append(
      '20261002_owner_workspace_provisioning.sql',
      '-- CONTROL: a parallel referral model.\ncreate table if not exists public.owner_referrals_v2 (\n  id uuid primary key default gen_random_uuid(),\n  owner_id uuid,\n  partner_code text\n);',
    ),
    test: { file: 'tests/part3GrowthPartnerIntegration.test.ts', pattern: '7.4|7.9' },
    expect: '7.4 fails on the table inventory and 7.9 fails with "no referral table"',
  },
  {
    name: 'part3-ledger',
    title: 'PART 3 provisioning damages the referral ledger',
    mutate: insertAfter(
      '20261002_owner_workspace_provisioning.sql',
      '  v_attempt integer := 0;',
      "  -- CONTROL: PART 3 wipes the owner's referral ledger row.\n  delete from public.partner_referrals where referred_user_id = actor;",
    ),
    test: { file: 'tests/part3GrowthPartnerIntegration.test.ts', pattern: '7.4' },
    expect: '7.4 fails: the ledger row is gone after the PART 3 workspace step',
  },
];

const only = process.argv.slice(2);
const selected = only.length ? controls.filter((c) => only.includes(c.name)) : controls;
if (!selected.length) {
  console.error(`unknown control; known: ${controls.map((c) => c.name).join(', ')}`);
  process.exit(2);
}

let failures = 0;
for (const control of selected) {
  const backup = join(tmpdir(), `${control.name}.phase7.bak`);
  const started = Date.now();
  const { mutated, source, name } = control.mutate();
  copyFileSync(source, backup);
  try {
    writeFileSync(source, mutated);
    console.log(`\n=== ${control.name}: ${control.title} (${name}) ===`);
    const run = spawnSync(
      './node_modules/.bin/tsx',
      ['--test', '--test-force-exit', `--test-name-pattern=${control.test.pattern}`, control.test.file],
      { encoding: 'utf8' },
    );
    let output = `${run.stdout}${run.stderr}`;
    if (control.domTest) {
      const dom = spawnSync(
        'node',
        [
          '--import', './scripts/testEnv.mjs', '--import', 'tsx',
          '--test', '--disable-warning=ExperimentalWarning', '--test-force-exit',
          control.domTest.file,
        ],
        { encoding: 'utf8' },
      );
      output += `\n--- ${control.domTest.file} ---\n${dom.stdout}${dom.stderr}`;
    }
    const pass = [...output.matchAll(/(?:^|\n)# pass (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    const fail = [...output.matchAll(/(?:^|\n)# fail (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const caught = fail > 0 && pass === 0;
    if (!caught) failures += 1;
    console.log(`    ${caught ? 'RED as expected' : 'GREEN — control did NOT catch the mutation'} in ${seconds}s`);
    console.log(`    expected: ${control.expect}`);
    for (const line of output.split('\n').filter((l) => /^\s*(not ok|# (pass|fail)|---)/.test(l))) {
      console.log(`    | ${line.trim()}`);
    }
    if (!caught) console.log(output.slice(-2000));
  } finally {
    copyFileSync(backup, source); // always restore, byte-for-byte
    const restored = readFileSync(source, 'utf8') === readFileSync(backup, 'utf8');
    console.log(`    restored: ${restored ? 'yes' : 'NO — check ' + source}`);
    if (!restored) failures += 1;
  }
}

console.log(`\n${selected.length - failures}/${selected.length} controls behaved as expected`);
process.exit(failures ? 1 : 0);
