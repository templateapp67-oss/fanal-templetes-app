// ============================================================================
// Customer App — Home (discovery) and Salon profile.
//
// Both are read-only views of the salon's own rows: `profiles` for the salon,
// `services`, `stylists`, and reviews that were actually left on completed
// bookings. A salon with no reviews shows "No reviews yet" — there is no
// fallback rating anywhere in this file, which is the single most important
// property of a screen like this.
//
// Search results, suggestions and ratings all come from the API; the only local
// state is the query text and the customer's own pins (which have no table).
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  Heart,
  MapPin,
  Search,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import {
  getSalon,
  listFavourites,
  listSalonReviews,
  listSalonServices,
  listSalonStaff,
  mappingNote,
  recordSearch,
  searchSalons,
  searchSuggestions,
  toggleFavourite,
} from '../../lib/customer/api';
import { readLocation } from '../../lib/customer/deviceStore';
import { readSearchHistory } from '../../lib/customer/deviceStore';
import type { CustomerFavourite, CustomerReview, CustomerSalon, CustomerService, CustomerStaff } from '../../lib/customer/types';
import {
  Button,
  CARD_CLASS,
  Chip,
  ConnectionNotice,
  EmptyState,
  ErrorState,
  LoadingRows,
  MUTED_CLASS,
  SectionTitle,
  SourceChip,
  StatTile,
  Avatar,
  money,
  useCustomerQuery,
} from '../ui';

export interface DiscoverProps {
  userId?: string | null;
  accentHex?: string;
  refreshToken?: number;
  onOpenSalon: (salonId: string) => void;
  onBook: (salonId: string) => void;
  onRequireAuth?: () => void;
  onOpenProfile?: () => void;
}

