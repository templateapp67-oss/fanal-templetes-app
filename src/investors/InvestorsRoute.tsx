import { lazy, Suspense, type ReactNode } from 'react';
import { usePathRoute } from '../lib/router';

const InvestorsPage = lazy(() => import('./InvestorsPage'));

/** Add only /investors; all existing paths still render the original application. */
export function InvestorsRoute({ children }: { children: ReactNode }) {
  const { path } = usePathRoute();
  if (path !== '/investors') return children;
  return (
    <Suspense fallback={<div role="status" style={{ minHeight: '100dvh', background: '#080808', color: '#D4AF37', padding: 32 }}>Loading Nexora…</div>}>
      <InvestorsPage />
    </Suspense>
  );
}
