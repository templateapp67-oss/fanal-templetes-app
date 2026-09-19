import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalonSyncPayload, SalonSyncResult } from './salonSync';
import { describeError, isAuthLikeFailure, isSessionExpiryFailure } from './autoSave';
import { ensureFreshSession, refreshSessionForSave, SESSION_REFRESH_HINT } from './authSession';
import { resolveOwnerWorkspace } from './ownerWorkspace';

// Serialize profile and editor writes so an older in-flight autosave cannot
// land after an explicit profile save in this tab.
let writes: Promise<unknown> = Promise.resolve();
export function queueOwnerWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writes.then(write, write);
  writes = next.catch(() => undefined);
  return next;
}

/**
 * The failure that means "this owner has no salon yet".
 *
 * nexora_save_owner_workspace() resolves its target through
 * nexora_owner_salon_ids() and raises this when the caller owns no salon —
 * exactly the state a freshly onboarded owner is in, because nothing else in
 * the app ever created their organization/membership/salon. Matching on the
 * message (and on a missing resolver function) keeps this narrow: an RLS
 * rejection, a validation error or a network failure is NOT retried here.
 */
export function isMissingOwnerWorkspaceError(errors: string[] | undefined): boolean {
  const joined = (errors || []).join(' ');
  return /select a salon owned by this account/i.test(joined)
    || /nexora_owner_salon_ids/i.test(joined);
}

async function writeOwnerEditorState(
  db: SupabaseClient,
  payload: SalonSyncPayload
): Promise<SalonSyncResult> {
  // One RPC call with the caller's current token. Returns the raw error (if
  // any) instead of throwing so the caller can decide whether an auth retry
  // is worth it.
  const callSaveRpc = async (): Promise<unknown | null> => {
    const { error } = await db.rpc('save_owner_editor_state', { p_state: {
      profile: payload.profile, services: payload.services,
      stylists: payload.stylists, loyaltyConfig: payload.loyaltyConfig,
      ...(payload.appointments !== undefined ? { appointments: payload.appointments } : {}),
      ...(payload.clients !== undefined ? { clients: payload.clients } : {}),
      ...(payload.selectedTemplateId !== undefined ? { selectedTemplateId: payload.selectedTemplateId } : {}),
    } });
    return error ?? null;
  };

  try {
    await queueOwnerWrite(async () => {
      // 1) PRE-FLIGHT REFRESH. A tab that sat in the background can hold an
      //    access token that is already inside (or past) its expiry margin.
      //    Refreshing here — silently, before any row is touched — is what
      //    turns the old "Database permission problem" (a stale JWT rejected
      //    by PostgREST) into a save that just works. A missing/incomplete
      //    auth client (mock builds, tests) is reported as `unavailable` and
      //    is deliberately not an error: the write proceeds unchanged.
      const preflight = await ensureFreshSession(db);
      if (preflight.refreshed) {
        console.info('[AutoSave] Refreshed the Supabase session before saving the website.');
      }

      const firstError = await callSaveRpc();
      if (!firstError) return;

      const detail = describeError(firstError);
      // Only a SESSION failure is worth retrying: a missing GRANT or a broken
      // RLS policy ("permission denied for table …", "new row violates
      // row-level security policy") is deterministic and would fail
      // identically, so it is surfaced immediately (see isSessionExpiryFailure
      // vs the broader isAuthLikeFailure).
      if (!isSessionExpiryFailure(detail)) throw firstError;

      // 2) REACTIVE REFRESH. The token can also expire (or be revoked) between
      //    the pre-flight and the write. Refresh once and retry the SAME
      //    transaction before reporting a permission problem — a recoverable
      //    session must never surface as a database-permission error.
      const retry = await refreshSessionForSave(db);
      if (!retry.ok) {
        console.warn(
          `[AutoSave] Save rejected as unauthenticated (${detail}) and the session could not be refreshed (${retry.reason ?? 'unknown'}). ${SESSION_REFRESH_HINT}`
        );
        throw firstError;
      }
      const retried = await callSaveRpc();
      if (retried) throw retried;
      console.info('[AutoSave] Save rejected as unauthenticated — refreshed the session and the retried save succeeded.');
    });
    return { ok: true, errors: [] };
  } catch (error) {
    const detail = describeError(error);
    return { ok: false, errors: [detail], blockedByAuth: isAuthLikeFailure(detail) };
  }
}

export async function saveOwnerEditorState(
  db: SupabaseClient,
  payload: SalonSyncPayload,
  options?: { deleteRemoved?: boolean }
): Promise<SalonSyncResult> {
  void options;
  const first = await writeOwnerEditorState(db, payload);
  if (first.ok || !isMissingOwnerWorkspaceError(first.errors)) return first;

  // Owner/salon workspace resolution (migration 20261002). Reached only on
  // the specific "no salon" failure, so the normal save still performs exactly
  // one RPC. ensure_owner_workspace() is idempotent, scoped to auth.uid() and
  // best-effort: if it cannot help (legacy schema, older database) the
  // original failure is returned unchanged rather than being masked.
  const workspace = await resolveOwnerWorkspace(db as any);

  // PHASE 10: several salons are no longer a dead end. Migration 20261006
  // resolves the target server-side (primary -> most recent -> first
  // authorized) inside nexora_save_owner_workspace(), so the retry below is
  // the normal path for a multi-salon owner. `workspace.ambiguous` stays
  // informational and is deliberately NOT consulted here: refusing to retry
  // was what produced the "more than one salon, could not pick one" message
  // for perfectly valid accounts.
  if (!workspace.salonId) return first;
  const retried = await writeOwnerEditorState(db, payload);
  return retried.ok ? retried : first;
}
