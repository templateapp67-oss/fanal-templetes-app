import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyOwnerEntry,
  decideOwnerEntry,
  describeOwnerEntry,
  ownerEntryView,
  ownerEntryWizardStep,
  readOwnerEntryFacts,
  UNKNOWN_OWNER_ENTRY_FACTS,
  type OwnerEntryFacts,
  type OwnerEntryStage,
} from '../src/lib/ownerEntryRoute';

// ============================================================================
// PHASE 3.1 — LOGIN ROUTING
//
// A successful login used to leave every owner on the same screen. These tests
// pin the replacement: the step is derived from backend state, routing is
// read-only, and an unreadable state moves nobody.
// ============================================================================

const facts = (overrides: Partial<OwnerEntryFacts> = {}): OwnerEntryFacts => ({
  ...UNKNOWN_OWNER_ENTRY_FACTS,
  hasProfile: true,
  profileReadOk: true,
  workspaceSupported: true,
  workspaceResolved: true,
  onboardingStatus: 'linked',
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The state matrix the phase is about
// ---------------------------------------------------------------------------

const MATRIX: Array<[string, OwnerEntryFacts, OwnerEntryStage, string, number | null]> = [
  [
    'no profile at all',
    facts({ hasProfile: false }),
    'no-profile',
    'wizard',
    1,
  ],
  [
    'profile exists but no workspace',
    facts({ hasProfile: true, workspaceResolved: false }),
    'no-workspace',
    'wizard',
    1,
  ],
  [
    'workspace exists but onboarding incomplete',
    facts({ onboardingStatus: 'linked', hasEditorState: false }),
    'onboarding-incomplete',
    'wizard',
    1,
  ],
  [
    'template selected, nothing saved yet',
    facts({ onboardingStatus: 'linked', templateId: 'luxury-salon' }),
    'template-selected',
    'wizard',
    2,
  ],
  [
    'editor started, not yet complete',
    facts({ onboardingStatus: 'template_started', hasEditorState: true, templateId: 'luxury-salon' }),
    'editor-started',
    'wizard',
    2,
  ],
  [
    'editor state saved but status still template_started',
    facts({ onboardingStatus: 'template_started', hasEditorState: true }),
    'editor-started',
    'wizard',
    2,
  ],
  [
    // The fallback for a database without get_owner_editor_state: the status
    // alone still lands the owner in the editor, at the customise step.
    'template_started with no editor state readable',
    facts({ onboardingStatus: 'template_started', hasEditorState: false }),
    'editor-started',
    'wizard',
    2,
  ],
  [
    'published / completed',
    facts({ onboardingStatus: 'template_completed', hasEditorState: true, templateId: 'luxury-salon' }),
    'published',
    'dashboard',
    null,
  ],
];

test('every state in the matrix resolves to its own existing step', () => {
  for (const [name, input, stage, view, step] of MATRIX) {
    assert.equal(classifyOwnerEntry(input), stage, `stage: ${name}`);
    assert.equal(ownerEntryView(stage), view, `view: ${name}`);
    assert.equal(
      view === 'wizard' ? ownerEntryWizardStep(stage) : null,
      step,
      `wizard step: ${name}`
    );
  }
});

test('the matrix covers six distinct stages, each with its own destination', () => {
  const stages = [...new Set(MATRIX.map(([, , stage]) => stage))];
  // Two rows legitimately share 'editor-started' (one with a template id, one
  // without) — the point is the six stages the phase names are all reachable.
  assert.deepEqual(
    stages.sort(),
    ['editor-started', 'no-profile', 'no-workspace', 'onboarding-incomplete', 'published', 'template-selected'].sort(),
    'the six states from the brief, each classified'
  );
  // Distinct stages must not all collapse onto one screen — that was the bug.
  assert.ok(
    new Set(stages.map((stage) => ownerEntryView(stage))).size >= 2,
    'the stages do not all land on the same view'
  );
  // And they are all real, existing views — no new screen was invented.
  const views = new Set(MATRIX.map(([, , stage]) => ownerEntryView(stage)));
  for (const view of views) {
    assert.ok(
      ['landing', 'wizard', 'preview', 'dashboard'].includes(view),
      `${view} is an existing AppView`
    );
  }
});

test('completion beats a partially-filled editor: published wins', () => {
  // Order matters. An owner who finished onboarding has editor state AND a
  // template id; they must not be sent back to the editor.
  const published = facts({
    onboardingStatus: 'template_completed',
    hasEditorState: true,
    templateId: 'luxury-salon',
  });
  assert.equal(classifyOwnerEntry(published), 'published');
  assert.equal(ownerEntryView('published'), 'dashboard');
});

test('a missing profile outranks everything else', () => {
  // Even a status that claims completion cannot route an owner who has no row.
  assert.equal(
    classifyOwnerEntry(facts({ hasProfile: false, onboardingStatus: 'template_completed' })),
    'no-profile'
  );
});

test('a pre-20261002 database is not treated as an incomplete step', () => {
  // No normalized generation means no workspace concept; the legacy
  // owner-scoped save path still works, so these owners must not be pushed
  // toward a step they do not need.
  const legacy = facts({ workspaceSupported: false, workspaceResolved: false });
  assert.equal(classifyOwnerEntry(legacy), 'onboarding-incomplete');
  assert.notEqual(classifyOwnerEntry(legacy), 'no-workspace');
});

// ---------------------------------------------------------------------------
// 2. Never guess
// ---------------------------------------------------------------------------

test('an ambiguous workspace produces no move', () => {
  const ambiguous = facts({ workspaceResolved: false, workspaceAmbiguous: true });
  assert.equal(classifyOwnerEntry(ambiguous), 'workspace-ambiguous');
  assert.equal(ownerEntryView('workspace-ambiguous'), 'landing');
  const decision = decideOwnerEntry({ path: '/', alreadyRouted: false, facts: ambiguous });
  assert.equal(decision.view, null, 'the owner stays put');
  assert.equal(decision.skip, 'no-confident-answer');
});

test('an unreadable state produces no move', () => {
  // A FAILED profiles read must not be mistaken for "no row" — that would send
  // an owner with a perfectly good account into the setup wizard because one
  // request failed. profileReadOk is what keeps the two apart.
  assert.equal(classifyOwnerEntry(UNKNOWN_OWNER_ENTRY_FACTS), 'unknown');
  assert.equal(ownerEntryView('unknown'), 'landing');
  assert.equal(
    decideOwnerEntry({ path: '/', alreadyRouted: false, facts: UNKNOWN_OWNER_ENTRY_FACTS }).view,
    null,
    'nothing was readable, so nobody is moved'
  );

  // Readable profile, unreadable everything else: still routed, on the profile.
  const partial = { ...UNKNOWN_OWNER_ENTRY_FACTS, profileReadOk: true, hasProfile: true };
  assert.equal(classifyOwnerEntry(partial), 'unknown');
  assert.equal(matchStageFor('a readable empty account'), 'no-profile');
});

/** A genuinely readable account with no row is a real step, not a guess. */
function matchStageFor(_name: string): OwnerEntryStage {
  return classifyOwnerEntry({ ...UNKNOWN_OWNER_ENTRY_FACTS, profileReadOk: true, hasProfile: false });
}

// ---------------------------------------------------------------------------
// 3. The routing rules around the decision
// ---------------------------------------------------------------------------

test('a deep link is never overridden', () => {
  const published = facts({ onboardingStatus: 'template_completed', hasEditorState: true });
  for (const path of ['/my-bookings', '/partner/dashboard', '/customer/booking/abc', '/staff-performance']) {
    const decision = decideOwnerEntry({ path, alreadyRouted: false, facts: published });
    assert.equal(decision.view, null, `${path} must be left alone`);
    assert.equal(decision.skip, 'deep-link');
  }
  // And '/' (with or without a trailing slash) is the entry point it acts on.
  for (const path of ['/', '']) {
    const decision = decideOwnerEntry({ path, alreadyRouted: false, facts: published });
    assert.equal(decision.view, 'dashboard', `${path || '(empty)'} routes`);
  }
});

test('an owner already routed on this session is not moved again', () => {
  const published = facts({ onboardingStatus: 'template_completed', hasEditorState: true });
  const decision = decideOwnerEntry({ path: '/', alreadyRouted: true, facts: published });
  assert.equal(decision.view, null);
  assert.equal(decision.skip, 'already-routed');
});

test('the decision carries the wizard step only when it opens the wizard', () => {
  const resuming = facts({ onboardingStatus: 'template_started', hasEditorState: true });
  const toWizard = decideOwnerEntry({ path: '/', alreadyRouted: false, facts: resuming });
  assert.equal(toWizard.view, 'wizard');
  assert.equal(toWizard.wizardStep, 2, 'resume at customise, not the template chooser');

  const fresh = facts({ hasProfile: false });
  const toChooser = decideOwnerEntry({ path: '/', alreadyRouted: false, facts: fresh });
  assert.equal(toChooser.view, 'wizard');
  assert.equal(toChooser.wizardStep, 1, 'a new owner starts at the chooser');

  const done = facts({ onboardingStatus: 'template_completed', hasEditorState: true });
  assert.equal(decideOwnerEntry({ path: '/', alreadyRouted: false, facts: done }).wizardStep, null);
});

test('the breadcrumb names the stage and every fact behind it', () => {
  const line = describeOwnerEntry(
    'editor-started',
    facts({ onboardingStatus: 'template_started', hasEditorState: true, templateId: 'luxury-salon' })
  );
  for (const fragment of [
    'stage=editor-started',
    'profile=yes',
    'workspace=resolved',
    'onboarding=template_started',
    'editor=saved',
    'template=luxury-salon',
  ]) {
    assert.match(line, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

// ---------------------------------------------------------------------------
// 4. The reader is read-only and degrades safely
// ---------------------------------------------------------------------------

function fakeClient(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  const client: any = {
    calls,
    rpc: async (fn: string) => {
      calls.push(`rpc:${fn}`);
      if (overrides[fn]) return overrides[fn];
      if (fn === 'get_my_owner_workspace') {
        return { data: { resolved: true, ambiguous: false, salon_count: 1, salons: [{}] }, error: null };
      }
      if (fn === 'get_my_onboarding_status') return { data: { status: 'linked', linked: true }, error: null };
      if (fn === 'get_owner_editor_state') return { data: null, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        limit: async () => {
          calls.push(`table:${table}`);
          return overrides.profiles ?? { data: [{ id: 'u-1' }], error: null };
        },
      }),
    }),
  };
  return client;
}

test('the reader issues four reads and provisions nothing', async () => {
  const client = fakeClient();
  const read = await readOwnerEntryFacts(client);
  assert.equal(read.hasProfile, true);
  assert.equal(read.workspaceResolved, true);
  assert.equal(read.onboardingStatus, 'linked');

  assert.deepEqual(
    [...client.calls].sort(),
    ['rpc:get_my_onboarding_status', 'rpc:get_my_owner_workspace', 'rpc:get_owner_editor_state', 'table:profiles'],
    `routing must be exactly four reads; got ${JSON.stringify(client.calls)}`
  );
  assert.ok(
    !client.calls.some((call) => call.includes('ensure_owner_workspace')),
    'routing must never provision a workspace'
  );
});

test('the reader picks up editor state and the chosen template', async () => {
  const client = fakeClient({
    get_owner_editor_state: { data: { profile: {}, selectedTemplateId: 'luxury-salon' }, error: null },
    get_my_onboarding_status: { data: { status: 'template_started', linked: true }, error: null },
  });
  const read = await readOwnerEntryFacts(client);
  assert.equal(read.hasEditorState, true);
  assert.equal(read.templateId, 'luxury-salon');
  assert.equal(classifyOwnerEntry(read), 'editor-started');
});

test('an older database without the workspace function is reported as unsupported', async () => {
  const client = fakeClient({
    get_my_owner_workspace: {
      data: null,
      error: { message: 'Could not find the function public.get_my_owner_workspace()' },
    },
  });
  const read = await readOwnerEntryFacts(client);
  assert.equal(read.workspaceSupported, false);
  assert.equal(classifyOwnerEntry(read), 'onboarding-incomplete', 'not "no-workspace"');
});

test('a real permission error is NOT mistaken for a missing function', async () => {
  // Positive control for the check above: a genuine failure must not be
  // silently excused as "this database is just old".
  const client = fakeClient({
    get_my_owner_workspace: { data: null, error: { message: 'permission denied for table salons' } },
  });
  const read = await readOwnerEntryFacts(client);
  assert.equal(read.workspaceSupported, true);
  assert.equal(read.workspaceResolved, false);
  assert.equal(classifyOwnerEntry(read), 'no-workspace');
});

test('every read failing at once still returns a usable fact set', async () => {
  const boom = { data: null, error: { message: 'Failed to fetch' } };
  const client = fakeClient({
    get_my_owner_workspace: boom,
    get_my_onboarding_status: boom,
    get_owner_editor_state: boom,
    profiles: boom,
  });
  const read = await readOwnerEntryFacts(client);
  assert.equal(read.profileReadOk, false, 'the failed read is recorded as failed');
  assert.equal(read.hasProfile, false);
  assert.equal(classifyOwnerEntry(read), 'unknown', 'so the owner is not moved');
  assert.equal(decideOwnerEntry({ path: '/', alreadyRouted: false, facts: read }).view, null);
  assert.equal(read.workspaceSupported, true, 'a transport error is not "old database"');
});

test('ambiguous salons are detected from either field', async () => {
  const byFlag = fakeClient({
    get_my_owner_workspace: { data: { resolved: false, ambiguous: true, salon_count: 2, salons: [{}, {}] }, error: null },
  });
  assert.equal((await readOwnerEntryFacts(byFlag)).workspaceAmbiguous, true);

  // An older shape without the `ambiguous` field: the count still proves it.
  const byCount = fakeClient({
    get_my_owner_workspace: { data: { resolved: false, salons: [{}, {}] }, error: null },
  });
  const read = await readOwnerEntryFacts(byCount);
  assert.equal(read.workspaceAmbiguous, true);
  assert.equal(classifyOwnerEntry(read), 'workspace-ambiguous');
});

// ---------------------------------------------------------------------------
// 5. The wiring
// ---------------------------------------------------------------------------

/** Comments stripped, the way the handoff scanner in templateHandoff.test.ts does it. */
const codeOnly = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

test('App.tsx routes on the backend-derived stage, not a hard-coded screen', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /readOwnerEntryFacts\(/, 'the entry effect reads the owner state');
  assert.match(app, /decideOwnerEntry\(/, 'and asks the pure decider where to go');
  assert.match(app, /entryRoutedForRef\.current === user\.id/, 'once per owner, not per render');
  assert.match(app, /authStatus !== 'ready'/, 'only once the session is really restored');
  assert.match(app, /normalizePath\(path\) !== '\/'/, 'only at the entry point');
  assert.match(app, /isMockSupabase \|\| !user\?\.id/, 'and never in offline-preview mode');
  // Comments stripped first: the effect's own comment names the function it
  // deliberately does NOT call.
  assert.doesNotMatch(codeOnly('src/App.tsx'), /ensure_owner_workspace/, 'logging in provisions nothing');

  // The old hard-coded fallback is now behind the backend answer.
  const click = app.slice(app.indexOf('const handleBuildWebsiteClick'));
  const body = click.slice(0, click.indexOf('\n  };'));
  const stageCheck = body.indexOf("stage === 'published'");
  // The CALL, not the identifier: the comment above it names the key too.
  const localCheck = body.indexOf('localStorage.getItem(ONBOARDING_COMPLETED_KEY)');
  assert.ok(stageCheck > -1, 'the backend stage is consulted');
  assert.ok(localCheck > -1, 'the localStorage fallback is still there');
  assert.ok(stageCheck < localCheck, 'and the backend stage is consulted first');
});

test('the only provisioning call sites are still the handoff and the save fallback', () => {
  // PHASE 3's invariant, re-checked after adding a fourth reader of owner state.
  const sources = ['src/App.tsx', 'src/lib/ownerEntryRoute.ts', 'src/lib/ownerWorkspace.ts'];
  for (const path of sources) {
    if (path === 'src/lib/ownerWorkspace.ts') continue; // this is the helper itself
    assert.doesNotMatch(codeOnly(path), /ensure_owner_workspace/, `${path} must not provision`);
  }
  const helper = readFileSync(new URL('../src/lib/ownerWorkspace.ts', import.meta.url), 'utf8');
  assert.match(helper, /rpc\('ensure_owner_workspace'\)/, 'the single provisioning helper is intact');
});
