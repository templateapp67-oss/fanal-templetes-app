import type { SupabaseClient } from '@supabase/supabase-js';
import { SalonSyncPayload, SalonSyncResult, syncSalonToSupabase } from './salonSync';
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
    return await queueOwnerWrite(async () => {
      // 1) Direct client sync to existing standard tables (profiles, services, stylists, loyalty_config, loyalty_rewards)
      const syncResult = await syncSalonToSupabase(db, payload, options);

      // 2) Best-effort sync to owner_editor_state RPC if available in the database
      try {
        await db.rpc('save_owner_editor_state', {
          p_state: {
            profile: payload.profile,
            services: payload.services,
            stylists: payload.stylists,
            loyaltyConfig: payload.loyaltyConfig,
          },
        });
      } catch {
        // RPC might not exist in database schema, safe to ignore
      }

      return syncResult;
    });
  } catch (error) {
    const detail = describeError(error);
    return { ok: false, errors: [detail], blockedByAuth: isAuthLikeFailure(detail) };
  }
}
