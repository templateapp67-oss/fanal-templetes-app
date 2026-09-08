// =============================================================================
// Local / demo Staff Performance when Phase 2 RPCs are missing (mock mode or
// unmigrated live DB). Numbers come from the salon roster + bookings the owner
// already has — Retry must not loop on rpc_unavailable.
// =============================================================================

import type { Appointment, Stylist } from '../types';
import {
  addDaysIso,
  asFiniteNumber,
  csvFromExportRows,
  lastSevenCivilDays,
  normalizeDailyRow,
  normalizeExportRow,
  normalizeLast7Row,
  normalizeSummaryRow,
  type StaffDailyPerformanceRow,
  type StaffDetailPayload,
  type StaffExportRow,
  type StaffLast7DaysRow,
  type StaffPerformanceSummaryRow,
  type StaffRecentAppointment,
  type StaffServiceSummary,
} from './staffPerformance';

export const MOCK_STAFF_PERFORMANCE_SALON_ID = 'mock-salon';
export const MOCK_STAFF_PERFORMANCE_USER_ID = 'mock-user-123';

export interface FallbackStaff {
  id: string;
  name: string;
  photo: string | null;
  role: string;
  commissionRate: number;
  rating?: number;
}

export interface FallbackBooking {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  timeSlot: string | null;
  status: string;
  paymentStatus: string;
  serviceId?: string;
  serviceName: string | null;
  customerName: string | null;
  grossAmount: number;
  paidAmount: number;
  discountAmount: number;
  rating: number | null;
}

export interface StaffPerformanceSource {
  staff: FallbackStaff[];
  bookings: FallbackBooking[];
}

let localSource: StaffPerformanceSource | null = null;

export function setStaffPerformanceLocalSource(source: StaffPerformanceSource | null): void {
  localSource = source && Array.isArray(source.staff) ? { staff: source.staff, bookings: source.bookings || [] } : null;
}

export function getStaffPerformanceLocalSource(): StaffPerformanceSource | null {
  return localSource;
}

function money(value: unknown): number {
  return Math.round(asFiniteNumber(value) * 100) / 100;
}

function statusOf(raw: string): string {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, '_');
  if (s === 'no-show') return 'no_show';
  return s;
}

function isCancelled(status: string): boolean {
  const s = statusOf(status);
  return s === 'cancelled' || s === 'canceled' || s === 'no_show';
}

function inRange(date: string, from: string, to: string): boolean {
  const d = String(date || '').slice(0, 10);
  if (!d) return false;
  return d >= from && d <= to;
}

export function staffFromStylists(stylists: Array<Partial<Stylist> & { id?: string; name?: string }>): FallbackStaff[] {
  return (stylists || [])
    .filter((row) => row && (row.id || row.name))
    .map((row) => ({
      id: String(row.id || row.name || ''),
      name: String(row.name || 'Staff'),
      photo: (row.avatarUrl as string | null | undefined) ?? null,
      role: String(row.role || 'Stylist'),
      commissionRate: asFiniteNumber(row.commissionRate),
      rating: asFiniteNumber(row.rating) || undefined,
    }));
}

export function bookingsFromAppointments(appointments: Array<Partial<Appointment>>): FallbackBooking[] {
  return (appointments || [])
    .filter((row) => row && (row.stylistId || row.stylistName))
    .map((row) => ({
      id: String(row.id || ''),
      staffId: String(row.stylistId || row.stylistName || ''),
      staffName: String(row.stylistName || 'Staff'),
      date: String(row.date || '').slice(0, 10),
      timeSlot: row.time ? String(row.time) : null,
      status: statusOf(String(row.status || 'confirmed')),
      paymentStatus: String(row.paymentStatus || ''),
      serviceId: row.serviceId ? String(row.serviceId) : undefined,
      serviceName: row.serviceName == null ? null : String(row.serviceName),
      customerName: row.clientName == null ? null : String(row.clientName),
      grossAmount: money(row.servicePrice),
      paidAmount: money(row.amountPaid),
      discountAmount: 0,
      rating: null,
    }));
}

