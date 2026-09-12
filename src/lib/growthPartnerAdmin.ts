import { supabase } from './supabaseClient';

// ============================================================================
// Growth Partner ADMIN operations.
//
// Every function here calls an admin-only RPC: the database refuses them unless
// the caller is a platform admin, so importing this module from a browser
// bundle is safe — a normal user gets a permission error, not data. Nothing
// here reads or writes identity material, and no caller id is ever passed: the
// backend derives the reviewer from auth.uid().
// ============================================================================

export type GrowthPartnerApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface GrowthPartnerApplicationQueueRow {
  id: string;
  user_id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  status: GrowthPartnerApplicationStatus;
  kyc_status: string;
  kyc_document_type: string | null;
  kyc_document_reference: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function adminError(context: string, error: unknown): Error {
  const message =
    (error as { message?: unknown })?.message ?? (typeof error === 'string' ? error : '');
  return new Error(message ? `${context}: ${message}` : context);
}

/**
 * The review queue an administrator works from. `status` filters the queue
 * ('pending' by default in the UI); omit it for everything.
 */
export async function listGrowthPartnerApplications(
  status: GrowthPartnerApplicationStatus | null = 'pending',
  limit = 50
): Promise<GrowthPartnerApplicationQueueRow[]> {
  const { data, error } = await supabase.rpc('list_growth_partner_applications', {
    p_status: status,
    p_limit: limit,
  });
  if (error) throw adminError('Could not load the application queue', error);
  const rows = (data ?? []) as unknown as GrowthPartnerApplicationQueueRow[] | null;
  return Array.isArray(rows) ? rows : [];
}

/** Approve or reject one application. Approval provisions the partner row. */
export async function decideGrowthPartnerApplication(input: {
  applicationId: string;
  approve: boolean;
  note?: string;
}): Promise<{ referralCode: string | null }> {
  const { data, error } = await supabase.rpc('review_growth_partner_application', {
    p_application_id: input.applicationId,
    p_approve: input.approve,
    p_note: input.note ?? null,
  });
  if (error) throw adminError('Could not update that application', error);
  const row = (data ?? {}) as unknown as { referral_code?: string | null };
  return { referralCode: typeof row.referral_code === 'string' ? row.referral_code : null };
}
