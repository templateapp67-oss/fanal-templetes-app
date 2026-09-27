import { useEffect, useRef, useState } from 'react';
import { isMockSupabase, supabase } from '../supabaseClient';

export type UseReferralCodeResult = {
  code: string | null;
  loading: boolean;
};

/**
 * Canonical Growth Partner referral-code reader.
 *
 * The database is the only source of truth. This hook never derives a code
 * from auth.user.id and never reads a cached/local fallback. Account changes
 * clear the previous value before the next RPC starts so one user's code
 * cannot flash for another user.
 */
export function useReferralCode(): UseReferralCodeResult {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);

  useEffect(() => {
    let mounted = true;

    if (isMockSupabase) {
      setCode(null);
      setLoading(false);
      return () => {
        mounted = false;
        requestVersion.current += 1;
      };
    }

    const clear = (nextLoading: boolean) => {
      if (!mounted) return;
      setCode(null);
      setLoading(nextLoading);
    };

    const load = async (hasUser: boolean) => {
      const version = ++requestVersion.current;

      if (!hasUser) {
        clear(false);
        return;
      }

      clear(true);

      try {
        const { data, error } = await supabase.rpc('get_my_referral_code');
        if (!mounted || version !== requestVersion.current) return;

        if (error) {
          setCode(null);
          setLoading(false);
          return;
        }

        const value = typeof data === 'string' ? data.trim() : '';
        setCode(value || null);
        setLoading(false);
      } catch {
        if (!mounted || version !== requestVersion.current) return;
        setCode(null);
        setLoading(false);
      }
    };

    void supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error || !session?.user) {
        clear(false);
        return;
      }
      void load(true);
    }).catch(() => {
      if (mounted) clear(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      requestVersion.current += 1;
      if (!session?.user) {
        clear(false);
        return;
      }
      clear(true);
      void load(true);
    });

    return () => {
      mounted = false;
      requestVersion.current += 1;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return { code, loading };
}
