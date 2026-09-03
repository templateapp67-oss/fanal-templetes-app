import React, { useState, useEffect } from 'react';
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

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');

  // Application Data States
  const [profile, setProfile] = useState<SalonProfile>(INITIAL_SALON_PROFILE);
  const [services, setServices] = useState<SalonService[]>(INITIAL_SERVICES);
  const [stylists, setStylists] = useState<Stylist[]>(INITIAL_STYLISTS);
  const [appointments, setAppointments] = useState<Appointment[]>(INITIAL_APPOINTMENTS);
  const [clients, setClients] = useState<ClientRecord[]>(INITIAL_CLIENTS);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);

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
    }
  };

  const handleAddAppointment = (newApt: Appointment) => {
    setAppointments((prev) => [newApt, ...prev]);

    // Calculate loyalty points earned: base visit points + spend points * multiplier
    const spendPoints = Math.round((newApt.servicePrice / 100) * loyaltyConfig.pointsPerHundredSpent);
    const baseVisitPoints = loyaltyConfig.pointsPerVisit;
    const earnedPoints = baseVisitPoints + spendPoints;

    // Also sync to CRM clients list if new
    const existingClient = clients.find((c) => c.phone === newApt.clientPhone);
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

          return {
            ...c,
            totalVisits: c.totalVisits + 1,
            totalSpent: c.totalSpent + newApt.servicePrice,
            lastVisit: newApt.date,
            points: newTotalPoints,
            lifetimePoints: newLifetime,
            loyaltyTier: newTier,
            pointHistory: [newTx, ...(c.pointHistory || [])],
          };
        })
      );
    } else {
      const initialPoints = earnedPoints;
      const initialTier = calculateLoyaltyTier(initialPoints, loyaltyConfig.tierThresholds);
      const newClientRecord: ClientRecord = {
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
      setClients((prev) => [newClientRecord, ...prev]);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Header
        currentView={currentView}
        setCurrentView={setCurrentView}
        salonName={profile.businessName}
      />

      {currentView === 'landing' && (
        <LandingPage 
          setCurrentView={setCurrentView} 
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
          onComplete={() => setCurrentView('preview')}
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
    </div>
  );
}
