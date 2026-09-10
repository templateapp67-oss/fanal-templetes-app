import React, { useState, useMemo, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Search,
  Filter,
  Plus,
  Phone,
  MessageSquare,
  CheckCircle2,
  XCircle,
  UserX,
  Sparkles,
  CalendarDays,
  CalendarRange,
  Layers,
  RotateCcw,
  Check,
  X,
  IndianRupee,
  Scissors,
} from 'lucide-react';
import { Appointment, AppointmentStatus, SalonService, Stylist } from '../types';
import { BookingStatusBadge } from './BookingStatusBadge';

interface AppointmentsCalendarViewProps {
  appointments: Appointment[];
  onCreate: (appointment: Appointment) => Promise<void>;
  onUpdate: (id: string, status: string, date?: string, time?: string) => Promise<void>;
  saving: boolean;
  setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>>;
  services: SalonService[];
  stylists: Stylist[];
  primaryAccentColor?: string;
}

type CalendarViewMode = 'day-grouped' | 'month' | 'week' | 'day';

// Helper to format ISO date string (YYYY-MM-DD) nicely
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const AppointmentsCalendarView: React.FC<AppointmentsCalendarViewProps> = ({
  appointments,
  setAppointments,
  onCreate, onUpdate, saving,
  services,
  stylists,
  primaryAccentColor = '#C20E5A',
}) => {
  // Navigation & View state
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day-grouped');
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    // If appointments exist, center near the latest or today
    const today = new Date();
    return today;
  });
  const [selectedDayStr, setSelectedDayStr] = useState<string>(getTodayStr());

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stylistFilter, setStylistFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modal states
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [addModalDefaultDate, setAddModalDefaultDate] = useState<string>(getTodayStr());

  const bookingReference = useRef(crypto.randomUUID());
  // New Appointment Form state
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newServiceId, setNewServiceId] = useState(services[0]?.id || '');
  const [newStylistId, setNewStylistId] = useState(stylists[0]?.id || '');
  const [newDate, setNewDate] = useState(getTodayStr());
  const [newTime, setNewTime] = useState('11:00');
  const [newPaymentStatus, setNewPaymentStatus] = useState<'pay_at_salon' | 'paid_deposit' | 'paid_full'>('pay_at_salon');
  const [formError, setFormError] = useState('');

  // Editing state for activeAppointment
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editStylistId, setEditStylistId] = useState('');

  const todayStr = useMemo(() => getTodayStr(), []);

  // Filtered appointments
  const filteredAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = apt.clientName.toLowerCase().includes(q);
        const matchPhone = apt.clientPhone?.toLowerCase().includes(q);
        const matchService = apt.serviceName.toLowerCase().includes(q);
        const matchStylist = apt.stylistName.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchService && !matchStylist) return false;
      }
      // Stylist filter
      if (stylistFilter !== 'all' && apt.stylistId !== stylistFilter) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'all' && apt.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [appointments, searchQuery, stylistFilter, statusFilter]);

  // Appointments grouped by Day (sorted chronologically)
  const groupedByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    filteredAppointments.forEach((apt) => {
      const d = apt.date || 'Unscheduled';
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(apt);
    });

    // Sort dates
    const sortedDates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return sortedDates.map((dateKey) => {
      const items = map.get(dateKey)!;
      // Sort appointments within the day by time
      items.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      const dayTotalRevenue = items.filter(item => item.status === 'completed').reduce((sum, item) => sum + (item.servicePrice || 0), 0);
      const confirmedCount = items.filter((i) => i.status === 'confirmed').length;
      const completedCount = items.filter((i) => i.status === 'completed').length;
      return {
        dateStr: dateKey,
        items,
        totalRevenue: dayTotalRevenue,
        totalCount: items.length,
        confirmedCount,
        completedCount,
      };
    });
  }, [filteredAppointments]);

  // Current overview metrics for filtered appointments
  const metrics = useMemo(() => {
    const total = filteredAppointments.length;
    const confirmed = filteredAppointments.filter((a) => a.status === 'confirmed').length;
    const completed = filteredAppointments.filter((a) => a.status === 'completed').length;
    const pending = filteredAppointments.filter((a) => a.status === 'pending').length;
    const revenue = filteredAppointments.filter(a => a.status === 'completed').reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    return { total, confirmed, completed, pending, revenue };
  }, [filteredAppointments]);

  // Navigation handlers
  const handlePrev = () => {
    const newD = new Date(currentDate);
    if (viewMode === 'month') {
      newD.setMonth(newD.getMonth() - 1);
    } else if (viewMode === 'week') {
      newD.setDate(newD.getDate() - 7);
    } else {
      newD.setDate(newD.getDate() - 1);
    }
    setCurrentDate(newD);
  };

  const handleNext = () => {
    const newD = new Date(currentDate);
    if (viewMode === 'month') {
      newD.setMonth(newD.getMonth() + 1);
    } else if (viewMode === 'week') {
      newD.setDate(newD.getDate() + 7);
    } else {
      newD.setDate(newD.getDate() + 1);
    }
    setCurrentDate(newD);
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDayStr(getTodayStr());
  };

  // Status updates
  const handleUpdateStatus = async (id: string, newStatus: AppointmentStatus) => {
    try { setFormError(''); await onUpdate(id, newStatus); setActiveAppointment(null); }
    catch (error: any) { setFormError(error.message); }
  };

  const handleSaveReschedule = async () => {
    if (!activeAppointment) return;
    try { setFormError(''); await onUpdate(activeAppointment.id, 'reschedule_proposed', editDate, editTime); setActiveAppointment(null); }
    catch (error: any) { setFormError(error.message); }
  };

  // Open active appointment modal
  const openAppointmentDetails = (apt: Appointment) => {
    setActiveAppointment(apt);
    setEditDate(apt.date);
    setEditTime(apt.time);
    setEditStylistId(apt.stylistId);
  };

  // Open Add Modal
  const openAddModal = (defaultDate?: string) => {
    bookingReference.current = crypto.randomUUID();
    setNewClientName('');
    setNewClientPhone('');
    setNewClientEmail('');
    setNewServiceId(services[0]?.id || '');
    setNewStylistId(stylists[0]?.id || '');
    setNewDate(defaultDate || selectedDayStr || getTodayStr());
    setNewTime('11:00');
    setNewPaymentStatus('pay_at_salon');
    setFormError('');
    setIsAddModalOpen(true);
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) {
      setFormError('Please provide client name');
      return;
    }
    if (!newClientPhone.trim()) {
      setFormError('Please provide client phone number');
      return;
    }

    const matchedService = services.find((s) => s.id === newServiceId) || services[0];
    const matchedStylist = stylists.find((s) => s.id === newStylistId) || stylists[0];

    const newApt: Appointment = {
      id: bookingReference.current,
      clientName: newClientName.trim(),
      clientPhone: newClientPhone.trim(),
      clientEmail: newClientEmail.trim(),
      serviceId: matchedService ? matchedService.id : 'custom',
      serviceName: matchedService ? matchedService.name : 'Custom Service',
      servicePrice: matchedService ? matchedService.price : 500,
      stylistId: matchedStylist ? matchedStylist.id : 'st-default',
      stylistName: matchedStylist ? matchedStylist.name : 'Salon Staff',
      date: newDate,
      time: newTime,
      status: 'confirmed',
      paymentStatus: newPaymentStatus,
      amountPaid: newPaymentStatus === 'paid_full' ? (matchedService?.price || 0) : newPaymentStatus === 'paid_deposit' ? Math.round((matchedService?.price || 0) * 0.2) : 0,
      createdAt: new Date().toISOString(),
    };

    try { setFormError(''); await onCreate(newApt); setIsAddModalOpen(false); }
    catch (error: any) { setFormError(error.message); }
  };

  // Current view period title
  const currentPeriodTitle = useMemo(() => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } else if (viewMode === 'week') {
      const startOfWeek = new Date(currentDate);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - day);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      return `${startOfWeek.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${endOfWeek.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      return currentDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
  }, [currentDate, viewMode]);

  // Month Grid Calculation
  const monthGridData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells: { dateStr: string; dayNum: number; isCurrentMonth: boolean; appointments: Appointment[] }[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const m = month === 0 ? 12 : month;
      const y = month === 0 ? year - 1 : year;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayApts = filteredAppointments.filter((a) => a.date === dateStr);
      cells.push({ dateStr, dayNum, isCurrentMonth: false, appointments: dayApts });
    }

    // Current month days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayApts = filteredAppointments.filter((a) => a.date === dateStr);
      cells.push({ dateStr, dayNum, isCurrentMonth: true, appointments: dayApts });
    }

    // Next month padding to fill complete grid of 35 or 42
    const totalSlots = cells.length <= 35 ? 35 : 42;
    const remaining = totalSlots - cells.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const m = month + 2 > 12 ? 1 : month + 2;
      const y = month + 2 > 12 ? year + 1 : year;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dayApts = filteredAppointments.filter((a) => a.date === dateStr);
      cells.push({ dateStr, dayNum, isCurrentMonth: false, appointments: dayApts });
    }

    return cells;
  }, [currentDate, filteredAppointments]);

  // Week Grid Calculation
  const weekDays = useMemo(() => {
    const startOfWeek = new Date(currentDate);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - day);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayNum = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayNum}`;
      const dayApts = filteredAppointments.filter((a) => a.date === dateStr);
      dayApts.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      days.push({
        date: d,
        dateStr,
        weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        dayNumber: d.getDate(),
        isToday: dateStr === todayStr,
        appointments: dayApts,
      });
    }
    return days;
  }, [currentDate, filteredAppointments, todayStr]);

  // Selected Day appointments (for day view)
  const selectedDayAppointments = useMemo(() => {
    const dateStr = selectedDayStr;
    const list = filteredAppointments.filter((a) => a.date === dateStr);
    list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return list;
  }, [filteredAppointments, selectedDayStr]);

  return (
    <div className="flex flex-col gap-6" id="appointments-calendar-container">
      {/* TOP HEADER: TITLE & SCHEDULE METRICS */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2.5">
              <div 
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-xs"
                style={{ backgroundColor: primaryAccentColor }}
              >
                <CalendarIcon className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display font-extrabold text-xl text-slate-900">
                  Salon Appointments Calendar
                </h1>
                <p className="text-xs text-slate-500">
                  Visual daily schedule, stylist assignments, and client bookings
                </p>
              </div>
            </div>
          </div>

          {/* Top Actions: + Schedule Appointment & Reset */}
          <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
            <button
              onClick={() => openAddModal()}
              className="px-4 py-2.5 rounded-xl font-bold text-xs text-white shadow-xs hover:opacity-95 transition-all flex items-center gap-2 cursor-pointer"
              style={{ backgroundColor: primaryAccentColor }}
              id="calendar-add-appointment-btn"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Appointment</span>
            </button>
          </div>
        </div>

        {/* Quick KPI Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Booked</p>
              <p className="text-lg font-extrabold text-slate-900">{metrics.total}</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Confirmed</p>
              <p className="text-lg font-extrabold text-emerald-700">{metrics.confirmed}</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Completed</p>
              <p className="text-lg font-extrabold text-purple-700">{metrics.completed}</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <IndianRupee className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Completed Booking Value</p>
              <p className="text-lg font-extrabold text-amber-900">₹{metrics.revenue.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* CONTROLS BAR: VIEW SELECTOR, DATE NAVIGATION, SEARCH & FILTERS */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          {/* Navigation: Prev, Today, Next & Date Display */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                onClick={handlePrev}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-white hover:shadow-xs transition-all cursor-pointer"
                title="Previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleToday}
                className="px-3 py-1 text-xs font-bold text-slate-700 hover:bg-white hover:shadow-xs rounded-lg transition-all cursor-pointer"
              >
                Today
              </button>
              <button
                onClick={handleNext}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-white hover:shadow-xs transition-all cursor-pointer"
                title="Next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <h2 className="font-display font-extrabold text-base sm:text-lg text-slate-900 pl-2">
              {currentPeriodTitle}
            </h2>
          </div>

          {/* View Modes Tabs */}
          <div className="flex items-center rounded-2xl bg-slate-100 p-1 border border-slate-200/80 w-full md:w-auto overflow-x-auto">
            <button
              onClick={() => setViewMode('day-grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'day-grouped'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Grouped by Day</span>
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'month'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Month</span>
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'week'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span>Week</span>
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'day'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Day Timeline</span>
            </button>
          </div>
        </div>

        {/* Filter bar: Search, Stylist & Status dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by client, service or phone..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 shrink-0">Stylist:</span>
            <select
              value={stylistFilter}
              onChange={(e) => setStylistFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="all">All Stylists ({stylists.length})</option>
              {stylists.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.role})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 shrink-0">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="all">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="no_show">No-Show</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* VIEW 1: GROUPED BY DAY (AGENDA VIEW) */}
      {viewMode === 'day-grouped' && (
        <div className="flex flex-col gap-6" id="calendar-day-grouped-view">
          {groupedByDay.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center">
              <CalendarIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-base text-slate-800">No appointments found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No appointments matched your search and filter criteria. You can clear filters or schedule a new appointment.
              </p>
              <button
                onClick={() => openAddModal()}
                className="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                style={{ backgroundColor: primaryAccentColor }}
              >
                <Plus className="w-4 h-4" />
                <span>Schedule New Appointment</span>
              </button>
            </div>
          ) : (
            groupedByDay.map((group) => {
              const isToday = group.dateStr === todayStr;
              return (
                <div
                  key={group.dateStr}
                  className={`bg-white border rounded-3xl shadow-xs overflow-hidden transition-all ${
                    isToday ? 'border-pink-300 ring-2 ring-pink-100' : 'border-slate-200'
                  }`}
                >
                  {/* Day Header */}
                  <div className={`p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b ${
                    isToday ? 'bg-pink-50/60 border-pink-100' : 'bg-slate-50/80 border-slate-100'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-bold shrink-0 ${
                        isToday ? 'bg-[#C20E5A] text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-800'
                      }`}>
                        <span className="text-[10px] uppercase font-mono leading-none">
                          {new Date(group.dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
                        </span>
                        <span className="text-base font-extrabold leading-none mt-0.5">
                          {group.dateStr.split('-')[2]}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-display font-bold text-base text-slate-900">
                            {formatDisplayDate(group.dateStr)}
                          </h3>
                          {isToday && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#C20E5A] text-white">
                              Today
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 font-medium">
                          <span>{group.totalCount} {group.totalCount === 1 ? 'Appointment' : 'Appointments'}</span>
                          <span>•</span>
                          <span className="font-semibold text-slate-800">
                            Completed Value: ₹{group.totalRevenue.toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                        {group.confirmedCount} Confirmed
                      </span>
                      {group.completedCount > 0 && (
                        <span className="text-xs font-bold text-purple-700 bg-purple-100 px-2.5 py-1 rounded-full">
                          {group.completedCount} Done
                        </span>
                      )}
                      <button
                        onClick={() => openAddModal(group.dateStr)}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        title="Add appointment for this day"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Add</span>
                      </button>
                    </div>
                  </div>

                  {/* Appointments in this Day */}
                  <div className="divide-y divide-slate-100">
                    {group.items.map((apt) => (
                      <div
                        key={apt.id}
                        className="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                      >
                        {/* Time & Client Info */}
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          {/* Time Chip */}
                          <div className="flex flex-col items-center justify-center w-18 py-2 rounded-xl bg-slate-100 border border-slate-200/70 shrink-0 text-slate-800">
                            <Clock className="w-3.5 h-3.5 text-slate-500 mb-0.5" />
                            <span className="font-mono font-extrabold text-xs">{apt.time}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-slate-900 truncate">
                                {apt.clientName}
                              </span>
                              <BookingStatusBadge status={apt.status} compact />
                            </div>

                            {/* Service and Price */}
                            <p className="text-xs text-slate-600 mt-1 font-medium flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-800">{apt.serviceName}</span>
                              <span className="text-slate-400">•</span>
                              <span className="font-extrabold text-[#C20E5A]">
                                ₹{apt.servicePrice.toLocaleString('en-IN')}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span className="text-[11px] text-slate-500">
                                Stylist: <strong className="text-slate-700">{apt.stylistName}</strong>
                              </span>
                            </p>

                            {/* Phone & quick communication */}
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                              <span className="font-mono">{apt.clientPhone}</span>
                              {apt.clientPhone && (
                                <a
                                  href={`https://wa.me/${apt.clientPhone.replace(/[^0-9]/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1 font-bold text-[11px]"
                                  title="Send WhatsApp message"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>WhatsApp</span>
                                </a>
                              )}
                              {apt.clientPhone && (
                                <a
                                  href={`tel:${apt.clientPhone}`}
                                  className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 font-bold text-[11px]"
                                  title="Direct Call"
                                >
                                  <Phone className="w-3 h-3" />
                                  <span>Call</span>
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions & Status Changer */}
                        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                          {apt.status === 'confirmed' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(apt.id, 'completed')}
                                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Mark as successfully completed"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Complete</span>
                              </button>
                              <button
                                onClick={() => handleUpdateStatus(apt.id, 'no_show')}
                                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer"
                                title="Client did not show up"
                              >
                                No-Show
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => openAppointmentDetails(apt)}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                          >
                            Details & Reschedule
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW 2: MONTH VIEW GRID */}
      {viewMode === 'month' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs overflow-hidden" id="calendar-month-grid-view">
          {/* Days of week header */}
          <div className="grid grid-cols-7 text-center font-bold text-xs text-slate-500 pb-3 border-b border-slate-100 font-mono-caps">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName) => (
              <div key={dayName} className="py-1">
                {dayName}
              </div>
            ))}
          </div>

          {/* Month Cells */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 pt-2">
            {monthGridData.map((cell) => {
              const isToday = cell.dateStr === todayStr;
              const hasAppointments = cell.appointments.length > 0;
              const isSelected = cell.dateStr === selectedDayStr;

              return (
                <div
                  key={cell.dateStr}
                  onClick={() => {
                    setSelectedDayStr(cell.dateStr);
                    if (hasAppointments) {
                      // switch to day-grouped view or timeline
                    }
                  }}
                  className={`min-h-[100px] sm:min-h-[110px] p-2 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? 'border-[#C20E5A] ring-2 ring-pink-100 bg-pink-50/20'
                      : isToday
                      ? 'border-pink-300 bg-pink-50/30'
                      : cell.isCurrentMonth
                      ? 'border-slate-100 bg-white hover:border-slate-300'
                      : 'border-slate-50 bg-slate-50/50 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                        isToday
                          ? 'bg-[#C20E5A] text-white'
                          : cell.isCurrentMonth
                          ? 'text-slate-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    {hasAppointments && (
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-slate-900 text-white font-mono">
                        {cell.appointments.length}
                      </span>
                    )}
                  </div>

                  {/* Appointment Chips in Month Cell */}
                  <div className="flex-1 flex flex-col gap-1 mt-1 overflow-hidden">
                    {cell.appointments.slice(0, 2).map((apt) => (
                      <div
                        key={apt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openAppointmentDetails(apt);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded-lg truncate font-semibold transition-all ${
                          apt.status === 'completed'
                            ? 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                            : apt.status === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                        title={`${apt.time} - ${apt.clientName} (${apt.serviceName})`}
                      >
                        <span className="font-mono font-bold mr-1">{apt.time}</span>
                        {apt.clientName}
                      </div>
                    ))}

                    {cell.appointments.length > 2 && (
                      <span className="text-[9px] font-bold text-slate-500 pl-1">
                        +{cell.appointments.length - 2} more
                      </span>
                    )}
                  </div>

                  {/* Day total */}
                  {hasAppointments && (
                    <div className="text-[9px] font-extrabold text-slate-500 text-right pt-0.5 border-t border-slate-100">
                      ₹{cell.appointments.reduce((s, a) => s + a.servicePrice, 0).toLocaleString('en-IN')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs overflow-x-auto" id="calendar-week-view">
          <div className="grid grid-cols-7 gap-3 min-w-[800px]">
            {weekDays.map((dayObj) => (
              <div
                key={dayObj.dateStr}
                className={`rounded-2xl border p-3 flex flex-col gap-3 min-h-[350px] ${
                  dayObj.isToday ? 'border-[#C20E5A] bg-pink-50/20' : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                {/* Day Header */}
                <div className="text-center pb-2 border-b border-slate-200">
                  <span className="text-[11px] font-mono font-bold text-slate-500 uppercase block">
                    {dayObj.weekday}
                  </span>
                  <span className={`text-lg font-extrabold inline-block w-8 h-8 rounded-full leading-8 mt-1 ${
                    dayObj.isToday ? 'bg-[#C20E5A] text-white' : 'text-slate-800'
                  }`}>
                    {dayObj.dayNumber}
                  </span>
                  <div className="text-[10px] font-bold text-slate-500 mt-1">
                    {dayObj.appointments.length} {dayObj.appointments.length === 1 ? 'apt' : 'apts'}
                  </div>
                </div>

                {/* Day's appointments list */}
                <div className="flex flex-col gap-2 flex-1">
                  {dayObj.appointments.map((apt) => (
                    <div
                      key={apt.id}
                      onClick={() => openAppointmentDetails(apt)}
                      className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-all cursor-pointer flex flex-col gap-1 text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-bold text-slate-800">{apt.time}</span>
                        <span className={`w-2 h-2 rounded-full ${
                          apt.status === 'completed'
                            ? 'bg-purple-500'
                            : apt.status === 'confirmed'
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`} />
                      </div>
                      <p className="font-bold text-slate-900 truncate">{apt.clientName}</p>
                      <p className="text-[11px] text-slate-600 truncate">{apt.serviceName}</p>
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 pt-1 border-t border-slate-100">
                        <span>{apt.stylistName}</span>
                        <span className="text-[#C20E5A]">₹{apt.servicePrice}</span>
                      </div>
                    </div>
                  ))}

                  {dayObj.appointments.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-[11px] text-slate-400 italic">
                      No bookings
                    </div>
                  )}
                </div>

                <button
                  onClick={() => openAddModal(dayObj.dateStr)}
                  className="w-full py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 text-slate-600 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Book</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 4: DAY TIMELINE VIEW */}
      {viewMode === 'day' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs" id="calendar-day-timeline-view">
          {/* Day Selector */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-slate-100 mb-6">
            <div>
              <h3 className="font-display font-extrabold text-lg text-slate-900">
                Timeline for {formatDisplayDate(selectedDayStr)}
              </h3>
              <p className="text-xs text-slate-500">
                {selectedDayAppointments.length} bookings scheduled on this date
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDayStr}
                onChange={(e) => setSelectedDayStr(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              />
              <button
                onClick={() => openAddModal(selectedDayStr)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-white flex items-center gap-1 cursor-pointer"
                style={{ backgroundColor: primaryAccentColor }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Slot</span>
              </button>
            </div>
          </div>

          {/* Timeline Slots */}
          <div className="flex flex-col divide-y divide-slate-100">
            {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'].map((hourSlot) => {
              const hourPrefix = hourSlot.split(':')[0];
              const slotAppointments = selectedDayAppointments.filter((a) => {
                const aHour = (a.time || '').split(':')[0];
                return aHour === hourPrefix;
              });

              return (
                <div key={hourSlot} className="py-3.5 flex items-start gap-4">
                  <div className="w-16 shrink-0 text-xs font-mono font-extrabold text-slate-500 pt-1">
                    {hourSlot}
                  </div>

                  <div className="flex-1 flex flex-col sm:flex-row gap-3">
                    {slotAppointments.length > 0 ? (
                      slotAppointments.map((apt) => (
                        <div
                          key={apt.id}
                          onClick={() => openAppointmentDetails(apt)}
                          className="flex-1 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-slate-900">{apt.clientName}</span>
                            <BookingStatusBadge status={apt.status} compact />
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">
                            {apt.serviceName} • <strong className="text-[#C20E5A]">₹{apt.servicePrice}</strong>
                          </p>
                          <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-200">
                            <span>Stylist: <strong>{apt.stylistName}</strong></span>
                            <span className="font-mono text-[11px]">{apt.clientPhone}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 py-2 text-xs text-slate-300 italic">
                        Available slot
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {formError && <p role="alert" className="p-3 bg-rose-50 text-rose-700">{formError}</p>}
      {saving && <p role="status">Saving appointment…</p>}
      {/* APPOINTMENT DETAILS & RESCHEDULE MODAL */}
      {activeAppointment && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div 
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  <CalendarIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Appointment Details
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">ID: {activeAppointment.id}</span>
                </div>
              </div>
              <button
                onClick={() => setActiveAppointment(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 py-4 text-xs">
              {/* Client Info Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Client</span>
                    <h4 className="font-bold text-sm text-slate-900">{activeAppointment.clientName}</h4>
                  </div>
                  <BookingStatusBadge status={activeAppointment.status} />
                </div>

                <div className="flex items-center gap-4 text-slate-600 pt-1">
                  <span>Phone: <strong className="text-slate-800">{activeAppointment.clientPhone}</strong></span>
                  {activeAppointment.clientEmail && (
                    <span>Email: <strong className="text-slate-800">{activeAppointment.clientEmail}</strong></span>
                  )}
                </div>

                {activeAppointment.clientPhone && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                    <a
                      href={`https://wa.me/${activeAppointment.clientPhone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp Notification</span>
                    </a>
                    <a
                      href={`tel:${activeAppointment.clientPhone}`}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Client</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Service & Pricing Details */}
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Service Booked</span>
                  <p className="font-bold text-slate-900 text-sm">{activeAppointment.serviceName}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Price</span>
                  <p className="font-extrabold text-[#C20E5A] text-sm">₹{activeAppointment.servicePrice.toLocaleString('en-IN')}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Payment Status</span>
                  <p className="font-semibold text-slate-800 uppercase">{activeAppointment.paymentStatus.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount Paid</span>
                  <p className="font-semibold text-slate-800">₹{activeAppointment.amountPaid}</p>
                </div>
              </div>

              {formError && <p role="alert" className="text-rose-700">{formError}</p>}
              {/* Reschedule Date, Time & Stylist */}
              <div className="p-4 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Propose a new date (awaits acceptance)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Stylist</label>
                    <select
                      disabled
                      value={editStylistId}
                      onChange={(e) => setEditStylistId(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    >
                      {stylists.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    disabled={saving}
                    onClick={handleSaveReschedule}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors"
                  >
                    Propose Reschedule
                  </button>
                </div>
              </div>

              {/* Status Update Quick Buttons */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Change Status</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleUpdateStatus(activeAppointment.id, 'confirmed')}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                      activeAppointment.status === 'confirmed'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Confirmed
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(activeAppointment.id, 'completed')}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                      activeAppointment.status === 'completed'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Completed
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(activeAppointment.id, 'no_show')}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                      activeAppointment.status === 'no_show'
                        ? 'bg-orange-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    No-Show
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(activeAppointment.id, 'cancelled')}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                      activeAppointment.status === 'cancelled'
                        ? 'bg-rose-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Cancelled
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setActiveAppointment(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD APPOINTMENT MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div 
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Schedule New Appointment
                  </h3>
                  <p className="text-xs text-slate-500">Direct booking into salon schedule</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-3.5 py-4 text-xs">
              {formError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Client Full Name *</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. Kavita Sharma"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-300 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">WhatsApp / Phone Number *</label>
                <input
                  type="tel"
                  required
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-300 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Client Email (Optional)</label>
                <input
                  type="email"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-300 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Service *</label>
                <select
                  value={newServiceId}
                  onChange={(e) => setNewServiceId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                >
                  {services.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name} — ₹{svc.price} ({svc.durationMinutes} mins)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Assign Stylist *</label>
                <select
                  value={newStylistId}
                  onChange={(e) => setNewStylistId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                >
                  {stylists.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} ({st.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Time *</label>
                  <input
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Status</label>
                <select
                  value={newPaymentStatus}
                  onChange={(e) => setNewPaymentStatus(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                >
                  <option value="pay_at_salon">Pay at Salon (Pending)</option>
                  <option disabled value="paid_deposit">Paid Deposit (20% Advance)</option>
                  <option disabled value="paid_full">Paid in Full</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  type="submit"
                  className="px-4 py-2 rounded-xl text-white font-bold text-xs shadow-xs hover:opacity-95 transition-all"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  Schedule Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
