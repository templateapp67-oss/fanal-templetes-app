import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHealthHandler, describeProbeFailure } from '../server/health';

// ============================================================================
// GET /api/health must not be green while the database refuses the API key.
//
// Production incident (2026-09-28): every query on the deployed site failed
// with a gateway 401 (code present, message empty), /api/site answered
// "database is not configured" for every slug — yet /api/health reported
// ok:true, bookingReady:true, problems:[] because its checks only tested
// config PRESENCE. These tests pin the always-on credential probe and the
// raw error codes that make the failure diagnosable.
// ============================================================================

const liveConfig = {
  mode: 'live' as const,
  hasUrl: true,
  hasAnonKey: true,
  hasServiceKey: true,
  issues: [] as string[],
  clientError: null,
  urlHost: 'example-project.supabase.co',
};

function fakeDb(answers: Record<string, any>) {
  return {
    calls: [] as string[],
    from(table: string) {
      this.calls.push(table);
      return {
        select: () => {
          const answer = answers[table];
          const settled =
            answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? { data: [], error: null, count: 0 });
          // Chainable AND awaitable: the plain probe awaits select() directly,
          // the deep probes append .limit(1) first (mirrors supabase-js).
          return {
            limit: () => settled,
            then: (onFulfilled: any, onRejected: any) => settled.then(onFulfilled, onRejected),
          };
        },
      };
    },
  };
}

async function runHealth(deps: Record<string, any>, query: Record<string, string> = {}) {
  const handler = createHealthHandler(deps as any);
  const res: any = {
    locals: {},
    json(body: any) {
      this.body = body;
    },
  };
  await handler({ query }, res);
  return res.body as any;
}

function baseDeps(db: any, overrides: Record<string, any> = {}) {
  return {
    db,
    isMock: false,
    hasAdminClient: true,
    supabaseConfig: { ...liveConfig },
    entrypoint: 'test',
    ...overrides,
  };
}

test('a refused API key degrades plain health with the raw code and the fix', async () => {
  const db = fakeDb({ profiles: { data: null, error: { code: '401', message: '' } } });
  const body = await runHealth(baseDeps(db));

  assert.equal(body.status, 'degraded');
  assert.equal(body.bookingReady, false, 'bookingReady must not stay green when every query is refused');

  const check = body.checks.find((c: any) => c.name === 'database_access');
  assert.ok(check, 'the always-on credential probe runs without ?deep=1');
  assert.equal(check.ok, false);
  assert.match(check.detail, /code 401/);
  assert.match(check.detail, /SUPABASE_SERVICE_ROLE_KEY/, 'names the exact variable to fix');
  assert.match(check.detail, /redeploy/i);

  const problem = body.problems.find((p: string) => /database access rejected/.test(p));
  assert.ok(problem, `problems[] carries the rejection, got: ${JSON.stringify(body.problems)}`);
  assert.match(problem, /code 401/);
});

test('a healthy key answer keeps health ok and bookingReady', async () => {
  const db = fakeDb({ profiles: { data: null, error: null, count: 0 } });
  const body = await runHealth(baseDeps(db));

  assert.equal(body.status, 'ok');
  assert.equal(body.bookingReady, true);
  const check = body.checks.find((c: any) => c.name === 'database_access');
  assert.ok(check);
  assert.equal(check.ok, true);
  assert.match(check.detail, /accepted/);
});

test('mock mode never probes the database', async () => {
  const db = {
    from() {
      throw new Error('the database must not be touched in mock mode');
    },
  };
  const body = await runHealth(baseDeps(db, { isMock: true, hasAdminClient: false }));

  assert.equal(body.mode, 'mock');
  assert.equal(body.status, 'ok');
  assert.equal(
    body.checks.some((c: any) => c.name === 'database_access'),
    false
  );
});

test('a config-only deployment with no usable keys is not probed against the placeholder', async () => {
  const db = {
    from() {
      throw new Error('no live connection means no probe');
    },
  };
  const body = await runHealth(
    baseDeps(db, {
      supabaseConfig: { ...liveConfig, mode: 'mock' as const, hasUrl: false, hasAnonKey: false, hasServiceKey: false },
    })
  );

  assert.equal(
    body.checks.some((c: any) => c.name === 'database_access'),
    false
  );
});

test('deep probes surface the raw code and message instead of a generic sentence', async () => {
  const db = fakeDb({
    bookings: { data: null, error: { code: 'PGRST301', message: 'JWT expired' } },
    profiles: { data: [{ id: 'p1' }], error: null },
  });
  const body = await runHealth(baseDeps(db), { deep: '1' });

  assert.equal(body.deep, true);
  assert.equal(body.status, 'degraded');
  const check = body.checks.find((c: any) => c.name === 'bookings_table');
  assert.ok(check);
  assert.equal(check.ok, false);
  assert.match(check.detail, /code PGRST301/);
  assert.match(check.detail, /JWT expired/);
  assert.match(check.detail, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(body.problems.some((p: string) => /database access rejected \(code PGRST301\)/.test(p)));
});

test('describeProbeFailure classifies permission and unknown failures distinctly', () => {
  const denied = describeProbeFailure(
    { code: '42501', message: 'permission denied for table bookings' },
    'SUPABASE_SERVICE_ROLE_KEY',
    'example-project.supabase.co'
  );
  assert.match(denied.detail, /code 42501/);
  assert.match(denied.problem, /permission denied/);
  assert.doesNotMatch(denied.problem, /redeploy/, 'a grants problem is not fixed by redeploying');

  const unknown = describeProbeFailure({ code: '57014', message: 'canceling statement' }, 'SUPABASE_ANON_KEY', null);
  assert.match(unknown.detail, /code 57014/);
  assert.match(unknown.detail, /canceling statement/);
});
