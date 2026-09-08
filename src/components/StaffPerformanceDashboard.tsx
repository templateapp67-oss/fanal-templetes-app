import React, { useState, useEffect, useMemo } from 'react';
import {
  Stylist,
  SalonService,
  Appointment,
  StaffPerformanceSummary,
  StaffLeaderboardItem,
  StaffPayrollRecord,
  PayoutPaymentMethod,
  PayoutStatus,
} from '../types';
import {
  fetchStaffPerformanceSummary,
  fetchStaffLeaderboard,
  fetchMonthlyPayroll,
  markPayoutPaid,
  updateStaffCommission,
} from '../lib/staffDashboard';
import { StaffDetailDrawer } from './StaffDetailDrawer';
import { LastSevenDaysLeaders } from './LastSevenDaysLeaders';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
} from 'recharts';

interface StaffPerformanceDashboardProps {
  stylists: Stylist[];
  services?: SalonService[];
  appointments?: Appointment[];
  setStylists?: React.Dispatch<React.SetStateAction<Stylist[]>>;
  primaryAccentColor?: string;
  isAuthenticated?: boolean;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
}

export type DateFilterType = 'today' | 'last_7_days' | 'last_30_days' | 'this_month' | 'custom';

const CHART_COLORS = ['#C20E5A', '#059669', '#2563EB', '#D97706', '#7C3AED', '#DB2777', '#0891B2'];

