import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isMockSupabase } from './lib/supabaseClient';
import { AppView, SalonProfile, SalonService, Stylist, Appointment, ClientRecord, BusinessTypeId, LoyaltyConfig, RewardThreshold } from './types';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS, INITIAL_APPOINTMENTS, INITIAL_CLIENTS } from './mockData';
import { CATEGORY_TEMPLATES } from './categoryTemplates';
import { ACCENT_PALETTES, applyPrimaryAccentCssVar, AccentPaletteKey } from './themeAccents';
import { DEFAULT_LOYALTY_CONFIG, calculateLoyaltyTier } from './loyaltyData';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { WebsiteEditor } from './components/WebsiteEditor';
import { SalonWebsitePreview } from './components/SalonWebsitePreview';
import { SaaSDashboard } from './components/SaaSDashboard';
import { AuthModal } from './components/AuthModal';
import {
  loadSalonState,
  saveSalonState,
  mergeTemplatePreservingUserData,
  mergeTemplateServices,
  mergeTemplateStylists,
  getSiteUrl,
  ONBOARDING_COMPLETED_KEY,
} from './lib/salonStore';
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVE_STATUS_RESET_MS,
  SaveStatus,
  describeError,
  summarizeSaveError,
  withRetry,
} from './lib/autoSave';
import { syncSalonToSupabase, applyWorkingHoursFromRow } from './lib/salonSync';

// ---------------------------------------------------------------------------
// Supabase row <-> App type mappers.
// The DB schema uses snake_case columns; the app types use camelCase.
// ---------------------------------------------------------------------------
function toAppointment(row: any): Appointment {
  return {
    id: row.id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientEmail: row.client_email,
    serviceId: row.service_id,
    serviceName: row.service_name,
    servicePrice: Number(row.service_price ?? 0),
    stylistId: row.stylist_id,
    stylistName: row.stylist_name,
    date: row.date,
    time: row.time,
    status: row.status,
    paymentStatus: row.payment_status,
    amountPaid: Number(row.amount_paid ?? 0),
    createdAt: row.created_at,
  };
}

function toClientRecord(row: any): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    totalVisits: row.total_visits ?? 0,
    totalSpent: Number(row.total_spent ?? 0),
    lastVisit: row.last_visit,
    notes: row.notes,
    favoriteStylist: row.favorite_stylist,
    points: row.points ?? 0,
    lifetimePoints: row.lifetime_points ?? 0,
    loyaltyTier: row.loyalty_tier,
    pointHistory: row.point_history,
    redeemedRewards: row.redeemed_rewards,
  };
}

function toAppointmentInsert(apt: Appointment, ownerId?: string | null) {
  return {
    id: apt.id,
    owner_id: ownerId || null,
    client_name: apt.clientName,
    client_phone: apt.clientPhone,
    client_email: apt.clientEmail,
    service_id: apt.serviceId,
    service_name: apt.serviceName,
    service_price: apt.servicePrice,
    stylist_id: apt.stylistId,
    stylist_name: apt.stylistName,
    date: apt.date,
    time: apt.time,
    status: apt.status,
    payment_status: apt.paymentStatus,
    amount_paid: apt.amountPaid,
    created_at: apt.createdAt,
  };
}

function toClientInsert(c: ClientRecord, ownerId?: string | null) {
  return {
    id: c.id,
    owner_id: ownerId || null,
    name: c.name,
    phone: c.phone,
    email: c.email,
    total_visits: c.totalVisits,
    total_spent: c.totalSpent,
    last_visit: c.lastVisit,
    notes: c.notes,
    favorite_stylist: c.favoriteStylist,
    points: c.points,
    lifetime_points: c.lifetimePoints,
    loyalty_tier: c.loyaltyTier,
    point_history: c.pointHistory,
    redeemed_rewards: c.redeemedRewards,
  };
}

