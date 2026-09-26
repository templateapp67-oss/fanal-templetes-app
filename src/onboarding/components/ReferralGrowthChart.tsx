import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, Users, Calendar, ArrowUpRight } from 'lucide-react';

export interface DailyGrowthPoint {
  date: string;
  signups: number;
}

export const ReferralGrowthChart: React.FC<{
  referralCode?: string | null;
  data?: DailyGrowthPoint[];
}> = ({ referralCode, data }) => {
  const chartData = data ?? [];

  const total30DaySignups = chartData.reduce((acc, item) => acc + item.signups, 0);
  const peakDailySignups = Math.max(...chartData.map((item) => item.signups), 0);
  const avgDailySignups = (total30DaySignups / chartData.length).toFixed(1);

  return (
    <div className="w-full bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5">
      {/* Chart Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#C20E5A]" />
            Referral Growth (Last 30 Days)
          </h3>
          <p className="text-xs text-slate-500">
            Attributed sign-ups for code:{' '}
            <code className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
              {referralCode || '—'}
            </code>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>Last 30 Days</span>
          </div>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">30-Day Total</div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 flex items-center gap-1">
            {total30DaySignups}
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Peak / Day</div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
            {peakDailySignups} <span className="text-xs font-semibold text-slate-500">users</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Avg / Day</div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
            {avgDailySignups}
          </div>
        </div>
      </div>

      {/* Bar Chart Container */}
      <div className="h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 5, left: -25, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              interval={4}
              tick={{ fill: '#64748B', fontSize: 11 }}
              angle={-25}
              textAnchor="end"
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                borderRadius: '12px',
                color: '#FFF',
                border: 'none',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                fontSize: '12px',
              }}
              formatter={(value: any) => [`${value} Sign-ups`, 'Attribution']}
              labelStyle={{ color: '#94A3B8', fontWeight: 'bold' }}
            />
            <Bar dataKey="signups" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.signups === peakDailySignups ? '#C20E5A' : '#3B82F6'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
