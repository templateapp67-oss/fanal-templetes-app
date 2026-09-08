import { supabase } from './supabaseClient';
import type {
  StaffPerformanceSummary,
  StaffLeaderboardItem,
  StaffBookingDetail,
  StaffPaymentDetail,
  StaffReviewDetail,
  UpdateStaffCommissionPayload,
  StaffPayrollRecord,
  MarkPayoutPaidPayload,
  StaffPayoutHistoryItem,
} from '../types';

function mapSummaryRow(row: any): StaffPerformanceSummary {
  return {
    staffId: row.staff_id,
    staffName: row.staff_name || 'Staff Member',
    staffRole: row.staff_role || 'Service Provider',
    avatarUrl: row.avatar_url || undefined,
    status: row.status || 'Available',
    isActive: row.is_active ?? true,
    commissionRate: Number(row.commission_rate ?? 0),
    fixedCommissionAmount: Number(row.fixed_commission_amount ?? 0),
    commissionType: row.commission_type || 'percentage',
    commissionBasis: row.commission_basis || 'net',
    totalBookings: Number(row.total_bookings ?? 0),
    confirmedBookings: Number(row.confirmed_bookings ?? 0),
    pendingBookings: Number(row.pending_bookings ?? 0),
    completedBookings: Number(row.completed_bookings ?? 0),
    cancelledBookings: Number(row.cancelled_bookings ?? 0),
    totalGrossAmount: Number(row.total_gross_amount ?? 0),
    totalPaidAmount: Number(row.total_paid_amount ?? 0),
    totalDiscountAmount: Number(row.total_discount_amount ?? 0),
    netRevenue: Number(row.net_revenue ?? 0),
    commissionAmount: Number(row.commission_amount ?? 0),
    ownerShareAmount: Number(row.owner_share_amount ?? 0),
    totalReviews: Number(row.total_reviews ?? 0),
    averageRating: Number(row.average_rating ?? 0),
    fiveStarCount: Number(row.five_star_count ?? 0),
    fourStarCount: Number(row.four_star_count ?? 0),
    threeStarCount: Number(row.three_star_count ?? 0),
    twoStarCount: Number(row.two_star_count ?? 0),
    oneStarCount: Number(row.one_star_count ?? 0),
    last7dCompletedBookings: Number(row.last_7d_completed_bookings ?? 0),
    last7dRevenue: Number(row.last_7d_revenue ?? 0),
    last7dCommission: Number(row.last_7d_commission ?? 0),
    last7dDiscount: Number(row.last_7d_discount ?? 0),
    last7dReviews: Number(row.last_7d_reviews ?? 0),
    last7dAverageRating: Number(row.last_7d_average_rating ?? 0),
    grossSales: Number(row.total_gross_amount ?? 0),
    totalDiscounts: Number(row.total_discount_amount ?? 0),
    totalCommission: Number(row.commission_amount ?? 0),
    netSalonShare: Number(row.owner_share_amount ?? 0),
    reviewCount: Number(row.total_reviews ?? 0),
    grossRevenue7d: Number(row.last_7d_revenue ?? 0),
  };
}

export async function fetchStaffPerformanceSummary(
  startDate?: string,
  endDate?: string
): Promise<{ data: StaffPerformanceSummary[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_staff_performance_summary', {
      p_start_date: startDate || null,
      p_end_date: endDate || null,
    });
    if (error) return { data: null, error: error.message };
    return { data: (data || []).map(mapSummaryRow), error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch staff performance summary' };
  }
}

