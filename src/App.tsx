import React, { useState, useEffect } from 'react';
import { supabase, isMockSupabase } from './lib/supabaseClient';
import { AppView, SalonProfile, SalonService, Stylist, Appointment, ClientRecord, BusinessTypeId, LoyaltyConfig } from './types';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS, INITIAL_APPOINTMENTS, INITIAL_CLIENTS } from './mockData';
import { CATEGORY_TEMPLATES } from './categoryTemplates';
import { ACCENT_PALETTES, applyPrimaryAccentCssVar, AccentPaletteKey } from './themeAccents';
import { DEFAULT_LOYALTY_CONFIG, calculateLoyaltyTier } from './loyaltyData';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SalonWebsitePreview } from './components/SalonWebsitePreview';
import { SaaSDashboard } from './components/SaaSDashboard';
import { AuthModal } from './components/AuthModal';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [wizardStartingStep, setWizardStartingStep] = useState<number>(1);

  // Auth State Listener
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  // Load persisted profile state from localStorage on initial mount
  const [profile, setProfile] = useState<SalonProfile>(INITIAL_SALON_PROFILE);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [user, setUser] = useState<any>(null);

  // Auth State Listener
  useEffect(() => {
    if (isMockSupabase) {
      console.log('Running in Mock Auth Mode');
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

  // Auto-Fetch Profile Sync
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user || isMockSupabase) return;
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (data) {
          setProfile((prev) => ({
            ...prev,
            businessName: data.salon_name || prev.businessName,
            ownerName: data.full_name || prev.ownerName,
            ownerRole: data.owner_role || prev.ownerRole,
            phone: data.phone_number || prev.phone,
            email: data.email || prev.email,
            ownerPhotoUrl: data.owner_photo_url || prev.ownerPhotoUrl,
            address: data.full_address || prev.address,
            postalCode: data.postal_code || prev.postalCode,
            landmark: data.landmark || prev.landmark,
          }));
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    };

    fetchProfile();
  }, [user]);

  // Real-time Auto-Save with Debounce
  useEffect(() => {
    if (!user || isMockSupabase) return;

    const timer = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const { error } = await supabase.from('profiles').upsert({
          id: user.id,
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
        });

        if (error) throw error;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error('Auto-save error:', err);
        setSaveStatus('error');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [profile, user]);

  const [services, setServices] = useState<SalonService[]>(INITIAL_SERVICES);
  const [stylists, setStylists] = useState<Stylist[]>(INITIAL_STYLISTS);
  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS);
  const [clients, setClients] = useState<ClientRecord[]>(INITIAL_CLIENTS);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);

  // Sync Supabase Realtime Data
  useEffect(() => {
    const fetchSyncData = async () => {
      if (isMockSupabase) return;
      try {
        const { data: apts } = await supabase.from('appointments').select('*').order('date', { ascending: false });
        if (apts && apts.length > 0) setAppointments(apts);
        
        const { data: clis } = await supabase.from('clients').select('*').order('lastVisit', { ascending: false });
        if (clis && clis.length > 0) setClients(clis);
      } catch (err) {
        console.warn('Could not sync with Supabase', err);
      }
    };

    fetchSyncData();
    const interval = setInterval(fetchSyncData, 3000); // Polling for mock mode support and fast sync
    return () => clearInterval(interval);
  }, []);

  // Auto-save profile (including logoUrl and coverImageUrl) to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pinky_nails_salon_profile_v1', JSON.stringify(profile));
    } catch (e) {
      console.warn('Could not save salon profile to localStorage:', e);
    }
  }, [profile]);

  // Sync primary accent CSS variable to :root whenever profile theme changes
  useEffect(() => {
    const accentKey = (profile.themeAccentKey as AccentPaletteKey) || 'slate';
    const pal = ACCENT_PALETTES[accentKey];
    const primaryColor = profile.customAccentColor || (pal ? pal.primaryHex : '#0f172a');
    const secondaryColor = pal ? pal.secondaryHex : '#334155';
    applyPrimaryAccentCssVar(primaryColor, secondaryColor);
  }, [profile.themeAccentKey, profile.customAccentColor]);

  const handleSelectCategory = (catId: BusinessTypeId) => {
    const tmpl = CATEGORY_TEMPLATES[catId];
    if (tmpl) {
      setProfile((prev) => ({
        ...prev,
        businessType: catId,
        businessName: tmpl.title,
        ownerName: tmpl.ownerName,
        ownerRole: tmpl.ownerRole,
        phone: tmpl.phone,
        whatsapp: tmpl.whatsapp,
        tagline: tmpl.tagline,
        about: tmpl.about,
        ownerPhotoUrl: tmpl.ownerPhotoUrl,
        coverImageUrl: tmpl.coverImageUrl,
        themePreset: tmpl.themePreset,
        currency: '₹',
        subdomain: tmpl.id.replace('_', ''),
        address: tmpl.defaultAddress,
        city: tmpl.defaultCity,
        postalCode: tmpl.defaultPostalCode,
        instagramHandle: tmpl.instagramHandle
      }));
      setServices(tmpl.services);
      setStylists(tmpl.stylists);
      
      // When selecting a category from landing page, start wizard at Step 2 (Tell us about business)
      setWizardStartingStep(2);
      setCurrentView('wizard');
    }
  };

  const handleAddAppointment = async (newApt: Appointment) => {
    // 1. Optimistic Update of Local State
    setAppointments((prev) => [newApt, ...prev]);

    // Calculate loyalty points earned: base visit points + spend points * multiplier
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

    // 2. Sync to Supabase in Background
    if (isMockSupabase) return;

    try {
      await supabase.from('appointments').insert([newApt]);

      if (updatedClient) {
        await supabase.from('clients').update({
          totalVisits: updatedClient.totalVisits,
          totalSpent: updatedClient.totalSpent,
          lastVisit: updatedClient.lastVisit,
          points: updatedClient.points,
          lifetimePoints: updatedClient.lifetimePoints,
          loyaltyTier: updatedClient.loyaltyTier,
          pointHistory: updatedClient.pointHistory
        }).eq('id', updatedClient.id);
      } else if (newClientRecord) {
        await supabase.from('clients').insert([newClientRecord]);
      }
    } catch (err) {
      console.warn('Supabase real-time sync failed for add appointment, relying on mock fallback.', err);
    }
  };

  const handleBuildWebsiteClick = () => {
    const wizardCompleted = localStorage.getItem('onboarding_wizard_completed') === 'true';
    if (wizardCompleted) {
      setCurrentView('preview');
    } else {
      setWizardStartingStep(1);
      setCurrentView('wizard');
    }
  };

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
              // If user clicks "Explore", we start wizard at Step 1 (Category Select)
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
        <OnboardingWizard
          profile={profile}
          setProfile={setProfile}
          services={services}
          setServices={setServices}
          stylists={stylists}
          setStylists={setStylists}
          initialStep={wizardStartingStep}
          saveStatus={saveStatus}
          onComplete={() => {
            localStorage.setItem('onboarding_wizard_completed', 'true');
            setCurrentView('preview');
          }}
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
          onSelectCategory={handleSelectCategory}
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
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
        onSuccess={(u) => setUser(u)}
      />
    </div>
  );
}
