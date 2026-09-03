import React, { useState } from 'react';
import { AppView, SalonProfile, SalonService, Stylist, Appointment, ClientRecord, BusinessTypeId } from './types';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS, INITIAL_APPOINTMENTS, INITIAL_CLIENTS } from './mockData';
import { CATEGORY_TEMPLATES } from './categoryTemplates';
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

    // Also sync to CRM clients list if new
    const existingClient = clients.find((c) => c.phone === newApt.clientPhone);
    if (existingClient) {
      setClients((prev) =>
        prev.map((c) =>
          c.id === existingClient.id
            ? {
                ...c,
                totalVisits: c.totalVisits + 1,
                totalSpent: c.totalSpent + newApt.servicePrice,
                lastVisit: newApt.date
              }
            : c
        )
      );
    } else {
      const newClientRecord: ClientRecord = {
        id: `cli-${Date.now()}`,
        name: newApt.clientName,
        phone: newApt.clientPhone,
        email: newApt.clientEmail,
        totalVisits: 1,
        totalSpent: newApt.servicePrice,
        lastVisit: newApt.date,
        notes: `First visit on ${newApt.date} for ${newApt.serviceName}`,
        favoriteStylist: newApt.stylistName
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
          services={services}
          stylists={stylists}
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
          appointments={appointments}
          setAppointments={setAppointments}
          clients={clients}
        />
      )}
    </div>
  );
}
