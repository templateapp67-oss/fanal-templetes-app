import { normalizePath } from './router';
import type { AppView } from '../types';

// ============================================================================
// PHASE 3.1 — LOGIN ROUTING
//
// A successful login used to leave every owner on the same screen: `App.tsx`
// starts at `currentView = 'landing'`, and every `setCurrentView` call in the
// app is a user click. So a returning owner who has already published a
// website saw the marketing landing page, and one who had never built anything
// saw exactly the same thing.
//
// This module answers one question — *which existing step does this owner
// belong on?* — from BACKEND state, and nothing else.
//
// Two rules it must not break:
//
//   1. READ-ONLY. Routing is a consequence of logging in, not a state change,
//      so it uses `get_my_owner_workspace()` (STABLE) and never
//      `ensure_owner_workspace()`. The provisioning boundary stays exactly
//      where PART 3 put it: the handoff exchange, and the 42501 save fallback.
//   2. NEVER GUESS. When the state cannot be read, the answer is `unknown` and
//      the owner stays where they were. A wrong guess is worse than the
//      landing page, because it moves somebody off a screen they chose.
// ============================================================================

/** The steps a signed-in owner can be at, most blocking first. */
export type OwnerEntryStage =
  /** No `profiles` row — nothing has been captured for this owner yet. */
  | 'no-profile'
  /**
   * A profile exists but no salon/workspace to save into.
   *
   * PHASE 10: this is the ONLY unresolved-workspace stage. Several salons used
   * to be reported as their own "the owner must decide" stage, but migration
   * 20261006 resolves the target server-side (primary → most recent → first
   * authorized), so a multi-salon owner has a workspace like any other.
   */
  | 'no-workspace'
  /** Workspace ready, onboarding not finished, no editor state yet. */
  | 'onboarding-incomplete'
  /** A template has been chosen but no editor state saved. */
  | 'template-selected'
  /** Editor state exists but the site is not complete. */
  | 'editor-started'
  /** `template_completed` — the site is published. */
  | 'published'
  /** State could not be read. Stay put. */
  | 'unknown';

export interface OwnerEntryFacts {
  /**
   * False means EITHER "no row" or "the read failed" — which is exactly why
   * `profileReadOk` exists. Routing on a failed read would be a guess dressed
   * up as a fact, and a wrong guess moves the owner off a screen they chose.
   */
  hasProfile: boolean;
  /** True only when the profiles read actually succeeded. */
  profileReadOk: boolean;
  /** False on a database that predates migration 20261002 — see below. */
  workspaceSupported: boolean;
  /** True when an authorized salon was found AND chosen for this caller. */
  workspaceResolved: boolean;
  /** `not_started` | `linked` | `template_started` | `template_completed`. */
  onboardingStatus: string;
  hasEditorState: boolean;
  templateId: string | null;
}

export const UNKNOWN_OWNER_ENTRY_FACTS: OwnerEntryFacts = {
  hasProfile: false,
  profileReadOk: false,
  workspaceSupported: false,
  workspaceResolved: false,
  onboardingStatus: '',
  hasEditorState: false,
  templateId: null,
};

export interface OwnerEntryClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => {
    select: (columns?: string) => { limit: (n: number) => Promise<{ data: any; error: any }> };
  };
}

/** True when an RPC failure means "this database does not have that function". */
function isMissingFunction(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? '');
  return /could not find the function|permission denied for function|does not exist/i.test(message);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Read the owner's entry facts. Never throws: every failure degrades to
 * "unknown", and `classifyOwnerEntry` turns that into "stay where you are".
 *
 * Four reads, all scoped to `auth.uid()` server-side and all read-only:
 *   profiles              -> has the owner got a row at all
 *   get_my_owner_workspace-> can they save anywhere (and is it ambiguous)
 *   get_my_onboarding_status -> how far the funnel got
 *   get_owner_editor_state   -> has the editor saved anything, which template
 */
export async function readOwnerEntryFacts(
  client: OwnerEntryClient
): Promise<OwnerEntryFacts> {
  const facts: OwnerEntryFacts = { ...UNKNOWN_OWNER_ENTRY_FACTS };

  const [profileResult, workspaceResult, statusResult, editorResult] = await Promise.all([
    client
      .from('profiles')
      .select('id')
      // RLS (`id = auth.uid()`) already limits this to the caller's own row, so
      // no `.eq('id', …)` is needed — and limit(1) keeps a pathological schema
      // from turning into a maybeSingle error.
      .limit(1)
      .catch(() => ({ data: null, error: { message: 'profiles read failed' } })),
    client.rpc('get_my_owner_workspace'),
    client.rpc('get_my_onboarding_status'),
    client.rpc('get_owner_editor_state'),
  ]);

  if (!profileResult.error) {
    facts.profileReadOk = true;
    facts.hasProfile = Array.isArray(profileResult.data)
      ? profileResult.data.length > 0
      : Boolean(profileResult.data);
  }

  if (workspaceResult.error) {
    // An older database simply does not have the normalized generation. The
    // legacy owner-scoped save path keeps working, so "no workspace" must not
    // be reported as an incomplete step — that would send those owners to a
    // screen they do not need.
    facts.workspaceSupported = !isMissingFunction(workspaceResult.error);
  } else if (workspaceResult.data && typeof workspaceResult.data === 'object') {
    const data = workspaceResult.data as Record<string, any>;
    facts.workspaceSupported = true;
    // The RPC's own verdict. `ambiguous` is deliberately ignored: since
    // migration 20261006 it is informational (several salons exist) while
    // `resolved` already names the salon the backend chose for this caller.
    facts.workspaceResolved = data.resolved === true;
  }

  if (!statusResult.error && statusResult.data && typeof statusResult.data === 'object') {
    facts.onboardingStatus = text((statusResult.data as Record<string, any>).status) ?? '';
  }

  if (!editorResult.error && editorResult.data && typeof editorResult.data === 'object') {
    const state = editorResult.data as Record<string, any>;
    facts.hasEditorState = true;
    facts.templateId = text(state.selectedTemplateId);
  }

  return facts;
}

