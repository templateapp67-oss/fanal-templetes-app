import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalonSyncPayload, SalonSyncResult } from './salonSync';
import { describeError, isAuthLikeFailure } from './autoSave';
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
  try {
    await queueOwnerWrite(async () => {
      const { error } = await db.rpc('save_owner_editor_state', { p_state: {
        profile: payload.profile, services: payload.services,
        stylists: payload.stylists, loyaltyConfig: payload.loyaltyConfig,
        ...(payload.appointments !== undefined ? { appointments: payload.appointments } : {}),
        ...(payload.clients !== undefined ? { clients: payload.clients } : {}),
        ...(payload.selectedTemplateId !== undefined ? { selectedTemplateId: payload.selectedTemplateId } : {}),
      } });
      if (error) throw error;
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
