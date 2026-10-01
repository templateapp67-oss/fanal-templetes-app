import { regularServicePrice } from '../lib/globalSiteConfig';
import React, { useEffect, useId, useState } from 'react';
import type { SalonService } from '../types';
import { FieldError, useFieldIssueProps, withIssueStyle } from './WebsiteIssues';

const withErrorTone = (className: string) => withIssueStyle(className, { severity: 'error' });

/** Both fields write the same service state as autosave, preview and booking. */
export function ServicePriceFields({ service, onChange, fieldPath }: {
  service: SalonService;
  onChange: (patch: Partial<SalonService>) => void;
  /** Path of this service in the saved content (`services[2]`) so a blocked save can mark the exact price box. */
  fieldPath?: string;
}) {
  const id = useId();
  // With a sale price, `price` IS the sale price and `originalPrice` the regular one.
  const hasSale = service.originalPrice != null;
  const regularPath = fieldPath ? `${fieldPath}.${hasSale ? 'originalPrice' : 'price'}` : undefined;
  const salePath = fieldPath && hasSale ? `${fieldPath}.price` : undefined;
  const regularField = useFieldIssueProps(regularPath);
  const saleField = useFieldIssueProps(salePath);
  const regular = regularServicePrice(service);
  const [saleDraft, setSaleDraft] = useState(service.originalPrice != null ? String(service.price) : '');
  const [error, setError] = useState('');
  useEffect(() => {
    setSaleDraft(service.originalPrice != null ? String(service.price) : '');
    setError('');
  }, [service.id, service.price, service.originalPrice]);
  const inputClass = 'w-full p-2 rounded-lg border border-gray-300 text-xs bg-white text-slate-900 font-mono focus:ring-2 focus:ring-rose-700/20 outline-none';
  const regularClass = regularField.className(inputClass);
  const saleClass = saleField.className(inputClass);
  return <>
    <div>
      <label htmlFor={`${id}-regular`} className="text-[10px] text-gray-500 block mb-0.5">Regular price (₹)</label>
      <input id={`${id}-regular`} type="number" min={0} step="0.01" value={regular} className={regularClass} {...regularField.attrs} onChange={e => {
        const amount = Number(e.target.value);
        if (!Number.isFinite(amount) || amount < 0) return;
        onChange(service.originalPrice != null && service.price <= amount
          ? { originalPrice: amount } : { price: amount, originalPrice: undefined });
      }} />
      {regularPath && <FieldError path={regularPath} />}
    </div>
    <div>
      <label htmlFor={`${id}-sale`} className="text-[10px] text-gray-500 block mb-0.5">Sale price (₹, optional)</label>
      <input id={`${id}-sale`} type="number" min={0} max={regular} step="0.01" value={saleDraft} placeholder="No discount" className={error ? withErrorTone(inputClass) : saleClass} {...saleField.attrs}
        aria-invalid={error || saleField.issue?.severity === 'error' ? true : undefined} aria-describedby={error ? `${id}-error` : saleField.attrs['aria-describedby']} onChange={e => {
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
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-rose-700 mt-1">{error}</p> : salePath && <FieldError path={salePath} />}
    </div>
  </>;
}
