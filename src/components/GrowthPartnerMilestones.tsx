import React from 'react';
import { Shirt, Tablet, Laptop, Bike, Smartphone, Car, Trophy, Check } from 'lucide-react';
import { PARTNER_MILESTONES, milestoneProgress } from '../lib/partnerMilestones';

const icons = { shirt: Shirt, tablet: Tablet, laptop: Laptop, scooter: Bike, phone: Smartphone, bike: Bike, car: Car };

export function GrowthPartnerMilestones({ shopCount }: { shopCount: number | null | undefined }) {
  const count = milestoneProgress(shopCount, 1000).completed;
  const next = PARTNER_MILESTONES.find(item => count === null || item.target > count);
  const reached = count === null ? null : PARTNER_MILESTONES.filter(item => count >= item.target).length;
  return <section id="rewards" aria-label="Growth Partner rewards and targets" className="scroll-mt-24 overflow-hidden rounded-3xl border border-pink-200 bg-[#fff8fb]">
    <header className="bg-gradient-to-br from-[#510026] via-[#a80050] to-[#e00065] p-6 text-white sm:p-8">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]"><Trophy size={18} />Nexora Growth Partner Rewards</div>
      <h2 className="mt-3 text-3xl font-black sm:text-4xl">Grow together. Get more.</h2>
      <p className="mt-3 max-w-xl text-sm text-pink-100">Jitne zyada shops onboard karenge, utne bade milestones unlock honge.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-pink-100">Onboarded shops</p><p className="mt-1 text-3xl font-black">{count ?? '—'}</p></div>
        <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-pink-100">Milestones reached</p><p className="mt-1 text-3xl font-black">{reached === null ? '—' : reached + ' / 7'}</p></div>
        <div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-pink-100">{next ? 'Shops to next target' : 'All targets reached'}</p><p className="mt-1 text-3xl font-black">{count === null ? '—' : next ? Math.max(0, next.target - count) : '✓'}</p><p className="mt-1 text-xs">{next?.reward || 'District Partner SUV Car milestone'}</p></div>
      </div>
      <a href="/growth-partner/onboard" className="mt-5 inline-block rounded-xl bg-white px-5 py-3 text-sm font-bold text-pink-900">Onboard a business →</a>
    </header>
    <div className="p-5 sm:p-7">
      {count === null && <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shop count is unavailable. Targets will update when the backend count loads.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PARTNER_MILESTONES.map(item => {
          const progress = milestoneProgress(count, item.target);
          const Icon = icons[item.icon];
          return <article key={item.target} className={'relative rounded-2xl border bg-white p-5 ' + (progress.reached ? 'border-emerald-300' : 'border-pink-100') + (item.target === 1000 ? ' sm:col-span-2 lg:col-span-3' : '')}>
            <div className="flex items-start justify-between gap-2">
              <span className="rounded-2xl bg-pink-50 p-3 text-pink-700"><Icon size={30} /></span>
              <span className={'rounded-full px-3 py-1 text-xs font-bold ' + (progress.reached ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{progress.reached ? 'Target reached' : next?.target === item.target ? 'Next target' : 'Milestone'}</span>
            </div>
            <p className="mt-4 text-3xl font-black text-pink-800">{item.target}{item.target === 1000 ? '+' : ''} <span className="text-xs font-bold uppercase tracking-widest">Shops</span></p>
            <h3 className="mt-2 text-base font-bold text-slate-900">{item.reward}</h3>
            <div role="progressbar" aria-label={item.reward + ' target progress'} aria-valuemin={0} aria-valuemax={item.target} aria-valuenow={count === null ? undefined : Math.min(count, item.target)} aria-valuetext={count === null ? 'Count unavailable' : count + ' shops onboarded; ' + progress.remaining + ' remaining'} className="mt-5 h-2 overflow-hidden rounded-full bg-pink-50">
              <div className={'h-full rounded-full transition-all ' + (progress.reached ? 'bg-emerald-500' : 'bg-pink-600')} style={{ width: progress.percent + '%' }} />
            </div>
            <p className="mt-3 flex items-center gap-1 text-sm font-semibold text-slate-600">{progress.reached ? <><Check size={16} />Target complete</> : progress.remaining === null ? 'Waiting for shop count' : progress.remaining + ' shops remaining'}</p>
          </article>;
        })}
      </div>
      <p className="mt-5 text-xs text-slate-500">Progress counts distinct shops with an active referral attribution to your account. Reaching a target does not indicate reward delivery.</p>
    </div>
  </section>;
}
