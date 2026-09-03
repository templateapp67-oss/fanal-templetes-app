import React, { useState } from 'react';
import { SalonProfile, SalonService, Appointment, ClientRecord } from '../types';
import { ACCENT_PALETTES, AccentPaletteKey } from '../themeAccents';

interface SaaSDashboardProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  appointments: Appointment[];
  setAppointments: React.Dispatch<React.SetStateAction<Appointment[]>>;
  clients: ClientRecord[];
}

type TabType = 'overview' | 'calendar' | 'services' | 'clients' | 'marketing' | 'website';

export const SaaSDashboard: React.FC<SaaSDashboardProps> = ({
  profile,
  setProfile,
  services,
  appointments,
  setAppointments,
  clients,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [marketingSms, setMarketingSms] = useState<string>('');
  const [marketingLoading, setMarketingLoading] = useState<boolean>(false);
  const [smsSentNotice, setSmsSentNotice] = useState<string>('');

  const totalRevenue = appointments.reduce((sum, a) => sum + a.servicePrice, 0) + 142500;
  const totalBookings = appointments.length + 68;

  const handleGenerateSms = () => {
    setMarketingLoading(true);
    setTimeout(() => {
      setMarketingSms(
        `Namaste [Client Name]! We miss your glow at ${profile.businessName}. Book your favorite service this week and receive an exclusive complimentary botanical scalp or hand spa therapy. Claim your slot: https://${profile.subdomain}.nexora.in/book`
      );
      setMarketingLoading(false);
    }, 1000);
  };

  const updateAppointmentStatus = (id: string, status: 'completed' | 'cancelled') => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleSendCampaign = () => {
    setSmsSentNotice('Campaign dispatched successfully via WhatsApp & SMS to 42 clients across India!');
    setTimeout(() => {
      setSmsSentNotice('');
    }, 4000);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 flex flex-col items-center bg-[#f9f9ff] text-[#151c27]">
      <div className="max-w-[1240px] w-full px-4 sm:px-6">
        
        {/* DASHBOARD HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#b0004a] text-white flex items-center justify-center font-bold text-2xl shadow-md shadow-[#b0004a]/20">
              <span className="material-symbols-outlined text-3xl">storefront</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold">{profile.businessName}</h1>
                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-mono-caps font-bold px-2 py-0.5 rounded-full">
                  LIVE SALON SITE
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                https://{profile.subdomain}.nexora.in • {profile.city}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-gray-500 font-mono-caps">Monthly Earnings (₹ INR)</div>
              <div className="font-display font-extrabold text-2xl text-[#b0004a]">
                ₹{totalRevenue.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex border-b border-gray-200 mb-6 gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: 'dashboard' },
            { id: 'calendar', label: 'Appointments', icon: 'calendar_month' },
            { id: 'services', label: 'Services Menu', icon: 'spa' },
            { id: 'clients', label: 'Clients CRM', icon: 'group' },
            { id: 'marketing', label: 'AI Marketing', icon: 'auto_awesome' },
            { id: 'website', label: 'Website & Theme', icon: 'palette' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-3 text-xs font-bold font-mono-caps border-b-2 flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#b0004a] text-[#b0004a]'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <span className="material-symbols-outlined text-lg">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* TAB CONTENT: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Total Revenue (₹)</span>
                  <span className="material-symbols-outlined text-[#b0004a]">payments</span>
                </div>
                <div className="font-display font-extrabold text-2xl">₹{totalRevenue.toLocaleString('en-IN')}</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+24% vs last month</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Appointments</span>
                  <span className="material-symbols-outlined text-[#b0004a]">calendar_month</span>
                </div>
                <div className="font-display font-extrabold text-2xl">{totalBookings}</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">96% Fill rate</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Active Clients</span>
                  <span className="material-symbols-outlined text-[#b0004a]">person_add</span>
                </div>
                <div className="font-display font-extrabold text-2xl">218</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+18 Indian clients this week</div>
              </div>

              <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center text-gray-500 mb-2">
                  <span className="text-xs font-bold font-mono-caps">Repeat Visit Rate</span>
                  <span className="material-symbols-outlined text-[#b0004a]">repeat</span>
                </div>
                <div className="font-display font-extrabold text-2xl">86%</div>
                <div className="text-[11px] text-emerald-600 font-bold mt-1">+8% automated retention</div>
              </div>
            </div>

            {/* Upcoming Appointments Table */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-display font-bold text-lg">Confirmed Indian Client Appointments</h2>
                <span className="text-xs text-slate-500 font-mono">Currency: INR (₹)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                      <th className="py-3 px-2">Client</th>
                      <th className="py-3 px-2">Service</th>
                      <th className="py-3 px-2">Stylist</th>
                      <th className="py-3 px-2">Date & Time</th>
                      <th className="py-3 px-2">Payment (INR)</th>
                      <th className="py-3 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((apt) => (
                      <tr key={apt.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 font-bold">{apt.clientName}</td>
                        <td className="py-3 px-2">{apt.serviceName} (₹{apt.servicePrice.toLocaleString('en-IN')})</td>
                        <td className="py-3 px-2">{apt.stylistName}</td>
                        <td className="py-3 px-2 font-mono">{apt.date} at {apt.time}</td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            apt.paymentStatus === 'paid_full' 
                              ? 'bg-emerald-100 text-emerald-700' 
                              : apt.paymentStatus === 'paid_deposit'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                          }`}>
                            {apt.paymentStatus.replace('_', ' ').toUpperCase()} (₹{apt.amountPaid})
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {apt.status === 'confirmed' ? (
                            <button
                              onClick={() => updateAppointmentStatus(apt.id, 'completed')}
                              className="text-xs bg-emerald-600 text-white font-bold px-2.5 py-1 rounded hover:bg-emerald-700 cursor-pointer"
                            >
                              Complete
                            </button>
                          ) : (
                            <span className="text-slate-400 font-bold">Done</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB CONTENT: APPOINTMENTS */}
        {activeTab === 'calendar' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
            <h2 className="font-display font-bold text-xl mb-4">Calendar & Appointment Schedule</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {appointments.map((apt) => (
                <div key={apt.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-sm">{apt.clientName}</div>
                    <div className="text-xs text-gray-500">{apt.serviceName} with {apt.stylistName}</div>
                    <div className="text-xs font-mono font-bold text-[#b0004a] mt-1">{apt.date} @ {apt.time}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-base">₹{apt.servicePrice.toLocaleString('en-IN')}</div>
                    <div className="text-[10px] text-gray-400 font-mono">Paid Advance: ₹{apt.amountPaid}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB CONTENT: SERVICES */}
        {activeTab === 'services' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-display font-bold text-xl">Manage Services & INR (₹) Pricing</h2>
                <p className="text-xs text-slate-500">Live treatments reflected on client website booking system</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {services.map((srv) => (
                <div key={srv.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-sm">{srv.name}</div>
                    <div className="text-xs text-gray-500">{srv.description}</div>
                    <div className="text-xs text-gray-400 mt-1">{srv.durationMinutes} mins | {srv.category}</div>
                  </div>
                  <div className="font-display font-bold text-lg text-[#b0004a]">
                    ₹{srv.price.toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB CONTENT: CLIENTS */}
        {activeTab === 'clients' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-4">
            <h2 className="font-display font-bold text-xl">Client CRM & Visit History (India)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {clients.map((cli) => (
                <div key={cli.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm text-gray-900">{cli.name}</span>
                    <span className="font-mono text-emerald-700 font-bold">₹{cli.totalSpent.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="text-gray-500">{cli.phone} | {cli.email}</div>
                  <div className="text-gray-600 italic bg-white p-2 rounded border border-gray-200">{cli.notes}</div>
                  <div className="flex justify-between text-[11px] text-gray-400 pt-1">
                    <span>Visits: {cli.totalVisits}</span>
                    <span>Stylist: {cli.favoriteStylist}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB CONTENT: WEBSITE & THEME */}
        {activeTab === 'website' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
            <div>
              <div className="flex items-center gap-2 text-[#b0004a]">
                <span className="material-symbols-outlined text-2xl">palette</span>
                <h2 className="font-display font-bold text-xl text-gray-900">
                  Website Theme & Data Configuration
                </h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Customize your live salon website without complex drag-and-drop builders. Select an accent palette and update essential business details.
              </p>
            </div>

            {/* Accent Palette Selector */}
            <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block">
                  Primary Theme Accent Palette
                </label>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Changes primary accents across your website (buttons, highlights, badges, review stars) without breaking grid layouts or typography scaling.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.values(ACCENT_PALETTES).map((pal) => {
                  const isCurrent = (profile.themeAccentKey || 'crimson') === pal.key;
                  return (
                    <button
                      key={pal.key}
                      onClick={() => setProfile((prev) => ({ ...prev, themeAccentKey: pal.key }))}
                      className={`p-3 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                        isCurrent
                          ? 'border-[#b0004a] bg-white ring-2 ring-[#b0004a]/20 shadow-xs'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full border border-black/10 shrink-0 shadow-xs"
                        style={{ backgroundColor: pal.primaryHex }}
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">{pal.name}</div>
                        <div className="text-[10px] text-gray-400 truncate">{pal.categoryHint}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Core Salon Information Form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Salon Brand Name
                </label>
                <input
                  type="text"
                  value={profile.businessName}
                  onChange={(e) => setProfile((prev) => ({ ...prev, businessName: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Tagline / Catchphrase
                </label>
                <input
                  type="text"
                  value={profile.tagline}
                  onChange={(e) => setProfile((prev) => ({ ...prev, tagline: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Phone (Direct Click-to-Call)
                </label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  WhatsApp Number
                </label>
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => setProfile((prev) => ({ ...prev, whatsapp: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Salon Address
                </label>
                <input
                  type="text"
                  value={profile.address}
                  onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  City & State
                </label>
                <input
                  type="text"
                  value={profile.city}
                  onChange={(e) => setProfile((prev) => ({ ...prev, city: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                  Postal PIN Code
                </label>
                <input
                  type="text"
                  value={profile.postalCode}
                  onChange={(e) => setProfile((prev) => ({ ...prev, postalCode: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-gray-300 text-xs font-mono focus:ring-2 focus:ring-[#b0004a] outline-none"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
              <span className="font-medium">
                ✓ Changes update automatically in live preview and across all 14 category templates.
              </span>
              <span className="font-mono text-[11px] font-bold bg-emerald-100 px-2 py-0.5 rounded">
                Live Synced
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
