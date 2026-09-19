import React from 'react';

/** `React.FC` on purpose: the portal's keyed lists pass `key` to this card. */
export const PartnerStatCard: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <p className="text-3xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-600">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
};

