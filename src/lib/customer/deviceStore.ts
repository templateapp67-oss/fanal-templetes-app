// ============================================================================
// Device-scoped persistence for the two customer entities that have no home in
// the existing schema (manual favourite pins and recent searches), plus the
// customer's chosen location.
//
// Why not Supabase: the app is forbidden from creating tables or columns, and
// `profiles`/`clients` have no column that means "favourite salon" or "last
// search". Bolting them onto an unrelated jsonb column would corrupt data the
// owner's screens read. So these live on-device, namespaced by the signed-in
// customer id, and every payload reports `source: 'device'` — the UI says so
// out loud instead of pretending the row came from the database.
//
// Quota-safe by construction: this reuses the same `safeWriteLocalStorage`
// helper the salon editor uses, which retries and reports instead of throwing.
// ============================================================================

import { safeWriteLocalStorage } from '../autoSave';
import type { CustomerFavourite, CustomerLocation, SearchHistoryItem } from './types';

const KEY_PREFIX = 'nexora_customer_v1';
const MAX_ITEMS = 40;

function namespace(customerId: string | null | undefined, suffix: string): string {
  // Without a customer id the bucket is per-tab, so a logged-out visitor never
  // writes into the next person's account on the same device.
  return `${KEY_PREFIX}:${customerId || 'anonymous'}:${suffix}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    const result = safeWriteLocalStorage(key, JSON.stringify(value));
    return result.ok !== false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Language preference
// ---------------------------------------------------------------------------

const SUPPORTED_LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'bn', 'mr', 'gu', 'pa'] as const;

export const CUSTOMER_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'mr', label: 'मराठी' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
];

export function isSupportedLanguage(code: unknown): code is string {
  return typeof code === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * The app renders English copy today; this preference is stored so the choice is
 * not lost when the strings become translatable, and it sets `document.lang`
 * now. It is deliberately NOT written to Supabase: no column in this schema
 * means "language", and inventing one is out of bounds.
 */
export function readLanguage(customerId: string | null | undefined): string {
  const stored = readJson<{ language?: string }>(namespace(customerId, 'preferences'), {}).language || '';
  return isSupportedLanguage(stored) ? stored : 'en';
}

export function writeLanguage(customerId: string | null | undefined, language: string): boolean {
  if (!isSupportedLanguage(language)) return false;
  const current = readJson<{ language?: string }>(namespace(customerId, 'preferences'), {});
  return writeJson(namespace(customerId, 'preferences'), { ...current, language });
}

// ---------------------------------------------------------------------------
// Favourite pins
// ---------------------------------------------------------------------------

export interface FavouritePin {
  salonId: string;
  staffId?: string;
  serviceId?: string;
  kind: 'salon' | 'staff' | 'service';
  salonName?: string;
  staffName?: string;
  serviceName?: string;
  pinnedAt: string;
}

export function readFavouritePins(customerId: string | null | undefined): FavouritePin[] {
  const rows = readJson<FavouritePin[]>(namespace(customerId, 'favourites'), []);
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (!row || !row.salonId) return false;
    if (row.kind === 'salon') return true;
    // A staff or service pin without its subject id would collide with every
    // other pin at that salon, so a malformed row is dropped rather than guessed.
    if (row.kind === 'staff') return !!row.staffId;
    if (row.kind === 'service') return !!row.serviceId;
    return false;
  });
}

export function writeFavouritePins(
  customerId: string | null | undefined,
  pins: FavouritePin[]
): boolean {
  return writeJson(namespace(customerId, 'favourites'), pins.slice(0, MAX_ITEMS));
}

export function isPinned(
  pins: FavouritePin[],
  input: { salonId: string; staffId?: string; serviceId?: string; kind: 'salon' | 'staff' | 'service' }
): boolean {
  return pins.some(
    (pin) =>
      pin.salonId === input.salonId &&
      pin.kind === input.kind &&
      (input.kind === 'salon' || (input.kind === 'staff' ? pin.staffId === input.staffId : pin.serviceId === input.serviceId))
  );
}

/** Merge the derived (real bookings) half with the customer's own pins. */
export function mergeFavourites(derived: CustomerFavourite[], pins: FavouritePin[]): CustomerFavourite[] {
  const byKey = new Map<string, CustomerFavourite>();
  for (const row of derived) {
    const key = `${row.kind}:${row.salonId}:${row.staffId || row.serviceId || ''}`;
    byKey.set(key, { ...row, source: row.origin === 'pinned' ? 'device' : 'derived' });
  }
  for (const pin of pins) {
    const key = `${pin.kind}:${pin.salonId}:${pin.staffId || pin.serviceId || ''}`;
    if (byKey.has(key)) {
      const existing = byKey.get(key)!;
      byKey.set(key, { ...existing, origin: 'pinned', source: 'device' });
      continue;
    }
    byKey.set(key, {
      id: key,
      salonId: pin.salonId,
      salonName: pin.salonName || 'Saved salon',
      staffId: pin.staffId || '',
      staffName: pin.staffName || '',
      serviceId: pin.serviceId || '',
      serviceName: pin.serviceName || '',
      kind: pin.kind,
      origin: 'pinned',
      lastVisit: '',
      visits: 0,
      source: 'device',
    });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'pinned' ? -1 : 1;
    return String(b.lastVisit || '').localeCompare(String(a.lastVisit || ''));
  });
}

// ---------------------------------------------------------------------------
// Search history
// ---------------------------------------------------------------------------

export function readSearchHistory(customerId: string | null | undefined): SearchHistoryItem[] {
  const rows = readJson<SearchHistoryItem[]>(namespace(customerId, 'search_history'), []);
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.query === 'string') : [];
}

export function pushSearchHistory(
  customerId: string | null | undefined,
  query: string,
  city: string
): SearchHistoryItem[] {
  const clean = String(query || '').trim().slice(0, 80);
  if (!clean) return readSearchHistory(customerId);
  const existing = readSearchHistory(customerId);
  const key = `${clean.toLowerCase()}|${String(city || '').toLowerCase()}`;
  const found = existing.find((row) => `${row.query.toLowerCase()}|${row.city.toLowerCase()}` === key);
  const next: SearchHistoryItem[] = found
    ? existing.map((row) =>
        row === found
          ? { ...row, usedAt: new Date().toISOString(), count: Number(row.count || 0) + 1, source: 'device' as const }
          : row
      )
    : [
        {
          id: key,
          query: clean,
          city: String(city || '').trim(),
          usedAt: new Date().toISOString(),
          count: 1,
          source: 'device',
        },
        ...existing,
      ];
  const ordered = next.sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt))).slice(0, MAX_ITEMS);
  writeJson(namespace(customerId, 'search_history'), ordered);
  return ordered;
}

export function clearSearchHistory(customerId: string | null | undefined): SearchHistoryItem[] {
  writeJson(namespace(customerId, 'search_history'), []);
  return [];
}

// ---------------------------------------------------------------------------
// Location (the customer's own; profiles columns are the durable copy)
// ---------------------------------------------------------------------------

export function readLocation(customerId: string | null | undefined): CustomerLocation | null {
  const row = readJson<CustomerLocation | null>(namespace(customerId, 'location'), null);
  if (!row || typeof row !== 'object') return null;
  return {
    city: String(row.city || ''),
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
    label: String(row.label || ''),
    source: row.source === 'gps' || row.source === 'manual' ? row.source : 'profile',
    updatedAt: String(row.updatedAt || ''),
  };
}

export function writeLocation(customerId: string | null | undefined, location: CustomerLocation): boolean {
  return writeJson(namespace(customerId, 'location'), location);
}

/** Ask the browser for a fix. Never throws; reports why it failed. */
export interface GeolocationOutcome {
  ok: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number;
  error: string;
}

export function requestBrowserLocation(): Promise<GeolocationOutcome> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, latitude: null, longitude: null, accuracyMeters: 0, error: 'This browser cannot share a location. Pick your city instead.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy || 0),
          error: '',
        }),
      (err) =>
        resolve({
          ok: false,
          latitude: null,
          longitude: null,
          accuracyMeters: 0,
          error:
            err?.code === 1
              ? 'Location permission was declined. Pick your city instead.'
              : 'Could not read your location right now. Pick your city instead.',
        }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

/**
 * Best-effort city for a coordinate using the app's own API.
 * No third-party key: the geocoding call goes through `/api/customer/geocode`,
 * which the server answers from its own Supabase data (nearest published salon).
 */
export function reverseGeocodeCity(latitude: number, longitude: number): Promise<string> {
  return fetch(`/api/customer/geocode${latitude !== undefined ? `?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}` : ''}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((json) => String(json?.data?.city || ''))
    .catch(() => '');
}
