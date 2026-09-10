import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalonSyncPayload, SalonSyncResult } from './salonSync';
import { describeError, isAuthLikeFailure } from './autoSave';

// Serialize profile and editor writes so an older in-flight autosave cannot
// land after an explicit profile save in this tab.
let writes: Promise<unknown> = Promise.resolve();
export function queueOwnerWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writes.then(write, write);
  writes = next.catch(() => undefined);
  return next;
}

export async function saveOwnerEditorState(
  db: SupabaseClient,
  payload: SalonSyncPayload,
  options?: { deleteRemoved?: boolean }
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