export function staffFromDbRows(rows: Array<Record<string, unknown>>): FallbackStaff[] {
  return (rows || [])
    .filter((row) => row && (row.id || row.name))
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || 'Staff'),
      photo: (row.avatar_url as string | null | undefined) ?? (row.staff_photo as string | null | undefined) ?? null,
      role: String(row.role || row.staff_role || 'Stylist'),
      commissionRate: asFiniteNumber(row.commission_rate ?? row.commissionRate),
      rating: asFiniteNumber(row.rating) || undefined,
    }));
}

function uuidFrom(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value);
}

export function bookingsFromDbRows(rows: Array<Record<string, unknown>>): FallbackBooking[] {
  return (rows || []).map((row) => {
    const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
    const services = Array.isArray(meta.services) ? (meta.services as Array<Record<string, unknown>>) : [];
    const staffId =
      uuidFrom(row.staff_id) ||
      uuidFrom(row.stylist_id) ||
      uuidFrom(meta.staff_id) ||
      uuidFrom(meta.stylist_id) ||
      uuidFrom(services[0]?.staff_id) ||
      uuidFrom(row.stylist_name);
    const date = String(row.booking_date || row.date || row.performance_date || '').slice(0, 10);
    const gross = money(row.total_amount ?? row.gross_amount ?? row.service_price ?? row.amount ?? 0);
    const paid = money(row.advance_paid_amount ?? row.amount_paid ?? row.paid_amount ?? 0);
    const discount = money(row.discount_amount ?? meta.discount_amount ?? 0);
    const ratingRaw = asFiniteNumber(meta.review_rating ?? row.review_rating ?? 0);
    const rating = ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;
    return {
      id: String(row.id || ''),
      staffId,
      staffName: String(row.stylist_name || row.staff_name || meta.staff_name || 'Staff'),
      date,
      timeSlot: row.time_slot == null && row.time == null ? null : String(row.time_slot || row.time),
      status: statusOf(String(row.status || 'confirmed')),
      paymentStatus: String(row.payment_status || row.paymentStatus || ''),
      serviceId: row.service_id ? String(row.service_id) : undefined,
      serviceName: row.service_name == null ? null : String(row.service_name),
      customerName: row.customer_name == null && row.client_name == null ? null : String(row.customer_name || row.client_name),
      grossAmount: gross,
      paidAmount: paid,
      discountAmount: discount,
      rating,
    };
  });
}

function demoStaff(): FallbackStaff[] {
  return [
    { id: 'hs-st-uma', name: 'Uma', photo: null, role: 'Founder & Master Stylist', commissionRate: 35, rating: 4.98 },
    { id: 'hs-st-1', name: 'Ananya Sharma', photo: null, role: 'Senior Precision Stylist', commissionRate: 30, rating: 4.95 },
    { id: 'hs-st-2', name: 'Rohan Kapoor', photo: null, role: 'Stylist & Hair Craftsman', commissionRate: 25, rating: 4.92 },
    { id: 'hs-st-3', name: 'Kavita Deshmukh', photo: null, role: 'Hair Texture & Scalp Specialist', commissionRate: 25, rating: 4.89 },
  ];
}

function demoBookings(): FallbackBooking[] {
  const staff = demoStaff();
  const window = lastSevenCivilDays();
  return staff.map((member, index) => {
    const iso = addDaysIso(window.from, index % 6);
    const gross = [2400, 750, 1100, 850][index % 4];
    const rating = [5, 5, 4, 5][index % 4];
    return {
      id: `demo-last7-${member.id}`,
      staffId: member.id,
      staffName: member.name,
      date: iso <= window.to ? iso : window.to,
      timeSlot: `${10 + index}:00`,
      status: 'completed',
      paymentStatus: 'paid_full',
      serviceName: ['Balayage', 'Precision Cut', 'Keratin', 'Cleanup'][index % 4],
      customerName: ['Priya', 'Arjun', 'Meera', 'Kabir'][index % 4],
      grossAmount: gross,
      paidAmount: gross,
      discountAmount: index === 0 ? 100 : 0,
      rating,
    };
  });
}

export function demoStaffPerformanceSource(): StaffPerformanceSource {
  return { staff: demoStaff(), bookings: demoBookings() };
}

