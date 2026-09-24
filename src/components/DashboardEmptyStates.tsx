import React, { useState } from 'react';
import { SALON_IMAGES } from '../assets/images';
import { Appointment, ClientRecord } from '../types';
import { copyToClipboard } from '../lib/clipboard';

interface EmptyAppointmentsProps {
  filterStatus?: string;
  onAddSampleAppointment?: () => void;
  onOpenCalendar?: () => void;
  onShareSite?: () => void;
  primaryAccentColor?: string;
}

export const EmptyAppointmentsPlaceholder: React.FC<EmptyAppointmentsProps> = ({
  filterStatus = 'all',
  onAddSampleAppointment,
  onOpenCalendar,
  onShareSite,
  primaryAccentColor = '#0f172a',
}) => {
  const [copied, setCopied] = useState(false);

  if (filterStatus !== 'all') {
    return (
      <div className="py-12 px-6 text-center bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 my-4 flex flex-col items-center justify-center gap-2">
        <div className="w-12 h-12 rounded-2xl bg-slate-200/60 flex items-center justify-center text-slate-500 mb-1">
          <span className="material-symbols-outlined text-2xl">event_busy</span>
        </div>
        <h4 className="font-bold text-slate-800 text-sm">
          No {filterStatus.replace('_', ' ')} appointments
        </h4>
        <p className="text-xs text-slate-500 max-w-sm">
          There are currently no appointments in the "{filterStatus}" status list. Select "All Records" to view all appointments.
        </p>
      </div>
    );
  }

  const handleShareClick = async () => {
    if (onShareSite) {
      onShareSite();
      return;
    }
    const ok = await copyToClipboard(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="my-4 bg-gradient-to-b from-slate-50/80 to-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col lg:flex-row items-center gap-8 text-slate-900">
      {/* Illustration Image Placeholder */}
      <div className="w-full lg:w-1/2 max-w-md shrink-0 relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-amber-200/50 via-rose-200/40 to-purple-200/50 rounded-3xl blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
        <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 bg-white shadow-sm aspect-4/3">
          <img
            src={SALON_IMAGES.noAppointments}
            alt="Ready for Day 1 Bookings - Salon Reception"
            className="w-full h-full object-cover transform group-hover:scale-102 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full border border-slate-200/80 text-[10px] font-bold text-slate-800 flex items-center gap-1.5 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Booking System Online</span>
          </div>
        </div>
      </div>

      {/* Text & Guidance Content */}
      <div className="w-full lg:w-1/2 flex flex-col gap-4 text-left">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/80 text-amber-900 text-[11px] font-bold border border-amber-200 mb-2">
            <span className="material-symbols-outlined text-xs text-amber-700">stars</span>
            <span>Day 1 Ready</span>
          </span>
          <h3 className="font-display font-bold text-2xl text-slate-900 tracking-tight">
            Your Appointment Book is Open!
          </h3>
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
            When clients reserve services on your public salon page, their bookings, selected services, and payment details will appear here in real-time.
          </p>
        </div>

        {/* Setup Checkmarks */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs py-1">
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="material-symbols-outlined text-emerald-600 text-sm shrink-0 mt-0.5">check_circle</span>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">Real-Time Sync</p>
              <p className="text-[10px] text-slate-500">Live calendar updates</p>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="material-symbols-outlined text-purple-600 text-sm shrink-0 mt-0.5">mark_chat_read</span>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">SMS Confirmations</p>
              <p className="text-[10px] text-slate-500">Automated client alerts</p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          {onAddSampleAppointment && (
            <button
              type="button"
              onClick={onAddSampleAppointment}
              className="px-4 py-2.5 rounded-xl text-white font-bold text-xs shadow-sm hover:opacity-95 transition-opacity flex items-center gap-2 cursor-pointer"
              style={{ backgroundColor: primaryAccentColor }}
              id="empty-state-add-sample-appointment-btn"
            >
              <span className="material-symbols-outlined text-sm">add_circle</span>
              <span>Add Sample Booking</span>
            </button>
          )}

          {onOpenCalendar && (
            <button
              type="button"
              onClick={onOpenCalendar}
              className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              id="empty-state-open-calendar-btn"
            >
              <span className="material-symbols-outlined text-sm">calendar_month</span>
              <span>Calendar View</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleShareShareOrCopyClick}
            className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            id="empty-state-share-link-btn"
          >
            <span className="material-symbols-outlined text-sm text-amber-600">
              {copied ? 'check' : 'share'}
            </span>
            <span>{copied ? 'Link Copied!' : 'Share Booking Site'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  function handleShareShareOrCopyClick() {
    handleShareClick();
  }
};

interface EmptyClientsProps {
  onAddSampleClients?: () => void;
  onShareSite?: () => void;
  primaryAccentColor?: string;
}

export const EmptyClientsPlaceholder: React.FC<EmptyClientsProps> = ({
  onAddSampleClients,
  onShareSite,
  primaryAccentColor = '#0f172a',
}) => {
  const [copied, setCopied] = useState(false);

  const handleShareClick = async () => {
    if (onShareSite) {
      onShareSite();
      return;
    }
    const ok = await copyToClipboard(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="bg-gradient-to-b from-purple-50/40 via-white to-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col lg:flex-row items-center gap-8 text-slate-900 my-2">
      {/* Illustration Image Placeholder */}
      <div className="w-full lg:w-1/2 max-w-md shrink-0 relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-purple-200/50 via-indigo-200/40 to-pink-200/50 rounded-3xl blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
        <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 bg-white shadow-sm aspect-4/3">
          <img
            src={SALON_IMAGES.noClients}
            alt="Welcome to Your Client Directory"
            className="w-full h-full object-cover transform group-hover:scale-102 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
          <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full border border-slate-200/80 text-[10px] font-bold text-slate-800 flex items-center gap-1.5 shadow-xs">
            <span className="material-symbols-outlined text-xs text-purple-600">groups</span>
            <span>Client CRM & Loyalty Engine Active</span>
          </div>
        </div>
      </div>

      {/* Text & Guidance Content */}
      <div className="w-full lg:w-1/2 flex flex-col gap-4 text-left">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100/80 text-purple-900 text-[11px] font-bold border border-purple-200 mb-2">
            <span className="material-symbols-outlined text-xs text-purple-700">group_add</span>
            <span>Client Hub</span>
          </span>
          <h3 className="font-display font-bold text-2xl text-slate-900 tracking-tight">
            Build Your Loyalty-Ready Directory
          </h3>
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
            Your customer CRM is empty. As new clients book online or visit your salon, their contact information, lifetime spending, loyalty points, and visit history will be tracked here automatically.
          </p>
        </div>

        {/* Feature Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs py-1">
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="material-symbols-outlined text-amber-500 text-sm shrink-0 mt-0.5">military_tech</span>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">Auto Tier Tracking</p>
              <p className="text-[10px] text-slate-500">Bronze, Silver & Gold rewards</p>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="material-symbols-outlined text-purple-600 text-sm shrink-0 mt-0.5">psychology</span>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">AI Re-Engagement</p>
              <p className="text-[10px] text-slate-500">Automated lapsed client SMS</p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          {onAddSampleClients && (
            <button
              type="button"
              onClick={onAddSampleClients}
              className="px-4 py-2.5 rounded-xl text-white font-bold text-xs shadow-sm hover:opacity-95 transition-opacity flex items-center gap-2 cursor-pointer"
              style={{ backgroundColor: primaryAccentColor }}
              id="empty-state-add-sample-clients-btn"
            >
              <span className="material-symbols-outlined text-sm">person_add</span>
              <span>Load Sample Client Directory</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleShareClick}
            className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            id="empty-state-share-site-clients-btn"
          >
            <span className="material-symbols-outlined text-sm text-purple-600">
              {copied ? 'check' : 'share'}
            </span>
            <span>{copied ? 'Link Copied!' : 'Share Salon Page'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
