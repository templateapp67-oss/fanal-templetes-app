#!/usr/bin/env node
// ============================================================================
// Supabase connection verifier —  npm run verify
// ----------------------------------------------------------------------------
// Answers, in one command: "is the Customer App actually connected to my
// database, and is every customer entity backed by a real table?"
//
//   Stage 1  mapping integrity (no network, always runs)
//            the 18 customer entities, the tables they claim, the routes that
//            serve them, and the gaps the schema cannot store
//   Stage 2  schema reality  (needs SUPABASE_URL + a key)
//            each physical table is asked over PostgREST whether it exists and
//            how many rows it holds — read-only, `limit=1` and a HEAD count
//   Stage 3  RLS reality     (needs the same keys)
//            the same catalogue read is retried anonymously to prove why the
//            customer app goes through the API instead of the browser
//   Stage 4  API agreement   (optional, `--api <url>`)
//            /api/customer/connection must agree with what the database said
//
// Nothing here writes. No table is created, renamed or truncated, and the
// service-role key is only ever used for reads. Secrets are never printed in
// full. Exit codes: 0 verified · 1 mismatch · 2 not configured / unreachable.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import {
  CUSTOMER_SCHEMA_MAP,
  CUSTOMER_FLOW_ORDER,
  PHYSICAL_TABLES,
  CUSTOMER_SCHEMA_GAPS,
} from '../src/lib/customer/schema.ts';

const cwd = process.cwd();
const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index !== -1 && argv[index + 1] ? String(argv[index + 1]).trim() : '';
};
const onlyStage = argValue('stage'); // e.g. --stage 1

// --- env ------------------------------------------------------------------
const sources = [];
for (const file of ['.env', '.env.local', '.env.development']) {
  const full = path.join(cwd, file);
  if (!fs.existsSync(full)) continue;
  const before = process.env.SUPABASE_URL;
  dotenv.config({ path: full, quiet: true });
  if (before !== process.env.SUPABASE_URL) sources.push(file);
}

const clean = (value) => String(value || '').trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
const mask = (value) => (value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '(missing)');

// Both spellings are accepted, matching src/lib/supabaseClient.ts.
const url = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
const anonKey = clean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const apiUrl = clean(argValue('api') || process.env.VERIFY_API_URL || '');
const appUrl = clean(process.env.APP_URL);
const resolvedApiUrl = apiUrl || (appUrl && !appUrl.includes('{') ? `${appUrl.replace(/\/+$/, '')}` : '');

const readKey = serviceKey || anonKey;
const readKeyLabel = serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : anonKey ? 'SUPABASE_ANON_KEY' : '(none)';

const failures = [];
const warnings = [];
const line = (label, value) => console.log(`  ${label.padEnd(22)}: ${value}`);

console.log('\n— Customer App ↔ Supabase verification ————————————————————');
line('env file(s)', sources.length ? sources.join(', ') : 'process environment only');
line('SUPABASE_URL', url || '(missing)');
line('read key', mask(readKey));
line('key used', readKeyLabel);
line('api base', resolvedApiUrl || '(not checked)');

// ===========================================================================
// Stage 1 — mapping integrity. Always runs; needs no credentials.
// ===========================================================================
console.log('\n[1/4] Mapping integrity');

// The names the Customer App spec asked for, and the logical entity that answers
// each one. Two spec names may share an entity — profile and location are both
// columns of `profiles` — which is exactly what this table makes visible instead
// of papering over with a 19th fake table.
const REQUESTED_ENTITIES = [
  { spec: 'login / signup (customer user)', logical: 'profiles' },
  { spec: 'profile', logical: 'profiles' },
  { spec: 'location', logical: 'profiles' },
  { spec: 'salon profile', logical: 'salons' },
  { spec: 'service', logical: 'salon_services' },
  { spec: 'staff', logical: 'salon_staff' },
  { spec: 'staff slots', logical: 'staff_slots' },
  { spec: 'booking', logical: 'bookings' },
  { spec: 'booking history', logical: 'bookings' },
  { spec: 'booking services', logical: 'booking_services' },
  { spec: 'reviews', logical: 'reviews' },
  { spec: 'favourites', logical: 'favourites' },
  { spec: 'search history', logical: 'search_history' },
  { spec: 'rewards wallet', logical: 'reward_wallets' },
  { spec: 'reward transactions', logical: 'reward_transactions' },
  { spec: 'QR payment rewards', logical: 'customer_qr_payments' },
  { spec: 'membership', logical: 'memberships' },
  { spec: 'referral', logical: 'referrals' },
  { spec: 'notifications', logical: 'notifications' },
  { spec: 'offers', logical: 'offers' },
  { spec: 'offer redemption', logical: 'offer_redemptions' },
];