export function resolveStaffPerformanceSource(override?: StaffPerformanceSource | null): StaffPerformanceSource {
  if (override && override.staff.length) return override;
  if (localSource && localSource.staff.length) return localSource;
  return demoStaffPerformanceSource();
}

function emptySummary(staff: FallbackStaff): StaffPerformanceSummaryRow {
  return normalizeSummaryRow({
    staff_id: staff.id,
    staff_name: staff.name,
    staff_photo: staff.photo,
    staff_role: staff.role,
    commission_rate: staff.commissionRate,
  });
}

function applyCommission(net: number, rate: number): { commission: number; salon: number } {
  const commission = money((net * asFiniteNumber(rate)) / 100);
  return { commission, salon: money(net - commission) };
}

function starBucket(rating: number | null): keyof Pick<
  StaffPerformanceSummaryRow,
  'five_star_reviews' | 'four_star_reviews' | 'three_star_reviews' | 'two_star_reviews' | 'one_star_reviews'
> | null {
  if (rating == null) return null;
  if (rating >= 4.5) return 'five_star_reviews';
  if (rating >= 3.5) return 'four_star_reviews';
  if (rating >= 2.5) return 'three_star_reviews';
  if (rating >= 1.5) return 'two_star_reviews';
  if (rating >= 1) return 'one_star_reviews';
  return null;
}

function accumulate(staff: FallbackStaff, bookings: FallbackBooking[]): StaffPerformanceSummaryRow {
  const row = emptySummary(staff);
  let ratingSum = 0;
  for (const booking of bookings) {
    row.total_bookings += 1;
    const status = statusOf(booking.status);
    if (status === 'pending') row.pending_bookings += 1;
    else if (status === 'confirmed') row.confirmed_bookings += 1;
    else if (status === 'completed') row.completed_bookings += 1;
    else if (isCancelled(status)) row.cancelled_bookings += 1;

    if (!isCancelled(status)) {
      row.gross_amount = money(row.gross_amount + booking.grossAmount);
      row.discount_amount = money(row.discount_amount + booking.discountAmount);
      row.paid_amount = money(row.paid_amount + booking.paidAmount);
    }

    if (booking.rating != null) {
      row.review_count += 1;
      ratingSum += booking.rating;
      const bucket = starBucket(booking.rating);
      if (bucket) row[bucket] += 1;
    }
  }
  row.net_amount = money(row.gross_amount - row.discount_amount);
  const split = applyCommission(row.net_amount, staff.commissionRate);
  row.commission_amount = split.commission;
  row.salon_amount = split.salon;
  row.average_rating = row.review_count > 0 ? Math.round((ratingSum / row.review_count) * 100) / 100 : asFiniteNumber(staff.rating);
  if (row.review_count === 0 && staff.rating && staff.rating >= 1) {
    // Roster rating is display-only until booking reviews exist — keep review_count at 0
    // so empty-state copy still works, but surface the known staff rating.
    row.average_rating = money(staff.rating);
  }
  return row;
}

function bookingsFor(source: StaffPerformanceSource, staffId: string, from: string, to: string): FallbackBooking[] {
  return source.bookings.filter((booking) => booking.staffId === staffId && inRange(booking.date, from, to));
}

export function computeStaffSummary(
  source: StaffPerformanceSource,
  from: string,
  to: string,
  staffId?: string | null
): StaffPerformanceSummaryRow[] {
  const roster = staffId ? source.staff.filter((s) => s.id === staffId) : source.staff;
  const historical = source.bookings.filter((b) => b.staffId && !roster.some((s) => s.id === b.staffId));
  const extraStaff: FallbackStaff[] = [];
  for (const booking of historical) {
    if (staffId && booking.staffId !== staffId) continue;
    if (extraStaff.some((s) => s.id === booking.staffId)) continue;
    extraStaff.push({
      id: booking.staffId,
      name: booking.staffName || 'Staff',
      photo: null,
      role: 'Stylist',
      commissionRate: 0,
    });
  }
  return [...roster, ...extraStaff].map((staff) => accumulate(staff, bookingsFor(source, staff.id, from, to)));
}

