// ============================================================================
// PHASE 3.2 — RESUME EXISTING ONBOARDING
//
// The merge that turns a cloud `owner_editor_state` row back into the app's
// in-memory salon state when an owner signs in.
//
// This used to live inline in App.tsx's hydration callback, which made the one
// rule that matters — *the cloud row is authoritative, except for edits made
// while the read was in flight* — impossible to test without mounting a
// 1700-line component. It is now a pure function with exactly the semantics the
// callback had, plus the template id it was missing.
//
// Why `beforeRead` exists at all: hydration is async. An owner can type between
// the moment the read starts and the moment it lands, and those keystrokes must
// survive. `beforeRead` is the snapshot taken immediately before the read, so
// "changed since beforeRead" means "the owner edited this", and only those
// values are kept over the cloud row.
// ============================================================================

export interface HydratableSalonState {
  profile: Record<string, any>;
  services: any[];
  stylists: any[];
  loyaltyConfig: Record<string, any>;
  selectedTemplateId: string;
}

/** The jsonb stored by `save_owner_editor_state`, read back by `get_owner_editor_state`. */
export interface SavedOwnerEditorState {
  profile?: Record<string, any> | null;
  services?: any[] | null;
  stylists?: any[] | null;
  loyaltyConfig?: Record<string, any> | null;
  selectedTemplateId?: string | null;
  [key: string]: any;
}

export interface HydrationMergeInput {
  /** `salonStateRef.current` at merge time — may include edits made mid-read. */
  current: HydratableSalonState;
  /** The same snapshot taken immediately BEFORE the read started. */
  beforeRead: HydratableSalonState;
  saved: SavedOwnerEditorState | null;
  userId: string;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge the saved state over the current one.
 *
 * Returns `null` when there is nothing to merge (no saved row) so the caller can
 * tell "applied nothing" from "applied an empty state".
 *
 * Field by field:
 *   profile            cloud wins, except keys the owner edited during the read
 *   services/stylists/ cloud wins, unless the reference changed during the read
 *     loyaltyConfig    (a reference compare is enough — the app always replaces
 *                      these arrays rather than mutating them)
 *   selectedTemplateId cloud wins, unless it changed during the read
 */
export function mergeHydratedSalonState(
  input: HydrationMergeInput
): HydratableSalonState | null {
  const { current, beforeRead, saved, userId } = input;
  if (!saved) return null;

  const mergedProfile: Record<string, any> = {
    ...current.profile,
    ...(saved.profile ?? {}),
    ownerId: userId,
  };
  // Preserve only what the owner changed while the read was in flight. Local
  // startup defaults must never stop the saved profile loading — on a new
  // device every key differs from the cloud row, and none of them are edits.
  for (const key of Object.keys(current.profile)) {
    if (!sameJson(current.profile[key], beforeRead.profile[key])) {
      mergedProfile[key] = current.profile[key];
    }
  }

  const editedDuringRead = (key: 'services' | 'stylists' | 'loyaltyConfig' | 'selectedTemplateId') =>
    current[key] !== beforeRead[key];

  // A blank id — empty or whitespace only — is not a choice. Applying one
  // would put an unusable value into state and then persist it on the next
  // save, so it is ignored and the current value is kept.
  const trimmedSavedTemplateId =
    typeof saved.selectedTemplateId === 'string' ? saved.selectedTemplateId.trim() : '';
  const savedTemplateId = trimmedSavedTemplateId || null;

  return {
    profile: mergedProfile,
    services: editedDuringRead('services') ? current.services : saved.services ?? current.services,
    stylists: editedDuringRead('stylists') ? current.stylists : saved.stylists ?? current.stylists,
    loyaltyConfig: editedDuringRead('loyaltyConfig')
      ? current.loyaltyConfig
      : saved.loyaltyConfig ?? current.loyaltyConfig,
    // A missing/blank saved id leaves the current one alone rather than
    // resetting it to a default.
    selectedTemplateId:
      savedTemplateId !== null && !editedDuringRead('selectedTemplateId')
        ? savedTemplateId
        : current.selectedTemplateId,
  };
}