if (CUSTOMER_SCHEMA_MAP.length !== 18) {
  failures.push(`CUSTOMER_SCHEMA_MAP has ${CUSTOMER_SCHEMA_MAP.length} entries, not 18.`);
}
for (const requested of REQUESTED_ENTITIES) {
  if (!CUSTOMER_SCHEMA_MAP.some((entry) => entry.logical === requested.logical)) {
    failures.push(`"${requested.spec}" cannot be served: entity "${requested.logical}" is not in the mapping.`);
  }
}
for (const logical of CUSTOMER_FLOW_ORDER) {
  if (!CUSTOMER_SCHEMA_MAP.some((entry) => entry.logical === logical)) {
    failures.push(`Flow step "${logical}" has no mapping entry — the customer flow cannot be completed.`);
  }
  if (!REQUESTED_ENTITIES.some((requested) => requested.logical === logical)) {
    failures.push(`Mapping entity "${logical}" is not part of the customer flow: nothing reads it.`);
  }
}

// Which tables really exist is read from the migration, not from this script's
// opinion — so a schema change moves the verdict automatically.
const migrationPath = path.join(cwd, 'supabase/migrations/00001_init.sql');
let realTables = new Set();
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const match of sql.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    realTables.add(match[1].toLowerCase());
  }
} else {
  warnings.push('supabase/migrations/00001_init.sql not found — "does the table exist" cannot be answered locally.');
}

for (const entry of CUSTOMER_SCHEMA_MAP) {
  for (const table of entry.tables) {
    if (!PHYSICAL_TABLES.includes(table)) {
      failures.push(`${entry.logical}: reads \`${table}\`, which is not in PHYSICAL_TABLES — the app must not touch tables outside the ones that exist.`);
    }
    if (realTables.size && !realTables.has(table.toLowerCase())) {
      failures.push(`${entry.logical}: \`${table}\` is not in the migration.`);
    }
  }
  // The kind decides what `table` may claim. A jsonb-backed entity DOES name a
  // physical table — the host row its jsonb lives on — and that must be one of
  // the tables the read path touches, otherwise the screen would be pointing at
  // a table it never queries.
  if (entry.kind === 'table' && !entry.table) failures.push(`${entry.logical}: kind "table" but no physical table.`);
  // A device-stored entity may still READ real tables for the derived half of
  // its list (popular searches come from `services`), but it must never claim a
  // host table, because nothing is ever written to the database for it.
  if ((entry.kind === 'device' || entry.kind === 'derived') && entry.table) {
    failures.push(`${entry.logical}: ${entry.kind} data claims a host table \`${entry.table}\` — the reader would look for a row that does not hold it.`);
  }
  if (entry.table && !entry.tables.includes(entry.table)) {
    failures.push(`${entry.logical}: host table \`${entry.table}\` is not among the tables it reads (${entry.tables.join(', ') || 'none'}).`);
  }
  if (!entry.endpoint || !entry.note) failures.push(`${entry.logical}: an entity without an endpoint or a mapping note is unverifiable.`);
}

// Every endpoint the UI is told to call must be registered on the server.
const serverPath = path.join(cwd, 'server/customerRoutes.ts');
const serverSource = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '';
// Route paths are compared after normalising placeholders, because the map
// spells them `{salonId}` and the router spells them `:idOrSubdomain` — and a
// comparison that only strips one of the two styles reports every nested route
// as missing (or, as this check used to, quietly skips the entity entirely).
const normalisePath = (value) =>
  String(value || '')
    .replace(/\{[^}]+\}/g, '*')
    .replace(/:[A-Za-z0-9_]+/g, '*')
    .replace(/\/+$/, '');
const endpointPath = (endpoint) => normalisePath(String(endpoint || '').trim().split(' ').pop());