function toClientUpdate(c: ClientRecord) {
  return {
    total_visits: c.totalVisits,
    total_spent: c.totalSpent,
    last_visit: c.lastVisit,
    points: c.points,
    lifetime_points: c.lifetimePoints,
    loyalty_tier: c.loyaltyTier,
    point_history: c.pointHistory,
    redeemed_rewards: c.redeemedRewards,
  };
}

// -- services -------------------------------------------------------------
function fromServiceRow(row: any): SalonService {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    icon: row.icon,
    price: Number(row.price ?? 0),
    durationMinutes: row.duration_minutes ?? 45,
    popular: row.popular ?? false,
    showDuration: row.show_duration ?? true,
  };
}

// -- stylists -------------------------------------------------------------
function fromStylistRow(row: any): Stylist {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    phone: row.phone,
    specialties: row.specialties || [],
    assignedServices: row.assigned_services || [],
    rating: Number(row.rating ?? 5),
    commissionRate: row.commission_rate ?? 0,
    status: row.status,
    accessRole: row.access_role,
    hidePhone: row.hide_phone ?? false,
    schedule: row.schedule,
  };
}

// -- loyalty --------------------------------------------------------------
function fromLoyaltyConfigRow(row: any): LoyaltyConfig {
  if (!row) return DEFAULT_LOYALTY_CONFIG;
  return {
    ...DEFAULT_LOYALTY_CONFIG,
    programEnabled: row.program_enabled ?? true,
    pointsPerVisit: row.points_per_visit ?? 10,
    pointsPerHundredSpent: row.points_per_hundred_spent ?? 10,
    tierThresholds: row.tier_thresholds || DEFAULT_LOYALTY_CONFIG.tierThresholds,
    tierMultipliers: row.tier_multipliers || DEFAULT_LOYALTY_CONFIG.tierMultipliers,
  };
}

function fromRewardRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    requiredPoints: row.required_points ?? 0,
    rewardType: row.reward_type,
    discountValue: Number(row.discount_value ?? 0),
    applicableCategory: row.applicable_category,
    description: row.description,
    isActive: row.is_active ?? true,
    couponCodePrefix: row.coupon_code_prefix,
  };
}

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [wizardStartingStep, setWizardStartingStep] = useState<number>(1);

  // Auth State Listener
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  // Load the persistent salon state from localStorage on initial mount.
  const initialSaved = typeof window !== 'undefined' ? loadSalonState() : null;
  const previousTemplateIdRef = React.useRef<BusinessTypeId>(
    initialSaved?.selectedTemplateId || INITIAL_SALON_PROFILE.businessType
  );

  const [profile, setProfile] = useState<SalonProfile>(
    initialSaved?.profile || INITIAL_SALON_PROFILE
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);

  const [services, setServices] = useState<SalonService[]>(
    initialSaved?.services || INITIAL_SERVICES
  );
  const [stylists, setStylists] = useState<Stylist[]>(
    initialSaved?.stylists || INITIAL_STYLISTS
  );
  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS);
  const [clients, setClients] = useState<ClientRecord[]>(INITIAL_CLIENTS);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig>(
    initialSaved?.loyaltyConfig || DEFAULT_LOYALTY_CONFIG
  );

  // Active template id — the single source of truth across the whole app.
  const [selectedTemplateId, setSelectedTemplateId] = useState<BusinessTypeId>(
    initialSaved?.selectedTemplateId ||
      initialSaved?.profile?.businessType ||
      INITIAL_SALON_PROFILE.businessType
  );

  // -------------------------------------------------------------------------
  // WHITE-LABEL TENANT BOOTSTRAP
  // Supports:
  //   1. Subdomain / Host lookup (e.g. https://arts-by-uma.nexora.in)
  //   2. Vercel deployment query params (e.g. https://fanal-templetes-app.vercel.app/?site=arts-by-uma)
  //   3. Direct public view mode (?view=public)
  // -------------------------------------------------------------------------
  const [siteTenant, setSiteTenant] = useState<{
    isTenant: boolean;
    found: boolean;
    subdomain?: string;
    customDomain?: string | null;
    profile?: SalonProfile;
    services?: SalonService[];
    stylists?: Stylist[];
  } | null>(null);
  const [siteLoading, setSiteLoading] = useState<boolean>(true);
  // Computed before the hooks below so the auto-save engine can skip saving
  // when a visitor is viewing a salon's public white-label site.
  const isPublicSite = !!siteTenant?.isTenant && siteTenant.found;

  useEffect(() => {
    let cancelled = false;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const requestedSite = params?.get('site') || params?.get('subdomain') || params?.get('tenant');
    const isPublicParam = params?.get('view') === 'public' || params?.has('public');

    (async () => {
      try {
        if (requestedSite) {
          try {
            const res = await fetch(`/api/site/${encodeURIComponent(requestedSite)}`, { headers: { Accept: 'application/json' } });
            const data = await res.json();
            if (cancelled) return;
            if (data && data.found && data.salon) {
              setSiteTenant({
                isTenant: true,
                found: true,
                subdomain: requestedSite,
                customDomain: null,
                profile: data.salon?.profile || profile,
                services: data.salon?.services || services,
                stylists: data.salon?.stylists || stylists,
              });
              return;
            }
          } catch {
            // fallback below
          }

          // In-memory fallback for Arts By Uma or current active profile
          if (cancelled) return;
          setSiteTenant({
            isTenant: true,
            found: true,
            subdomain: requestedSite,
            customDomain: null,
            profile: profile,
            services: services,
            stylists: stylists,
          });
          return;
        }

        const res = await fetch('/api/site', { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (cancelled) return;
        if (data && data.isTenant) {
          setSiteTenant({
            isTenant: true,
            found: !!data.found,
            subdomain: data.tenant?.subdomain,
            customDomain: data.tenant?.customDomain,
            profile: data.salon?.profile || profile,
            services: data.salon?.services || services,
            stylists: data.salon?.stylists || stylists,
          });
        } else if (isPublicParam) {
          setSiteTenant({
            isTenant: true,
            found: true,
            subdomain: profile.subdomain || 'arts-by-uma',
            customDomain: null,
            profile: profile,
            services: services,
            stylists: stylists,
          });
        } else {
          setSiteTenant({ isTenant: false, found: false });
        }
      } catch (err) {
        console.warn('Could not resolve site tenant:', err);
        if (requestedSite || isPublicParam) {
          setSiteTenant({
            isTenant: true,
            found: true,
            subdomain: requestedSite || profile.subdomain || 'arts-by-uma',
            customDomain: null,
            profile: profile,
            services: services,
            stylists: stylists,
          });
        } else {
          setSiteTenant({ isTenant: false, found: false });
        }
      } finally {
        if (!cancelled) setSiteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Global save/update toast so the owner always knows their work is secure.
  const [toast, setToast] = useState<{ id: number; message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const firstPersistRef = useRef(true);
  // Stable identity so the debounced auto-save callback does not get recreated
  // (and its timer reset) on every unrelated re-render.
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      setToast({ id: Date.now(), message, type });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    },
    []
  );

  useEffect(() => {
    previousTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);

  // Auth State Listener
  useEffect(() => {
    if (isMockSupabase) {
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isMockSupabase) return;
    setProfile((prev) => ({ ...prev, ownerId: user?.id ?? undefined }));
  }, [user?.id, isMockSupabase]);

  // Auto-Fetch Profile Sync
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user || isMockSupabase) return;

      const meta = user.user_metadata || {};

      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (data) {
          setProfile((prev) =>
            applyWorkingHoursFromRow(
              {
                ...prev,
                businessName: data.salon_name || meta.salon_name || prev.businessName,
                ownerName: data.full_name || meta.full_name || prev.ownerName,
                ownerRole: data.owner_role || prev.ownerRole,
                phone: data.phone_number || meta.phone_number || prev.phone,
                whatsapp: data.whatsapp || prev.whatsapp,
                email: data.email || user.email || prev.email,
                ownerPhotoUrl: data.owner_photo_url || prev.ownerPhotoUrl,
                coverImageUrl: data.cover_image_url || prev.coverImageUrl,
                tagline: data.tagline || prev.tagline,
                about: data.about || prev.about,
                address: data.full_address || prev.address,
                city: data.city || meta.city || prev.city,
                postalCode: data.postal_code || prev.postalCode,
                landmark: data.landmark || prev.landmark,
                subdomain: data.subdomain || prev.subdomain,
                instagramHandle: data.instagram_handle || prev.instagramHandle,
                themePreset: data.theme_preset || prev.themePreset,
                themeAccentKey: data.theme_accent_key || prev.themeAccentKey,
                customAccentColor: data.custom_accent_color || prev.customAccentColor,
              },
              data
            )
          );
        } else {
          setProfile((prev) => ({
            ...prev,
            businessName: meta.salon_name || prev.businessName,
            ownerName: meta.full_name || prev.ownerName,
            phone: meta.phone_number || prev.phone,
            email: user.email || prev.email,
            city: meta.city || prev.city,
          }));
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    };

    fetchProfile();
  }, [user]);

  // Sync Supabase Realtime Data
  useEffect(() => {
    const fetchSyncData = async () => {
      if (isMockSupabase) return;
      try {
        const { data: apts } = await supabase.from('appointments').select('*').order('date', { ascending: false });
        if (apts && apts.length > 0) setAppointments(apts.map(toAppointment));

        const { data: clis } = await supabase.from('clients').select('*').order('last_visit', { ascending: false });
        if (clis && clis.length > 0) setClients(clis.map(toClientRecord));
      } catch (err) {
        console.warn('Could not sync with Supabase', err);
      }
    };

    fetchSyncData();
    const interval = setInterval(fetchSyncData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Hydrate services / staff / loyalty from Supabase once the owner logs in.
  // The cloud sync only performs *destructive* cleanup (deleting rows removed
  // in the editor) after this hydration has succeeded, so a client that failed
  // to load existing rows can never wipe them.
  const hydratedForUserRef = useRef(false);
  const hydrationErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || isMockSupabase) return;
    let cancelled = false;
    hydratedForUserRef.current = false;
    hydrationErrorRef.current = null;

    const hydrate = () =>
      withRetry(
        async () => {
          const [svc, stf, lc, rw] = await Promise.all([
            supabase.from('services').select('*').order('sort_order'),
            supabase.from('stylists').select('*').order('sort_order'),
            supabase.from('loyalty_config').select('*').eq('owner_id', user.id).maybeSingle(),
            supabase.from('loyalty_rewards').select('*').eq('owner_id', user.id).order('sort_order'),
          ]);
          const selectError = svc.error || stf.error || lc.error || rw.error;
          if (selectError) throw selectError;
          if (cancelled) return;
          return { svc, stf, lc, rw };
        },
        { label: 'hydrate salon data from cloud' }
      );

    (async () => {
      try {
        const result = await hydrate();
        if (cancelled || !result) return;

        const { svc, stf, lc, rw } = result;
        if (svc.data && svc.data.length) setServices(svc.data.map(fromServiceRow));
        if (stf.data && stf.data.length) setStylists(stf.data.map(fromStylistRow));
        if (lc.data) {
          setLoyaltyConfig((prev) => ({
            ...fromLoyaltyConfigRow(lc.data),
            rewards:
              rw.data && rw.data.length
                ? (rw.data.map(fromRewardRow) as RewardThreshold[])
                : prev.rewards,
          }));
        }
        hydratedForUserRef.current = true;
      } catch (err) {
        // Hydration failed even after retries — keep the flag false so the
        // save flow reports the problem instead of overwriting cloud data it
        // never managed to read.
        hydrationErrorRef.current = describeError(err);
        console.error('[AutoSave] Cloud hydration failed:', hydrationErrorRef.current);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, isMockSupabase]);

  // -------------------------------------------------------------------------
  // AUTO-SAVE ENGINE
  // Any change to the salon state (Salon Details, Services & Pricing,
  // Timings, Sub-domain, theme, staff, loyalty…) schedules a debounced save
  // that persists to localStorage immediately and to Supabase when the owner
  // is signed in. Network failures retry with backoff and surface the exact
  // error; the status pill in the editor shows Saving… / All changes saved /
  // Save failed.
  // -------------------------------------------------------------------------
  // Always-fresh snapshot of the salon state so a debounced (or flushed) save
  // can never persist a stale closure.
  const salonStateRef = useRef({ profile, services, stylists, loyaltyConfig, selectedTemplateId, user });
  salonStateRef.current = { profile, services, stylists, loyaltyConfig, selectedTemplateId, user };

  const debounceTimerRef = useRef<number | undefined>(undefined);
  const statusResetTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const resaveAfterFlightRef = useRef(false);
  const hasPendingSaveRef = useRef(false);
  const lastErrorToastRef = useRef<string>('');
  // Skip no-op saves (mount effects, reverted edits) by comparing snapshots.
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  if (lastPersistedSnapshotRef.current === null) {
    lastPersistedSnapshotRef.current = JSON.stringify({
      profile,
      services,
      stylists,
      loyaltyConfig,
      selectedTemplateId,
    });
  }

  const snapshotOf = (state: typeof salonStateRef.current) =>
    JSON.stringify({
      profile: state.profile,
      services: state.services,
      stylists: state.stylists,
      loyaltyConfig: state.loyaltyConfig,
      selectedTemplateId: state.selectedTemplateId,
    });

  const scheduleStatusReset = useCallback(() => {
    if (statusResetTimerRef.current) window.clearTimeout(statusResetTimerRef.current);
    statusResetTimerRef.current = window.setTimeout(
      () => setSaveStatus('idle'),
      SAVE_STATUS_RESET_MS
    );
  }, []);

  const persistSalonState = useCallback(
    async (options?: { source?: 'auto' | 'manual'; message?: string }): Promise<boolean> => {
      const source = options?.source ?? 'manual';
      const state = salonStateRef.current;

      // Coalesce auto-saves: if one is already running, remember to run again
      // afterwards so the newest state always lands.
      if (saveInFlightRef.current && source === 'auto') {
        resaveAfterFlightRef.current = true;
        return false;
      }

      const snapshot = snapshotOf(state);
      if (snapshot === lastPersistedSnapshotRef.current) {
        // Nothing actually changed — don't hammer localStorage/Supabase.
        if (source === 'manual') {
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
          showToast(options?.message || 'Website details updated successfully!');
          scheduleStatusReset();
          return true;
        }
        setSaveStatus((prev) => (prev === 'pending' ? 'idle' : prev));
        return true;
      }

      saveInFlightRef.current = true;
      if (statusResetTimerRef.current) window.clearTimeout(statusResetTimerRef.current);
      setSaveStatus('saving');
      const failures: string[] = [];

      try {
        // -- 1) Local persistence (never throws; quota-aware) ---------------
        const local = saveSalonState({
          profile: state.profile,
          services: state.services,
          stylists: state.stylists,
          loyaltyConfig: state.loyaltyConfig,
          selectedTemplateId: state.selectedTemplateId,
        });
        if (!local.ok) {
          failures.push(`local storage: ${local.error}`);
          console.error('[AutoSave] localStorage write failed:', local.error);
        } else if (local.degraded) {
          // Saved, but inline images had to be dropped to fit the quota.
          console.warn('[AutoSave] localStorage quota exceeded — saved without inline images:', local.error);
        }

        // -- 2) Cloud persistence (signed-in owners with a real project) ---
        if (state.user && !isMockSupabase) {
          if (!hydratedForUserRef.current) {
            // Never write over cloud rows we failed to read — that used to
            // duplicate/delete data after a flaky login.
            const reason = hydrationErrorRef.current
              ? `hydration failed: ${hydrationErrorRef.current}`
              : 'hydration still pending';
            failures.push(`cloud sync skipped (${reason})`);
            console.error('[AutoSave] Cloud sync skipped because', reason);
          } else {
            const cloud = await syncSalonToSupabase(
              supabase,
              {
                ownerId: state.user.id,
                profile: state.profile,
                services: state.services,
                stylists: state.stylists,
                loyaltyConfig: state.loyaltyConfig,
              },
              { deleteRemoved: true }
            );
            if (!cloud.ok) failures.push(...cloud.errors);
          }
        }

        if (failures.length) {
          const detail = failures.join(' · ');
          console.error('[AutoSave] Save failed:', detail);
          setSaveStatus('error');
          // Show the root cause in the toast (throttled so a burst of edits
          // doesn't spam identical errors), keep the full detail in console.
          if (source === 'manual' || lastErrorToastRef.current !== detail) {
            showToast(`Save failed: ${summarizeSaveError(detail)}`, 'error');
          }
          lastErrorToastRef.current = detail;
          return false;
        }

        lastPersistedSnapshotRef.current = snapshot;
        lastErrorToastRef.current = '';
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        // Auto-saves update quietly via the status pill; only explicit saves
        // interrupt the owner with a toast.
        if (source === 'manual') {
          showToast(options?.message || 'Website details updated successfully!');
        }
        scheduleStatusReset();
        return true;
      } catch (err) {
        // Unexpected (programming) errors — surface with full detail.
        const detail = describeError(err);
        console.error('[AutoSave] Unexpected save failure:', err);
        setSaveStatus('error');
        showToast(`Save failed: ${summarizeSaveError(detail)}`, 'error');
        lastErrorToastRef.current = detail;
        return false;
      } finally {
        saveInFlightRef.current = false;
        if (resaveAfterFlightRef.current) {
          resaveAfterFlightRef.current = false;
          void persistSalonState({ source: 'auto' });
        }
      }
    },
    [showToast, scheduleStatusReset]
  );

  // Debounced auto-save. The timer resets on every keystroke so a burst of
  // edits becomes a single save ~1.2s after the last change.
  useEffect(() => {
    if (firstPersistRef.current) {
      firstPersistRef.current = false;
      return;
    }
    if (isPublicSite) return; // visitors on a public salon site never save
    if (statusResetTimerRef.current) window.clearTimeout(statusResetTimerRef.current);
    setSaveStatus('pending');
    hasPendingSaveRef.current = true;
    const timer = window.setTimeout(() => {
      hasPendingSaveRef.current = false;
      void persistSalonState({ source: 'auto' });
    }, AUTOSAVE_DEBOUNCE_MS);
    debounceTimerRef.current = timer;
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile,
    services,
    stylists,
    loyaltyConfig,
    selectedTemplateId,
    user?.id,
    isMockSupabase,
    isPublicSite,
    persistSalonState,
  ]);

  // Flush a pending debounced save when the tab is hidden or closed so edits
  // are never lost. The localStorage write inside persistSalonState runs
  // synchronously before the first await, which beforeunload can rely on.
  const flushPendingSave = useCallback(() => {
    if (!hasPendingSaveRef.current) return;
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    hasPendingSaveRef.current = false;
    void persistSalonState({ source: 'auto' });
  }, [persistSalonState]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingSave();
    };
    window.addEventListener('beforeunload', flushPendingSave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushPendingSave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushPendingSave]);

  const handleSaveNow = useCallback(() => {
    // Explicit save runs immediately — don't wait out the debounce.
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      hasPendingSaveRef.current = false;
    }
    return persistSalonState({
      source: 'manual',
      message: 'Website details updated successfully!',
    });
  }, [persistSalonState]);

  useEffect(() => {
    const accentKey = (profile.themeAccentKey as AccentPaletteKey) || 'slate';
    const pal = ACCENT_PALETTES[accentKey];
    const primaryColor = profile.customAccentColor || (pal ? pal.primaryHex : '#0f172a');
    const secondaryColor = pal ? pal.secondaryHex : '#334155';
    applyPrimaryAccentCssVar(primaryColor, secondaryColor);
  }, [profile.themeAccentKey, profile.customAccentColor]);

  const handleSelectTemplate = (catId: BusinessTypeId) => {
    const tmpl = CATEGORY_TEMPLATES[catId];
    if (!tmpl) return;

    const prevTmplId = previousTemplateIdRef.current;

    setProfile((prev) => mergeTemplatePreservingUserData(prev, catId, prevTmplId));
    setServices((prev) => mergeTemplateServices(prev, catId, prevTmplId));
    setStylists((prev) => mergeTemplateStylists(prev, catId, prevTmplId));
    setSelectedTemplateId(catId);
    previousTemplateIdRef.current = catId;
  };

  const handleSelectCategory = (catId: BusinessTypeId) => {
    handleSelectTemplate(catId);
    setWizardStartingStep(2);
    setCurrentView('wizard');
  };

  const handleAddAppointment = async (newApt: Appointment) => {
    setAppointments((prev) => [newApt, ...prev]);

    const spendPoints = Math.round((newApt.servicePrice / 100) * loyaltyConfig.pointsPerHundredSpent);
    const baseVisitPoints = loyaltyConfig.pointsPerVisit;
    const earnedPoints = baseVisitPoints + spendPoints;

    const existingClient = clients.find((c) => c.phone === newApt.clientPhone);
    let updatedClient: ClientRecord | null = null;
    let newClientRecord: ClientRecord | null = null;

    if (existingClient) {
      setClients((prev) =>
        prev.map((c) => {
          if (c.id !== existingClient.id) return c;
          const currentPts = c.points || 0;
          const currentLifetime = c.lifetimePoints || currentPts;
          const tier = c.loyaltyTier || 'bronze';
          const multiplier = loyaltyConfig.tierMultipliers[tier] || 1.0;
          const finalEarned = Math.round(earnedPoints * multiplier);
          const newTotalPoints = currentPts + finalEarned;
          const newLifetime = currentLifetime + finalEarned;
          const newTier = calculateLoyaltyTier(newLifetime, loyaltyConfig.tierThresholds);

          const newTx = {
            id: `tx-${Date.now()}`,
            date: newApt.date,
            description: `Visit & booking for ${newApt.serviceName}`,
            pointsChange: finalEarned,
            type: 'spend_earned' as const,
          };

          updatedClient = {
            ...c,
            totalVisits: c.totalVisits + 1,
            totalSpent: c.totalSpent + newApt.servicePrice,
            lastVisit: newApt.date,
            points: newTotalPoints,
            lifetimePoints: newLifetime,
            loyaltyTier: newTier,
            pointHistory: [newTx, ...(c.pointHistory || [])],
          };
          return updatedClient;
        })
      );
    } else {
      const initialPoints = earnedPoints;
      const initialTier = calculateLoyaltyTier(initialPoints, loyaltyConfig.tierThresholds);
      newClientRecord = {
        id: `cli-${Date.now()}`,
        name: newApt.clientName,
        phone: newApt.clientPhone,
        email: newApt.clientEmail,
        totalVisits: 1,
        totalSpent: newApt.servicePrice,
        lastVisit: newApt.date,
        notes: `First visit on ${newApt.date} for ${newApt.serviceName}`,
        favoriteStylist: newApt.stylistName,
        points: initialPoints,
        lifetimePoints: initialPoints,
        loyaltyTier: initialTier,
        pointHistory: [
          {
            id: `tx-${Date.now()}`,
            date: newApt.date,
            description: `First booking for ${newApt.serviceName}`,
            pointsChange: initialPoints,
            type: 'spend_earned',
          },
        ],
      };
      setClients((prev) => [newClientRecord as ClientRecord, ...prev]);
    }

    if (isMockSupabase || isPublicSite) return;

    const ownerId = user?.id ?? profile.ownerId;

    try {
      await supabase.from('appointments').insert([toAppointmentInsert(newApt, ownerId)]);

      if (updatedClient) {
        await supabase
          .from('clients')
          .update(toClientUpdate(updatedClient))
          .eq('id', updatedClient.id);
      } else if (newClientRecord) {
        await supabase.from('clients').insert([toClientInsert(newClientRecord, ownerId)]);
      }
    } catch (err) {
      console.warn('Supabase real-time sync fallback.', err);
    }
  };

  const handleBuildWebsiteClick = () => {
    const wizardCompleted = localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
    if (wizardCompleted) {
      setCurrentView('preview');
    } else {
      setWizardStartingStep(1);
      setCurrentView('wizard');
    }
  };

  const handleWizardComplete = () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    setCurrentView('preview');
  };

  const publicProfile = (siteTenant?.profile || profile) as SalonProfile;
  const publicServices = (siteTenant?.services || services) as SalonService[];
  const publicStylists = (siteTenant?.stylists || stylists) as Stylist[];

  // -------------------------------------------------------------------------
  // PUBLIC LIVE SITE RENDER
  // -------------------------------------------------------------------------
  if (isPublicSite) {
    return (
      <div className="min-h-screen bg-surface text-on-surface">
        <SalonWebsitePreview
          profile={publicProfile}
          services={publicServices}
          stylists={publicStylists}
          onAddAppointment={handleAddAppointment}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          siteUrl={getSiteUrl(publicProfile)}
          publicView
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Header
        currentView={currentView}
        setCurrentView={setCurrentView}
        salonName={profile.businessName}
        onBuildWebsiteClick={handleBuildWebsiteClick}
        user={user}
        setUser={setUser}
        profile={profile}
        openAuth={(mode) => {
          setAuthMode(mode);
          setIsAuthModalOpen(true);
        }}
      />

      {currentView === 'landing' && (
        <LandingPage 
          setCurrentView={(view) => {
            if (view === 'preview') {
              setWizardStartingStep(1);
              setCurrentView('wizard');
            } else {
              setCurrentView(view);
            }
          }} 
          onSelectCategory={handleSelectCategory}
        />
      )}

      {currentView === 'wizard' && (
        <WebsiteEditor
          profile={profile}
          setProfile={setProfile}
          services={services}
          setServices={setServices}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          onComplete={handleWizardComplete}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={handleSelectTemplate}
          siteUrl={getSiteUrl(profile, 'https://fanal-templetes-app.vercel.app')}
          onSave={handleSaveNow}
          onBackToDashboard={() => setCurrentView('dashboard')}
          showToast={showToast}
        />
      )}

      {currentView === 'preview' && (
        <SalonWebsitePreview
          profile={profile}
          setProfile={setProfile}
          services={services}
          setServices={setServices}
          stylists={stylists}
          setStylists={setStylists}
          onAddAppointment={handleAddAppointment}
          onSelectTemplate={handleSelectTemplate}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          siteUrl={getSiteUrl(profile)}
        />
      )}

      {currentView === 'dashboard' && (
        <SaaSDashboard
          profile={profile}
          setProfile={setProfile}
          services={services}
          setServices={setServices}
          stylists={stylists}
          setStylists={setStylists}
          appointments={appointments}
          setAppointments={setAppointments}
          clients={clients}
          setClients={setClients}
          loyaltyConfig={loyaltyConfig}
          setLoyaltyConfig={setLoyaltyConfig}
          onNavigateToPreview={() => setCurrentView('preview')}
          onNavigateToEditor={() => {
            setWizardStartingStep(1);
            setCurrentView('wizard');
          }}
          siteUrl={getSiteUrl(profile)}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
        onSuccess={(u) => setUser(u)}
      />

      {/* Global save toast */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1200] animate-in slide-in-from-bottom"
        >
          <div
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold border ${
              toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-emerald-600 text-white border-emerald-500'
            }`}
          >
            {toast.type === 'error' ? (
              <span className="material-symbols-outlined text-lg">error</span>
            ) : (
              <span className="material-symbols-outlined text-lg">check_circle</span>
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
