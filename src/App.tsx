import { observeAuthSession, type RestoredAuthState } from './lib/restoreAuthSession';
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
import { UserProfileSettingsModal } from './components/UserProfileSettingsModal';
import {
  loadSalonState,
  saveSalonState,
  mergeTemplatePreservingUserData,
  mergeTemplateServices,
  mergeTemplateStylists,
  getSiteUrl,
  ONBOARDING_COMPLETED_KEY,
  getStoredAuthenticatedProfile,
  setStoredAuthenticatedProfile,
  AuthenticatedProfileState,
} from './lib/salonStore';
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVE_STATUS_RESET_MS,
  SaveStatus,
  describeError,
  summarizeSaveError,
  isAuthLikeFailure,
  isSchemaLikeFailure,
  isUuid,
  toDbId,
  withRetry,
  runSalonSavePipeline,
} from './lib/autoSave';
import { applyWorkingHoursFromRow } from './lib/salonSync';
import { saveOwnerEditorState } from './lib/ownerEditorState';
import {
  usePathRoute,
  isCustomerAppPath,
  isMyBookingsPath,
  isStaffPerformancePath,
  isStaffCommissionPath,
  MY_BOOKINGS_PATH,
  STAFF_PERFORMANCE_PATH,
  STAFF_COMMISSION_PATH,
  matchBookingDetailPath,
  bookingDetailPath,
} from './lib/router';
import { MyBookingsPage } from './components/MyBookingsPage';
import { CustomerApp } from './customer/CustomerApp';
import { BookingDetailPage } from './components/BookingDetailPage';
import { StaffPerformanceDashboard } from './components/StaffPerformanceDashboard';
import { StaffCommissionDashboard } from './components/StaffCommissionDashboard';