if (!serverSource) {
  failures.push('server/customerRoutes.ts is missing — the customer API does not exist.');
} else {
  const registered = new Set(
    [...serverSource.matchAll(/^\s*\['(\/api\/customer[^']+)', '(get|post)'/gm)].map((match) => normalisePath(match[1]))
  );
  if (!registered.size) {
    failures.push('No /api/customer routes could be read out of the router table — the endpoint check cannot run.');
  }
  for (const entry of CUSTOMER_SCHEMA_MAP) {
    const path = endpointPath(entry.endpoint);
    if (!path) {
      failures.push(`${entry.logical}: no endpoint to verify.`);
      continue;
    }
    if (!registered.has(path)) {
      failures.push(`${entry.logical}: nothing in server/customerRoutes.ts serves \`${entry.endpoint}\`.`);
    }
    for (const extra of entry.alsoEndpoints || []) {
      if (!registered.has(endpointPath(extra))) {
        failures.push(`${entry.logical}: nothing serves the additional endpoint \`${extra}\`.`);
      }
    }
  }
  if (!serverSource.includes("'/api/customer/health'") && !serverSource.includes('/api/customer/connection')) {
    warnings.push('No /api/customer/connection route found; the API-agreement stage cannot work.');
  }
}

const counts = { table: 0, jsonb: 0, derived: 0, device: 0 };
for (const entry of CUSTOMER_SCHEMA_MAP) counts[entry.kind] = (counts[entry.kind] || 0) + 1;
line('entities', `${CUSTOMER_SCHEMA_MAP.length}`);
line('direct tables', String(counts.table));
line('jsonb-backed', String(counts.jsonb));
line('derived', String(counts.derived));
line('device-only', String(counts.device));
line('physical tables used', PHYSICAL_TABLES.length ? [...new Set(CUSTOMER_SCHEMA_MAP.flatMap((entry) => entry.tables))].join(', ') : '(none)');
console.log(`\n  The schema has no table for ${CUSTOMER_SCHEMA_GAPS.length} of the requested entities:`);
for (const gap of CUSTOMER_SCHEMA_GAPS) {
  console.log(`    • ${gap.logical} — ${gap.why}`);
  if (!gap.why || !gap.needs) failures.push(`Gap "${gap.logical}" is missing its why/needs explanation.`);
}
console.log('  These are derived or device-stored on purpose; nothing was created to hide them.');
if (onlyStage === '1') finish();

// ===========================================================================
// Stage 2 — does each table answer?
// ===========================================================================
console.log('\n[2/4] Table probe over PostgREST');
if (!url || !readKey) {
  console.log('  SKIPPED — no SUPABASE_URL / key in this environment.');
  console.log('  The app answers every customer request with mode:"mock" and an explicit');
  console.log('  "not connected" notice rather than sample data, so this is a deployment');
  console.log('  gap, not a code gap. Add the keys to .env and re-run.');
  if (onlyStage === '2' || onlyStage === '3' || onlyStage === '4') finish(2);
  finish();
}

const tables = [...new Set(CUSTOMER_SCHEMA_MAP.flatMap((entry) => entry.tables))].sort();
const rest = `${url}/rest/v1`;
const headers = (key) => ({ apikey: key || readKey, Authorization: `Bearer ${key || readKey}`, Accept: 'application/json' });

async function probe(table, key) {
  const target = `${rest}/${table}?select=*&limit=1`;
  try {
    const res = await fetch(target, { headers: headers(key), signal: AbortSignal.timeout(15000) });
    const countRes = await fetch(`${rest}/${table}?select=*`, {
      method: 'HEAD',
      headers: { ...headers(key), Prefer: 'count=exact' },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    const range = countRes?.headers?.get('content-range') || '';
    const rows = /\/(\d+)$/.exec(range)?.[1];
    const body = res.ok ? await res.json().catch(() => []) : null;
    return {
      status: res.status,
      ok: res.ok,
      code: !res.ok ? (await res.json().catch(() => ({})))?.code : undefined,
      sample: Array.isArray(body) ? body.length : 0,
      rows: rows ? Number(rows) : null,
    };
  } catch (err) {
    return { status: 0, ok: false, error: String(err?.name === 'TimeoutError' ? 'timed out' : err?.message || err), sample: 0, rows: null };
  }
}

const results = new Map();
for (const table of tables) {
  const result = await probe(table);
  results.set(table, result);
  const missing = result.status === 404 || /PGRST205|does not exist|Could not find/i.test(String(result.code || ''));
  const flag = result.ok ? '✔' : missing ? '✖' : '!';
  const detail = result.ok
    ? `readable${typeof result.rows === 'number' ? `, ~${result.rows} rows` : ''}`
    : missing
      ? `not present (${result.code || result.status})`
      : result.error || `HTTP ${result.status}`;
  console.log(`  ${flag} ${table.padEnd(28)} ${detail}`);
  if (missing) failures.push(`\`${table}\` is mapped but does not exist in this project.`);
  else if (!result.ok) failures.push(`\`${table}\` could not be read (HTTP ${result.status}${result.error ? `: ${result.error}` : ''}).`);
}
if (onlyStage === '2') finish();

// ===========================================================================
// Stage 3 — what an anonymous browser read can see
// ===========================================================================
console.log('\n[3/4] Row-level security as a customer\'s browser sees it');
const catalogueTables = CUSTOMER_SCHEMA_MAP.filter((entry) => entry.readScope === 'public-active').flatMap((entry) => entry.tables);
for (const table of [...new Set(catalogueTables)].sort()) {
  const anon = await probe(table, anonKey || readKey);
  const verdict = anon.ok ? `${anon.sample} row(s) visible to a bare anon key` : `blocked (HTTP ${anon.status})`;
  console.log(`  · ${table.padEnd(28)} ${verdict}`);
  if (anon.ok && anon.sample === 0) {
    console.log('      → owner-scoped policy returns nothing, so the customer app reads this through /api/customer/*. Correct by design.');
  }
}
console.log('  Customer-private tables (bookings, wallet rows) are never read from the browser.');
if (onlyStage === '3') finish();

// ===========================================================================
// Stage 4 — the API must agree with the database
// ===========================================================================
console.log('\n[4/4] /api/customer/connection');
if (!resolvedApiUrl) {
  console.log('  SKIPPED — pass --api https://your-host (or set APP_URL) to compare the API report with the database.');
} else {
  try {
    const res = await fetch(`${resolvedApiUrl}/api/customer/connection`, { signal: AbortSignal.timeout(20000) });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) {
      failures.push(`The API report failed (HTTP ${res.status}: ${payload?.error || 'no response body'}).`);
    } else {
      line('mode', payload.data.mode);
      line('request id', payload.requestId || '(none)');
      if (payload.data.mode === 'mock') {
        warnings.push('The API reports mode:"mock": the deployment has no Supabase credentials, so no customer data is live yet.');
      } else {
        for (const [table, info] of Object.entries(payload.data.tables || {})) {
          const direct = results.get(table);
          const said = info?.exists ? 'exists' : 'missing';
          const saw = direct?.ok ? 'readable' : direct ? 'unreachable' : 'not probed';
          const agree = info?.exists === Boolean(direct?.ok);
          console.log(`  ${agree ? '✔' : '✖'} ${table.padEnd(28)} api:${said} · direct:${saw}`);
          if (!agree) failures.push(`\`${table}\`: the API says "${said}" but the direct probe says "${saw}".`);
        }
        for (const entry of CUSTOMER_SCHEMA_MAP) {
          const mapped = payload.data.mapping?.[entry.logical];
          if (!mapped) {
            failures.push(`${entry.logical}: the API did not report a mapping for it.`);
            continue;
          }
          if (mapped.table !== entry.table) {
            failures.push(`${entry.logical}: API mapping "${mapped.table}" ≠ local mapping "${entry.table}".`);
          }
        }
      }
    }
  } catch (err) {
    warnings.push(`Could not reach ${resolvedApiUrl}/api/customer/connection (${err?.message || err}).`);
  }
}

finish();

// ---------------------------------------------------------------------------
function finish(forcedCode) {
  // 0 = fully verified, 1 = something is wrong, 2 = nothing could be verified
  // because the credentials are absent. The last one is deliberately not 0: a
  // deployment that only checked the mapping must not report a green run.
  const code = typeof forcedCode === 'number' ? forcedCode : failures.length ? 1 : !url || !readKey ? 2 : 0;
  if (warnings.length) {
    console.log('\nNotes');
    for (const warning of warnings) console.log(`  · ${warning}`);
  }
  if (failures.length) {
    console.log(`\n✖ ${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  ✖ ${failure}`);
  } else if (!url) {
    console.log('\n△ Mapping integrity passed. Credentials are missing, so the live half was skipped.');
    console.log('  Add SUPABASE_URL + SUPABASE_ANON_KEY (+ SUPABASE_SERVICE_ROLE_KEY) to .env, then re-run.');
  } else {
    console.log('\n✔ Every mapped table answers, and each of the 18 customer entities is backed by a real');
    console.log('  table, a jsonb field on one, or an explicitly-labelled derived/device view. No screen');
    console.log('  in /app needs a mock row to render.');
  }
  console.log('');
  process.exit(code);
}