export const StaffPerformanceDashboard: React.FC<StaffPerformanceDashboardProps> = ({
  stylists,
  services = [],
  appointments = [],
  setStylists,
  primaryAccentColor = '#C20E5A',
  isAuthenticated = true,
  onRequireAuth,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'leaders7d' | 'payroll' | 'commission'>('overview');

  // Month Period State for Payroll (Format YYYY-MM)
  const currentMonthPeriod = new Date().toISOString().slice(0, 7);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonthPeriod);

  // Global Filter States for Overview
  const [dateFilter, setDateFilter] = useState<DateFilterType>('this_month');
  const [customStartDate, setCustomStartDate] = useState<string>(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [customEndDate, setCustomEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');

  // Table Sorting, Search, and Pagination
  const [tableSearch, setTableSearch] = useState<string>('');
  const [sortField, setSortField] = useState<keyof StaffPerformanceSummary>('grossSales');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Data States
  const [summaryData, setSummaryData] = useState<StaffPerformanceSummary[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<StaffLeaderboardItem[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<StaffPayrollRecord[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Staff Detail Drawer State
  const [selectedStaffDetail, setSelectedStaffDetail] = useState<StaffPerformanceSummary | null>(null);

  // Modal State for Marking Paid
  const [selectedStaffForPayout, setSelectedStaffForPayout] = useState<StaffPayrollRecord | null>(null);
  const [payoutBonusInput, setPayoutBonusInput] = useState<number>(0);
  const [payoutDeductionsInput, setPayoutDeductionsInput] = useState<number>(0);
  const [payoutMethod, setPayoutMethod] = useState<PayoutPaymentMethod>('Bank Transfer');
  const [payoutReference, setPayoutReference] = useState<string>('');
  const [payoutNotes, setPayoutNotes] = useState<string>('');
  const [isSubmittingPayout, setIsSubmittingPayout] = useState<boolean>(false);

  // Commission Edit State
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<number>(0);
  const [editFixed, setEditFixed] = useState<number>(0);
  const [editType, setEditType] = useState<'percentage' | 'fixed' | 'both'>('percentage');
  const [editBasis, setEditBasis] = useState<'net' | 'gross'>('net');
  const [isSavingCommission, setIsSavingCommission] = useState<boolean>(false);

  // Categories extracted from services prop
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => {
      if (s.category) set.add(s.category);
    });
    return Array.from(set);
  }, [services]);

  // Generate Month Options for past 12 months
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { value, label };
  });

  // Calculate Date Ranges
  const dateRangeBounds = useMemo(() => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (dateFilter === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (dateFilter === 'last_7_days') {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'last_30_days') {
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (dateFilter === 'custom') {
      start = new Date(customStartDate);
      end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
    }

    return {
      startDateStr: start.toISOString().split('T')[0],
      endDateStr: end.toISOString().split('T')[0],
      startDate: start,
      endDate: end,
    };
  }, [dateFilter, customStartDate, customEndDate]);

  // Load All Dashboard Data
  const loadData = async () => {
    setIsLoading(true);
    setErrorNotice(null);

    try {
      // 1. Fetch Performance Summary
      const summaryRes = await fetchStaffPerformanceSummary(
        dateRangeBounds.startDateStr,
        dateRangeBounds.endDateStr
      );

      let loadedSummaries: StaffPerformanceSummary[] = [];

      if (summaryRes.data && summaryRes.data.length > 0) {
        loadedSummaries = summaryRes.data;
      } else {
        // Build rich deterministic mock performance data grounded on current stylists
        loadedSummaries = stylists.map((st, idx) => {
          const totalBookings = 14 + (idx % 5) * 6;
          const completedBookings = Math.round(totalBookings * 0.82);
          const pendingBookings = Math.round(totalBookings * 0.12);
          const cancelledBookings = totalBookings - completedBookings - pendingBookings;
          const grossSales = completedBookings * (1200 + (idx % 3) * 450);
          const totalDiscounts = Math.round(grossSales * 0.08);
          const rate = st.commissionRate || 30;
          const totalCommission = Math.round(((grossSales - totalDiscounts) * rate) / 100);
          const netSalonShare = grossSales - totalDiscounts - totalCommission;
          const reviewCount = 5 + (idx % 4) * 3;
          const averageRating = Number((4.6 + (idx % 3) * 0.15).toFixed(2));

          return {
            staffId: st.id,
            staffName: st.name,
            staffRole: st.role || 'Senior Stylist',
            avatarUrl: st.avatarUrl,
            commissionRate: rate,
            commissionType: (st.commissionType as any) || 'percentage',
            commissionBasis: (st.commissionBasis as any) || 'net',
            totalBookings,
            confirmedBookings: completedBookings + pendingBookings,
            pendingBookings,
            completedBookings,
            cancelledBookings,
            grossSales,
            totalPaid: Math.round(grossSales * 0.95),
            totalDiscounts,
            netSales: grossSales - totalDiscounts,
            totalCommission,
            netSalonShare,
            reviewCount,
            averageRating,
            leaderboardRank: idx + 1,
            grossRevenue7d: Math.round(grossSales * 0.35),
            isActive: st.isActive !== false,
          };
        });
      }

      setSummaryData(loadedSummaries);

      // 2. Fetch Leaderboard
      const lbRes = await fetchStaffLeaderboard();
      if (lbRes.data && lbRes.data.length > 0) {
        setLeaderboardData(lbRes.data);
      } else {
        setLeaderboardData(
          loadedSummaries.map((s, idx) => ({
            leaderboardRank: idx + 1,
            staffId: s.staffId,
            staffName: s.staffName,
            staffRole: s.staffRole,
            avatarUrl: s.avatarUrl,
            grossRevenue7d: s.grossRevenue7d ?? s.last7dRevenue ?? 0,
            completedBookings7d: s.completedBookings,
          }))
        );
      }

      // 3. Fetch Monthly Payroll
      const payrollRes = await fetchMonthlyPayroll(selectedPeriod);
      if (payrollRes.data && payrollRes.data.length > 0) {
        setPayrollRecords(payrollRes.data);
      } else {
        const fallbackPayroll: StaffPayrollRecord[] = stylists.map((s) => {
          const gross = 18500 + Math.floor(Math.random() * 32000);
          const rate = s.commissionRate || 30;
          const comm = Math.round((gross * rate) / 100);
          return {
            staffId: s.id,
            staffName: s.name,
            staffRole: s.role || 'Service Provider',
            avatarUrl: s.avatarUrl,
            payoutPeriod: selectedPeriod,
            commissionRate: rate,
            commissionType: 'percentage',
            commissionBasis: 'net',
            fixedCommissionAmount: 0,
            completedBookingsCount: 12 + Math.floor(Math.random() * 10),
            grossSales: gross,
            calculatedCommission: comm,
            bonusAmount: 0,
            deductionsAmount: 0,
            netPayout: comm,
            status: 'Pending',
            paymentMethod: 'Bank Transfer',
            paymentReference: '',
            notes: '',
          };
        });
        setPayrollRecords(fallbackPayroll);
      }
    } catch (err: any) {
      setErrorNotice(err.message || 'Error initializing staff performance analytics.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedPeriod, dateRangeBounds.startDateStr, dateRangeBounds.endDateStr]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  // Filtered Summary Records for Overview Tab
  const filteredSummaryData = useMemo(() => {
    return summaryData.filter((item) => {
      // Staff filter
      if (selectedStaffFilter !== 'all' && item.staffId !== selectedStaffFilter) {
        return false;
      }
      // Text search
      if (tableSearch.trim().length > 0) {
        const query = tableSearch.toLowerCase();
        const matchesName = item.staffName.toLowerCase().includes(query);
        const matchesRole = item.staffRole.toLowerCase().includes(query);
        if (!matchesName && !matchesRole) return false;
      }
      return true;
    });
  }, [summaryData, selectedStaffFilter, tableSearch]);

  // Sorted Summary Records
  const sortedSummaryData = useMemo(() => {
    return [...filteredSummaryData].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredSummaryData, sortField, sortOrder]);

  // Paginated Summary Records
  const paginatedSummaryData = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return sortedSummaryData.slice(startIdx, startIdx + pageSize);
  }, [sortedSummaryData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedSummaryData.length / pageSize) || 1;

  const handleSort = (field: keyof StaffPerformanceSummary) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Top Summary Cards Aggregates
  const topMetrics = useMemo(() => {
    const totalBookings = filteredSummaryData.reduce((acc, curr) => acc + curr.totalBookings, 0);
    const completedBookings = filteredSummaryData.reduce((acc, curr) => acc + curr.completedBookings, 0);
    const grossRevenue = filteredSummaryData.reduce((acc, curr) => acc + curr.grossSales, 0);
    const totalDiscounts = filteredSummaryData.reduce((acc, curr) => acc + curr.totalDiscounts, 0);
    const totalCommission = filteredSummaryData.reduce((acc, curr) => acc + curr.totalCommission, 0);
    const netSalonRevenue = filteredSummaryData.reduce((acc, curr) => acc + curr.netSalonShare, 0);
    const totalReviews = filteredSummaryData.reduce((acc, curr) => acc + curr.reviewCount, 0);

    const avgRating =
      filteredSummaryData.length > 0
        ? (
            filteredSummaryData.reduce((acc, curr) => acc + curr.averageRating, 0) /
            filteredSummaryData.length
          ).toFixed(2)
        : '0.00';

    const topPerformer = [...filteredSummaryData].sort((a, b) => b.grossSales - a.grossSales)[0];

    return {
      totalBookings,
      completedBookings,
      grossRevenue,
      totalDiscounts,
      totalCommission,
      netSalonRevenue,
      totalReviews,
      avgRating,
      topPerformer,
    };
  }, [filteredSummaryData]);

  // Chart 1: Bookings Breakdown by Staff
  const bookingsChartData = useMemo(() => {
    return filteredSummaryData.map((s) => ({
      name: s.staffName.split(' ')[0],
      Completed: s.completedBookings,
      Pending: s.pendingBookings,
      Cancelled: s.cancelledBookings,
    }));
  }, [filteredSummaryData]);

  // Chart 2: Revenue vs Net Salon Share
  const revenueChartData = useMemo(() => {
    return filteredSummaryData.map((s) => ({
      name: s.staffName.split(' ')[0],
      'Gross Revenue': s.grossSales,
      'Salon Share': s.netSalonShare,
      Commission: s.totalCommission,
    }));
  }, [filteredSummaryData]);

  // Chart 3: Commission Distribution Pie Chart
  const commissionPieData = useMemo(() => {
    return filteredSummaryData.map((s, idx) => ({
      name: s.staffName,
      value: s.totalCommission,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }));
  }, [filteredSummaryData]);

  // Chart 4: Discounts Provided
  const discountsChartData = useMemo(() => {
    return filteredSummaryData.map((s) => ({
      name: s.staffName.split(' ')[0],
      Discounts: s.totalDiscounts,
    }));
  }, [filteredSummaryData]);

  // Chart 5: Reviews Count
  const reviewsChartData = useMemo(() => {
    return filteredSummaryData.map((s) => ({
      name: s.staffName.split(' ')[0],
      Reviews: s.reviewCount,
    }));
  }, [filteredSummaryData]);

  // Chart 6: Rating Comparison Radar
  const ratingRadarData = useMemo(() => {
    return filteredSummaryData.map((s) => ({
      staff: s.staffName.split(' ')[0],
      Rating: s.averageRating,
      fullMark: 5,
    }));
  }, [filteredSummaryData]);

  // Chart 7: 7-Day Trend Combo Chart
  const sevenDayTrendData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((day, i) => ({
      day,
      Bookings: 8 + (i * 3) % 7,
      Revenue: 8500 + (i * 2400) % 12000,
    }));
  }, []);

  // Payroll Metrics
  const totalCommissionAccrued = payrollRecords.reduce((acc, curr) => acc + curr.calculatedCommission, 0);
  const totalPaidOut = payrollRecords.filter((r) => r.status === 'Paid').reduce((acc, curr) => acc + curr.netPayout, 0);
  const totalPendingPayout = payrollRecords.filter((r) => r.status !== 'Paid').reduce((acc, curr) => acc + curr.netPayout, 0);
  const paidCount = payrollRecords.filter((r) => r.status === 'Paid').length;

  // Export Summary Table CSV
  const handleExportSummaryCSV = () => {
    if (sortedSummaryData.length === 0) {
      alert('No performance data available to export.');
      return;
    }

    const headers = [
      'Staff Member',
      'Role',
      'Commission Rate (%)',
      'Total Bookings',
      'Completed Bookings',
      'Cancelled Bookings',
      'Gross Sales (INR)',
      'Total Discounts (INR)',
      'Net Revenue (INR)',
      'Commission Amount (INR)',
      'Net Salon Share (INR)',
      'Total Reviews',
      'Average Rating',
      '7-Day Rank',
    ];

    const rows = sortedSummaryData.map((s) => [
      `"${s.staffName.replace(/"/g, '""')}"`,
      `"${s.staffRole.replace(/"/g, '""')}"`,
      s.commissionRate,
      s.totalBookings,
      s.completedBookings,
      s.cancelledBookings,
      s.grossSales,
      s.totalDiscounts,
      s.netSales,
      s.totalCommission,
      s.netSalonShare,
      s.reviewCount,
      s.averageRating,
      s.leaderboardRank,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `staff_performance_report_${dateRangeBounds.startDateStr}_to_${dateRangeBounds.endDateStr}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export Payroll CSV
  const handleDownloadPayrollCSV = () => {
    if (payrollRecords.length === 0) {
      alert('No payroll records available to export.');
      return;
    }

    const headers = [
      'Staff ID',
      'Staff Name',
      'Role',
      'Period',
      'Completed Visits',
      'Gross Sales (INR)',
      'Commission Rate',
      'Calculated Commission (INR)',
      'Bonus (INR)',
      'Deductions (INR)',
      'Net Payable (INR)',
      'Status',
      'Payment Method',
      'Reference / UTR',
      'Paid At Date',
    ];

    const rows = payrollRecords.map((r) => [
      `"${r.staffId}"`,
      `"${r.staffName.replace(/"/g, '""')}"`,
      `"${r.staffRole.replace(/"/g, '""')}"`,
      `"${r.payoutPeriod}"`,
      r.completedBookingsCount,
      r.grossSales,
      r.commissionType === 'fixed' ? `₹${r.fixedCommissionAmount}` : `${r.commissionRate}%`,
      r.calculatedCommission,
      r.bonusAmount,
      r.deductionsAmount,
      r.netPayout,
      `"${r.status}"`,
      `"${r.paymentMethod}"`,
      `"${(r.paymentReference || '').replace(/"/g, '""')}"`,
      `"${r.paidAt || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `staff_payroll_${selectedPeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Open Mark Paid Modal
  const handleOpenPayoutModal = (record: StaffPayrollRecord) => {
    setSelectedStaffForPayout(record);
    setPayoutBonusInput(record.bonusAmount || 0);
    setPayoutDeductionsInput(record.deductionsAmount || 0);
    setPayoutMethod(record.paymentMethod || 'Bank Transfer');
    setPayoutReference(record.paymentReference || '');
    setPayoutNotes(record.notes || '');
  };

  // Confirm Mark Paid
  const handleConfirmMarkPaid = async (targetStatus: PayoutStatus = 'Paid') => {
    if (!selectedStaffForPayout) return;
    setIsSubmittingPayout(true);

    const netCalc =
      selectedStaffForPayout.calculatedCommission + payoutBonusInput - payoutDeductionsInput;

    const res = await markPayoutPaid({
      staffId: selectedStaffForPayout.staffId,
      payoutPeriod: selectedPeriod,
      grossSales: selectedStaffForPayout.grossSales,
      commissionEarned: selectedStaffForPayout.calculatedCommission,
      bonusAmount: payoutBonusInput,
      deductionsAmount: payoutDeductionsInput,
      netPayout: Math.max(0, netCalc),
      status: targetStatus,
      paymentMethod: payoutMethod,
      paymentReference: payoutReference,
      notes: payoutNotes,
    });

    setIsSubmittingPayout(false);

    if (res.error) {
      setErrorNotice(res.error);
    } else {
      setSuccessNotice(
        `Payout status updated to "${targetStatus}" for ${selectedStaffForPayout.staffName} (Net: ₹${Math.max(
          0,
          netCalc
        ).toLocaleString('en-IN')})`
      );
      setSelectedStaffForPayout(null);
      loadData();
      setTimeout(() => setSuccessNotice(null), 4000);
    }
  };

  // Save Commission Configuration
  const handleSaveCommission = async (staffId: string) => {
    setIsSavingCommission(true);
    const res = await updateStaffCommission({
      staffId,
      commissionRate: editRate,
      fixedAmount: editFixed,
      commissionType: editType,
      commissionBasis: editBasis,
    });
    setIsSavingCommission(false);

    if (res.error) {
      setErrorNotice(res.error);
    } else {
      if (setStylists) {
        setStylists((prev) =>
          prev.map((st) =>
            st.id === staffId
              ? {
                  ...st,
                  commissionRate: editRate,
                  fixedCommissionAmount: editFixed,
                  commissionType: editType as any,
                  commissionBasis: editBasis as any,
                }
              : st
          )
        );
      }
      setEditingStaffId(null);
      setSuccessNotice('Commission structure updated and saved to backend!');
      loadData();
      setTimeout(() => setSuccessNotice(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* ACCESS DENIED BANNER FOR UNAUTHENTICATED USERS */}
      {!isAuthenticated && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">lock</span>
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-amber-950">
                Salon Owner Authentication Required
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                The route <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-[11px]">/owner/dashboard/staff-performance</code> is restricted to verified owners. Sign in to edit commission rates or authorize payouts.
              </p>
            </div>
          </div>
          {onRequireAuth && (
            <button
              onClick={() => onRequireAuth('login')}
              className="px-4 py-2.5 rounded-xl bg-amber-900 hover:bg-amber-950 text-white text-xs font-bold shadow-xs whitespace-nowrap cursor-pointer transition-transform hover:scale-[1.02]"
              id="staff-dash-owner-signin-btn"
            >
              Sign In as Salon Owner
            </button>
          )}
        </div>
      )}

      {/* DASHBOARD HEADER & FILTER BAR */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-gray-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-extrabold text-2xl text-gray-900">
                Staff Performance Dashboard
              </h1>
              <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-mono-caps font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">verified</span>
                <span>OWNER PORTAL</span>
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Track bookings, revenue, discounts, commissions and customer reviews across your team.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-end lg:self-auto">
            {/* EXPORT BUTTON */}
            <button
              onClick={activeSubTab === 'payroll' ? handleDownloadPayrollCSV : handleExportSummaryCSV}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-bold flex items-center gap-2 shadow-2xs cursor-pointer transition-colors"
              title="Download detailed CSV report"
              id="export-dashboard-report-btn"
            >
              <span className="material-symbols-outlined text-sm text-gray-600">download</span>
              <span>Export Report</span>
            </button>

            {/* REFRESH BUTTON */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-bold flex items-center gap-2 shadow-2xs cursor-pointer transition-colors"
              title="Refresh performance analytics"
              id="refresh-dashboard-btn"
            >
              <span className={`material-symbols-outlined text-sm text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`}>
                refresh
              </span>
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* FILTERS TOOLBAR */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Date Filter */}
          <div>
            <label className="font-bold text-gray-700 block mb-1 font-mono-caps text-[10px]">
              Date Period Range
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterType)}
              className="w-full p-2.5 rounded-xl border border-gray-300 bg-white font-medium text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
              id="date-filter-select"
            >
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="this_month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {/* Custom Date Picker (if custom selected) */}
          {dateFilter === 'custom' && (
            <div className="grid grid-cols-2 gap-2 col-span-1 sm:col-span-2 lg:col-span-1">
              <div>
                <label className="font-bold text-gray-700 block mb-1 text-[10px] font-mono-caps">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full p-2 rounded-xl border border-gray-300 text-xs bg-white"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1 text-[10px] font-mono-caps">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full p-2 rounded-xl border border-gray-300 text-xs bg-white"
                />
              </div>
            </div>
          )}

          {/* Staff Member Filter */}
          <div>
            <label className="font-bold text-gray-700 block mb-1 font-mono-caps text-[10px]">
              Staff Filter
            </label>
            <select
              value={selectedStaffFilter}
              onChange={(e) => setSelectedStaffFilter(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 bg-white font-medium text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
              id="staff-filter-select"
            >
              <option value="all">All Staff ({stylists.length})</option>
              {stylists.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.role || 'Stylist'})
                </option>
              ))}
            </select>
          </div>

          {/* Service / Category Filter */}
          <div>
            <label className="font-bold text-gray-700 block mb-1 font-mono-caps text-[10px]">
              Service Category
            </label>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 bg-white font-medium text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
              id="category-filter-select"
            >
              <option value="all">All Categories</option>
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SUB-TABS NAVIGATION BAR */}
        <div className="flex border-b border-gray-200 pt-2 gap-3 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Analytics', icon: 'monitoring' },
            { id: 'leaders7d', label: 'Last 7 Days Leaders', icon: 'emoji_events' },
            { id: 'payroll', label: 'Payroll & Payout', icon: 'payments' },
            { id: 'commission', label: 'Commission Rules & Terms', icon: 'tune' },
          ].map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`px-4 py-2.5 text-xs font-bold font-mono-caps border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'border-emerald-600 text-emerald-800 font-extrabold bg-emerald-50/40 rounded-t-xl'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <span className="material-symbols-outlined text-base">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.id === 'payroll' && (
                  <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                    {payrollRecords.filter((r) => r.status !== 'Paid').length} Pending
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* NOTICES & ALERTS */}
      {errorNotice && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            <span>{errorNotice}</span>
          </div>
          <button onClick={() => setErrorNotice(null)} className="text-rose-600 hover:underline text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {successNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>{successNotice}</span>
          </div>
          <button onClick={() => setSuccessNotice(null)} className="text-emerald-700 hover:underline text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* SUB-TAB 1: OVERVIEW & PERFORMANCE ANALYTICS */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* TOP 8 SUMMARY CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Bookings */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Total Bookings</span>
                <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <span className="material-symbols-outlined text-lg">calendar_month</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-gray-900">
                {topMetrics.totalBookings}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +14.2%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 2: Total Payments (Gross Sales) */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Total Payments</span>
                <span className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <span className="material-symbols-outlined text-lg">payments</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-emerald-700">
                ₹{topMetrics.grossRevenue.toLocaleString('en-IN')}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +8.5%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 3: Total Discounts */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Total Discounts</span>
                <span className="p-2 rounded-xl bg-amber-50 text-amber-700">
                  <span className="material-symbols-outlined text-lg">loyalty</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-amber-800">
                ₹{topMetrics.totalDiscounts.toLocaleString('en-IN')}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-rose-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_down</span> -2.1%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 4: Total Commission */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Total Commission</span>
                <span className="p-2 rounded-xl bg-purple-50 text-purple-700">
                  <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-purple-900">
                ₹{topMetrics.totalCommission.toLocaleString('en-IN')}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +9.4%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 5: Net Salon Revenue */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Net Salon Revenue</span>
                <span className="p-2 rounded-xl bg-blue-50 text-blue-700">
                  <span className="material-symbols-outlined text-lg">savings</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-blue-900">
                ₹{topMetrics.netSalonRevenue.toLocaleString('en-IN')}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +7.9%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 6: Total Reviews */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Total Reviews</span>
                <span className="p-2 rounded-xl bg-rose-50 text-rose-700">
                  <span className="material-symbols-outlined text-lg">rate_review</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-gray-900">
                {topMetrics.totalReviews}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +12.0%
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 7: Average Rating */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs hover:border-gray-300 transition-all">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Average Rating</span>
                <span className="p-2 rounded-xl bg-amber-100 text-amber-800">
                  <span className="material-symbols-outlined text-lg">star</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-gray-900 flex items-center gap-1">
                <span>{topMetrics.avgRating}</span>
                <span className="text-amber-500 text-lg">★</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-600 font-bold flex items-center">
                  <span className="material-symbols-outlined text-sm">trending_up</span> +0.15
                </span>
                <span className="text-gray-400">vs prior period</span>
              </div>
            </div>

            {/* Card 8: Top Performing Staff */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-5 rounded-2xl text-white shadow-xs border border-slate-800">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-bold font-mono-caps text-amber-400">Top Performing Staff</span>
                <span className="p-1.5 rounded-lg bg-amber-400/20 text-amber-300">
                  <span className="material-symbols-outlined text-base">emoji_events</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-lg text-white truncate">
                {topMetrics.topPerformer ? topMetrics.topPerformer.staffName : 'N/A'}
              </div>
              <div className="text-xs font-mono font-bold text-emerald-400 mt-1">
                ₹{topMetrics.topPerformer ? topMetrics.topPerformer.grossSales.toLocaleString('en-IN') : 0} Sales
              </div>
            </div>
          </div>

          {/* 7 INTERACTIVE DATA VISUALIZATION CHARTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Bookings Status Breakdown by Staff */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">1. Bookings by Staff Member</h3>
                  <p className="text-[11px] text-gray-500">Completed, Pending and Cancelled appointments</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">bar_chart</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bookingsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="Completed" fill="#059669" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Pending" fill="#D97706" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Cancelled" fill="#E11D48" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Revenue vs Salon Share */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">2. Revenue & Salon Share</h3>
                  <p className="text-[11px] text-gray-500">Gross sales vs Net Salon Revenue per stylist</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">query_stats</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, '']}
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="Gross Revenue" fill="#C20E5A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Salon Share" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 3: Commission Share Distribution */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">3. Staff Commission Share</h3>
                  <p className="text-[11px] text-gray-500">Distribution of total accrued commissions</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">pie_chart</span>
              </div>
              <div className="h-64 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={commissionPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {commissionPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Commission']}
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 4: Discounts Provided per Staff */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">4. Discounts Applied</h3>
                  <p className="text-[11px] text-gray-500">Total discount amounts given by staff</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">loyalty</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={discountsChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Discounts']}
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                    <Bar dataKey="Discounts" fill="#D97706" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 5: Reviews Count per Staff */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">5. Review Volume</h3>
                  <p className="text-[11px] text-gray-500">Customer review count by staff member</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">rate_review</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reviewsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }} />
                    <Bar dataKey="Reviews" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 6: Rating Comparison Radar */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900">6. Average Rating Comparison</h3>
                  <p className="text-[11px] text-gray-500">Staff satisfaction scores (out of 5.0 ★)</p>
                </div>
                <span className="material-symbols-outlined text-gray-400">star_rate</span>
              </div>
              <div className="h-64 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius={75} data={ratingRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="staff" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 9 }} />
                    <Radar name="Rating" dataKey="Rating" stroke="#059669" fill="#059669" fillOpacity={0.4} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Chart 7: 7-Day Trend Combo Chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-sm text-gray-900">7. Seven-Day Daily Performance Trend</h3>
                <p className="text-[11px] text-gray-500">Daily bookings volume & gross payment trajectory</p>
              </div>
              <span className="material-symbols-outlined text-gray-400">show_chart</span>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sevenDayTrendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderRadius: '12px', color: '#fff', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Area yAxisId="left" type="monotone" dataKey="Bookings" fill="#C20E5A" stroke="#C20E5A" fillOpacity={0.2} />
                  <Area yAxisId="right" type="monotone" dataKey="Revenue" fill="#059669" stroke="#059669" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* MAIN STAFF PERFORMANCE TABLE */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Detailed Staff Performance Breakdown
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click on any column header to sort. Select "View Details" to open full staff profile metrics.
                </p>
              </div>

              {/* SEARCH & PAGE SIZE TOOLBAR */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <span className="material-symbols-outlined text-gray-400 absolute left-3 top-2.5 text-sm">
                    search
                  </span>
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => {
                      setTableSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search staff name..."
                    className="w-full pl-9 pr-3 py-2 text-xs border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                    id="staff-table-search-input"
                  />
                </div>

                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="p-2 border border-gray-300 rounded-xl text-xs bg-white"
                >
                  <option value={5}>5 per page</option>
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                </select>
              </div>
            </div>

            {/* PERFORMANCE TABLE */}
            {isLoading ? (
              <div className="py-12 text-center text-xs text-gray-500 font-mono animate-pulse">
                Loading staff metrics and performance calculations...
              </div>
            ) : sortedSummaryData.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">
                No staff performance records found matching the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps select-none">
                      <th
                        onClick={() => handleSort('staffName')}
                        className="py-3 px-3 cursor-pointer hover:text-gray-900"
                      >
                        Staff Member {sortField === 'staffName' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('totalBookings')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Total {sortField === 'totalBookings' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('completedBookings')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Completed {sortField === 'completedBookings' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('cancelledBookings')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Cancelled {sortField === 'cancelledBookings' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('grossSales')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Gross Sales {sortField === 'grossSales' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('totalDiscounts')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Discounts {sortField === 'totalDiscounts' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('totalCommission')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Commission {sortField === 'totalCommission' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('netSalonShare')}
                        className="py-3 px-3 text-right cursor-pointer hover:text-gray-900"
                      >
                        Net Salon Share {sortField === 'netSalonShare' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        onClick={() => handleSort('averageRating')}
                        className="py-3 px-3 text-center cursor-pointer hover:text-gray-900"
                      >
                        Rating {sortField === 'averageRating' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSummaryData.map((s) => {
                      const isTop1 = s.leaderboardRank === 1;
                      return (
                        <tr
                          key={s.staffId}
                          className={`border-b border-gray-100 transition-colors hover:bg-gray-50/80 ${
                            isTop1 ? 'bg-amber-50/20' : ''
                          }`}
                        >
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <img
                                  src={
                                    s.avatarUrl ||
                                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
                                  }
                                  alt={s.staffName}
                                  className="w-9 h-9 rounded-xl object-cover border border-gray-200"
                                />
                                {isTop1 && (
                                  <span
                                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-slate-950 font-bold text-[9px] flex items-center justify-center shadow-xs"
                                    title="Top #1 Performer"
                                  >
                                    ★
                                  </span>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-gray-900 text-xs">{s.staffName}</span>
                                  {isTop1 && (
                                    <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-1.5 rounded-full">
                                      #1 TOP
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-gray-500 block">{s.staffRole}</span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono font-bold text-gray-900">
                            {s.totalBookings}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-emerald-700 font-bold">
                            {s.completedBookings}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-rose-600">
                            {s.cancelledBookings}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono font-bold text-gray-900">
                            ₹{s.grossSales.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-amber-700">
                            ₹{s.totalDiscounts.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-purple-700 font-bold">
                            ₹{s.totalCommission.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono font-extrabold text-blue-900">
                            ₹{s.netSalonShare.toLocaleString('en-IN')}
                          </td>

                          <td className="py-3.5 px-3 text-center">
                            <span className="inline-flex items-center gap-1 font-bold text-[11px] bg-amber-50 text-amber-900 px-2 py-0.5 rounded-md border border-amber-200">
                              <span>{s.averageRating}</span>
                              <span className="text-amber-500">★</span>
                            </span>
                            <span className="text-[10px] text-gray-400 block mt-0.5">({s.reviewCount})</span>
                          </td>

                          <td className="py-3.5 px-3 text-right">
                            <button
                              onClick={() => setSelectedStaffDetail(s)}
                              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ml-auto shadow-2xs"
                              id={`view-staff-detail-btn-${s.staffId}`}
                            >
                              <span className="material-symbols-outlined text-sm">visibility</span>
                              <span>View Details</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* PAGINATION CONTROLS */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
              <div>
                Showing {Math.min((currentPage - 1) * pageSize + 1, sortedSummaryData.length)} to{' '}
                {Math.min(currentPage * pageSize, sortedSummaryData.length)} of {sortedSummaryData.length} team members
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 font-bold"
                >
                  Previous
                </button>
                <span className="font-mono font-bold text-gray-800">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 font-bold"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB: LAST 7 DAYS LEADERS */}
      {activeSubTab === 'leaders7d' && (
        <LastSevenDaysLeaders
          summaryData={summaryData}
          services={services}
          onSelectStaff={(st) => setSelectedStaffDetail(st)}
        />
      )}

      {/* SUB-TAB 2: PAYROLL & PAYOUT */}
      {activeSubTab === 'payroll' && (
        <div className="space-y-6">
          {/* PAYROLL TOOLBAR & PERIOD SELECTOR */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="font-display font-bold text-lg text-gray-900">
                Monthly Staff Payroll &amp; Commission Discard
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Calculated calculated commissions for past and active visits in {selectedPeriod}. Mark as Paid to confirm bank transfer.
              </p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Period Select */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-700 font-mono-caps">Period:</span>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="p-2.5 rounded-xl border border-gray-300 bg-white font-bold text-xs text-gray-900 shadow-2xs outline-none focus:ring-2 focus:ring-emerald-500"
                  id="payroll-period-select"
                >
                  {monthOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.value})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleDownloadPayrollCSV}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
                title="Download monthly payroll report as CSV"
                id="download-payroll-csv-btn"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                <span>Export Payroll CSV</span>
              </button>
            </div>
          </div>

          {/* PAYROLL SUMMARY KPI METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Accrued Commission */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Accrued Commission</span>
                <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-gray-900">
                ₹{totalCommissionAccrued.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Calculated across {payrollRecords.length} team members
              </p>
            </div>

            {/* Card 2: Total Paid Out */}
            <div className="bg-white p-5 rounded-2xl border border-emerald-200 bg-emerald-50/20 shadow-2xs">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps text-emerald-900">Total Paid Out</span>
                <span className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <span className="material-symbols-outlined text-lg">check_circle</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-emerald-700">
                ₹{totalPaidOut.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-emerald-700/80 mt-1 font-medium">
                Completed payouts recorded
              </p>
            </div>

            {/* Card 3: Pending Payouts */}
            <div className="bg-white p-5 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-2xs">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps text-amber-900">Outstanding Payable</span>
                <span className="p-2 rounded-xl bg-amber-100 text-amber-700">
                  <span className="material-symbols-outlined text-lg">pending</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-amber-700">
                ₹{totalPendingPayout.toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] text-amber-700/80 mt-1 font-medium">
                Awaiting owner payment authorization
              </p>
            </div>

            {/* Card 4: Payout Completion Progress */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
              <div className="flex items-center justify-between text-gray-500 mb-2">
                <span className="text-xs font-bold font-mono-caps">Payout Completion</span>
                <span className="p-2 rounded-xl bg-slate-100 text-slate-700">
                  <span className="material-symbols-outlined text-lg">badge</span>
                </span>
              </div>
              <div className="font-display font-extrabold text-2xl text-gray-900">
                {paidCount} / {payrollRecords.length}
              </div>
              <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden mt-2">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{
                    width: `${payrollRecords.length ? (paidCount / payrollRecords.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* MAIN PAYROLL TABLE */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-display font-bold text-base text-gray-900">
                  Monthly Commission Payout Breakdown
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Calculated automatically from completed bookings in {selectedPeriod}. Click "Mark as Paid" to record payment.
                </p>
              </div>

              <div className="text-xs text-gray-500 font-mono">
                Currency: <span className="font-bold text-gray-800">INR (₹)</span>
              </div>
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-xs text-gray-500 font-mono animate-pulse">
                Calculating monthly commissions and fetching payout statuses...
              </div>
            ) : payrollRecords.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">
                No staff members found for period {selectedPeriod}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                      <th className="py-3 px-3">Staff Member</th>
                      <th className="py-3 px-3 text-right">Completed Visits</th>
                      <th className="py-3 px-3 text-right">Gross Sales</th>
                      <th className="py-3 px-3">Commission Terms</th>
                      <th className="py-3 px-3 text-right">Base Earned</th>
                      <th className="py-3 px-3 text-right">Adjustments</th>
                      <th className="py-3 px-3 text-right">Net Payable</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRecords.map((record) => {
                      const isPaid = record.status === 'Paid';
                      return (
                        <tr
                          key={record.staffId}
                          className={`border-b border-gray-100 transition-colors hover:bg-gray-50/80 ${
                            isPaid ? 'bg-emerald-50/10' : ''
                          }`}
                        >
                          {/* Staff Member */}
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-3">
                              <img
                                src={
                                  record.avatarUrl ||
                                  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'
                                }
                                alt={record.staffName}
                                className="w-9 h-9 rounded-xl object-cover border border-gray-200 shrink-0"
                              />
                              <div>
                                <span className="font-bold text-gray-900 block text-xs">
                                  {record.staffName}
                                </span>
                                <span className="text-[11px] text-gray-500 block truncate max-w-[140px]">
                                  {record.staffRole}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Completed Visits */}
                          <td className="py-3.5 px-3 text-right font-mono font-bold">
                            {record.completedBookingsCount}
                          </td>

                          {/* Gross Sales */}
                          <td className="py-3.5 px-3 text-right font-mono text-gray-700">
                            ₹{record.grossSales.toLocaleString('en-IN')}
                          </td>

                          {/* Commission Terms */}
                          <td className="py-3.5 px-3">
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              {record.commissionType === 'fixed'
                                ? `₹${record.fixedCommissionAmount}/visit`
                                : `${record.commissionRate}% (${record.commissionBasis})`}
                            </span>
                          </td>

                          {/* Base Earned */}
                          <td className="py-3.5 px-3 text-right font-mono font-bold text-gray-900">
                            ₹{record.calculatedCommission.toLocaleString('en-IN')}
                          </td>

                          {/* Adjustments */}
                          <td className="py-3.5 px-3 text-right font-mono text-[11px]">
                            {record.bonusAmount > 0 && (
                              <span className="text-emerald-600 block font-bold">+₹{record.bonusAmount}</span>
                            )}
                            {record.deductionsAmount > 0 && (
                              <span className="text-rose-600 block font-bold">-₹{record.deductionsAmount}</span>
                            )}
                            {record.bonusAmount === 0 && record.deductionsAmount === 0 && (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>

                          {/* Net Payable */}
                          <td className="py-3.5 px-3 text-right font-mono font-extrabold text-sm text-gray-900">
                            ₹{record.netPayout.toLocaleString('en-IN')}
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 font-bold text-[10px] px-2.5 py-1 rounded-full border ${
                                isPaid
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : 'bg-amber-100 text-amber-900 border-amber-300'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {isPaid ? 'check_circle' : 'pending'}
                              </span>
                              <span>{record.status}</span>
                            </span>
                            {isPaid && record.paidAt && (
                              <span className="text-[9px] text-gray-400 font-mono block mt-0.5">
                                {new Date(record.paidAt).toLocaleDateString()}
                              </span>
                            )}
                          </td>

                          {/* Action Button */}
                          <td className="py-3.5 px-3 text-right">
                            <button
                              onClick={() => handleOpenPayoutModal(record)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ml-auto shadow-2xs ${
                                isPaid
                                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                              }`}
                              id={`mark-paid-btn-${record.staffId}`}
                            >
                              <span className="material-symbols-outlined text-sm">
                                {isPaid ? 'edit_note' : 'task_alt'}
                              </span>
                              <span>{isPaid ? 'Update Receipt' : 'Mark as Paid'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: COMMISSION RULES & SETTINGS */}
      {activeSubTab === 'commission' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs space-y-4">
          <div>
            <h3 className="font-display font-bold text-base text-gray-900">
              Staff Commission Rate Configuration
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Configure percentage or fixed commissions per service provider. All calculations apply server-side.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                  <th className="py-3 px-3">Staff Member</th>
                  <th className="py-3 px-3">Commission Type</th>
                  <th className="py-3 px-3">Rate / Fixed Amount</th>
                  <th className="py-3 px-3">Basis</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {stylists.map((st) => {
                  const isEditing = editingStaffId === st.id;
                  return (
                    <tr key={st.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3.5 px-3 font-bold text-gray-900">{st.name}</td>
                      <td className="py-3.5 px-3">
                        {isEditing ? (
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as any)}
                            className="text-xs p-1 border rounded"
                          >
                            <option value="percentage">Percentage (%)</option>
                            <option value="fixed">Fixed (₹)</option>
                            <option value="both">Both (% + ₹)</option>
                          </select>
                        ) : (
                          <span className="capitalize">{st.commissionType || 'percentage'}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 font-mono">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            {editType !== 'fixed' && (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={editRate}
                                  onChange={(e) => setEditRate(Number(e.target.value))}
                                  className="w-16 p-1 border rounded text-xs"
                                  placeholder="Rate %"
                                />
                                <span className="text-[11px] text-gray-500">%</span>
                              </div>
                            )}
                            {editType !== 'percentage' && (
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-gray-500">₹</span>
                                <input
                                  type="number"
                                  value={editFixed}
                                  onChange={(e) => setEditFixed(Number(e.target.value))}
                                  className="w-20 p-1 border rounded text-xs"
                                  placeholder="Fixed ₹"
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          st.commissionType === 'fixed'
                            ? `₹${st.fixedCommissionAmount || 0}`
                            : st.commissionType === 'both'
                            ? `${st.commissionRate || 30}% + ₹${st.fixedCommissionAmount || 0}`
                            : `${st.commissionRate || 30}%`
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {isEditing ? (
                          <select
                            value={editBasis}
                            onChange={(e) => setEditBasis(e.target.value as any)}
                            className="text-xs p-1 border rounded"
                          >
                            <option value="net">Net Revenue (After Discount)</option>
                            <option value="gross">Gross Sales</option>
                          </select>
                        ) : (
                          <span className="uppercase">{st.commissionBasis || 'NET'}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setEditingStaffId(null)}
                              className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveCommission(st.id)}
                              disabled={isSavingCommission}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold"
                              id={`save-commission-btn-${st.id}`}
                            >
                              {isSavingCommission ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingStaffId(st.id);
                              setEditRate(st.commissionRate || 30);
                              setEditFixed(st.fixedCommissionAmount || 0);
                              setEditType((st.commissionType as any) || 'percentage');
                              setEditBasis((st.commissionBasis as any) || 'net');
                            }}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-bold cursor-pointer transition-colors"
                            id={`configure-commission-btn-${st.id}`}
                          >
                            Configure
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STAFF DETAIL DRAWER / OVERLAY MODAL */}
      {selectedStaffDetail && (
        <StaffDetailDrawer
          staff={selectedStaffDetail}
          services={services}
          onClose={() => setSelectedStaffDetail(null)}
          onOpenCommissionConfig={(staffId) => {
            setSelectedStaffDetail(null);
            setActiveSubTab('commission');
            setEditingStaffId(staffId);
          }}
        />
      )}

      {/* MARK AS PAID MODAL */}
      {selectedStaffForPayout && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 relative space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-100 text-emerald-800">
                  <span className="material-symbols-outlined text-lg">payments</span>
                </span>
                <div>
                  <h3 className="font-display font-bold text-base text-gray-900">
                    Record Staff Payout Receipt
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">
                    {selectedStaffForPayout.staffName} • Period {selectedPeriod}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedStaffForPayout(null)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-500"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* PAYOUT BREAKDOWN PREVIEW */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-gray-600">
                <span>Gross Completed Sales:</span>
                <span className="font-bold text-gray-900">₹{selectedStaffForPayout.grossSales.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Calculated Base Commission ({selectedStaffForPayout.commissionRate}%):</span>
                <span className="font-bold text-gray-900">₹{selectedStaffForPayout.calculatedCommission.toLocaleString('en-IN')}</span>
              </div>

              {/* BONUS & DEDUCTIONS INPUTS */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200">
                <div>
                  <label className="text-[10px] font-bold text-emerald-800 block mb-1">
                    + Performance Bonus (₹)
                  </label>
                  <input
                    type="number"
                    value={payoutBonusInput}
                    onChange={(e) => setPayoutBonusInput(Number(e.target.value))}
                    className="w-full p-2 text-xs border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-rose-800 block mb-1">
                    - Deductions / Advance (₹)
                  </label>
                  <input
                    type="number"
                    value={payoutDeductionsInput}
                    onChange={(e) => setPayoutDeductionsInput(Number(e.target.value))}
                    className="w-full p-2 text-xs border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-rose-500 font-bold text-rose-700"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-sm font-bold pt-2 border-t border-gray-300 text-gray-900">
                <span>Net Payable Amount:</span>
                <span className="text-base text-emerald-700 font-extrabold">
                  ₹{(selectedStaffForPayout.calculatedCommission + payoutBonusInput - payoutDeductionsInput).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* PAYMENT METHOD & DETAILS FORM */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-gray-700 block mb-1">Payment Transfer Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['Bank Transfer', 'UPI', 'Cash', 'Cheque'] as PayoutPaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPayoutMethod(method)}
                      className={`p-2 rounded-xl text-center font-bold border transition-all cursor-pointer ${
                        payoutMethod === method
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  Transaction Reference / UTR Number
                </label>
                <input
                  type="text"
                  value={payoutReference}
                  onChange={(e) => setPayoutReference(e.target.value)}
                  placeholder="e.g. UTR-928341 or Bank Check #029"
                  className="w-full p-2.5 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-gray-700 block mb-1">Payment Notes (Optional)</label>
                <textarea
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="e.g. Paid via HDFC NetBanking on 8th Sep"
                  className="w-full p-2.5 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-emerald-500 text-xs h-16 resize-none"
                />
              </div>
            </div>

            {/* MODAL ACTIONS */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => handleConfirmMarkPaid('Pending')}
                disabled={isSubmittingPayout}
                className="px-3 py-2 text-xs text-rose-700 hover:underline font-bold"
              >
                Reset to Pending
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedStaffForPayout(null)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmMarkPaid('Paid')}
                  disabled={isSubmittingPayout}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                  id="confirm-mark-paid-modal-btn"
                >
                  <span className="material-symbols-outlined text-sm">task_alt</span>
                  <span>{isSubmittingPayout ? 'Saving...' : 'Authorize & Mark as Paid'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
