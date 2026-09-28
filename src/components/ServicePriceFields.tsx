import { regularServicePrice } from '../lib/globalSiteConfig';
import React, { useEffect, useId, useState } from 'react';
import type { SalonService } from '../types';

/** Both fields write the same service state as autosave, preview and booking. */
export function ServicePriceFields({ service, onChange }: { service: SalonService; onChange: (patch: Partial<SalonService>) => void }) {
  const id = useId();
  const regular = regularServicePrice(service);
  const [saleDraft, setSaleDraft] = useState(service.originalPrice != null ? String(service.price) : '');
  const [error, setError] = useState('');
  useEffect(() => {
    setSaleDraft(service.originalPrice != null ? String(service.price) : '');
    setError('');
  }, [service.id, service.price, service.originalPrice]);
  const inputClass = 'w-full p-2 rounded-lg border border-gray-300 text-xs bg-white text-slate-900 font-mono focus:ring-2 focus:ring-rose-700/20 outline-none';
  return <>
    <div>
      <label htmlFor={`${id}-regular`} className="text-[10px] text-gray-500 block mb-0.5">Regular price (₹)</label>
      <input id={`${id}-regular`} type="number" min={0} step="0.01" value={regular} className={inputClass} onChange={e => {
        const amount = Number(e.target.value);
        if (!Number.isFinite(amount) || amount < 0) return;
        onChange(service.originalPrice != null && service.price <= amount
          ? { originalPrice: amount } : { price: amount, originalPrice: undefined });
      }} />
    </div>
    <div>
      <label htmlFor={`${id}-sale`} className="text-[10px] text-gray-500 block mb-0.5">Sale price (₹, optional)</label>
      <input id={`${id}-sale`} type="number" min={0} max={regular} step="0.01" value={saleDraft} placeholder="No discount" className={inputClass}
        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={e => {
          const draft = e.target.value;
          setSaleDraft(draft);
          const amount = Number(draft);
          if (draft && (!Number.isFinite(amount) || amount < 0 || amount > regular)) {
            setError('Not saved: sale price must be between ₹0 and the regular price.');
            return;
          }
          setError('');
          onChange(draft === '' ? { price: regular, originalPrice: undefined } : { price: amount, originalPrice: regular });
        }} />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-rose-700 mt-1">{error}</p>}
    </div>
  </>;
}
