import { supabase } from './supabaseClient';

type RpcError = { message?: string; code?: string } | null;
function fail(context: string, error: RpcError): never { throw new Error(`${context}: ${error?.message || 'Unknown database error'}`); }
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) fail(name, error);
  return data as T;
}

export type PartnerEarningsPayload = { currency: string; totals: { lifetime_paise: number; pending_paise: number; available_paise: number }; transactions: Array<{ id: string; earning_type: string; status: string; amount_paise: number; earned_at: string; available_at: string | null }> };
export const getPartnerEarnings = () => rpc<PartnerEarningsPayload>('get_my_partner_earnings', { p_limit: 50, p_offset: 0 });
export const requestPartnerPayout = (amountPaise: number, method: string, destinationLabel: string) => rpc<{ id: string; status: string; amount_paise: number }>('request_my_partner_payout', { p_amount_paise: amountPaise, p_method: method, p_destination_label: destinationLabel });
export type PartnerLevelsPayload = { active_referrals: number; levels: Array<{ code: string; sort_order: number; minimum_paid_referrals: number; commission_bps: number; perks: string[]; unlocked: boolean }> };
export const getPartnerLevels = () => rpc<PartnerLevelsPayload>('get_my_partner_levels');
export type PartnerLeaderboardPayload = { items: Array<{ rank: number; partner_id: string; earnings_paise: number }>; my_rank: number | null };
export const getPartnerLeaderboard = () => rpc<PartnerLeaderboardPayload>('get_partner_leaderboard', { p_limit: 25 });
export type PartnerNotificationsPayload = { unread_count: number; items: Array<{ id: string; notification_type: string; title: string; body: string; is_read: boolean }> };
export const getPartnerNotifications = (type?: string) => rpc<PartnerNotificationsPayload>('get_my_partner_notifications', { p_type: type || null, p_limit: 50 });
export const markPartnerNotificationsRead = (ids?: string[]) => rpc<number>('mark_my_partner_notifications_read', { p_ids: ids || null });
export type PartnerMarketingAsset = { id: string; category: string; title: string; description: string | null; storage_bucket: string; storage_path: string; mime_type: string; file_size_bytes: number | null };
export const getPartnerMarketingAssets = (category?: string) => rpc<PartnerMarketingAsset[]>('get_partner_marketing_assets', { p_category: category || null });
export const submitPartnerSupportTicket = (subject: string, message: string, priority = 'normal') => rpc<{ id: string; ticket_number: number; status: string }>('submit_my_partner_support_ticket', { p_subject: subject, p_message: message, p_priority: priority });