/** Deterministic-id namespaces for rows synced to `appointments`/`clients`. */
export const APPOINTMENT_ID_NAMESPACE = 'nexora-appointment';
export const CLIENT_ID_NAMESPACE = 'nexora-client';

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
    // `appointments.id` is a uuid column. Local app ids are `apt-…` strings,
    // which Postgres rejected — the insert silently persisted zero rows.
    // Deterministic mapping keeps repeated saves idempotent (no duplicates).
    id: toDbId(apt.id, APPOINTMENT_ID_NAMESPACE),
    owner_id: ownerId || null,
    client_name: apt.clientName,
    client_phone: apt.clientPhone,
    client_email: apt.clientEmail,
    // Local template/service ids (`srv-…`, `hs-st-…`) are not uuid-shaped and
    // would make the whole insert fail on these uuid columns — same class of
    // bug as the id column. Names stay denormalized in text columns.
    service_id: apt.serviceId && isUuid(apt.serviceId) ? apt.serviceId : null,
    service_name: apt.serviceName,
    service_price: apt.servicePrice,
    stylist_id: apt.stylistId && isUuid(apt.stylistId) ? apt.stylistId : null,
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
    // `clients.id` is a uuid column; local ids are `cli-…` strings (see
    // toAppointmentInsert for the same bug/fix).
    id: toDbId(c.id, CLIENT_ID_NAMESPACE),
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
  const [currentView, setCurrentViewState] = useState<AppView>('landing');
  const { path, navigate } = usePathRoute();
  // Which booking `/customer/booking/:id` is showing. Lives in state as well as
  // the URL so a deep link and an in-app tap converge on the same screen.
  const [bookingDetailId, setBookingDetailId] = useState<string | null>(null);

  // One direction only: the URL drives the view (so deep links and the browser
  // back button work). Navigation is pushed by `setCurrentView` below, so the
  // two never chase each other in a loop.
  useEffect(() => {
    const detailId = matchBookingDetailPath(path);
    if (detailId) {
      setBookingDetailId((prev) => (prev === detailId ? prev : detailId));
      setCurrentViewState((view) => (view === 'bookingDetail' ? view : 'bookingDetail'));
      return;
    }
    if (isMyBookingsPath(path)) {
      setCurrentViewState((view) => (view === 'bookings' ? view : 'bookings'));
      return;
    }
    if (isStaffCommissionPath(path)) {
      setCurrentViewState((view) => (view === 'staffCommission' ? view : 'staffCommission'));
      return;
    }
    if (isStaffPerformancePath(path)) {
      setCurrentViewState((view) => (view === 'staffPerformance' ? view : 'staffPerformance'));
      return;
    }
    setCurrentViewState((view) =>
      view === 'bookings' || view === 'bookingDetail' || view === 'staffPerformance' || view === 'staffCommission'
        ? 'landing'
        : view
    );
  }, [path]);

  /**
   * The single way this app changes screen. Keeping the URL here (rather than in
   * a `currentView` effect) is what makes back/forward behave: an effect would
   * re-push the URL immediately after the user navigated away from it.
   */
  const setCurrentView = useCallback(
    (view: AppView) => {
      setCurrentViewState(view);
      if (view === 'bookings') {
        navigate(MY_BOOKINGS_PATH);
      } else if (view === 'bookingDetail') {
        navigate(bookingDetailPath(bookingDetailId ?? ''));
      } else if (view === 'staffPerformance') {
        navigate(STAFF_PERFORMANCE_PATH);
      } else if (view === 'staffCommission') {
        navigate(STAFF_COMMISSION_PATH);
      } else {
        navigate('/');
      }
    },
    [navigate, bookingDetailId]
  );

  /** Open one booking's detail page and put its id in the URL. */
  const openBookingDetail = useCallback(
    (id: string) => {
      setBookingDetailId(id);
      setCurrentViewState('bookingDetail');
      navigate(bookingDetailPath(id));
    },
    [navigate]
  );

  // Set by "My Bookings" → Rebook; consumed by the salon site to pre-select the
  // service and open the booking flow. `at` de-duplicates repeat taps.
  const [rebookTarget, setRebookTarget] = useState<{ serviceName: string; at: number } | null>(null);

  const [wizardStartingStep, setWizardStartingStep] = useState<number>(1);

  // Auth State Listener
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  // Load the persistent salon state from localStorage on initial mount.
  const initialSaved = typeof window !== 'undefined' ? loadSalonState() : null;
  const previousTemplateIdRef = React.useRef<BusinessTypeId>(
    initialSaved?.selectedTemplateId || INITIAL_SALON_PROFILE.businessType
  );

  const [profile, setProfile] = useState<SalonProfile>(
    initialSaved?.profile && typeof initialSaved.profile === 'object' ? initialSaved.profile : INITIAL_SALON_PROFILE
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [authStatus, setAuthStatus] = useState<RestoredAuthState['status']>(isMockSupabase ? 'ready' : 'restoring');
  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;
  const authRetryRef = useRef<() => void>(() => {});
  const [user, setUser] = useState<any>(() => {
    if (!isMockSupabase) return null;
    try {
      const raw = localStorage.getItem('nexora_auth_user_v1');
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem('nexora_auth_user_v1', JSON.stringify(user));
      } else {
        localStorage.removeItem('nexora_auth_user_v1');
      }
    } catch {}
  }, [user]);

  const [services, setServices] = useState<SalonService[]>(
    initialSaved?.services && Array.isArray(initialSaved.services) && initialSaved.services.length > 0 ? initialSaved.services : INITIAL_SERVICES
  );
  const [stylists, setStylists] = useState<Stylist[]>(
    initialSaved?.stylists && Array.isArray(initialSaved.stylists) && initialSaved.stylists.length > 0 ? initialSaved.stylists : INITIAL_STYLISTS
  );
  const [appointments, setAppointments] = useState<Appointment[]>(isMockSupabase ? INITIAL_APPOINTMENTS : []);
  const [clients, setClients] = useState<ClientRecord[]>(isMockSupabase ? INITIAL_CLIENTS : []);
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
  // SHARED PERSISTENCE REFS
  // Always-fresh snapshot of the salon state so a debounced (or flushed) save
  // can never persist a stale closure, plus the "what did we last persist"
  // snapshot used to (a) skip no-op saves and (b) detect unsaved edits so a
  // late-arriving cloud read (profile fetch / hydration) can never clobber
  // what the owner is typing right now.
  const salonStateRef = useRef({ profile, services, stylists, loyaltyConfig, selectedTemplateId, user });
  salonStateRef.current = { profile, services, stylists, loyaltyConfig, selectedTemplateId, user };

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

  /**
   * True when the in-memory salon state differs from what was last persisted
   * (debounced auto-save pending or a save in flight). Cloud reads must not
   * overwrite the editor state in this window — otherwise a slow profile/hydrate
   * response could erase edits the owner made right after sign-in, and the
   * subsequent auto-save would persist the erased state (data loss).
   * `ownerId` is excluded: it is injected by the auth effect, not a user edit.
   */
  const hasUnsavedEdits = (): boolean => {
    const persistedRaw = lastPersistedSnapshotRef.current;
    if (persistedRaw === null) return false;
    try {
      const persisted = JSON.parse(persistedRaw);
      const cur = salonStateRef.current;
      const stripOwner = (p: any) => {
        if (!p) return p;
        const copy = { ...p };
        delete copy.ownerId;
        return copy;
      };
      const draftOf = (p: any, svc: any, stf: any, loy: any, tmpl: any) =>
        JSON.stringify({
          profile: stripOwner(p),
          services: svc ?? [],
          stylists: stf ?? [],
          loyaltyConfig: loy ?? DEFAULT_LOYALTY_CONFIG,
          selectedTemplateId: tmpl,
        });
      return (
        draftOf(cur.profile, cur.services, cur.stylists, cur.loyaltyConfig, cur.selectedTemplateId) !==
        draftOf(persisted.profile, persisted.services, persisted.stylists, persisted.loyaltyConfig, persisted.selectedTemplateId)
      );
    } catch {
      return false;
    }
  };

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
  // The Customer App (`/app`) is a second surface of this deployment. It is
  // computed up here, next to `isPublicSite` and for the same reason, because
  // the auto-save and appointment-sync effects below must both stay silent on
  // it: a visitor with no owner session must never write the default salon
  // profile over a real one.
  const isCustomerApp = isCustomerAppPath(path);

  /**
   * Fetch a same-origin JSON API route with exact diagnostics.
   *
   * Returns the parsed JSON on success, or `null` after logging the failure
   * to the console for HTTP errors (404/500…), non-JSON bodies (an Express /
   * Vercel HTML error page or the SPA fallback) and network failures. Callers
   * can therefore distinguish "the server answered: not found" from "the
   * request itself failed" instead of silently guessing.
   */
  const fetchSiteJson = useCallback(async (url: string): Promise<any | null> => {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(
          `[Site bootstrap] GET ${url} failed → HTTP ${res.status} ${res.statusText}.`,
          body ? `Body (first 400 chars): ${body.slice(0, 400)}` : '(empty body)'
        );
        return null;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const body = await res.text().catch(() => '');
        console.error(
          `[Site bootstrap] GET ${url} returned "${contentType}" instead of application/json — the API route may not be deployed.`,
          body ? `Body (first 400 chars): ${body.slice(0, 400)}` : '(empty body)'
        );
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error(`[Site bootstrap] GET ${url} threw:`, describeError(err));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const requestedSite = params?.get('site') || params?.get('subdomain') || params?.get('tenant');
    const isPublicParam = params?.get('view') === 'public' || params?.has('public');

    (async () => {
      try {
        if (requestedSite) {
          const data = await fetchSiteJson(`/api/site/${encodeURIComponent(requestedSite)}`);
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

          // A reachable live (Supabase-backed) API answering found:false is
          // authoritative — this subdomain is not published. Show the app
          // instead of fabricating a public site from local state (which used
          // to make every unknown ?site= URL silently render local/demo data).
          if (data && !isMockSupabase) {
            console.warn(
              `[Site bootstrap] Live API reports no published salon for "${requestedSite}" — rendering the app, not a public site.`
            );
            setSiteTenant({
              isTenant: true,
              found: false,
              subdomain: requestedSite,
              customDomain: null,
            });
            return;
          }

          // Mock/demo mode (no Supabase configured) or an unreachable API:
          // fall back to the current local profile so the preview flow keeps
          // working; the fetch failure itself was logged above by fetchSiteJson.
          if (data === null) {
            console.warn(
              `[Site bootstrap] API unreachable for "${requestedSite}" — previewing from local state.`
            );
          }
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

        const data = await fetchSiteJson('/api/site');
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
        // Unexpected bootstrap error — never crash the app; keep the demo
        // preview working from local state when a site was explicitly requested.
        console.error('Could not resolve site tenant:', err);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSiteJson, isMockSupabase]);

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

  // The restored SDK session, not a cached user object, controls authentication.
  useEffect(() => {
    if (isMockSupabase) return;
    const observer = observeAuthSession(supabase.auth, (state) => {
      setUser(state.user);
      setAuthStatus(state.status);
    });
    authRetryRef.current = observer.retry;
    window.addEventListener('online', observer.retry);
    return () => {
      observer.dispose();
      window.removeEventListener('online', observer.retry);
    };
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
        // maybeSingle (not single): a brand-new owner may legitimately have no
        // profile row yet (e.g. the signup trigger ran before the migration
        // existed). `.single()` used to throw PGRST116 here, so the meta-data
        // fallback below never ran and the console logged a scary error on
        // every load for new accounts.
        const { data: editorState, error: editorError } = await supabase.rpc('get_owner_editor_state');
        if (editorError) throw editorError;
        if (editorState?.profile) return;
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          // Permission/RLS/grants problem — NOT a missing record. The user
          // must fix the schema before saving can ever work.
          console.error(
            '[Profile] Could not read the owner profile row (auth/RLS/grants issue — apply supabase/migrations):',
            error
          );
          return;
        }

        const authState: AuthenticatedProfileState = {
          salonName: data?.salon_name || meta.salon_name,
          phone: data?.phone_number || meta.phone_number,
          city: data?.city || meta.city,
          ownerName: data?.full_name || meta.full_name,
          email: data?.email || user.email,
          address: data?.full_address,
          postalCode: data?.postal_code,
          subdomain: data?.subdomain,
        };
        if (authState.salonName || authState.phone || authState.city) {
          setStoredAuthenticatedProfile(authState);
        }

        if (!data) {
          // No row yet: hydrate from the sign-up metadata; the first cloud
          // save creates the profile row (upsert keyed on auth.uid()).
          if (hasUnsavedEdits()) {
            // The owner already typed before this slow response landed — do
            // not overwrite their draft with sign-up metadata.
            console.warn(
              '[Profile] No profile row exists yet, but local edits are pending — keeping the draft; the first save creates the row.'
            );
            return;
          }
          console.warn(
            '[Profile] No profile row exists yet for this user — using sign-up metadata until the first save creates it.'
          );
          setProfile((prev) => ({
            ...prev,
            businessName: meta.salon_name || prev.businessName,
            ownerName: meta.full_name || prev.ownerName,
            phone: meta.phone_number || prev.phone,
            email: user.email || prev.email,
            city: meta.city || prev.city,
          }));
          return;
        }

        if (hasUnsavedEdits()) {
          // Race-condition guard: a slow profile read must never clobber edits
          // the owner made since the last persist. The debounced save will
          // push the draft to the cloud anyway; the server profile is applied
          // on the next page load (or once the draft settles).
          console.warn(
            '[Profile] Server profile arrived while local edits are pending — deferring the merge so your unsaved changes are not overwritten.'
          );
          return;
        }

        setProfile((prev) =>
          applyWorkingHoursFromRow(
            {
              ...prev,
              businessName: data.salon_name || meta.salon_name || prev.businessName,
              ownerName: data.full_name || meta.full_name || prev.ownerName,
              ownerRole: data.owner_role || prev.ownerRole,
              phone: data.phone_number || data.phone || data.mobile || meta.phone_number || prev.phone,
              whatsapp: data.whatsapp || prev.whatsapp,
              email: data.email || user.email || prev.email,
              ownerPhotoUrl: data.owner_photo_url || data.avatar_url || data.photo_url || prev.ownerPhotoUrl,
              coverImageUrl: data.cover_image_url || prev.coverImageUrl,
              tagline: data.tagline || prev.tagline,
              about: data.about || prev.about,
              address: data.full_address || prev.address,
              city: data.city || data.preferred_city || meta.city || prev.city,
              areaLocality: data.area ?? data.preferred_area ?? prev.areaLocality,
              postalCode: data.postal_code || data.pincode || prev.postalCode,
              landmark: data.landmark || prev.landmark,
              subdomain: data.subdomain || prev.subdomain,
              instagramHandle: data.instagram_handle || prev.instagramHandle,
              homeService: data.home_service ?? prev.homeService,
              offers: data.offers ?? prev.offers,
              themePreset: data.theme_preset || prev.themePreset,
              themeAccentKey: data.theme_accent_key || prev.themeAccentKey,
              customAccentColor: data.custom_accent_color || prev.customAccentColor,
            },
            data
          )
        );
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    };

    fetchProfile();
  }, [user]);

  // Hydrate services / staff / loyalty from Supabase once the owner logs in.
  // The cloud sync only performs *destructive* cleanup (deleting rows removed
  // in the editor) after this hydration has succeeded, so a client that failed
  // to load existing rows can never wipe them.
  const hydratedForUserRef = useRef(false);
  const hydrationErrorRef = useRef<string | null>(null);
  // Single-flight runner: the mount effect AND a save-time self-heal retry
  // share one hydration run instead of firing overlapping queries. Keyed by
  // owner id so a run for a previously signed-in owner can never satisfy (or
  // unlock cleanup for) the next owner.
  const hydrationRunRef = useRef<{ userId: string; promise: Promise<boolean> } | null>(null);
  // Owner we are hydrating for — guards against applying a stale user's
  // snapshot after a fast account switch.
  const hydrationUserRef = useRef<string | null>(null);

  /**
   * Apply a hydrated cloud snapshot into editor state. Returns true only when
   * the snapshot was actually applied. If the owner has unsaved edits (typing
   * right after sign-in, save still in flight) the snapshot is DEFERRED —
   * overwriting the draft here would silently erase their latest changes, and
   * the very next auto-save would persist that erased state. The save path
   * re-runs hydration after the draft settles, at which point the snapshot
   * applies and destructive cleanup becomes safe again.
   */
  const applyHydrationSnapshot = useCallback(
    (snapshot: { svc: any; stf: any; lc: any; rw: any }): boolean => {
      if (hasUnsavedEdits()) {
        console.warn(
          '[AutoSave] Cloud data finished loading while local edits are pending — snapshot deferred so unsaved changes are not overwritten.'
        );
        return false;
      }
      const { svc, stf, lc, rw } = snapshot;
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
      return true;
    },
    []
  );

  const startHydration = useCallback(
    (userId: string): Promise<boolean> => {
      // Re-use an in-flight run only for the SAME owner.
      const inFlight = hydrationRunRef.current;
      if (inFlight && inFlight.userId === userId) return inFlight.promise;
      const run = (async (): Promise<boolean> => {
        try {
          // Pre-check: the Supabase client must actually hold a live session
          // for this user. If the stored session expired or was revoked while
          // the tab sat in the background, every query below would fail with
          // the same auth error — detect it once instead of retrying five
          // queries three times, and surface an actionable message.
          const { data: sessionData, error: sessionLookupError } =
            await supabase.auth.getSession();
          if (sessionLookupError) {
            throw sessionLookupError;
          }
          if (!sessionData.session?.user) {
            const message = 'no active Supabase session — please sign in again';
            if (hydrationUserRef.current === userId) {
              hydratedForUserRef.current = false;
              hydrationErrorRef.current = message;
              console.error('[AutoSave] Cloud hydration failed:', message);
              // Only the auth listener changes login state; a data read cannot log the user out.
            }
            return false;
          }

          const beforeRead = salonStateRef.current;
          const { data: saved, error } = await supabase.rpc('get_owner_editor_state');
          if (error) throw error;
          if (hydrationUserRef.current === userId) {
            if (saved) {
              const current = salonStateRef.current;
              const mergedProfile = { ...current.profile, ...saved.profile, ownerId: userId };
              // Preserve only edits made while this read was in flight. Local
              // startup defaults must never prevent the saved profile loading.
              for (const key of Object.keys(current.profile)) {
                if (JSON.stringify(current.profile[key]) !== JSON.stringify(beforeRead.profile[key])) mergedProfile[key] = current.profile[key];
              }
              const next = { ...current, profile: mergedProfile,
                services: current.services !== beforeRead.services ? current.services : saved.services ?? current.services,
                stylists: current.stylists !== beforeRead.stylists ? current.stylists : saved.stylists ?? current.stylists,
                loyaltyConfig: current.loyaltyConfig !== beforeRead.loyaltyConfig ? current.loyaltyConfig : saved.loyaltyConfig ?? current.loyaltyConfig };
              salonStateRef.current = next;
              setProfile(next.profile); setServices(next.services); setStylists(next.stylists); setLoyaltyConfig(next.loyaltyConfig);
            }
            hydratedForUserRef.current = true;
            hydrationErrorRef.current = null;
          }
          return true;
        } catch (err) {
          // Hydration failed even after retries — keep the flag false so the
          // save flow never performs destructive cleanup (deleting rows it
          // failed to read).
          if (hydrationUserRef.current === userId) {
            hydratedForUserRef.current = false;
            hydrationErrorRef.current = describeError(err);
            // Classify the root cause so the console shows the exact remedy.
            const hint = isAuthLikeFailure(hydrationErrorRef.current)
              ? 'AUTH/RLS: the authenticated role is missing table grants or RLS policies — re-apply supabase/migrations (incl. 20260907_owner_save_grants.sql) and sign in again.'
              : isSchemaLikeFailure(hydrationErrorRef.current)
              ? 'SCHEMA: tables are missing — apply supabase/migrations to this Supabase project (SUPABASE_SETUP.md).'
              : 'TRANSIENT: network/server — retried automatically; saves continue locally.';
            console.error(`[AutoSave] Cloud hydration failed (${hint}):`, hydrationErrorRef.current);
          }
          return false;
        }
      })();
      hydrationRunRef.current = { userId, promise: run };
      run.finally(() => {
        if (hydrationRunRef.current?.promise === run) hydrationRunRef.current = null;
      });
      return run;
    },
    [applyHydrationSnapshot]
  );

  useEffect(() => {
    if (!user || isMockSupabase) {
      // Signed out (or mock mode): no cloud rows are loaded — clear all
      // hydration state so a stale run for a previous owner can never unlock
      // destructive cleanup for a later owner.
      hydrationUserRef.current = null;
      hydratedForUserRef.current = false;
      hydrationErrorRef.current = null;
      return;
    }
    hydratedForUserRef.current = false;
    hydrationErrorRef.current = null;
    hydrationUserRef.current = user.id;
    void startHydration(user.id);
  }, [user?.id, isMockSupabase, startHydration]);

  // -------------------------------------------------------------------------
  // AUTO-SAVE ENGINE
  // Any change to the salon state (Salon Details, Services & Pricing,
  // Timings, Sub-domain, theme, staff, loyalty…) schedules a debounced save
  // that persists to localStorage immediately and to Supabase when the owner
  // is signed in. Network failures retry with backoff and surface the exact
  // error; the status pill in the editor shows Saving… / All changes saved /
  // Save failed.
  // -------------------------------------------------------------------------
  // salonStateRef / lastPersistedSnapshotRef / hasUnsavedEdits() are declared
  // near the top of the component so both the auto-save engine AND the
  // profile-fetch / hydration effects share the same snapshots.
  const debounceTimerRef = useRef<number | undefined>(undefined);
  const statusResetTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const resaveAfterFlightRef = useRef(false);
  const hasPendingSaveRef = useRef(false);
  const lastErrorToastRef = useRef<string>('');

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
      if (salonStateRef.current.user && !isMockSupabase && !hydratedForUserRef.current) {
        const loaded = await startHydration(salonStateRef.current.user.id);
        if (!loaded || !hydratedForUserRef.current) {
          setSaveStatus('error');
          if (source === 'manual') showToast('Saved data could not be loaded. Save paused to protect your existing profile. Please retry.', 'error');
          return false;
        }
      }
      if (!isMockSupabase && authStatusRef.current !== 'ready') return false;
      const state = salonStateRef.current;

      // Coalesce auto-saves: if one is already running, remember to run again
      // afterwards so the newest state always lands.
      if (saveInFlightRef.current && source === 'auto') {
        resaveAfterFlightRef.current = true;
        return false;
      }

      const snapshot = snapshotOf(state);
      if (source === 'auto' && snapshot === lastPersistedSnapshotRef.current) {
        // Nothing actually changed — don't hammer localStorage/Supabase.
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

        // -- 2) Cloud persistence — full fallback pipeline ------------------
        // runSalonSavePipeline (src/lib/autoSave.ts) guarantees the owner's
        // progress is never lost and the editor is never blocked:
        //   0. unauthenticated / local mock / free-tier session
        //        → localStorage draft (nexora_draft_salon_data),
        //          status SUCCESS (Local Draft) — no crash, no error modal
        //   1. direct Supabase client sync (syncSalonToSupabase)
        //   2. network/auth/RLS failure → POST /api/website/save
        //        (server-side upsert with the Supabase service-role key)
        //   3. both failed → localStorage draft cache + full console
        //        diagnostics (duplicate error popups suppressed while the
        //        owner keeps typing)
        let sessionOk = !isMockSupabase && !!state.user;
        let liveOwnerId = state.user?.id ?? state.profile.ownerId ?? '';
        let canCleanUpCloudRows = false;
        let liveAccessToken: string | undefined;

        if (state.user && !isMockSupabase) {
          // 2a) Pre-flight: the Supabase client must hold a LIVE session for
          // the same owner we are saving for. A dead session is no longer a
          // hard failure — the pipeline degrades to SUCCESS (Local Draft) —
          // the auth observer alone controls the signed-in UI.
          try {
            const { data: sessionData, error: sessionLookupError } =
              await supabase.auth.getSession();
            if (sessionLookupError) {
              throw sessionLookupError;
            }
            const sessionUser = sessionData?.session?.user ?? null;
            if (sessionUser) {
              // Forwarded to POST /api/website/save so the server can prove
              // the caller is really liveOwnerId (identity binding).
              liveAccessToken = sessionData?.session?.access_token || undefined;
            }
            if (!sessionUser) {
              sessionOk = false;
              console.error(
                '[AutoSave] No active Supabase session — saving as a local draft (SUCCESS (Local Draft)) instead of failing. Sign in again to resume cloud sync (local edits are already saved on this device).'
              );
              // Only the auth listener changes login state; a data read cannot log the user out.
            } else if (sessionUser.id !== liveOwnerId) {
              // A save started before an account switch. Keep its original
              // identity and prevent this snapshot from reaching the new account.
              console.warn(
                `[AutoSave] Session user changed (${liveOwnerId} → ${sessionUser.id}); preserving the old account draft without a cloud write.`
              );
              // This snapshot belongs to the previous account. Never save it as the new user.
              sessionOk = false;
              liveAccessToken = undefined;
            }
          } catch (err) {
            // An unverified session cannot authorize a cloud write.
            sessionOk = false;
            liveAccessToken = undefined;
            console.warn('[AutoSave] Session verification failed; preserving a local draft:', err);
          }

          // 2b) Hydration self-heal. Destructive cleanup (deleting rows removed
          // in the editor) is only safe after a successful hydrate, so a
          // half-loaded client can never wipe rows it hasn't seen. A flaky
          // hydrate preserves a local draft; neither cloud write path can run
          // until the existing workspace has loaded for this account.
          if (sessionOk) {
            if (hydratedForUserRef.current && hydrationUserRef.current !== liveOwnerId) {
              hydratedForUserRef.current = false;
              hydrationUserRef.current = liveOwnerId;
            }
            if (!hydratedForUserRef.current) {
              await startHydration(liveOwnerId);
            }
            canCleanUpCloudRows =
              hydratedForUserRef.current && hydrationUserRef.current === liveOwnerId;
            if (!canCleanUpCloudRows) {
              const reason = hydrationErrorRef.current || 'hydration still pending';
              console.warn(
                `[AutoSave] Cloud hydration unavailable (${reason}) — preserving a local draft until the complete cloud workspace has loaded.`
              );
            }
          }
        }

        // 2c) Run the pipeline: client sync → service-role API → local draft.
        const cloud = await runSalonSavePipeline({
          sync: (p) => saveOwnerEditorState(supabase, p),
          payload: {
            ownerId: liveOwnerId,
            profile: state.profile,
            services: state.services,
            stylists: state.stylists,
            loyaltyConfig: state.loyaltyConfig,
          },
          workspaceReady: canCleanUpCloudRows,
          deleteRemoved: canCleanUpCloudRows,
          isMockMode: isMockSupabase,
          authenticated: sessionOk && !!liveOwnerId,
          accessToken: liveAccessToken,
        });

        if (cloud.errors.length) {
          const joined = cloud.errors.join(' · ');
          // Classify the exact root cause for the console (the pipeline has
          // already logged each failure with table name + HTTP status).
          if (isAuthLikeFailure(joined)) {
            console.error(
              '[AutoSave] Cloud save rejected (AUTH/RLS/GRANTS): the authenticated role lacks table privileges or RLS policies. Re-apply supabase/migrations (incl. 20260907_owner_save_grants.sql) and sign in again.',
              cloud.errors
            );
          } else if (isSchemaLikeFailure(joined)) {
            console.error(
              '[AutoSave] Cloud save rejected (SCHEMA): tables are missing. Apply supabase/migrations to this Supabase project (SUPABASE_SETUP.md).',
              cloud.errors
            );
          }
        } else if (cloud.target === 'cloud' && state.user && !isMockSupabase && !canCleanUpCloudRows) {
          console.warn(
            '[AutoSave] Cloud sync succeeded in safe (non-destructive) mode; destructive cleanup resumes after a successful hydrate.'
          );
        }
        if (cloud.target === 'api') {
          console.warn(
            '[AutoSave] Direct client sync failed — the server saved your site state via POST /api/website/save (authenticated workspace transaction).'
          );
        }

        if (failures.length) {
          // Only LOCAL-storage failures reach here — cloud problems are
          // handled by the pipeline and never block the editor with a
          // "couldn't save your changes" error.
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

        if (!cloud.ok || (sessionOk && cloud.target === 'local_draft')) {
          // The single remaining hard failure: neither the cloud NOR the
          // local draft cache could take the state (storage disabled/quota
          // even after degradation). Surface it once; auto-saves stay quiet.
          const detail = cloud.errors.join(' · ') || cloud.summary;
          console.error('[Nexora Sync Error]:', { stage: 'save pipeline — no persistence target available', target: cloud.target, errors: cloud.errors });
          setSaveStatus('error');
          if (source === 'manual' || lastErrorToastRef.current !== detail) {
            showToast(`Save failed: ${summarizeSaveError(detail)}`, 'error');
          }
          lastErrorToastRef.current = detail;
          return false;
        }

        lastPersistedSnapshotRef.current = snapshot;
        lastErrorToastRef.current = '';
        setLastSavedAt(Date.now());

        const publishedToCloud = cloud.target === 'cloud' || cloud.target === 'api';
        if (publishedToCloud) {
          setSaveStatus('saved');
          // Auto-saves update quietly via the status pill; only explicit
          // saves interrupt the owner with a toast.
          if (source === 'manual') {
            showToast(options?.message || 'Website details updated successfully!');
          }
        } else {
          // SUCCESS (Local Draft) — unauthenticated / mock session, or the
          // cloud is unreachable. Progress is safe on this device, so the
          // pill shows "SUCCESS (Local Draft)" instead of a blocking error.
          // Background auto-saves stay SILENT (status pill only) — this is
          // what suppresses the duplicate error popups while the owner is
          // still typing; an explicit save gets one informative toast.
          setSaveStatus('saved_local');
          if (source === 'manual') {
            showToast(
              cloud.errors.length
                ? 'Saved on this device (local draft) — cloud sync is unavailable right now. The exact error is in the browser console.'
                : 'Saved on this device (local draft) — sign in to publish to the cloud.',
              'success'
            );
          }
        }
        scheduleStatusReset();
        // Manual saves report "published" only when the cloud actually took
        // the state (the success modal promises a live link); auto-saves
        // always succeed because the progress is persisted somewhere.
        return publishedToCloud || source === 'auto';
      } catch (err) {
        // Unexpected (programming) errors — surface with full detail.
        const detail = describeError(err);
        console.error('[Nexora Sync Error]:', {
          stage: 'save engine — unexpected exception',
          message: detail,
        });
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
    [showToast, scheduleStatusReset, startHydration]
  );

  // Debounced auto-save. The timer resets on every keystroke so a burst of
  // edits becomes a single save ~1.2s after the last change.
  useEffect(() => {
    if (firstPersistRef.current) {
      firstPersistRef.current = false;
      return;
    }
    if (isPublicSite) return; // visitors on a public salon site never save
    if (isCustomerApp) return; // …and neither does anyone in the Customer App
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
    isCustomerApp,
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
    const authProfile = getStoredAuthenticatedProfile();

    setProfile((prev) => mergeTemplatePreservingUserData(prev, catId, prevTmplId, authProfile));
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
    if (!isMockSupabase) { window.dispatchEvent(new Event('owner-bookings-changed')); return; }
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

    // The customer app must never append to the owner's `appointments`/`clients`
    // either: a customer booking arrives through /api/customer/* and is written
    // against their own rows.
    if (isMockSupabase || isPublicSite || isCustomerApp) return;

    const ownerId = user?.id ?? profile.ownerId;
    if (!ownerId) {
      // No signed-in owner: appointments/clients rows are NOT NULL on
      // owner_id, so a cloud write can only fail — keep the local state.
      console.warn('[Appointments] Skipped cloud sync: no owner id (sign in to persist).');
      return;
    }

    try {
      const { error: aptError } = await supabase
        .from('appointments')
        .insert([toAppointmentInsert(newApt, ownerId)]);
      if (aptError) console.warn('[Appointments] Insert error:', aptError);

      if (updatedClient) {
        const { error: clientError } = await supabase
          .from('clients')
          .update(toClientUpdate(updatedClient))
          .eq('id', toDbId(updatedClient.id, CLIENT_ID_NAMESPACE));
        if (clientError) console.warn('[Appointments] Client update error:', clientError);
      } else if (newClientRecord) {
        const { error: clientError } = await supabase
          .from('clients')
          .insert([toClientInsert(newClientRecord, ownerId)]);
        if (clientError) console.warn('[Appointments] Client insert error:', clientError);
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
  const openBookingAuth = (mode: 'login' | 'signup' = 'login') => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };

  // -------------------------------------------------------------------------
  // CUSTOMER APP RENDER
  //
  // Ahead of the public site and the editor: `/app` belongs to the customer
  // surface alone, so the owner UI never mounts underneath it. The accent comes
  // from the tenant row when the request arrived on a salon subdomain, which is
  // how one deployment serves both products without a second theme system.
  // -------------------------------------------------------------------------
  if (isCustomerApp) {
    return (
      <CustomerApp
        path={path}
        navigate={navigate}
        accentHex={ACCENT_PALETTES[(siteTenant?.profile || profile)?.themeAccentKey as AccentPaletteKey]?.primaryHex}
        tenantSubdomain={siteTenant?.isTenant && siteTenant.found ? siteTenant.subdomain || '' : ''}
        tenantName={siteTenant?.isTenant && siteTenant.found ? siteTenant.profile?.businessName || '' : ''}
      />
    );
  }

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
          user={user}
          onRequireAuth={openBookingAuth}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          siteUrl={getSiteUrl(publicProfile)}
          publicView
        />
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          initialMode={authMode}
          purpose="customer"
          onSuccess={(u) => setUser(u)}
        />
      </div>
    );
  }

  if (!isMockSupabase && !user && authStatus !== 'ready') {
    return <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div role="status" className="max-w-md rounded-2xl bg-white border border-slate-200 p-6">
        <h1 className="text-lg font-bold">{authStatus === 'restoring' ? 'Restoring your session…' : 'Could not restore your login yet'}</h1>
        <p className="my-3 text-sm">{authStatus === 'restoring' ? 'Loading your saved sign-in.' : 'Check your connection, then retry. Your saved profile has not been cleared.'}</p>
        {authStatus === 'error' && <button type="button" onClick={() => authRetryRef.current()} className="rounded-lg bg-pink-700 px-4 py-2 text-white">Retry connection</button>}
      </div>
    </div>;
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
        onProfileSaved={(patch) => { setProfile(prev => ({ ...prev, ...patch })); showToast('Profile saved successfully. Contact & Location updated.'); }}
        profile={profile}
        openAuth={(mode) => {
          setAuthMode(mode);
          setIsAuthModalOpen(true);
        }}
        onOpenProfileSettings={() => setIsProfileSettingsOpen(true)}
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
          isAuthenticated={!!user}
          onRequireAuth={openBookingAuth}
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
          user={user}
          onRequireAuth={openBookingAuth}
          onSelectTemplate={handleSelectTemplate}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          siteUrl={getSiteUrl(profile)}
          rebookRequest={rebookTarget}
        />
      )}

      {currentView === 'dashboard' && (
        <SaaSDashboard
          key={user?.id || 'signed-out'}
          ownerId={user?.id}
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
          isAuthenticated={!!user}
          onRequireAuth={openBookingAuth}
          onNavigateToStaffPerformance={() => setCurrentView('staffPerformance')}
          onNavigateToStaffCommission={() => setCurrentView('staffCommission')}
        />
      )}

      {currentView === 'staffPerformance' && (
        <StaffPerformanceDashboard
          user={user}
          onRequireAuth={openBookingAuth}
          onBackToDashboard={() => setCurrentView('dashboard')}
          onOpenCommission={() => setCurrentView('staffCommission')}
          primaryAccentColor={ACCENT_PALETTES[profile.themeAccentKey as AccentPaletteKey]?.primaryHex}
          currencySymbol={profile.currency || '₹'}
          salonName={profile.businessName}
        />
      )}

      {currentView === 'staffCommission' && (
        <StaffCommissionDashboard
          user={user}
          onRequireAuth={openBookingAuth}
          onBackToDashboard={() => setCurrentView('dashboard')}
          onOpenStaffPerformance={() => setCurrentView('staffPerformance')}
          primaryAccentColor={ACCENT_PALETTES[profile.themeAccentKey as AccentPaletteKey]?.primaryHex}
          currencySymbol={profile.currency || '₹'}
          salonName={profile.businessName}
        />
      )}

      {currentView === 'bookings' && (
        <MyBookingsPage
          user={user}
          onRequireAuth={openBookingAuth}
          accentHex={ACCENT_PALETTES[profile.themeAccentKey as AccentPaletteKey]?.primaryHex}
          onExploreSalons={() => setCurrentView('preview')}
          onViewDetails={(card) => openBookingDetail(card.id)}
          onRebook={(card) => {
            // Rebook opens the salon site with that service pre-selected and
            // flags the flow as coming from history, which is what makes the
            // confirmation page offer "Book this service again".
            setRebookTarget({ serviceName: card.serviceName, at: Date.now() });
            setCurrentView('preview');
          }}
        />
      )}

      {currentView === 'bookingDetail' && (
        <BookingDetailPage
          bookingId={bookingDetailId ?? ''}
          user={user}
          onRequireAuth={openBookingAuth}
          accentHex={ACCENT_PALETTES[profile.themeAccentKey as AccentPaletteKey]?.primaryHex}
          onBack={() => setCurrentView('bookings')}
          onRebook={(detail) => {
            setRebookTarget({ serviceName: detail.services[0], at: Date.now() });
            setCurrentView('preview');
          }}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
        onSuccess={(u) => setUser(u)}
      />

      <UserProfileSettingsModal
        isOpen={isProfileSettingsOpen}
        onClose={() => setIsProfileSettingsOpen(false)}
        profile={profile}
        setProfile={setProfile}
        showToast={showToast}
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
