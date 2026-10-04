import React from 'react';
import type { SalonProfile } from '../types';
import { REQUIRED_ADVANCE_PERCENT } from '../lib/advanceDeposit';

export function TemplatePublishingSettings({ profile, onChange }: { profile: SalonProfile; onChange: (patch: Partial<SalonProfile>) => void }) {
  return <fieldset className="rounded-2xl border border-slate-200 p-4 space-y-3" aria-label="Publishing and booking settings">
    <legend className="text-xs font-bold px-1">Publishing &amp; booking</legend>
    <label className="block text-xs font-semibold">Custom domain
      <input type="text" aria-label="Custom domain" value={profile.customDomain || ''} placeholder="studio.example.com" onChange={event => onChange({ customDomain: event.target.value.trim() })} className="block w-full min-h-11 mt-1 rounded-xl border border-slate-300 px-3" />
    </label>
    <p className="text-[11px] text-slate-500">Save your domain here. DNS and hosting connection are configured separately.</p>
    <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={profile.whiteLabelEnabled === true} onChange={event => onChange({ whiteLabelEnabled: event.target.checked })} /> Hide “Powered by Nexora” branding</label>
    <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={profile.whatsappNotificationsEnabled !== false} onChange={event => onChange({ whatsappNotificationsEnabled: event.target.checked })} /> WhatsApp booking notification preference</label>
    <p className="text-[11px] text-slate-500">This saves your preference. Delivery depends on the messaging service.</p>
    <p className="text-xs font-semibold">Online booking advance: {REQUIRED_ADVANCE_PERCENT}%</p>
    <p className="text-[11px] text-slate-500">The platform requires a 25% advance for online bookings. The remaining amount is paid at the salon.</p>
  </fieldset>;
}
