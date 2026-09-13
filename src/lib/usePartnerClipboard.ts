import { useCallback, useEffect, useRef, useState } from 'react';
import { copyReferralCodeToClipboard } from './growthPartner';

export const REFERRAL_CODE_COPIED = 'Referral code copied';
export const REFERRAL_LINK_COPIED = 'Referral link copied';

/** Last action wins; failed writes never produce a success snackbar. */
export function usePartnerClipboard() {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ id: 0, message: '' });
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { sequence.current++; clearTimeout(timer.current); }, []);
  const copy = useCallback(async (value: string, kind: 'code' | 'link') => {
    const id = ++sequence.current;
    clearTimeout(timer.current);
    setCopied(null); setError(''); setNotice({id,message:''});
    const ok = await copyReferralCodeToClipboard(value);
    if (sequence.current !== id) return ok;
    if (!ok) { setError('Could not copy. Select and copy the code or link manually.'); return false; }
    setCopied(kind);
    setNotice({id,message:kind === 'code' ? REFERRAL_CODE_COPIED : REFERRAL_LINK_COPIED});
    timer.current = setTimeout(() => { setCopied(null); setNotice({id,message:''}); },6000);
    return true;
  }, []);
  return {copy,copied,error,notice};
}