function denseRank(values: Array<{ id: string; value: number }>): Record<string, number> {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const ranks: Record<string, number> = {};
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((row, index) => {
    if (lastValue === null || row.value !== lastValue) {
      lastRank = index + 1;
      lastValue = row.value;
    }
    ranks[row.id] = lastRank;
  });
  return ranks;
}

export function computeStaffLast7Days(source: StaffPerformanceSource, today?: string): StaffLast7DaysRow[] {
  const window = lastSevenCivilDays(today);
  const summaries = computeStaffSummary(source, window.from, window.to, null);
  const bookingRank = denseRank(summaries.map((row) => ({ id: row.staff_id, value: row.completed_bookings })));
  const paymentRank = denseRank(summaries.map((row) => ({ id: row.staff_id, value: row.paid_amount })));
  const reviewRank = denseRank(summaries.map((row) => ({ id: row.staff_id, value: row.review_count * 10 + row.average_rating })));
  const scored = summaries.map((row) => {
    const br = bookingRank[row.staff_id] || summaries.length;
    const pr = paymentRank[row.staff_id] || summaries.length;
    const rr = reviewRank[row.staff_id] || summaries.length;
    return { id: row.staff_id, value: 1 / br + 1 / pr + 1 / rr };
  });
  const overallRank = denseRank(scored);
  return summaries.map((row) =>
    normalizeLast7Row({
      staff_id: row.staff_id,
      staff_name: row.staff_name,
      staff_photo: row.staff_photo,
      booking_count_7d: row.total_bookings,
      completed_booking_count_7d: row.completed_bookings,
      gross_amount_7d: row.gross_amount,
      discount_amount_7d: row.discount_amount,
      net_amount_7d: row.net_amount,
      paid_amount_7d: row.paid_amount,
      commission_amount_7d: row.commission_amount,
      salon_amount_7d: row.salon_amount,
      review_count_7d: row.review_count,
      average_rating_7d: row.average_rating,
      booking_rank: bookingRank[row.staff_id] || 0,
      payment_rank: paymentRank[row.staff_id] || 0,
      review_rank: reviewRank[row.staff_id] || 0,
      overall_rank: overallRank[row.staff_id] || 0,
    })
  );
}

export function computeStaffDaily(
  source: StaffPerformanceSource,
  from: string,
  to: string,
  staffId?: string | null
): StaffDailyPerformanceRow[] {
  const staffById = new Map(source.staff.map((s) => [s.id, s]));
  const grouped = new Map<string, FallbackBooking[]>();
  for (const booking of source.bookings) {
    if (!booking.staffId || !inRange(booking.date, from, to)) continue;
    if (staffId && booking.staffId !== staffId) continue;
    const key = `${booking.date}|${booking.staffId}`;
    const list = grouped.get(key) || [];
    list.push(booking);
    grouped.set(key, list);
  }
  const rows: StaffDailyPerformanceRow[] = [];
  for (const [key, list] of grouped) {
    const [date, id] = key.split('|');
    const staff = staffById.get(id) || {
      id,
      name: list[0]?.staffName || 'Staff',
      photo: null,
      role: 'Stylist',
      commissionRate: 0,
    };
    const summary = accumulate(staff, list);
    rows.push(
      normalizeDailyRow({
        performance_date: date,
        staff_id: id,
        staff_name: staff.name,
        bookings: summary.total_bookings,
        completed_bookings: summary.completed_bookings,
        gross_amount: summary.gross_amount,
        discount_amount: summary.discount_amount,
        net_amount: summary.net_amount,
        paid_amount: summary.paid_amount,
        commission_amount: summary.commission_amount,
        salon_amount: summary.salon_amount,
        reviews: summary.review_count,
        average_rating: summary.average_rating,
      })
    );
  }
  rows.sort((a, b) => a.performance_date.localeCompare(b.performance_date) || a.staff_name.localeCompare(b.staff_name));
  return rows;
}