// ---------------------------------------------------------------------------
// Home / discovery
// ---------------------------------------------------------------------------
export const HomeScreen: React.FC<DiscoverProps> = ({ userId, accentHex = '#C20E5A', refreshToken = 0, onOpenSalon, onBook, onRequireAuth }) => {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [sort, setSort] = useState<'nearby' | 'rating' | 'name' | 'trending' | 'price'>('nearby');
  const [filters, setFilters] = useState<DiscoveryFilters>(EMPTY_DISCOVERY_FILTERS);
  const location = useMemo(() => readLocation(userId), [userId, refreshToken]);
  const recent = useMemo(() => readSearchHistory(userId).slice(0, 6), [userId, refreshToken]);

  const salonsState = useSalonSearch({ query: submitted, city: location?.city || '', sort, filters, location });
  const suggestionsState = useSuggestions(query, location?.city || '');
  // Recommendation input: the salons this customer has actually booked or pinned.
  // Nothing else in this schema says what a customer likes.
  const favouritesState = useCustomerQuery(() => listFavourites(userId), [userId, refreshToken]);

  const runSearch = (value: string) => {
    const clean = value.trim();
    setQuery(clean);
    setSubmitted(clean);
    if (clean.length >= 2) recordSearch(userId, clean, location?.city || '');
  };

  return (
    <div className="space-y-5">
      <div className={`${CARD_CLASS} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {location?.city ? `Salons near ${location.city}` : 'Salons on Nexora'}
            </p>
            <h1 className="text-xl font-extrabold text-slate-900 mt-1">Find your next appointment</h1>
          </div>
          <div className="flex items-center gap-2">
            <SourceChip source="supabase" mode={salonsState.mode} loading={salonsState.loading} title={mappingNote('salons')} />
            {!location?.city ? (
              <Chip tone="warn" title="Set a city on the Location step to sort by distance">
                no location set
              </Chip>
            ) : null}
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(query);
          }}
          className="mt-4 flex items-center gap-2"
        >
          <div className="flex items-center gap-2 flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-slate-300">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Salon, service or area"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(''); setSubmitted(''); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
          <Button type="submit">Search</Button>
        </form>

        {submitted.length < 2 && suggestionsState.data?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestionsState.data.slice(0, 6).map((item) => (
              <Chip key={item.id} onClick={() => runSearch(item.query)} tone="neutral">
                <Sparkles className="w-3 h-3" /> {item.query}
                <span className="text-slate-400">· {item.count}</span>
              </Chip>
            ))}
          </div>
        ) : null}

        {submitted.length >= 2 && suggestionsState.data?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestionsState.data.slice(0, 6).map((item) => (
              <Chip key={item.id} onClick={() => runSearch(item.query)} tone="accent" title={mappingNote('search_history')}>
                {item.query}
              </Chip>
            ))}
          </div>
        ) : null}

        <DiscoveryFilterBar filters={filters} onChange={setFilters} salons={salonsState.data || []} accentHex={accentHex} />

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            {(['nearby', 'trending', 'rating', 'price', 'name'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
                className={`px-2.5 py-1.5 rounded-lg font-bold cursor-pointer capitalize ${
                  sort === value ? 'text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
                style={sort === value ? { backgroundColor: accentHex } : undefined}
              >
                {value === 'nearby' ? 'nearest' : value === 'price' ? 'cheapest' : value}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => salonsState.reload()} className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer">
            Refresh
          </button>
        </div>
      </div>

      {submitted ? (
        <p className={`text-xs ${MUTED_CLASS}`}>
          {`Results for “${submitted}” in ${location?.city || 'all cities'}`} · <span title={mappingNote('search_history')}>recent searches are kept on this device</span>
        </p>
      ) : null}

      {!recent.length && !submitted ? (
        <p className={`text-xs ${MUTED_CLASS}`}>Search history lives on this device — the schema has no search_history table to write to.</p>
      ) : null}

      {!submitted && !salonsState.loading && !salonsState.failed && (salonsState.data?.length || 0) >= 3 ? (
        <DiscoveryRails
          salons={salonsState.data || []}
          favourites={(favouritesState.data || []) as any[]}
          accentHex={accentHex}
          onOpen={onOpenSalon}
        />
      ) : null}

      {salonsState.loading ? <LoadingRows rows={4} label="Reading published salons…" /> : null}
      {salonsState.failed ? <ErrorState message={salonsState.error} onRetry={salonsState.reload} /> : null}
      {!salonsState.loading && !salonsState.failed ? (
        salonsState.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {salonsState.data.map((salon) => (
              <SalonCard
                key={salon.id}
                salon={salon}
                accentHex={accentHex}
                onOpen={() => onOpenSalon(salon.id)}
                onBook={() => onBook(salon.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Search className="w-6 h-6 text-slate-400" />}
            title={submitted ? 'No salon matches that search' : 'No salons published yet'}
            body={
              submitted
                ? `Nothing in ${location?.city || 'the connected database'} matches “${submitted}”. Try a service name, or clear the city filter on the Location step.`
                : 'The connected Supabase project has no published salons. A salon appears here once its owner publishes a name and sub-domain.'
            }
            action={
              submitted ? (
                <Button variant="secondary" onClick={() => { setQuery(''); setSubmitted(''); }}>
                  Clear search
                </Button>
              ) : null
            }
          />
        )
      ) : null}

      {salonsState.mode === 'mock' ? <ConnectionNotice mode="mock" notice={salonsState.notice} /> : null}
      {!userId ? (
        <button type="button" onClick={onRequireAuth} className={`${CARD_CLASS} w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:border-slate-300 cursor-pointer`}>
          <span className="text-sm">
            <span className="font-bold text-slate-900">Sign in to save favourites</span>
            <span className={`block ${MUTED_CLASS}`}>Your bookings, wallet and notifications follow your account.</span>
          </span>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      ) : null}
    </div>
  );
};

export interface DiscoveryFilters {
  category: string;
  maxPrice: string;
  minRating: number;
  openNow: boolean;
  offersOnly: boolean;
}

export const EMPTY_DISCOVERY_FILTERS: DiscoveryFilters = { category: '', maxPrice: '', minRating: 0, openNow: false, offersOnly: false };

function useSalonSearch(input: {
  query: string;
  city: string;
  sort: string;
  filters: DiscoveryFilters;
  location: { latitude: number | null; longitude: number | null } | null;
}) {
  const [state, setState] = useState<{ data: CustomerSalon[] | null; loading: boolean; failed: boolean; error: string; notice: string; mode: 'live' | 'mock' }>({
    data: null,
    loading: true,
    failed: false,
    error: '',
    notice: '',
    mode: 'live',
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    void (async () => {
      const budget = Number(input.filters.maxPrice);
      const result = await searchSalons({
        q: input.query || undefined,
        city: input.city || undefined,
        sort: input.sort as any,
        category: input.filters.category || undefined,
        maxPrice: Number.isFinite(budget) && budget > 0 ? budget : undefined,
        minRating: input.filters.minRating > 0 ? input.filters.minRating : undefined,
        openNow: input.filters.openNow || undefined,
        offersOnly: input.filters.offersOnly || undefined,
        latitude: input.location?.latitude ?? undefined,
        longitude: input.location?.longitude ?? undefined,
        // Rails are derived from this one response, so ask for a fuller page than
        // the grid shows rather than firing a separate request per rail.
        limit: 60,
      });
      if (cancelled) return;
      if (result.ok) {
        setState({ data: (result.data as CustomerSalon[]) || [], loading: false, failed: false, error: '', notice: (result as any).notice || '', mode: result.mode });
      } else {
        setState({ data: null, loading: false, failed: true, error: result.error, notice: '', mode: 'live' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.query, input.city, input.sort, JSON.stringify(input.filters), input.location?.latitude, input.location?.longitude, reloadKey]);

  return { ...state, reload: useCallback(() => setReloadKey((key) => key + 1), []) };
}

function useSuggestions(term: string, city: string) {
  const [data, setData] = useState<{ id: string; query: string; count: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await searchSuggestions({ q: term.trim() || undefined, city: city || undefined });
      if (!cancelled && result.ok) setData((result.data as any[]) || []);
      if (!cancelled && !result.ok) setData([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [term, city]);
  return { data };
}

/**
 * Every control here maps to a filter the API understands — `category`,
 * `maxPrice`, `minRating`, `openNow`, `offersOnly` — and each one is applied by
 * PostgREST or by the derived salon facts the server attached, never by hiding
 * rows the customer asked for. Category options come from the categories present
 * in the current result set, because `services.category` is free text and a
 * hardcoded list would offer filters that match nothing.
 */
const DiscoveryFilterBar: React.FC<{
  filters: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  salons: CustomerSalon[];
  accentHex: string;
}> = ({ filters, onChange, salons, accentHex }) => {
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const salon of salons) {
      for (const entry of salon.categories) seen.set(entry, (seen.get(entry) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [salons]);
  const activeCount =
    (filters.category ? 1 : 0) + (filters.maxPrice ? 1 : 0) + (filters.minRating ? 1 : 0) + (filters.openNow ? 1 : 0) + (filters.offersOnly ? 1 : 0);

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...filters, openNow: !filters.openNow })}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
            filters.openNow ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:border-slate-300'
          }`}
          style={filters.openNow ? { backgroundColor: accentHex } : undefined}
          title="Salons whose published working hours cover this moment"
        >
          Open now
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...filters, offersOnly: !filters.offersOnly })}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
            filters.offersOnly ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:border-slate-300'
          }`}
          style={filters.offersOnly ? { backgroundColor: accentHex } : undefined}
          title="Salons with at least one active row in loyalty_rewards"
        >
          Has offers
        </button>
        <div className="flex items-center gap-1.5">
          {[0, 4, 4.5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...filters, minRating: value })}
              className={`px-2 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
                filters.minRating === value ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:border-slate-300'
              }`}
              style={filters.minRating === value ? { backgroundColor: accentHex } : undefined}
              title={value ? `Average of stored ratings at or above ${value}` : 'Any rating, including salons with no reviews yet'}
            >
              {value ? `★ ${value}+` : 'any rating'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
          under
          <input
            value={filters.maxPrice}
            onChange={(event) => onChange({ ...filters, maxPrice: event.target.value.replace(/[^\d]/g, '').slice(0, 6) })}
            inputMode="numeric"
            placeholder="600"
            className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-300"
            title="The salon's cheapest published service price must be at or below this"
          />
        </label>
        {activeCount ? (
          <button type="button" onClick={() => onChange(EMPTY_DISCOVERY_FILTERS)} className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer">
            clear ({activeCount})
          </button>
        ) : null}
      </div>
      {categories.length ? (
        <div className="flex flex-wrap gap-1.5">
          {categories.map(([entry, count]) => (
            <button
              key={entry}
              type="button"
              onClick={() => onChange({ ...filters, category: filters.category === entry ? '' : entry })}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer border ${
                filters.category === entry ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:border-slate-300'
              }`}
              style={filters.category === entry ? { backgroundColor: accentHex } : undefined}
            >
              {entry} <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">Category chips appear once the loaded salons have services with categories to filter on.</p>
      )}
    </div>
  );
};

/**
 * The three rails the customer app promises, each defined by data rather than by
 * an opinion: recent booking volume, stored rating average, and the categories of
 * salons this customer has booked or pinned before.
 */
const DiscoveryRails: React.FC<{
  salons: CustomerSalon[];
  favourites: any[];
  accentHex: string;
  onOpen: (id: string) => void;
}> = ({ salons, favourites, onOpen }) => {
  const rails = useMemo(() => {
    const trending = salons
      .filter((salon) => salon.recentBookings > 0)
      .sort((a, b) => b.recentBookings - a.recentBookings)
      .slice(0, 4)
      .map((salon) => ({ salon, why: `${salon.recentBookings} booked in the last 30 days` }));
    const topRated = salons
      .filter((salon) => salon.rating.count >= 2)
      .sort((a, b) => b.rating.average - a.rating.average)
      .slice(0, 4)
      .map((salon) => ({ salon, why: `★ ${salon.rating.average.toFixed(1)} from ${salon.rating.count} stored reviews` }));
    const knownSalonIds = new Set(favourites.map((entry) => String(entry.salonId)));
    const likedCategories = new Set<string>();
    for (const entry of favourites) {
      const salon = salons.find((candidate) => String(candidate.id) === String(entry.salonId));
      for (const category of salon?.categories || []) likedCategories.add(category.toLowerCase());
    }
    const recommended = salons
      .filter((salon) => !knownSalonIds.has(String(salon.id)))
      .map((salon) => {
        const shared = salon.categories.filter((entry) => likedCategories.has(entry.toLowerCase()));
        return { salon, why: shared.length ? `also offers ${shared.slice(0, 2).join(' and ')}` : `in ${salon.city || 'your area'}` };
      })
      .slice(0, 4);
    return [
      { id: 'trending', title: 'Trending near you', body: 'Counted from real bookings, last 30 days', items: trending },
      { id: 'top', title: 'Top rated', body: 'Average of stored ratings on completed visits', items: topRated },
      { id: 'recommended', title: 'Recommended for you', body: favourites.length ? 'Based on where you have booked before' : 'Book or pin a salon and this rail learns from it', items: recommended },
    ].filter((rail) => rail.items.length > 0);
  }, [salons, favourites]);

  if (!rails.length) return null;

  return (
    <div className="space-y-4">
      {rails.map((rail) => (
        <section key={rail.id}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-extrabold text-slate-900">{rail.title}</h2>
            <p className={`text-[11px] ${MUTED_CLASS}`}>{rail.body}</p>
          </div>
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
            {rail.items.map(({ salon, why }) => (
              <button
                key={salon.id}
                type="button"
                onClick={() => onOpen(salon.id)}
                className={`${CARD_CLASS} w-60 shrink-0 p-3 text-left cursor-pointer hover:border-slate-300`}
              >
                <div className="flex items-center gap-2">
                  {salon.logoUrl ? <Avatar src={salon.logoUrl} name={salon.name} size={28} /> : null}
                  <p className="text-sm font-bold text-slate-900 truncate">{salon.name}</p>
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5">{why}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {salon.minServicePrice !== null ? `from ${money(salon.minServicePrice, salon.currency || '₹')} · ` : ''}
                  {salon.serviceCount} services
                </p>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

/**
 * The heart on a service or staff row. Favourites are the one entity with no
 * table in this schema, so a pin is stored on this device and merged with the
 * salons/services this customer has actually booked — the tip says which half is
 * which, because "saved" and "booked before" are different claims.
 */
const SaveButton: React.FC<{ saved: boolean; label: string; onSave: () => void; disabled?: boolean }> = ({
  saved,
  label,
  onSave,
  disabled,
}) => (
  <button
    type="button"
    onClick={onSave}
    disabled={disabled}
    aria-pressed={saved}
    title={saved ? `Saved${label ? `: ${label}` : ''}` : `Save${label ? ` ${label}` : ''} to your favourites`}
    className={`p-1.5 rounded-full border cursor-pointer transition-colors ${
      saved ? 'border-transparent text-white' : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300'
    }`}
    style={saved ? { backgroundColor: '#0f172a' } : undefined}
  >
    <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}`} />
  </button>
);

const SalonCard: React.FC<{ salon: CustomerSalon; accentHex: string; onOpen: () => void; onBook: () => void }> = ({ salon, accentHex, onOpen, onBook }) => (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`${CARD_CLASS} overflow-hidden flex flex-col`}>
      <button type="button" onClick={onOpen} className="text-left cursor-pointer">
        <div className="h-28 w-full bg-slate-100 relative">
          {salon.coverImageUrl ? <img src={salon.coverImageUrl} alt="" className="w-full h-full object-cover" /> : null}
          {salon.openNow === true ? (
            <span className="absolute top-2 left-2 px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wide">open now</span>
          ) : salon.openNow === false ? (
            <span className="absolute top-2 left-2 px-2 py-1 rounded-full bg-slate-800/80 text-white text-[10px] font-bold uppercase tracking-wide">closed</span>
          ) : null}
        </div>
        <div className="p-4">
          <div className="flex items-start gap-3">
            {salon.logoUrl ? <Avatar src={salon.logoUrl} name={salon.name} size={40} /> : null}
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-slate-900 truncate">{salon.name}</h3>
              <p className={`text-xs mt-0.5 truncate ${MUTED_CLASS}`}>{salon.tagline || salon.businessType}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-xs text-slate-600">
            {salon.rating.count ? (
              <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {salon.rating.average.toFixed(1)}
                <span className="font-medium text-slate-500">({salon.rating.count})</span>
              </span>
            ) : (
              <span className="text-slate-400 font-semibold">No reviews yet</span>
            )}
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {[salon.address, salon.city].filter(Boolean).join(', ') || 'Address not set'}
            </span>
            {salon.distanceKm !== null ? <span className="font-semibold">{salon.distanceKm} km</span> : null}
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> {salon.serviceCount} services
            </span>
            {salon.minServicePrice !== null ? (
              <span className="font-semibold text-slate-800" title="Cheapest published price on this menu">
                from {money(salon.minServicePrice, salon.currency || '₹')}
              </span>
            ) : null}
            {salon.hasActiveOffers ? (
              <span className="font-semibold text-emerald-700" title="This salon has an active reward in loyalty_rewards">
                offers live
              </span>
            ) : null}
            {salon.recentBookings > 0 ? (
              <span className="text-slate-500" title="Bookings in the last 30 days, counted from bookings">
                {salon.recentBookings} booked this month
              </span>
            ) : null}
          </div>
          {salon.categories.length ? (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {salon.categories.slice(0, 4).map((entry) => (
                <span key={entry} className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  {entry}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </button>
      <div className="mt-auto px-4 pb-4 flex items-center gap-2">
        <Button onClick={onBook} accentHex={accentHex} className="flex-1">
          <Calendar className="w-4 h-4" /> Book
        </Button>
        <Button onClick={onOpen} variant="secondary">
          View
        </Button>
      </div>
    </motion.div>
);

// ---------------------------------------------------------------------------
// Salon profile (with services / staff / reviews tabs)
// ---------------------------------------------------------------------------
export type SalonTab = 'overview' | 'services' | 'staff' | 'reviews';

export const SalonScreen: React.FC<{
  salonId: string;
  tab?: SalonTab;
  accentHex?: string;
  userId?: string | null;
  refreshToken?: number;
  onBack: () => void;
  onTab: (tab: SalonTab) => void;
  onBook: (serviceIds?: string[]) => void;
  onRequireAuth?: () => void;
}> = ({ salonId, tab = 'overview', accentHex = '#C20E5A', userId, refreshToken = 0, onBack, onTab, onBook, onRequireAuth }) => {
  const salonState = useCustomerLoad(() => getSalon(salonId), [salonId, refreshToken]);
  const salon = salonState.data as CustomerSalon | null;

  const servicesState = useCustomerLoad(() => listSalonServices(salonId), [salonId, refreshToken]);
  const staffState = useCustomerLoad(() => listSalonStaff(salonId), [salonId, refreshToken]);
  const reviewsState = useCustomerLoad(() => listSalonReviews(salonId), [salonId, refreshToken]);
  const favouritesState = useCustomerLoad(() => listFavourites(userId), [userId, refreshToken]);

  const favouriteRows = useMemo(() => (favouritesState.data as CustomerFavourite[] | null) || [], [favouritesState.data]);
  const isFavourite = favouriteRows.some((row) => row.kind === 'salon' && row.salonId === salonId);
  const savedStaffIds = useMemo(
    () => favouriteRows.filter((row) => row.kind === 'staff' && row.salonId === salonId && row.staffId).map((row) => row.staffId),
    [favouriteRows, salonId]
  );
  const savedServiceIds = useMemo(
    () => favouriteRows.filter((row) => row.kind === 'service' && row.salonId === salonId && row.serviceId).map((row) => row.serviceId),
    [favouriteRows, salonId]
  );

  const requireUser = () => {
    if (userId) return true;
    onRequireAuth?.();
    return false;
  };
  const toggleStaffSave = async (member: CustomerStaff) => {
    if (!requireUser()) return;
    const result = await toggleFavourite(userId, {
      salonId,
      kind: 'staff',
      staffId: member.id,
      salonName: salon?.name || '',
      staffName: member.name,
      pinned: !savedStaffIds.includes(member.id),
    });
    if (result.ok) favouritesState.setData((result.data as CustomerFavourite[]) || []);
  };
  const toggleServiceSave = async (service: CustomerService) => {
    if (!requireUser()) return;
    const result = await toggleFavourite(userId, {
      salonId,
      kind: 'service',
      serviceId: service.id,
      salonName: salon?.name || '',
      serviceName: service.name,
      pinned: !savedServiceIds.includes(service.id),
    });
    if (result.ok) favouritesState.setData((result.data as CustomerFavourite[]) || []);
  };

  const toggleSave = async () => {
    if (!userId) {
      onRequireAuth?.();
      return;
    }
    const result = await toggleFavourite(userId, { salonId, kind: 'salon', salonName: salon?.name || '', pinned: !isFavourite });
    if (result.ok) favouritesState.setData((result.data as CustomerFavourite[]) || []);
  };

  if (salonState.loading) return <LoadingRows rows={5} label="Loading the salon from Supabase…" />;
  if (salonState.failed) return <ErrorState message={salonState.error} onRetry={salonState.reload} />;
  if (!salon) {
    return (
      <EmptyState
        icon={<MapPin className="w-6 h-6 text-slate-400" />}
        title="This salon is not published"
        body="It has no salon name or sub-domain in the connected database yet, so there is nothing to book. Once the owner publishes their site it appears here."
        action={<Button variant="secondary" onClick={onBack}>Back to salons</Button>}
      />
    );
  }

  const services = (servicesState.data as CustomerService[] | null) || [];
  const staff = (staffState.data as CustomerStaff[] | null) || [];
  const reviews = (reviewsState.data as CustomerReview[] | null) || [];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> All salons
      </button>

      <div className={`${CARD_CLASS} overflow-hidden`}>
        <div className="h-36 w-full bg-slate-100 relative">
          {salon.coverImageUrl ? <img src={salon.coverImageUrl} alt="" className="w-full h-full object-cover" /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-white truncate">{salon.name}</h1>
              <p className="text-xs text-white/85 truncate">{salon.tagline || [salon.city, salon.businessType].filter(Boolean).join(' · ')}</p>
            </div>
            <button
              type="button"
              onClick={toggleSave}
              title={userId ? 'Save or unsave this salon' : 'Sign in to save salons'}
              className="w-9 h-9 rounded-xl bg-white/95 flex items-center justify-center shrink-0 cursor-pointer hover:bg-white"
            >
              <Heart className={`w-4 h-4 ${isFavourite ? 'fill-rose-600 text-rose-600' : 'text-slate-600'}`} />
            </button>
          </div>
        </div>

        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            label="Rating"
            value={salon.rating.count ? `${salon.rating.average.toFixed(1)} / 5` : '—'}
            hint={salon.rating.count ? `${salon.rating.count} review${salon.rating.count > 1 ? 's' : ''}` : 'no reviews stored yet'}
            accentHex={accentHex}
          />
          <StatTile label="Services" value={String(salon.serviceCount || services.length)} hint="from the salon menu" />
          <StatTile label="Team" value={String(staff.length)} hint="bookable staff" />
          <StatTile label="Deposit" value={salon.requireDeposit ? `${salon.depositPercentage}%` : 'None'} hint={salon.requireDeposit ? 'paid online' : 'pay at the salon'} />
        </div>

        <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
          <Chip tone="neutral">
            <MapPin className="w-3 h-3" /> {salon.address || 'Address not set'}{salon.city ? `, ${salon.city}` : ''}
          </Chip>
          {salon.distanceKm !== null ? <Chip tone="accent">{salon.distanceKm} km away</Chip> : null}
          {salon.phone ? <Chip tone="neutral"><Clock className="w-3 h-3" /> {salon.phone}</Chip> : null}
          {salon.workingHours.monFri ? <Chip tone="neutral">Mon–Fri {salon.workingHours.monFri}</Chip> : null}
          {salon.workingHours.sunday ? <Chip tone="neutral">Sun {salon.workingHours.sunday}</Chip> : null}
          <SourceChip source="supabase" mode={salonState.mode} loading={salonState.loading} title={mappingNote('salons')} />
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-100 w-fit">
        {(['overview', 'services', 'staff', 'reviews'] as SalonTab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onTab(value)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize cursor-pointer transition-colors ${
              tab === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {value === 'reviews' && salon.rating.count ? `reviews (${salon.rating.count})` : value}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className={`${CARD_CLASS} p-5 space-y-4`}>
          <SectionTitle title={`About ${salon.name}`} subtitle="Written by the salon owner" action={<Button onClick={() => onBook()} accentHex={accentHex}><Calendar className="w-4 h-4" /> Book a slot</Button>} />
          <p className={`text-sm leading-relaxed ${MUTED_CLASS}`}>{salon.about || 'This salon has not written an about section yet.'}</p>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <InfoRow label="Home visits" value={salon.homeServiceEnabled ? 'Available — check the booking step' : 'Not offered by this salon'} />
            <InfoRow label="Sub-domain" value={salon.subdomain ? `${salon.subdomain}` : '—'} />
            <InfoRow label="Instagram" value={salon.instagram ? `@${salon.instagram.replace(/^@/, '')}` : 'Not linked'} />
            <InfoRow label="Currency" value={salon.currency} />
          </div>
        </div>
      ) : null}

      {tab === 'overview' && salon.gallery.length ? (
        <div className={`${CARD_CLASS} p-4`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">From this salon</p>
            <p className={`text-[11px] ${MUTED_CLASS}`} title="One row per entry in social_videos, ordered as the salon sorted them">
              {salon.gallery.length} published item{salon.gallery.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="mt-2.5 flex gap-3 overflow-x-auto pb-1">
            {salon.gallery.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="w-40 shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-slate-50"
              >
                <span className="block h-24 bg-slate-200 relative">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-slate-400 text-[11px] font-bold">no thumbnail</span>
                  )}
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block text-[11px] font-bold text-slate-800 truncate">{item.title}</span>
                  <span className="block text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{item.kind}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'services' ? (
        <ServiceList
          services={services}
          state={servicesState}
          accentHex={accentHex}
          onBook={(ids) => onBook(ids)}
          salonName={salon.name}
          currency={salon.currency}
          savedIds={savedServiceIds}
          onToggleSave={toggleServiceSave}
        />
      ) : null}

      {tab === 'staff' ? (
        <StaffList staff={staff} state={staffState} salonName={salon.name} savedIds={savedStaffIds} onToggleSave={toggleStaffSave} />
      ) : null}

      {tab === 'reviews' ? <ReviewList reviews={reviews} state={reviewsState} rating={salon.rating} /> : null}
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-sm font-semibold text-slate-800 mt-0.5 break-words">{value}</p>
  </div>
);

export const ServiceList: React.FC<{
  services: CustomerService[];
  state: { loading: boolean; failed: boolean; error: string; reload: () => void; mode: 'live' | 'mock'; notice?: string };
  accentHex: string;
  salonName: string;
  onBook: (serviceIds: string[]) => void;
  selected?: string[];
  onToggle?: (id: string) => void;
  compact?: boolean;
  currency?: string;
  /** Ids the customer has favourited, for the heart on each row. */
  savedIds?: string[];
  onToggleSave?: (service: CustomerService) => void;
}> = ({ services, state, accentHex, salonName, onBook, selected = [], onToggle, compact, currency = '₹', savedIds = [], onToggleSave }) => {
  if (state.loading) return <LoadingRows rows={4} label={`Loading ${salonName}'s menu…`} />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!services.length) {
    return (
      <EmptyState
        icon={<Sparkles className="w-6 h-6 text-slate-400" />}
        title="This salon has no services listed"
        body="Nothing in the `services` table for this salon yet. The owner adds them in Service Management, and they appear here immediately."
      />
    );
  }
  const grouped = new Map<string, CustomerService[]>();
  for (const service of services) {
    const list = grouped.get(service.category) || [];
    list.push(service);
    grouped.set(service.category, list);
  }
  return (
    <div className={`${CARD_CLASS} divide-y divide-slate-100`}>
      {[...grouped.entries()].map(([category, rows]) => (
        <div key={category} className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">{category}</p>
          <div className="space-y-2">
            {rows.map((service) => {
              const isSelected = selected.includes(service.id);
              return (
                <div key={service.id} className={`flex items-start gap-3 rounded-2xl border p-3 ${isSelected ? 'border-transparent' : 'border-slate-100'}`} style={isSelected ? { backgroundColor: '#fff1f5' } : undefined}>
                  {onToggle ? (
                    <button
                      type="button"
                      onClick={() => onToggle(service.id)}
                      aria-pressed={isSelected}
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 cursor-pointer ${isSelected ? 'text-white' : 'bg-white'}`}
                      style={isSelected ? { backgroundColor: accentHex, borderColor: accentHex } : undefined}
                    >
                      {isSelected ? <CheckGlyph /> : null}
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-900">{service.name}</p>
                      {service.popular ? <Chip tone="accent">popular</Chip> : null}
                      {service.discountLabel ? (
                        <Chip tone="success" title="A discount this salon published in loyalty_rewards for this category">
                          {service.discountLabel}
                        </Chip>
                      ) : null}
                    </div>
                    {service.description ? <p className={`text-xs mt-1 ${MUTED_CLASS}`}>{service.description}</p> : null}
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      <span className="font-extrabold text-slate-900">{money(service.price, currency)}</span>
                      {service.showDuration ? (
                        <span className={`inline-flex items-center gap-1 ${MUTED_CLASS}`}>
                          <Clock className="w-3.5 h-3.5" /> {service.durationMinutes} min
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {compact ? null : (
                    <button type="button" onClick={() => onBook([service.id])} className="shrink-0 text-xs font-bold cursor-pointer hover:underline" style={{ color: accentHex }}>
                      Book
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const CheckGlyph = () => (
  <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M5 10.5 8.5 14 15 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const StaffList: React.FC<{
  staff: CustomerStaff[];
  state: { loading: boolean; failed: boolean; error: string; reload: () => void };
  salonName: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  accentHex?: string;
  savedIds?: string[];
  onToggleSave?: (member: CustomerStaff) => void;
}> = ({ staff, state, salonName, selectedId, onSelect, accentHex = '#C20E5A', savedIds = [], onToggleSave }) => {
  if (state.loading) return <LoadingRows rows={3} label={`Loading ${salonName}'s team…`} />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!staff.length) {
    return (
      <EmptyState
        icon={<Users className="w-6 h-6 text-slate-400" />}
        title="No staff are bookable at this salon"
        body="The `stylists` table has no active rows for this salon (or every member is marked Inactive, which hides them from booking)."
      />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {staff.map((member) => (
        <div key={member.id} className={`${CARD_CLASS} p-4 ${selectedId === member.id ? 'ring-2' : ''}`} style={selectedId === member.id ? ({ ['--tw-ring-color' as any]: accentHex } as any) : undefined}>
          <div className="flex items-start gap-3">
            <Avatar src={member.avatarUrl} name={member.name} size={44} />
            {onToggleSave ? (
              <div className="ml-auto shrink-0">
                <SaveButton saved={savedIds.includes(member.id)} label={member.name} onSave={() => onToggleSave(member)} />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 truncate">{member.name}</p>
              <p className={`text-xs ${MUTED_CLASS}`}>{member.role}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {member.rating > 0 ? (
                  <Chip tone="neutral" title="Average rating the salon configured for this stylist">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {member.rating.toFixed(1)}
                  </Chip>
                ) : null}
                <Chip tone={member.status === 'Available' ? 'success' : member.status === 'On Leave' ? 'warn' : 'neutral'}>{member.status}</Chip>
                {member.scheduleConfigured ? <Chip tone="neutral" title="This stylist has their own weekly schedule, so slot times are personal"><Clock className="w-3 h-3" /> own hours</Chip> : null}
              </div>
              {member.specialties.length ? <p className={`text-xs mt-2 ${MUTED_CLASS}`}>{member.specialties.join(' · ')}</p> : null}
              {member.bio ? <p className="text-xs text-slate-500 mt-2 line-clamp-2">{member.bio}</p> : null}
              {member.phone ? <p className="text-xs text-slate-500 mt-2">{member.phone}</p> : null}
            </div>
          </div>
          {onSelect ? (
            <Button variant={selectedId === member.id ? 'primary' : 'secondary'} onClick={() => onSelect(member.id)} accentHex={accentHex} className="w-full mt-3">
              {selectedId === member.id ? 'Selected' : 'Choose this stylist'}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export const ReviewList: React.FC<{
  reviews: CustomerReview[];
  state: { loading: boolean; failed: boolean; error: string; reload: () => void; mode?: 'live' | 'mock' };
  rating: { average: number; count: number };
}> = ({ reviews, state, rating }) => {
  if (state.loading) return <LoadingRows rows={3} label="Loading reviews left on completed bookings…" />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!reviews.length) {
    return (
      <EmptyState
        icon={<Star className="w-6 h-6 text-slate-400" />}
        title="No reviews for this salon yet"
        body="Reviews are written by customers after a visit is marked completed, so this stays empty until someone rates an appointment. Nothing here is invented."
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className={`${CARD_CLASS} px-4 py-3 flex items-center gap-3`}>
        <span className="text-2xl font-extrabold text-slate-900">{rating.average.toFixed(1)}</span>
        <div>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <Star key={value} className={`w-3.5 h-3.5 ${value <= Math.round(rating.average) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
            ))}
          </div>
          <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
            {rating.count} review{rating.count === 1 ? '' : 's'} · average of every stored rating
          </p>
        </div>
        <div className="ml-auto">
          <SourceChip source="supabase" mode={state.mode} loading={state.loading} title={mappingNote('reviews')} />
        </div>
      </div>
      {reviews.map((review) => (
        <div key={review.id} className={`${CARD_CLASS} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <Star key={value} className={`w-3.5 h-3.5 ${value <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
              ))}
            </div>
            <span className={`text-xs ${MUTED_CLASS}`}>{review.visitedOn ? new Date(`${review.visitedOn}T12:00:00`).toLocaleDateString() : 'recently'}</span>
          </div>
          {review.text ? <p className="text-sm text-slate-700 mt-2">{review.text}</p> : null}
          {review.serviceName ? <p className={`text-xs mt-2 ${MUTED_CLASS}`}>for {review.serviceName}</p> : null}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// A tiny loader shared by the salon screen's four panels.
// ---------------------------------------------------------------------------
export function useCustomerLoad(loader: () => Promise<any>, deps: React.DependencyList) {
  const [state, setState] = useState<{ data: any; loading: boolean; failed: boolean; error: string; notice: string; mode: 'live' | 'mock' }>({
    data: null,
    loading: true,
    failed: false,
    error: '',
    notice: '',
    mode: 'live',
  });
  const [key, setKey] = useState(0);
  const ref = React.useRef(loader);
  ref.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, failed: false }));
    void (async () => {
      const result = await ref.current();
      if (cancelled) return;
      if (result.ok) {
        setState({ data: result.data ?? null, loading: false, failed: false, error: '', notice: result.notice || '', mode: result.mode || 'live' });
      } else {
        setState({ data: null, loading: false, failed: true, error: result.error || 'The request failed.', notice: '', mode: 'live' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key]);

  return { ...state, reload: () => setKey((value) => value + 1), setData: (data: any) => setState((prev) => ({ ...prev, data, failed: false, loading: false })) };
}
