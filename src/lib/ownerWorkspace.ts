import { supabase } from './supabaseClient';

// ============================================================================
// Owner / salon workspace resolution (PART 3, migration 20261002).
//
// Every owner-side write in this app assumes a resolved workspace:
//   • public.nexora_save_owner_workspace() resolves its target salon through
//     public.nexora_owner_salon_ids() and RAISES 'Select a salon owned by this
//     account' when the caller has none;
//   • public.template_website_is_complete() — the onboarding completion check
//     — needs an active owner/manager membership plus a named, slugged salon.
//
// A user who signs up through the Onboarding App arrives with a profiles row
// and nothing else, so without this step the first normalized save fails and
// onboarding can never complete. ensure_owner_workspace() is idempotent, is
// scoped to auth.uid() (it takes no id parameters), and returns a result
// instead of raising — so this wrapper is strictly best-effort: it never
// throws, never blocks a save, and never changes what the caller does next.
// ============================================================================

/** Minimal structural client: the real Supabase client and test fakes both fit. */
export interface OwnerWorkspaceClient {
  rpc: (fn: string, args?: Record<string, any>) => Promise<{ data: any; error: any }>;
}

export type OwnerWorkspaceReason =
  | 'created'
  | 'existing'
  | 'legacy-schema'
  | 'schema-incomplete'
  | 'failed';

/** One salon the caller could save into. */
export interface OwnerSalonOption {
  salonId: string | null;
  slug: string | null;
  name: string | null;
}

export interface OwnerWorkspace {
  /** Workspace status, e.g. 'active' or 'needs_onboarding' */
  status: string;
  /** Resolved primary salon object or null if needs onboarding */
  salon: OwnerSalonOption | null;
  /** True only when this call actually created workspace rows. */
  provisioned: boolean;
  reason: OwnerWorkspaceReason | string;
  organizationId: string | null;
  salonId: string | null;
  slug: string | null;
  name: string | null;
  /** How many live salons the caller owns (0 when unresolved). */
  salonCount: number;
  /**
   * True when the caller owns more than one live salon. INFORMATIONAL ONLY:
   * since migration 20261006 the backend always picks one (see `selection`),
   * so several salons are never a reason a save cannot proceed.
   */
  ambiguous: boolean;
  /**
   * Which tier of the canonical rule chose `salonId` (`primary`,
   * `most-recent`, `first-authorized`, `first-authorized-inactive`), or null
   * on a database that predates the rule.
   */
  selection: string | null;
  /** The candidate salons: the chosen one first, then newest first, capped at 25. */
  salons: OwnerSalonOption[];
}

/** Result used when the RPC itself is unavailable — never a thrown error. */
export const UNRESOLVED_OWNER_WORKSPACE: OwnerWorkspace = {
  status: 'needs_onboarding',
  salon: null,
  provisioned: false,
  reason: 'unavailable',
  organizationId: null,
  salonId: null,
  slug: null,
  name: null,
  salonCount: 0,
  ambiguous: false,
  selection: null,
  salons: [],
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function salonsOf(value: unknown): OwnerSalonOption[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).map((entry: any) => ({
    salonId: text(entry?.salon_id),
    slug: text(entry?.slug),
    name: text(entry?.name),
  }));
}

/**
 * Provision (if needed) and resolve the signed-in owner's workspace.
 *
 * Never throws. A failure is logged and reported as `reason: 'unavailable'`
 * so the caller can continue exactly as it would have before this step
 * existed — the legacy owner-scoped save path does not need a salon row.
 */
export async function resolveOwnerWorkspace(
  client: OwnerWorkspaceClient = supabase as unknown as OwnerWorkspaceClient
): Promise<OwnerWorkspace> {
  try {
    const { data, error } = await client.rpc('ensure_owner_workspace');
    if (error) throw error;
    if (!data || typeof data !== 'object') return UNRESOLVED_OWNER_WORKSPACE;
    const salons = salonsOf(data.salons);
    // An older database without the ambiguity fields still answers correctly:
    // fall back to what the scalar fields already prove.
    const salonCount = typeof data.salon_count === 'number' ? data.salon_count : salons.length;
    const salonId = text(data.salon_id);
    const slug = text(data.slug);
    const name = text(data.name);
    const status = text(data.status) ?? (salonId ? 'active' : 'needs_onboarding');
    const salonObj = data.salon && typeof data.salon === 'object' ? {
      salonId: text(data.salon.id) ?? salonId,
      slug: text(data.salon.slug) ?? slug,
      name: text(data.salon.name) ?? name,
    } : (salonId ? { salonId, slug, name } : null);

    return {
      status,
      salon: salonObj,
      provisioned: data.provisioned === true,
      reason: text(data.reason) ?? 'failed',
      organizationId: text(data.organization_id),
      salonId,
      slug,
      name,
      salonCount,
      // Informational. The backend resolves multiple salons with its canonical
      // rule, so callers must not treat this as an error state.
      ambiguous: data.ambiguous === true || salonCount > 1,
      selection: text(data.selection),
      salons,
    };
  } catch (error) {
    // A project whose database predates migration 20261002 simply does not
    // have the function yet. That is a supported state, not a crash.
    const message = String((error as { message?: unknown })?.message ?? error ?? '');
    if (/could not find the function|permission denied for function/i.test(message)) {
      return { ...UNRESOLVED_OWNER_WORKSPACE, reason: 'unsupported' };
    }
    console.warn('[Owner workspace] resolution skipped:', message);
    return UNRESOLVED_OWNER_WORKSPACE;
  }
}

// ---------------------------------------------------------------------------
// Call sites (both deliberately narrow, so no autosave pays for an extra RPC):
//
//   • src/components/TemplateHandoffPage.tsx — on a successful handoff
//     exchange, i.e. the PART 3 boundary where a brand-new owner first
//     arrives. Awaited, because the editor needs the salon to exist.
//   • src/lib/ownerEditorState.ts — only when a save has already failed with
//     'Select a salon owned by this account', then retried once.
//
// ensure_owner_workspace() is idempotent, so neither site needs to remember
// whether it has run: a second call is a read that returns reason 'existing'.
// ---------------------------------------------------------------------------
