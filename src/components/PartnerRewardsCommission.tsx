import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Gift, IndianRupee, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import partnerMilestonesImage from '../assets/partner-milestones.png';
import partnerRulesImage from '../assets/nexora-partner-rules-revenue.jpg';

type RewardMilestone = {
  id: string; code: string; name: string; required_qualifying_shops: number;
  claim_unlock_verified_shops: number; maximum_value_paise: number;
  eligible: boolean; plus_one_complete: boolean;
  claim: { id: string; claim_number: string; status: string; reason?: string | null; created_at: string } | null;
};
type RewardDashboard = {
  verified_shops: number; qualifying_shops: number; cycles_running: number; rejected_shops: number;
  current_milestone: number; next_milestone: number | null; remaining_qualifying_shops: number;
  rules: { daily_qr_paise: number; company_commission_rate_bps: number;
    daily_company_commission_paise: number; growth_partner_share_of_company_bps: number;
    daily_growth_partner_commission_paise: number; consecutive_days: number;
    processing_day_from: number; processing_day_to: number };
  milestones: RewardMilestone[];
};
type OnboardingRewardRow = {
  id: string; shop_attribution_id: string; salon_id: string; shop_name: string;
  qualification_start_date: string; qualification_end_date: string;
  qualifying_qr_transaction_paise: number; company_commission_paise: number;
  onboarding_reward_paise: number; status: 'earned' | 'approved' | 'paid' | 'held' | 'revoked';
  earned_at: string; status_reason?: string | null;
};
type OnboardingRewardDashboard = {
  currency: string; programme_type: string; is_main_commission: false;
  is_recurring: false; has_upper_cap: false; company_commission_rate_bps: number;
  reward_share_of_company_bps: number; qualification_days: number;
  minimums: { daily_qr_transaction_paise: number; cycle_qr_transaction_paise: number;
    cycle_company_commission_paise: number; cycle_onboarding_reward_paise: number };
  totals: { qualifying_shops: number; qualifying_qr_transaction_paise: number;
    company_commission_paise: number; onboarding_reward_paise: number; paid_reward_paise: number };
  rewards: OnboardingRewardRow[];
};

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format((Number(paise) || 0) / 100);

const CAREER_MILESTONES = [
  ['25 Shops', 'Official Nexora T-Shirt', 'Branded NEXORA SALONOS Logo • 240 GSM Organic Cotton'],
  ['50 Shops', 'Samsung Tablet', 'Samsung Galaxy Tab A9+ 5G + 128GB + Stylus'],
  ['100 Shops', 'Branded HP Laptop', 'HP OmniBook Ultra / ProBook AI Laptop'],
  ['250 Shops', 'Electric Scooter', 'Flagship Smart Electric Scooter — Ather 450X / Ola S1 Pro'],
  ['500 Shops', 'Latest iPhone', 'Apple iPhone 16 Pro 256GB Titanium Edition'],
  ['750 Shops', 'Royal Enfield 350 CC', 'Royal Enfield Classic 350 CC Chrome & Stealth Black'],
  ['1000+ Shops', 'District Partner SUV Car', 'Mahindra XUV700 AX7 / Hyundai Creta'],
] as const;

function Loading({ label }: { label: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">{label}</div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center">
    <AlertCircle className="mx-auto h-8 w-8 text-rose-600" />
    <p className="mt-3 text-sm font-bold text-rose-900">{message}</p>
    <button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white">
      <RefreshCw className="h-4 w-4" />Retry
    </button>
  </div>;
}
function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
  </div>;
}

