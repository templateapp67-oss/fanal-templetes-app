import React, { useEffect, useState, useMemo } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Ticket,
  User,
} from 'lucide-react';
import {
  fetchMyPartnerReferrals,
  type GrowthPartner,
} from '../lib/growthPartner';

type ReferredSalon = {
  id: string;
  name: string;
  city: string | null;
  owner_name: string | null;
  owner_email: string | null;
  phone: string | null;
  partner_code: string | null;
  status: 'active' | 'completed' | 'onboarding';
  joined_at: string | null;
  created_at: string | null;
  slug: string | null;
};
import { formatPartnerDate } from '../lib/partnerPresentation';

interface PartnerReferralHistoryPageProps {
  partner?: GrowthPartner | null;
  accentHex?: string;
  partnerCode?: string | null;
  referralCode?: string | null;
  onCopyLink?: () => void;
}

export const PartnerReferralHistoryPage: React.FC<PartnerReferralHistoryPageProps> = ({
  partner,
  accentHex = '#C20E5A',
  partnerCode,
  referralCode,
}) => {
  const [salons, setSalons] = useState<ReferredSalon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'onboarding'>('all');
  const [copiedCode, setCopiedCode] = useState(false);

  const activePartnerCode = partnerCode || partner?.partner_code || 'NEX-GP';
  const activeReferralCode = referralCode || partner?.referral_code || 'NEXORA-REF';

  const loadSalons = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use the session-scoped, RLS-backed referral RPC. It returns masked
      // contact data only; never query raw auth/profile details from the page.
      const result = await fetchMyPartnerReferrals({ status: 'all', limit: 100, offset: 0 });
      setSalons(result.rows.map((row) => {
        const joinedAt = row.joined_at || row.referral_clicked_at || null;
        return {
          id: row.referral_id || row.ref,
          name: row.display_name || row.ref,
          city: null,
          owner_name: row.display_name,
          owner_email: row.masked_contact,
          phone: null,
          partner_code: row.referral_code,
          status: row.template_completed_at
            ? 'completed'
            : row.template_started_at
              ? 'active'
              : 'onboarding',
          joined_at: joinedAt,
          created_at: joinedAt,
          slug: null,
        };
      }));
    } catch (err: any) {
      console.error('Error fetching referred salons:', err);
      setError(err?.message || 'Could not load referred salons. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSalons();
  }, []);

  const filteredSalons = useMemo(() => {
    return salons.filter((salon) => {
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && (salon.status === 'active' || salon.status === 'completed')) ||
        (statusFilter === 'onboarding' && salon.status === 'onboarding');

      if (!matchStatus) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        salon.name.toLowerCase().includes(q) ||
        (salon.city && salon.city.toLowerCase().includes(q)) ||
        (salon.owner_name && salon.owner_name.toLowerCase().includes(q)) ||
        (salon.owner_email && salon.owner_email.toLowerCase().includes(q)) ||
        (salon.partner_code && salon.partner_code.toLowerCase().includes(q))
      );
    });
  }, [salons, search, statusFilter]);

  const stats = useMemo(() => {
    const total = salons.length;
    const active = salons.filter((s) => s.status === 'active' || s.status === 'completed').length;
    const onboarding = total - active;
    return { total, active, onboarding };
  }, [salons]);

  const handleCopyPartnerCode = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(activePartnerCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-semibold backdrop-blur-md">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Partner Attribution Tracking</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Referral History</h1>
            <p className="text-sm text-slate-300 max-w-xl">
              Real-time list of all salons and beauty businesses referred to Nexora using your unique Partner Code.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/15 flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Your Partner Code</div>
                <div className="font-mono font-black text-base text-amber-300">{activePartnerCode}</div>
              </div>
              <button
                type="button"
                onClick={handleCopyPartnerCode}
                className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer"
                title="Copy Partner Code"
              >
                {copiedCode ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={loadSalons}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-white text-slate-900 font-bold text-xs hover:bg-slate-100 transition-all cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Referred Salons</span>
            <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900">{stats.total}</div>
          <div className="mt-1 text-xs text-slate-500">Tracked under {activePartnerCode}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Live &amp; Active Salons</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-emerald-600">{stats.active}</div>
          <div className="mt-1 text-xs text-slate-500">Active salon websites</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">In Onboarding</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-amber-600">{stats.onboarding}</div>
          <div className="mt-1 text-xs text-slate-500">Setting up website / services</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by salon name, city, or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start md:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({salons.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-emerald-700'
            }`}
          >
            Live ({stats.active})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('onboarding')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'onboarding'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-amber-700'
            }`}
          >
            In Setup ({stats.onboarding})
          </button>
        </div>
      </div>

      {/* Content Section */}
      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <RefreshCw className="w-8 h-8 animate-spin text-pink-600 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Loading your referred salons…</p>
          <p className="text-xs text-slate-400 mt-1">Checking partner code attribution records</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-3xl p-8 text-center">
          <p className="text-sm font-bold text-rose-800">{error}</p>
          <button
            type="button"
            onClick={loadSalons}
            className="mt-4 px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 cursor-pointer transition-colors"
          >
            Retry Connection
          </button>
        </div>
      ) : filteredSalons.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-400">
            <Building2 className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {search ? 'No salons match your search' : 'No salons referred yet'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-6">
            {search
              ? 'Try changing your search terms or filter.'
              : `Share your Partner Code (${activePartnerCode}) or referral link with salon owners to start earning rewards when they launch.`}
          </p>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  <th scope="col" className="py-4 px-6">Salon / Business</th>
                  <th scope="col" className="py-4 px-6">Owner Details</th>
                  <th scope="col" className="py-4 px-6">Location</th>
                  <th scope="col" className="py-4 px-6">Code Used</th>
                  <th scope="col" className="py-4 px-6">Status</th>
                  <th scope="col" className="py-4 px-6">Referred On</th>
                  <th scope="col" className="py-4 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSalons.map((salon) => (
                  <tr key={salon.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-4 px-6 font-medium text-slate-900">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-50 to-pink-100 text-pink-700 flex items-center justify-center font-bold text-sm">
                          {salon.name ? salon.name.charAt(0).toUpperCase() : 'S'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{salon.name}</div>
                          {salon.slug && (
                            <div className="text-xs text-slate-400 font-mono">/{salon.slug}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <div className="text-xs space-y-0.5">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{salon.owner_name || 'Salon Owner'}</span>
                        </div>
                        {salon.owner_email && (
                          <div className="text-slate-500 font-mono">{salon.owner_email}</div>
                        )}
                        {salon.phone && (
                          <div className="text-slate-500 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{salon.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <div className="text-xs flex items-center gap-1.5 text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{salon.city || 'Jaipur'}</span>
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 font-mono text-xs font-bold border border-amber-200/60">
                        <Ticket className="w-3 h-3 text-amber-600" />
                        {salon.partner_code || activePartnerCode}
                      </span>
                    </td>

                    <td className="py-4 px-6">
                      {salon.status === 'active' || salon.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Live &amp; Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-bold text-xs border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          In Setup
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-6 text-xs text-slate-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatPartnerDate(salon.joined_at || salon.created_at)}</span>
                      </div>
                    </td>

                    <td className="py-4 px-6 text-right">
                      {salon.slug ? (
                        <a
                          href={`/?site=${encodeURIComponent(salon.slug)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-bold text-pink-700 hover:text-pink-900 bg-pink-50 hover:bg-pink-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <span>View</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Pending Launch</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
