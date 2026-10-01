import React, { useEffect, useId, useRef, useState } from 'react';
import { compressAndResizeImage, validateImageFile } from '../utils/imageUploadHelper';
import { cleanImageUrlInput, isSafeImageUrl } from '../lib/websiteValidation';
import { FieldError, fieldErrorId, useFieldIssueProps, withIssueStyle } from './WebsiteIssues';

interface ContentImageFieldProps {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  /**
   * Path of this field in the saved content (`profile.gallery[0].url`). When
   * given, a problem found when saving is shown here: red border + message.
   */
  fieldPath?: string;
  /**
   * The default image saved when this field is left empty. A value equal to it
   * is shown as "using the default image" with an empty link box, instead of
   * leaking the placeholder's file path into the input.
   */
  placeholderUrl?: string;
  /** Shown while the field is empty, e.g. what will appear on the website instead. */
  emptyHint?: string;
}

export function ContentImageField({ label, value, onChange, fieldPath, placeholderUrl, emptyHint }: ContentImageFieldProps) {
  const id = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const usingPlaceholder = !!placeholderUrl && value === placeholderUrl;
  const editable = (next?: string) => (!next || next.startsWith('data:') || (!!placeholderUrl && next === placeholderUrl) ? '' : next);
  const [url, setUrl] = useState(editable(value));
  const sequence = useRef(0);
  const latestValue = useRef(value); latestValue.current = value;
  const field = useFieldIssueProps(fieldPath);
  const invalid = !!error || field.issue?.severity === 'error';
  useEffect(() => { setUrl(editable(value)); }, [value]);
  useEffect(() => () => { sequence.current++; }, []);
  const update = (next: string) => { sequence.current++; setBusy(false); setError(''); onChange(next); };
  const inputClass = withIssueStyle(
    'w-full rounded-lg border border-slate-300 bg-white p-2 text-xs',
    error ? { severity: 'error' } : field.issue
  );
  return <div className="space-y-2 text-slate-800">
    <label htmlFor={id} className="block text-xs font-bold">{label}</label>
    {value && isSafeImageUrl(value) && <img src={value} alt={usingPlaceholder ? `${label} (default image)` : label} loading="lazy" className="h-24 w-32 rounded-xl object-cover" />}
    <input id={id} type="url" value={url} placeholder="https://… (image URL)" {...field.attrs} onChange={e => {
      const next = e.target.value; setUrl(next); sequence.current++; setBusy(false);
      if (isSafeImageUrl(next)) update(next.trim());
      else setError('Enter a complete http(s) image URL, or upload a JPG, PNG or WebP.');
    }} onBlur={() => {
      // `cdn.example.com/photo.jpg` pasted without the scheme: complete it.
      const cleaned = cleanImageUrlInput(url);
      if (cleaned !== url.trim() && isSafeImageUrl(cleaned)) { setUrl(cleaned); update(cleaned); }
    }} aria-invalid={invalid ? true : undefined}
      aria-describedby={error ? `${id}-error` : field.issue && fieldPath ? fieldErrorId(fieldPath) : undefined}
      className={inputClass} />
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
    {usingPlaceholder && <p className="text-xs text-slate-500" data-default-image-note>Using the default image. Paste a link or upload a photo to replace it.</p>}
    {!value && emptyHint && <p className="text-xs text-slate-500" data-default-image-note>{emptyHint}</p>}
    {value && !usingPlaceholder && <button type="button" onClick={() => { setUrl(''); update(''); }} className="text-xs text-rose-700">Remove image</button>}
    {error
      ? <p id={`${id}-error`} role="alert" className="text-xs text-red-700">{error}</p>
      : fieldPath && <FieldError path={fieldPath} />}
  </div>;
}