export function PartnerRewardsPage() {
  const [data, setData] = useState<RewardDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data: value, error: rpcError } = await supabase.rpc('get_my_partner_reward_dashboard');
    if (rpcError) setError('Reward progress अभी load नहीं हो सका। कृपया दोबारा कोशिश करें।');
    else setData(value as RewardDashboard);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <Loading label="Reward progress loading…" />;
  if (error && !data) return <ErrorState message={error} retry={() => void load()} />;
  if (!data) return null;
  const target = data.next_milestone ?? 1000;
  const progress = Math.min(100, Math.round((data.qualifying_shops / Math.max(target, 1)) * 100));
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#8b0a46] via-[#c20e5a] to-[#ed176f] p-6 text-white shadow-xl sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-pink-100">Premium Reward Programme</p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">Shops onboard karein, premium rewards paayen</h1>
          <p className="mt-2 max-w-2xl text-sm text-pink-50">हर qualifying shop पर minimum ₹1,000 genuine daily QR transaction, 10% company commission और 15 consecutive qualifying days जरूरी हैं।</p>
        </div><Gift className="h-12 w-12 text-pink-100" />
      </div>
      <div className="mt-6"><div className="flex justify-between text-xs font-bold"><span>Next milestone: {target} shops</span><span>{progress}%</span></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white" style={{ width: progress+'%' }} /></div>
        <p className="mt-2 text-xs text-pink-100">{data.remaining_qualifying_shops} qualifying shops remaining</p>
      </div>
    </section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Verified shops" value={data.verified_shops} /><Stat label="Qualifying shops" value={data.qualifying_shops} />
      <Stat label="15-day cycle" value={data.cycles_running} /><Stat label="Rejected shops" value={data.rejected_shops} />
    </section>
    {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{error}</p> : null}
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.milestones.map((m) => <article key={m.id} className={'rounded-3xl border bg-white p-5 shadow-sm '+(m.eligible?'border-emerald-300':'border-slate-200')}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-[#c20e5a]">{m.required_qualifying_shops} Shops</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">{m.name}</h2></div>
          {m.eligible?<CheckCircle2 className="h-6 w-6 text-emerald-600" />:<Gift className="h-6 w-6 text-slate-300" />}
        </div>
        <p className="mt-4 text-2xl font-black text-slate-950">Up to {money(m.maximum_value_paise)}</p>
        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <p className="flex items-center gap-2"><Store className="h-4 w-4" />Claim unlock: {m.claim_unlock_verified_shops} verified shops</p>
          <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />{m.eligible?'Eligible for verification':m.plus_one_complete?'Qualification pending':'Plus-one shop pending'}</p>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">Claim status: {m.claim?.status?.replaceAll('_',' ') ?? 'Not eligible'}</div>
      </article>)}
    </section>
    <section className="overflow-hidden rounded-3xl border border-white/30 bg-white/70 p-5 shadow-xl shadow-pink-900/5 backdrop-blur-lg sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#c20e5a]">7-stage career ladder</p><h2 className="mt-1 text-2xl font-black text-slate-950">Nexora Milestone Rewards &amp; Asset Gifts</h2><p className="mt-1 text-sm text-slate-600">Guaranteed physical handover after eligibility, document verification and compliance review.</p></div><span className="rounded-full bg-pink-100 px-3 py-1.5 text-xs font-black text-[#a40c4c]">1,000+ Shops Milestone</span></div>
      <img src={partnerMilestonesImage} alt="Nexora partner milestone reward assets" className="mt-5 h-44 w-full rounded-2xl object-cover object-center sm:h-56" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{CAREER_MILESTONES.map(([target,title,detail], index) => <article key={target} className="group rounded-2xl border border-white/70 bg-white/80 p-3 backdrop-blur-md transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/20"><p className="text-[10px] font-black uppercase tracking-wide text-[#c20e5a]">Stage {index + 1} · {target}</p><h3 className="mt-2 text-sm font-black text-slate-950">{title}</h3><p className="mt-1 min-h-10 text-[11px] leading-snug text-slate-600">{detail}</p><p className="mt-3 flex items-center gap-1 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Physical handover guaranteed</p></article>)}</div>
    </section>
    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <h2 className="font-black">Important</h2>
      <p className="mt-1">यह performance-based non-cash programme है। Rewards KYC, genuine settled QR transactions, fraud clearance, tax compliance और availability के अधीन हैं। Brezza reward maximum ₹5,50,000 purchase contribution है—free car नहीं। Eligible reward approval के बाद Day 16–30 में process होगा।</p>
    </section>
  </div>;
}

export function PartnerCommissionPage() {
  const [data, setData] = useState<OnboardingRewardDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data: value, error: rpcError } = await supabase.rpc('get_my_partner_onboarding_rewards', { p_limit: 100, p_offset: 0 });
    if (rpcError) setError('Extra Onboarding Reward data अभी load नहीं हो सका।');
    else setData(value as OnboardingRewardDashboard);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <Loading label="Extra Onboarding Rewards loading…" />;
  if (error && !data) return <ErrorState message={error} retry={() => void load()} />;
  if (!data) return null;

  return <div className="space-y-5">
    <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 shadow-2xl shadow-slate-950/20">
      <img src={partnerRulesImage} alt="Nexora Growth Partner rules and revenue sharing" className="h-56 w-full object-cover opacity-80 sm:h-72 lg:h-96" />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/45 to-transparent" />
      <div className="absolute inset-0 flex items-end p-6 sm:p-8"><div className="max-w-xl text-white"><p className="text-xs font-black uppercase tracking-[.22em] text-pink-300">Nexora Partner Program</p><h1 className="mt-2 text-2xl font-black sm:text-4xl">Rules, revenue &amp; your extra reward</h1><p className="mt-2 text-sm leading-6 text-slate-200">Explain SalonOS, onboard shops ethically and unlock transparent one-time activation rewards with recurring growth share.</p><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-white/15 px-3 py-2 backdrop-blur">10% activation bonus</span><span className="rounded-full bg-pink-600 px-3 py-2">10% recurring share</span><span className="rounded-full bg-white/15 px-3 py-2 backdrop-blur">2% lifetime share</span></div></div></div>
    </section>
    <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-pink-300">One-time reward per qualifying shop</p>
      <h1 className="mt-2 text-2xl font-black">Extra Onboarding Reward</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-300">यह Growth Partner की main या recurring commission नहीं है। हर नई shop के पहले successful 15 consecutive qualifying days complete होने पर एक बार Extra Onboarding Reward मिलता है।</p>
      <div className="mt-5 grid gap-2 text-center text-sm font-black sm:grid-cols-3">
        <div className="rounded-xl bg-white/10 p-3">₹15,000 Minimum QR</div>
        <div className="rounded-xl bg-white/10 p-3">₹1,500 Company Commission</div>
        <div className="rounded-xl bg-pink-600 p-3">₹150 Minimum Extra Reward</div>
      </div>
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Qualifying shops" value={data.totals.qualifying_shops} />
      <Stat label="15-day QR collection" value={money(data.totals.qualifying_qr_transaction_paise)} />
      <Stat label="Company commission" value={money(data.totals.company_commission_paise)} />
      <Stat label="Your extra reward" value={money(data.totals.onboarding_reward_paise)} />
    </section>

    <section className="rounded-3xl border border-pink-200 bg-pink-50 p-5">
      <h2 className="font-black text-slate-950">No maximum limit</h2>
      <p className="mt-2 text-sm text-slate-700">हर दिन minimum ₹1,000 जरूरी है। पहले valid 15-day cycle में जितना actual QR collection होगा, company को उसका 10% commission मिलेगा और company commission का 10% आपका one-time Extra Onboarding Reward होगा।</p>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <p className="rounded-xl bg-white p-4"><span className="block text-slate-500">Minimum example</span><strong>₹15,000 QR → ₹1,500 company → ₹150 reward</strong></p>
        <p className="rounded-xl bg-white p-4"><span className="block text-slate-500">Higher collection example</span><strong>₹50,000 QR → ₹5,000 company → ₹500 reward</strong></p>
      </div>
    </section>

    {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{error}</p> : null}
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5"><h2 className="font-black text-slate-950">Shop-wise earned rewards</h2></div>
      {data.rewards.length === 0
        ? <div className="p-10 text-center"><IndianRupee className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-bold text-slate-800">No Extra Onboarding Reward earned yet</p><p className="mt-1 text-sm text-slate-500">नई shop का first valid 15-day qualification cycle complete होने पर reward यहाँ दिखेगा।</p></div>
        : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Shop</th><th className="p-4">15-day period</th><th className="p-4">QR collection</th><th className="p-4">Company 10%</th><th className="p-4">Extra reward</th><th className="p-4">Status</th></tr></thead>
          <tbody>{data.rewards.map((reward) => <tr key={reward.id} className="border-t border-slate-100">
            <td className="p-4 font-bold">{reward.shop_name || 'Shop'}</td>
            <td className="p-4 text-slate-600">{new Date(reward.qualification_start_date + 'T00:00:00').toLocaleDateString('en-IN')} – {new Date(reward.qualification_end_date + 'T00:00:00').toLocaleDateString('en-IN')}</td>
            <td className="p-4">{money(reward.qualifying_qr_transaction_paise)}</td>
            <td className="p-4">{money(reward.company_commission_paise)}</td>
            <td className="p-4 font-black text-[#c20e5a]">{money(reward.onboarding_reward_paise)}</td>
            <td className="p-4"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{reward.status.replaceAll('_', ' ')}</span></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}
