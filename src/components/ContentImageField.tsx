import React, { useEffect, useId, useRef, useState } from 'react';
import { compressAndResizeImage, validateImageFile } from '../utils/imageUploadHelper';
import { isSafeImageUrl } from '../lib/websiteValidation';

export function ContentImageField({ label, value, onChange }: { label: string; value?: string; onChange: (url: string) => void }) {
  const id = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(value?.startsWith('data:') ? '' : value || '');
  const sequence = useRef(0);
  const latestValue = useRef(value); latestValue.current = value;
  useEffect(() => { setUrl(value?.startsWith('data:') ? '' : value || ''); }, [value]);
  useEffect(() => () => { sequence.current++; }, []);
  const update = (next: string) => { sequence.current++; setBusy(false); setError(''); onChange(next); };
  return <div className="space-y-2 text-slate-800">
    <label htmlFor={id} className="block text-xs font-bold">{label}</label>
    {value && isSafeImageUrl(value) && <img src={value} alt={label} loading="lazy" className="h-24 w-32 rounded-xl object-cover" />}
    <input id={id} type="url" value={url} placeholder="https://… (image URL)" onChange={e => {
      const next = e.target.value; setUrl(next); sequence.current++; setBusy(false);
      if (isSafeImageUrl(next)) update(next);
      else setError('Enter a complete http(s) image URL, or upload a JPG, PNG or WebP.');
    }} aria-invalid={!!error} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs" />
    <input aria-label={`Upload ${label}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="w-full text-xs" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      const validation = validateImageFile(file);
      if (!validation.isValid) { setError(validation.errorMessage || 'Invalid image'); return; }
      const request = ++sequence.current; const before = value;
      setBusy(true); setError('');
      try {
        const result = await compressAndResizeImage(file, 1000, 300 * 1024);
        if (request !== sequence.current || latestValue.current !== before) return;
        if (result.isValid && result.dataUrl) onChange(result.dataUrl);
        else setError(result.errorMessage || 'Could not process image');
      } catch { if (request === sequence.current) setError('Could not upload image. Try a smaller JPG or PNG.'); }
      finally { if (request === sequence.current) setBusy(false); }
    }} />
    <p className="text-xs text-slate-500">JPG, PNG or WebP, up to 5 MB. {busy ? 'Processing…' : 'Changes are included when you save your website.'}</p>
    {value && <button type="button" onClick={() => { setUrl(''); update(''); }} className="text-xs text-rose-700">Remove image</button>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
