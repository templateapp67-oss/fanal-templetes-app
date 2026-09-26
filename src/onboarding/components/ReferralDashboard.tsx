import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, CheckCircle2, TrendingUp, Award, Copy, Check, Share2, Filter } from 'lucide-react';
import { partnerReferralShareLink } from '../../lib/partnerReferralLink';

export interface ReferralDataPoint {
  period: string;
  signups: number;
  conversions: number;
}

export interface ReferralRecord {
  id: string;
  code: string;
  userEmail: string;
  partnerName: string;
  status: 'verified' | 'pending' | 'completed';
  date: string;
}

export const ReferralDashboard: React.FC<{
  code?: string;
  partnerName?: string;
  chartData?: ReferralDataPoint[];
  records?: ReferralRecord[];
}> = ({
  code = '',
  partnerName = 'Growth Partner',
  chartData = [],
  records = [],
}) => {
  const [timeframe, setTimeframe] = useState<'monthly' | 'weekly'>('monthly');
  const [copied, setCopied] = useState(false);

  const totalSignups = chartData.reduce((acc, curr) => acc + curr.signups, 0);
  const totalConversions = chartData.reduce((acc, curr) => acc + curr.conversions, 0);
  const conversionRate = totalSignups > 0 ? ((totalConversions / totalSignups) * 100).toFixed(1) : '0';

  const shareUrl = partnerReferralShareLink(
    code,
    typeof window !== 'undefined' ? window.location.origin : undefined
  );

  const handleCopyLink = () => {
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 p-4 sm:p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-[#C20E5A]" />
            Referral & Attribution Dashboard
          </h2>
          <p className="text-sm text-slate-500">
            Partner: <span className="font-semibold text-slate-800">{partnerName}</span> • Code: <code className="bg-slate-100 px-2 py-0.5 rounded font-mono font-bold text-slate-900">{code}</code>
          </p>
        </div>

        {/* Copy Share Link */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold text-sm transition-all cursor-pointer shadow-sm active:scale-95"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Link Copied!' : 'Copy Referral Link'}</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total Sign-ups</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">{totalSignups}</div>
          <div className="text-xs text-slate-500 mt-1">Referred registrations</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Conversions</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">{totalConversions}</div>
          <div className="text-xs text-slate-500 mt-1">Active site setups</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Conversion Rate</span>
            <TrendingUp className="w-4 h-4 text-[#C20E5A]" />
          </div>
          <div className="text-2xl font-black text-slate-900">{conversionRate}%</div>
          <div className="text-xs text-slate-500 mt-1">Attribution success</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Partner Rank</span>
            <Award className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">Tier 1</div>
          <div className="text-xs text-slate-500 mt-1">Top growth partner</div>
        </div>
      </div>

      {/* Bar Chart Section */}
      <div className="p-5 rounded-2xl bg-slate-50/50 border border-slate-200 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Referral Attribution Performance</h3>
            <p className="text-xs text-slate-500">Sign-ups vs successfully verified conversions over time</p>
          </div>
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setTimeframe('monthly')}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${timeframe === 'monthly' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setTimeframe('weekly')}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${timeframe === 'weekly' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Weekly
            </button>
          </div>
        </div>

        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', color: '#FFF', border: 'none' }}
                itemStyle={{ color: '#F8FAFC' }}
              />
              <Legend wrapperStyle={{ paddingTop: '10px' }} />
              <Bar dataKey="signups" name="Sign-ups" fill="#3B82F6" radius={[6, 6, 0, 0]} barSize={24} />
              <Bar dataKey="conversions" name="Conversions" fill="#C20E5A" radius={[6, 6, 0, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Referral Activity List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Recent Referral Attributions</h3>
          <span className="text-xs font-semibold text-slate-500">{records.length} records</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-100 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Referral Code</th>
                <th className="py-3 px-4">Partner</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white font-medium text-slate-800">
              {records.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-900">{rec.userEmail}</td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-700">{rec.code}</td>
                  <td className="py-3 px-4 text-slate-600">{rec.partnerName}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        rec.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : rec.status === 'verified'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {rec.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-slate-500 font-mono text-xs">{rec.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
