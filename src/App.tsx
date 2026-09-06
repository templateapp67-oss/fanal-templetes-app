import React, { useState, useEffect, useRef } from 'react';
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
function toServiceRow(s: SalonService, ownerId: string) {
  return {
    id: s.id,
    owner_id: ownerId,
    name: s.name,
    category: s.category,
    description: s.description,
    icon: s.icon,
    price: s.price,
    duration_minutes: s.durationMinutes,
    popular: s.popular ?? false,
    show_duration: s.showDuration ?? true,
  };
}

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
function toStylistRow(st: Stylist, ownerId: string) {
  return {
    id: st.id,
    owner_id: ownerId,
    name: st.name,
    role: st.role,
    avatar_url: st.avatarUrl,
    bio: st.bio,
    phone: st.phone,
    specialties: st.specialties,
    assigned_services: st.assignedServices,
    rating: st.rating,
    commission_rate: st.commissionRate,
    status: st.status,
    access_role: st.accessRole,
    hide_phone: st.hidePhone ?? false,
    schedule: st.schedule,
  };
}

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
function toLoyaltyConfigRow(config: LoyaltyConfig, ownerId: string) {
  return {
    owner_id: ownerId,
    program_enabled: config.programEnabled,
    points_per_visit: config.pointsPerVisit,
    points_per_hundred_spent: config.pointsPerHundredSpent,
    tier_thresholds: config.tierThresholds,
    tier_multipliers: config.tierMultipliers,
  };
}

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

function toRewardRow(r: any, ownerId: string, index: number) {
  return {
    id: r.id,
    owner_id: ownerId,
    title: r.title,
    required_points: r.requiredPoints,
    reward_type: r.rewardType,
    discount_value: r.discountValue,
    applicable_category: r.applicableCategory,
    description: r.description,
    is_active: r.isActive,
    coupon_code_prefix: r.couponCodePrefix,
    sort_order: index,
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ id: Date.now(), message, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

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
          setProfile((prev) => ({
            ...prev,
            businessName: data.salon_name || meta.salon_name || prev.businessName,
            ownerName: data.full_name || meta.full_name || prev.ownerName,
            ownerRole: data.owner_role || prev.ownerRole,
            phone: data.phone_number || meta.phone_number || prev.phone,
            email: data.email || user.email || prev.email,
            ownerPhotoUrl: data.owner_photo_url || prev.ownerPhotoUrl,
            address: data.full_address || prev.address,
            city: data.city || meta.city || prev.city,
            postalCode: data.postal_code || prev.postalCode,
            landmark: data.landmark || prev.landmark,
          }));
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

  // Hydrate services / staff / loyalty from Supabase once the owner logs in
  useEffect(() => {
    if (!user || isMockSupabase) return;
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [svc, stf, lc, rw] = await Promise.all([
          supabase.from('services').select('*').order('sort_order'),
          supabase.from('stylists').select('*').order('sort_order'),
          supabase.from('loyalty_config').select('*').eq('owner_id', user.id).maybeSingle(),
          supabase.from('loyalty_rewards').select('*').eq('owner_id', user.id).order('sort_order'),
        ]);
        if (cancelled) return;

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
      } catch (err) {
        console.warn('Could not hydrate services/staff/loyalty from Supabase', err);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isMockSupabase]);

  // Unified, debounced save
  const persistSalonState = async (message?: string): Promise<boolean> => {
    setSaveStatus('saving');
    try {
      saveSalonState({ profile, services, stylists, loyaltyConfig, selectedTemplateId });
      localStorage.setItem('pinky_nails_salon_profile_v1', JSON.stringify(profile));

      if (user && !isMockSupabase) {
        const ownerId = user.id;
        const ops: PromiseLike<{ error: unknown }>[] = [
          supabase.from('profiles').upsert({
            id: ownerId,
            full_name: profile.ownerName,
            salon_name: profile.businessName,
            phone_number: profile.phone,
            email: profile.email,
            owner_role: profile.ownerRole,
            owner_photo_url: profile.ownerPhotoUrl,
            full_address: profile.address,
            postal_code: profile.postalCode,
            landmark: profile.landmark,
            updated_at: new Date().toISOString(),
          }),
        ];
        if (services.length) {
          ops.push(supabase.from('services').upsert(services.map((s) => toServiceRow(s, ownerId))));
        }
        if (stylists.length) {
          ops.push(supabase.from('stylists').upsert(stylists.map((st) => toStylistRow(st, ownerId))));
        }
        ops.push(supabase.from('loyalty_config').upsert(toLoyaltyConfigRow(loyaltyConfig, ownerId)));
        if (loyaltyConfig.rewards && loyaltyConfig.rewards.length) {
          ops.push(
            supabase
              .from('loyalty_rewards')
              .upsert(loyaltyConfig.rewards.map((r, i) => toRewardRow(r, ownerId, i)))
          );
        }
        const results = await Promise.allSettled(ops);
        if (results.some((r) => r.status === 'rejected' || r.value.error)) {
          throw new Error('One or more cloud tables failed to sync');
        }
      }

      setSaveStatus('saved');
      showToast(message || (user ? 'All changes saved to cloud.' : 'Auto-Saved. Website updated.'));
      setTimeout(() => setSaveStatus('idle'), 2500);
      return true;
    } catch (err) {
      console.warn('Save failed:', err);
      setSaveStatus('error');
      showToast('Save failed. Please try again.', 'error');
      return false;
    }
  };

  useEffect(() => {
    if (firstPersistRef.current) {
      firstPersistRef.current = false;
      return;
    }
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      persistSalonState();
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, services, stylists, loyaltyConfig, selectedTemplateId, user?.id, isMockSupabase]);

  const handleSaveNow = () => {
    return persistSalonState('Website details updated successfully!');
  };

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
