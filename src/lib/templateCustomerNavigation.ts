import { useCallback, useEffect, useState } from 'react';
import { matchCustomerRoute } from './router';
import type { TemplateCustomerRequest, TemplateCustomerSection } from '../components/TemplateCustomerHub';

export const CUSTOMER_SECTIONS = ['home','salon','services','packages','book','bookings','wallet','notifications','favourites','profile','location','settings','auth'] as const;
export function templateCustomerPath(request: TemplateCustomerRequest, slug: string) {
  if (request.path?.startsWith('/app')) return request.path;
  const section = request.section;
  if (section === 'home') return '/app';
  if (['salon','services','packages','book'].includes(section)) return `/app/${section === 'book' ? 'book' : 'salon'}/${encodeURIComponent(slug)}${['services','packages'].includes(section) ? `/${section}` : ''}`;
  return `/app/${section}`;
}
export function readTemplateCustomerRequest(search: string): TemplateCustomerRequest | null {
  const params = new URLSearchParams(search);
  const value = params.get('customer');
  const serviceIds = [...new Set((params.get('customerServices') || '').slice(0, 4000).split(',').filter(Boolean))].slice(0, 50);
  if (!value) return null;
  if (CUSTOMER_SECTIONS.includes(value as TemplateCustomerSection)) return { section: value as TemplateCustomerSection, ...(serviceIds.length ? { serviceIds } : {}) };
  if (!/^\/app(?:\/|$)/.test(value)) return null;
  const route = matchCustomerRoute(value);
  const section = route.section === 'salon' && ['services','packages'].includes(route.tab) ? route.tab : route.section === 'booking' ? 'bookings' : route.section;
  return { section: CUSTOMER_SECTIONS.includes(section as TemplateCustomerSection) ? section as TemplateCustomerSection : 'profile', path: value, ...(serviceIds.length ? { serviceIds } : {}) };
}
export function useTemplateCustomerNavigation() {
  const [request, setRequest] = useState<TemplateCustomerRequest | null>(() => typeof window === 'undefined' ? null : readTemplateCustomerRequest(window.location.search));
  useEffect(() => {
    const pop = () => setRequest(readTemplateCustomerRequest(window.location.search));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const update = useCallback((next: TemplateCustomerRequest | null) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('customer', next.path || next.section);
    else url.searchParams.delete('customer');
    if (next?.serviceIds?.length) url.searchParams.set('customerServices', next.serviceIds.join(','));
    else url.searchParams.delete('customerServices');
    if (url.href !== window.location.href) window.history.pushState(window.history.state, '', url.href);
    setRequest(next);
  }, []);
  const navigate = useCallback((path: string) => {
    const ids = ['book', 'auth'].some(section => path.startsWith(`/app/${section}`)) ? new URLSearchParams(window.location.search).get('customerServices') || '' : '';
    const next = readTemplateCustomerRequest(`customer=${encodeURIComponent(path)}&customerServices=${encodeURIComponent(ids)}`);
    if (next) update(next);
  }, [update]);
  return { request, setRequest: update, navigate, open: (section: TemplateCustomerSection) => update({ section }), close: () => update(null) };
}