/**
 * The owner's step. Order matters: each earlier stage blocks the later ones,
 * so the most blocking unfinished thing is what they are sent to.
 */
export function classifyOwnerEntry(facts: OwnerEntryFacts): OwnerEntryStage {
  // Nothing was readable, so there is nothing to route on. Returning
  // 'no-profile' here would send an owner with a perfectly good account into
  // the setup wizard because one request failed.
  if (!facts.profileReadOk) return 'unknown';
  if (!facts.hasProfile) return 'no-profile';
  // Only meaningful on a database that has the normalized generation. An
  // unresolved workspace is MISSING, never "ambiguous": the server resolves
  // multiple salons itself (20261006), and a caller cannot act on ambiguity.
  if (facts.workspaceSupported && !facts.workspaceResolved) return 'no-workspace';
  if (facts.onboardingStatus === 'template_completed') return 'published';
  if (facts.hasEditorState) return 'editor-started';
  if (facts.templateId) return 'template-selected';
  if (facts.onboardingStatus === 'template_started') return 'editor-started';
  if (facts.onboardingStatus === 'linked' || facts.onboardingStatus === 'not_started') {
    return 'onboarding-incomplete';
  }
  return 'unknown';
}

/**
 * The EXISTING view for that step — no new screen is introduced:
 *
 *   wizard    `WebsiteEditor` — choose a template, then customise it
 *   preview   the owner's live site
 *   dashboard the owner dashboard (bookings, staff, analytics)
 *   landing   left alone; this is also the "do not guess" answer
 */
export function ownerEntryView(stage: OwnerEntryStage): AppView {
  switch (stage) {
    case 'published':
      // Onboarding is finished, so the business is the home screen. This is a
      // deliberate choice over `preview`: the landing page already offers
      // "build website" -> preview, but a published owner logging in is
      // managing a business, not shopping for a template.
      return 'dashboard';
    case 'no-profile':
    case 'no-workspace':
    case 'onboarding-incomplete':
    case 'template-selected':
    case 'editor-started':
      return 'wizard';
    case 'unknown':
    default:
      // Never guess: `unknown` means a read FAILED, not that the owner has no
      // workspace — a missing workspace is its own stage above. PHASE 10
      // removed the last case that used to land here deliberately: several
      // salons are resolved server-side (20261006), so a multi-salon owner
      // reaches the wizard like any other instead of being parked on landing.
      return 'landing';
  }
}

/**
 * Which wizard step to open on. Step 1 is the template chooser, step 2 is
 * customisation — the same split `handleSelectCategory` already uses. An owner
 * who has already chosen a template should not be sent back to the chooser.
 */
export function ownerEntryWizardStep(stage: OwnerEntryStage): number {
  return stage === 'template-selected' || stage === 'editor-started' ? 2 : 1;
}

/** Human-readable reason, for the console breadcrumb and tests. */
export function describeOwnerEntry(stage: OwnerEntryStage, facts: OwnerEntryFacts): string {
  const parts = [
    `stage=${stage}`,
    `profile=${facts.profileReadOk ? (facts.hasProfile ? 'yes' : 'no') : 'unread'}`,
    facts.workspaceSupported
      ? `workspace=${facts.workspaceResolved ? 'resolved' : 'missing'}`
      : 'workspace=unsupported',
    `onboarding=${facts.onboardingStatus || 'unread'}`,
    `editor=${facts.hasEditorState ? 'saved' : 'empty'}`,
    `template=${facts.templateId ?? 'none'}`,
  ];
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// The whole routing decision, in one pure function.
//
// App.tsx only does the plumbing (read the facts, apply the answer); every
// rule about WHEN and WHERE it is allowed to move the owner lives here, so it
// can be tested without mounting a 1700-line component.
// ---------------------------------------------------------------------------

export interface OwnerEntryDecision {
  /** The view to switch to, or null to leave the owner exactly where they are. */
  view: AppView | null;
  /** The wizard step to open on, when `view` is 'wizard'. */
  wizardStep: number | null;
  stage: OwnerEntryStage | null;
  /** Why no move was made — for the console breadcrumb and for tests. */
  skip: 'deep-link' | 'already-routed' | 'no-confident-answer' | null;
}

/**
 * Decide where a just-signed-in owner belongs.
 *
 *   • a deep link (anything but '/') is never overridden — the owner asked for
 *     that screen, or a partner link put them there
 *   • an owner already routed on this session is never moved again, so a token
 *     refresh cannot yank them off a screen they navigated to
 *   • an ambiguous workspace or an unreadable state produces no move at all
 */
export function decideOwnerEntry(input: {
  path: string;
  alreadyRouted: boolean;
  facts: OwnerEntryFacts;
}): OwnerEntryDecision {
  if (input.alreadyRouted) {
    return { view: null, wizardStep: null, stage: null, skip: 'already-routed' };
  }
  if (normalizePath(input.path) !== '/') {
    return { view: null, wizardStep: null, stage: null, skip: 'deep-link' };
  }
  const stage = classifyOwnerEntry(input.facts);
  const view = ownerEntryView(stage);
  if (view === 'landing') {
    return { view: null, wizardStep: null, stage, skip: 'no-confident-answer' };
  }
  return { view, wizardStep: view === 'wizard' ? ownerEntryWizardStep(stage) : null, stage, skip: null };
}