export async function fetchStaffLeaderboard(): Promise<{ data: StaffLeaderboardItem[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_seven_day_leaderboard');
    if (error) return { data: null, error: error.message };
    const mapped: StaffLeaderboardItem[] = (data || []).map((row: any) => ({
      leaderboardRank: Number(row.leaderboard_rank),
      staffId: row.staff_id,
      staffName: row.staff_name,
      staffRole: row.staff_role,
      avatarUrl: row.avatar_url || undefined,
      completedBookings7d: Number(row.completed_bookings_7d ?? 0),
      grossRevenue7d: Number(row.gross_revenue_7d ?? 0),
      netRevenue7d: Number(row.net_revenue_7d ?? 0),
      commissionGenerated7d: Number(row.commission_generated_7d ?? 0),
      reviewsCount7d: Number(row.reviews_count_7d ?? 0),
      averageRating7d: Number(row.average_rating_7d ?? 0),
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch staff leaderboard' };
  }
}

export async function fetchStaffBookingDetails(
  staffId?: string,
  status?: string,
  limit = 50,
  offset = 0
): Promise<{ data: StaffBookingDetail[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_staff_booking_details', {
      p_staff_id: staffId || null,
      p_status: status || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return { data: null, error: error.message };
    const mapped: StaffBookingDetail[] = (data || []).map((row: any) => ({
      bookingId: row.booking_id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || '',
      customerEmail: row.customer_email || '',
      serviceName: row.service_name,
      bookingDate: row.booking_date,
      timeSlot: row.time_slot,
      status: row.status,
      paymentStatus: row.payment_status,
      grossAmount: Number(row.gross_amount ?? 0),
      advancePaid: Number(row.advance_paid ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
      netRevenue: Number(row.net_revenue ?? 0),
      commissionRate: Number(row.commission_rate ?? 0),
      commissionAmount: Number(row.commission_amount ?? 0),
      ownerShare: Number(row.owner_share ?? 0),
      createdAt: row.created_at,
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch staff booking details' };
  }
}

export async function fetchStaffPaymentDetails(
  staffId?: string,
  limit = 50,
  offset = 0
): Promise<{ data: StaffPaymentDetail[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_staff_payment_details', {
      p_staff_id: staffId || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return { data: null, error: error.message };
    const mapped: StaffPaymentDetail[] = (data || []).map((row: any) => ({
      paymentId: row.payment_id,
      bookingId: row.booking_id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      customerName: row.customer_name,
      bookingDate: row.booking_date,
      serviceName: row.service_name,
      grossAmount: Number(row.gross_amount ?? 0),
      advancePaid: Number(row.advance_paid ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
      netRevenue: Number(row.net_revenue ?? 0),
      paymentStatus: row.payment_status,
      commissionAmount: Number(row.commission_amount ?? 0),
      ownerShare: Number(row.owner_share ?? 0),
      createdAt: row.created_at,
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch staff payment details' };
  }
}

export async function fetchStaffReviewDetails(
  staffId?: string,
  limit = 50,
  offset = 0
): Promise<{ data: StaffReviewDetail[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_staff_review_details', {
      p_staff_id: staffId || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return { data: null, error: error.message };
    const mapped: StaffReviewDetail[] = (data || []).map((row: any) => ({
      reviewId: row.review_id,
      bookingId: row.booking_id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      customerName: row.customer_name,
      serviceName: row.service_name,
      rating: Number(row.rating ?? 0),
      comment: row.comment || '',
      reviewedAt: row.reviewed_at,
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch staff review details' };
  }
}

export async function updateStaffCommission(
  payload: UpdateStaffCommissionPayload
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_update_staff_commission', {
      p_staff_id: payload.staffId,
      p_commission_rate: payload.commissionRate,
      p_fixed_amount: payload.fixedAmount ?? 0,
      p_commission_type: payload.commissionType || 'percentage',
      p_commission_basis: payload.commissionBasis || 'net',
    });
    if (error) return { success: false, error: error.message };
    return { success: !!data?.success, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update staff commission' };
  }
}

export async function fetchMonthlyPayroll(
  payoutPeriod?: string
): Promise<{ data: StaffPayrollRecord[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_get_monthly_payroll', {
      p_payout_period: payoutPeriod || null,
    });
    if (error) return { data: null, error: error.message };
    const mapped: StaffPayrollRecord[] = (data || []).map((row: any) => ({
      payoutId: row.payout_id || undefined,
      staffId: row.staff_id,
      staffName: row.staff_name || 'Staff Member',
      staffRole: row.staff_role || 'Service Provider',
      avatarUrl: row.avatar_url || undefined,
      payoutPeriod: row.payout_period,
      commissionRate: Number(row.commission_rate ?? 0),
      commissionType: row.commission_type || 'percentage',
      commissionBasis: row.commission_basis || 'net',
      fixedCommissionAmount: Number(row.fixed_commission_amount ?? 0),
      completedBookingsCount: Number(row.completed_bookings_count ?? 0),
      grossSales: Number(row.gross_sales ?? 0),
      calculatedCommission: Number(row.calculated_commission ?? 0),
      bonusAmount: Number(row.bonus_amount ?? 0),
      deductionsAmount: Number(row.deductions_amount ?? 0),
      netPayout: Number(row.net_payout ?? 0),
      status: row.status || 'Pending',
      paymentMethod: row.payment_method || 'Bank Transfer',
      paymentReference: row.payment_reference || '',
      paidAt: row.paid_at || undefined,
      notes: row.notes || '',
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch monthly payroll' };
  }
}

export async function markPayoutPaid(
  payload: MarkPayoutPaidPayload
): Promise<{ data: StaffPayrollRecord | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_mark_payout_paid', {
      p_staff_id: payload.staffId,
      p_payout_period: payload.payoutPeriod,
      p_gross_sales: payload.grossSales ?? 0,
      p_commission_earned: payload.commissionEarned ?? 0,
      p_bonus_amount: payload.bonusAmount ?? 0,
      p_deductions_amount: payload.deductionsAmount ?? 0,
      p_net_payout: payload.netPayout ?? 0,
      p_status: payload.status || 'Paid',
      p_payment_method: payload.paymentMethod || 'Bank Transfer',
      p_payment_reference: payload.paymentReference || null,
      p_notes: payload.notes || null,
    });
    if (error) return { data: null, error: error.message };
    return {
      data: data
        ? {
            payoutId: data.id,
            staffId: data.staff_id,
            staffName: '',
            staffRole: '',
            payoutPeriod: data.payout_period,
            commissionRate: 0,
            commissionType: 'percentage',
            commissionBasis: 'net',
            fixedCommissionAmount: 0,
            completedBookingsCount: 0,
            grossSales: Number(data.gross_sales ?? 0),
            calculatedCommission: Number(data.commission_earned ?? 0),
            bonusAmount: Number(data.bonus_amount ?? 0),
            deductionsAmount: Number(data.deductions_amount ?? 0),
            netPayout: Number(data.net_payout ?? 0),
            status: data.status || 'Paid',
            paymentMethod: data.payment_method || 'Bank Transfer',
            paymentReference: data.payment_reference || '',
            paidAt: data.paid_at || undefined,
            notes: data.notes || '',
          }
        : null,
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to mark payout as paid' };
  }
}

export async function fetchPayoutHistory(
  staffId?: string
): Promise<{ data: StaffPayoutHistoryItem[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('owner_get_payout_history', {
      p_staff_id: staffId || null,
    });
    if (error) return { data: null, error: error.message };
    const mapped: StaffPayoutHistoryItem[] = (data || []).map((row: any) => ({
      payoutId: row.payout_id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      payoutPeriod: row.payout_period,
      grossSales: Number(row.gross_sales ?? 0),
      commissionEarned: Number(row.commission_earned ?? 0),
      bonusAmount: Number(row.bonus_amount ?? 0),
      deductionsAmount: Number(row.deductions_amount ?? 0),
      netPayout: Number(row.net_payout ?? 0),
      status: row.status || 'Pending',
      paymentMethod: row.payment_method || 'Bank Transfer',
      paymentReference: row.payment_reference || '',
      paidAt: row.paid_at || undefined,
      notes: row.notes || '',
      createdAt: row.created_at,
    }));
    return { data: mapped, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Failed to fetch payout history' };
  }
}