export function computeStaffDetail(
  source: StaffPerformanceSource,
  staffId: string,
  from: string,
  to: string
): StaffDetailPayload | null {
  const staff = source.staff.find((s) => s.id === staffId) || {
    id: staffId,
    name: source.bookings.find((b) => b.staffId === staffId)?.staffName || 'Staff',
    photo: null,
    role: 'Stylist',
    commissionRate: 0,
  };
  const summary = accumulate(staff, bookingsFor(source, staffId, from, to));
  const last7 = computeStaffLast7Days(source).find((row) => row.staff_id === staffId) || {};
  const rangeBookings = bookingsFor(source, staffId, from, to);
  const serviceMap = new Map<string, StaffServiceSummary>();
  for (const booking of rangeBookings) {
    const name = booking.serviceName || 'Unknown service';
    const key = `${booking.serviceId || name}|${name}`;
    const current = serviceMap.get(key) || {
      service_id: booking.serviceId,
      service_name: name,
      bookings: 0,
      completed_bookings: 0,
      gross_amount: 0,
    };
    current.bookings = (current.bookings || 0) + 1;
    if (statusOf(booking.status) === 'completed') current.completed_bookings += 1;
    if (!isCancelled(booking.status)) current.gross_amount = money(current.gross_amount + booking.grossAmount);
    serviceMap.set(key, current);
  }
  const services = [...serviceMap.values()].sort((a, b) => b.completed_bookings - a.completed_bookings || b.gross_amount - a.gross_amount);
  const recent: StaffRecentAppointment[] = [...rangeBookings]
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.timeSlot || '').localeCompare(String(a.timeSlot || '')))
    .slice(0, 12)
    .map((booking) => ({
      booking_id: booking.id,
      performance_date: booking.date,
      time_slot: booking.timeSlot,
      status: booking.status,
      payment_status: booking.paymentStatus,
      service_name: booking.serviceName,
      customer_name: booking.customerName,
      gross_amount: booking.grossAmount,
      paid_amount: booking.paidAmount,
    }));

  return {
    staff_profile: {
      staff_id: staff.id,
      staff_name: staff.name,
      staff_photo: staff.photo,
      staff_role: staff.role,
    },
    booking_status_summary: {
      total_bookings: summary.total_bookings,
      pending_bookings: summary.pending_bookings,
      confirmed_bookings: summary.confirmed_bookings,
      completed_bookings: summary.completed_bookings,
      cancelled_bookings: summary.cancelled_bookings,
    },
    payment_summary: {
      gross_amount: summary.gross_amount,
      paid_amount: summary.paid_amount,
      outstanding_amount: money(Math.max(0, summary.net_amount - summary.paid_amount)),
    },
    discount_summary: {
      discount_amount: summary.discount_amount,
      net_amount: summary.net_amount,
    },
    commission_calculation: {
      commission_rate: summary.commission_rate,
      commission_amount: summary.commission_amount,
    },
    salon_share: {
      salon_amount: summary.salon_amount,
    },
    review_summary: {
      review_count: summary.review_count,
      average_rating: summary.average_rating,
    },
    rating_distribution: {
      five_star_reviews: summary.five_star_reviews,
      four_star_reviews: summary.four_star_reviews,
      three_star_reviews: summary.three_star_reviews,
      two_star_reviews: summary.two_star_reviews,
      one_star_reviews: summary.one_star_reviews,
    },
    service_wise_booking_summary: services,
    top_services: services.slice(0, 5),
    recent_appointments: recent,
    last_7_days: last7,
  };
}

export function computeStaffExport(
  source: StaffPerformanceSource,
  from: string,
  to: string,
  staffId?: string | null
): { rows: StaffExportRow[]; csv: string } {
  const rows = computeStaffSummary(source, from, to, staffId).map((row) =>
    normalizeExportRow({
      staff_name: row.staff_name,
      staff_role: row.staff_role,
      total_bookings: row.total_bookings,
      completed_bookings: row.completed_bookings,
      cancelled_bookings: row.cancelled_bookings,
      gross_amount: row.gross_amount,
      discount_amount: row.discount_amount,
      net_amount: row.net_amount,
      paid_amount: row.paid_amount,
      commission_rate: row.commission_rate,
      commission_amount: row.commission_amount,
      salon_amount: row.salon_amount,
      review_count: row.review_count,
      average_rating: row.average_rating,
    })
  );
  return { rows, csv: csvFromExportRows(rows) };
}
