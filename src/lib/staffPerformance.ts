// ==============================================================================
// Owner-only Staff Performance Dashboard — RPC contract.
// Physical mapping (see supabase/migrations/20260908_staff_performance_dashboard_backend.sql):
//   salon_id  → profiles.id (= auth.uid() of the salon owner)
//   staff_id  → stylists.id
//   bookings  → public.bookings (staff in metadata.staff_id / metadata.services[].staff_id)
//   payments  → bookings.payment_status + advance_paid_amount (no payments table)
//   reviews   → bookings.metadata.review_rating
// ==============================================================================

export const STAFF_PERFORMANCE_RPCS = [
  'get_owner_staff_performance',
  'get_owner_staff_last_7_days',
  'get_owner_staff_daily_performance',
  'get_owner_staff_detail',
  'get_owner_staff_export',
  'refresh_staff_performance_daily',
  'calculate_staff_commission',
  'is_staff_dashboard_owner',
] as const;

export const STAFF_PERFORMANCE_TABLES = [
  'staff_commission_settings',
  'staff_performance_daily',
  'staff_performance_audit',
] as const;

export type StaffCommissionType = 'percentage' | 'fixed' | 'none';

export interface StaffPerformanceSummaryRow {
  staff_id: string;
  staff_name: string;
  staff_photo: string | null;
  staff_role: string;
  total_bookings: number;
  pending_bookings: number;
  confirmed_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
  review_count: number;
  average_rating: number;
  five_star_reviews: number;
  four_star_reviews: number;
  three_star_reviews: number;
  two_star_reviews: number;
  one_star_reviews: number;
}

export interface StaffLast7DaysRow {
  staff_id: string;
  staff_name: string;
  staff_photo: string | null;
  booking_count_7d: number;
  completed_booking_count_7d: number;
  gross_amount_7d: number;
  discount_amount_7d: number;
  net_amount_7d: number;
  paid_amount_7d: number;
  commission_amount_7d: number;
  salon_amount_7d: number;
  review_count_7d: number;
  average_rating_7d: number;
  booking_rank: number;
  payment_rank: number;
  review_rank: number;
  overall_rank: number;
}

export interface StaffDailyPerformanceRow {
  performance_date: string;
  staff_id: string;
  staff_name: string;
  bookings: number;
  completed_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_amount: number;
  salon_amount: number;
  reviews: number;
  average_rating: number;
}

export interface StaffCommissionResult {
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  commission_type: StaffCommissionType;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
}

export interface StaffExportRow {
  staff_name: string;
  staff_role: string;
  total_bookings: number;
  completed_bookings: number;
  cancelled_bookings: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  paid_amount: number;
  commission_rate: number;
  commission_amount: number;
  salon_amount: number;
  review_count: number;
  average_rating: number;
}
