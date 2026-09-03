import React, { useState } from 'react';
import { SalonProfile, SalonService, Stylist, BusinessTypeId } from '../types';
import { BUSINESS_TYPES } from '../mockData';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { AIBioModal } from './AIBioModal';
import { SocialConnectivityStep } from './SocialConnectivityStep';

interface OnboardingWizardProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists: React.Dispatch<React.SetStateAction<Stylist[]>>;
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  stylists,
  setStylists,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(2); // Start at Step 2 (Business Type)
  const [isBioModalOpen, setIsBioModalOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);

  const totalSteps = 12; // 12-step guided flow for maximum ease
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  const handleBusinessTypeSelect = (typeId: BusinessTypeId) => {
    const tmpl = CATEGORY_TEMPLATES[typeId];
    if (!tmpl) return;

    setProfile((prev) => ({
      ...prev,
      businessType: typeId,
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
  };

  const handleAddService = () => {
    const newSrv: SalonService = {
      id: `srv-custom-${Date.now()}`,
      name: 'Custom Specialty Service',
      category: 'General',
      durationMinutes: 45,
      price: 60,
      description: 'High-quality personalized service.',
      icon: 'content_cut',
      popular: false
    };
    setServices((prev) => [...prev, newSrv]);
  };

  const handleRemoveService = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
  };

  const startAIGeneration = () => {
    setIsGenerating(true);
    setGenerationProgress(10);

    const interval = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsGenerating(false);
            onComplete();
          }, 600);
          return 100;
        }
        return prev + 18;
      });
    }, 400);
  };

  const nextStep = () => {
    if (currentStep === totalSteps - 1) {
      setCurrentStep(totalSteps);
      startAIGeneration();
    } else if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-16 flex flex-col items-center justify-start bg-[#f9f9ff] text-[#151c27]">
      {/* Bio Modal */}
      <AIBioModal
        isOpen={isBioModalOpen}
        onClose={() => setIsBioModalOpen(false)}
        businessName={profile?.businessName || 'Our Salon'}
        businessType={profile?.businessType || 'hair_salon'}
        ownerName={profile?.ownerName || 'Owner'}
        onApply={(bio, tagline) => {
          setProfile((prev) => ({ ...prev, about: bio, tagline }));
        }}
      />

      <div className={`${currentStep === 6 ? 'max-w-7xl' : 'max-w-4xl'} w-full px-4 sm:px-6 transition-all duration-300`}>
        {/* Progress Header */}
        <div className="mb-8 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[#b0004a] text-white text-xs font-bold flex items-center justify-center">
                {currentStep}
              </span>
              <span className="font-display font-bold text-sm text-gray-800">
                Step {currentStep} of {totalSteps}
              </span>
            </div>
            <span className="font-mono-caps text-xs font-bold text-[#b0004a]">
              {progressPercent}% Completed
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-[#b0004a] h-full transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* STEP CONTENT CONTAINER */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-xl min-h-[460px] flex flex-col justify-between">
          
          {/* STEP 1: Welcome & Goal */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  GET STARTED
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">What is your primary goal today?</h2>
                <p className="text-gray-600 text-sm mt-1">
                  We'll customize your website template and booking options based on your target setup.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-4">
                {[
                  { title: 'Launch New Salon Site', icon: 'web', desc: 'Create a full mobile-friendly website with online bookings.' },
                  { title: 'Enable Online Bookings', icon: 'calendar_month', desc: 'Accept client appointments and deposits 24/7.' },
                  { title: 'Replace Existing Site', icon: 'published_with_changes', desc: 'Upgrade to Nexora AI with automated retention tools.' }
                ].map((item, idx) => (
                  <div
                    key={idx}
                    onClick={nextStep}
                    className="p-5 rounded-2xl border-2 border-gray-200 hover:border-[#b0004a] hover:bg-[#b0004a]/5 cursor-pointer transition-all flex flex-col gap-3 group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#b0004a]/10 text-[#b0004a] flex items-center justify-center group-hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-2xl">{item.icon}</span>
                    </div>
                    <h3 className="font-display font-bold text-base text-gray-900">{item.title}</h3>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Business Type Grid (Matches Screenshot 2) */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  BUSINESS TYPE
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Select your salon category</h2>
                <p className="text-gray-600 text-sm mt-1">
                  This helps us auto-generate the perfect layout, service list, and aesthetic for your brand.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 my-2 max-h-[360px] overflow-y-auto pr-1">
                {BUSINESS_TYPES.map((bt) => {
                  const isSelected = profile.businessType === bt.id;
                  return (
                    <div
                      key={bt.id}
                      onClick={() => handleBusinessTypeSelect(bt.id)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3 relative ${
                        isSelected
                          ? 'border-[#b0004a] bg-[#b0004a]/5 text-[#b0004a] font-bold shadow-md'
                          : 'border-gray-200 hover:border-gray-300 text-gray-800'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#b0004a] text-white' : 'bg-gray-100 text-gray-700'
                      }`}>
                        <span className="material-symbols-outlined text-2xl">{bt.icon}</span>
                      </div>
                      <div className="flex flex-col pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-display text-sm font-bold">{bt.title}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-normal">
                            {bt.paletteName}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">
                          {bt.aestheticDescription || bt.description}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="material-symbols-outlined text-[#b0004a] text-lg absolute top-3 right-3 fill-1">
                          check_circle
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Business Details & Bio (Matches Screenshot 3) */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  SALON INFORMATION
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Tell us about your business</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Add your contact details and founder story to build immediate trust with clients.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-2">
                {/* Left: Founder Photo Upload Card */}
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#b0004a] shadow-md relative group">
                    <img
                      src={profile.ownerPhotoUrl}
                      alt={profile.ownerName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="font-display text-sm font-bold">{profile.ownerName || 'Salon Owner'}</div>
                    <div className="text-xs text-gray-500">{profile.ownerRole || 'Founder'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextImg = profile.ownerPhotoUrl.includes('photo-1573496359142')
                        ? 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&q=80'
                        : 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80';
                      setProfile((p) => ({ ...p, ownerPhotoUrl: nextImg }));
                    }}
                    className="text-xs font-bold text-[#b0004a] hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">add_a_photo</span>
                    <span>Change Photo</span>
                  </button>
                </div>

                {/* Right: Input fields */}
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="font-bold text-gray-700">Salon Name</label>
                    <input
                      type="text"
                      value={profile?.businessName || ''}
                      onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
                      className="w-full mt-1 p-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700">Owner / Lead Stylist Name</label>
                    <input
                      type="text"
                      value={profile.ownerName}
                      onChange={(e) => setProfile({ ...profile, ownerName: e.target.value })}
                      className="w-full mt-1 p-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700">Phone Number</label>
                    <input
                      type="text"
                      value={profile.phone}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      className="w-full mt-1 p-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700">WhatsApp / Booking Line</label>
                    <input
                      type="text"
                      value={profile.whatsapp}
                      onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })}
                      className="w-full mt-1 p-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="font-bold text-gray-700">Salon Story / Bio</label>
                      <button
                        type="button"
                        onClick={() => setIsBioModalOpen(true)}
                        className="text-[#b0004a] font-bold text-xs hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">auto_awesome</span>
                        <span>Write with AI / Speak</span>
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={profile.about}
                      onChange={(e) => setProfile({ ...profile, about: e.target.value })}
                      className="w-full p-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Aesthetics & Theme Presets */}
          {currentStep === 4 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  VISUAL STYLE
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Choose your website aesthetic</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Select a color palette and visual atmosphere that matches your salon vibe.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
                {[
                  { id: 'luxe_light', name: 'Luxe Light', bg: 'bg-[#f9f9ff]', accent: 'bg-[#b0004a]', text: 'text-gray-900', desc: 'Clean, elegant, high-contrast rose accent.' },
                  { id: 'champagne_gold', name: 'Champagne Gold', bg: 'bg-[#fbf8f2]', accent: 'bg-[#c59b27]', text: 'text-gray-900', desc: 'Refined, golden warm luxury salon theme.' },
                  { id: 'velvet_rose', name: 'Velvet Rose', bg: 'bg-[#fff5f7]', accent: 'bg-[#d81b60]', text: 'text-gray-900', desc: 'Warm rose tones for high-end boutique salons.' },
                  { id: 'emerald_botanical', name: 'Emerald Botanical', bg: 'bg-[#f2f7f4]', accent: 'bg-[#1b5e20]', text: 'text-gray-900', desc: 'Calming organic green tones for spas & wellness.' }
                ].map((tp) => (
                  <div
                    key={tp.id}
                    onClick={() => setProfile((p) => ({ ...p, themePreset: tp.id as any }))}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col gap-3 ${
                      profile.themePreset === tp.id
                        ? 'border-[#b0004a] ring-2 ring-[#b0004a]/30 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-display font-bold text-base">{tp.name}</span>
                      {profile.themePreset === tp.id && (
                        <span className="material-symbols-outlined text-[#b0004a] text-xl fill-1">
                          check_circle
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{tp.desc}</p>
                    <div className={`h-12 w-full rounded-lg ${tp.bg} border border-gray-300 p-2 flex items-center justify-between`}>
                      <span className={`text-xs font-bold ${tp.text}`}>Preview Text</span>
                      <div className={`w-6 h-6 rounded-full ${tp.accent}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: Services & Pricing */}
          {currentStep === 5 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div className="flex justify-between items-end">
                <div>
                  <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                    SERVICES MENU
                  </span>
                  <h2 className="font-display text-3xl font-bold mt-1">Configure your services & pricing</h2>
                </div>
                <button
                  type="button"
                  onClick={handleAddService}
                  className="bg-[#b0004a] text-white text-xs font-bold px-3.5 py-2 rounded-lg hover:bg-[#d81b60] flex items-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  <span>Add Service</span>
                </button>
              </div>

              <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
                {services.map((srv) => (
                  <div
                    key={srv.id}
                    className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="w-8 h-8 rounded-lg bg-[#b0004a]/10 text-[#b0004a] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-lg">{srv.icon || 'spa'}</span>
                      </div>
                      <input
                        type="text"
                        value={srv.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setServices((prev) => prev.map((s) => (s.id === srv.id ? { ...s, name: val } : s)));
                        }}
                        className="font-bold text-gray-900 bg-transparent border-b border-gray-300 focus:outline-none focus:border-[#b0004a] text-sm w-full sm:w-64"
                      />
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 font-mono-caps">Price (₹):</span>
                        <input
                          type="number"
                          value={srv.price}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setServices((prev) => prev.map((s) => (s.id === srv.id ? { ...s, price: val } : s)));
                          }}
                          className="w-20 p-1.5 rounded border border-gray-300 text-center font-bold"
                        />
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 font-mono-caps">Duration (min):</span>
                        <input
                          type="number"
                          value={srv.durationMinutes}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setServices((prev) => prev.map((s) => (s.id === srv.id ? { ...s, durationMinutes: val } : s)));
                          }}
                          className="w-16 p-1.5 rounded border border-gray-300 text-center font-bold"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveService(srv.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 06: SOCIAL CONNECTIVITY */}
          {currentStep === 6 && (
            <div className="animate-fade-in w-full">
              <SocialConnectivityStep
                profile={profile}
                setProfile={setProfile}
                onBack={prevStep}
                onContinue={nextStep}
              />
            </div>
          )}

          {/* STEP 7-10: Booking Rules, Payments, Domain */}
          {currentStep >= 7 && currentStep <= 10 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  CONFIGURATION
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">
                  {currentStep === 7 && 'Team members & specialists'}
                  {currentStep === 8 && 'Booking & deposit rules'}
                  {currentStep === 9 && 'Payment gateways'}
                  {currentStep === 10 && 'Claim your free domain name'}
                </h2>
                <p className="text-gray-600 text-sm mt-1">
                  Automate deposit collection and client notifications seamlessly.
                </p>
              </div>

              {currentStep === 8 && (
                <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-sm">Require Online Deposit to Book</div>
                      <div className="text-xs text-gray-500">Reduces no-shows by up to 90%.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.requireDeposit}
                      onChange={(e) => setProfile({ ...profile, requireDeposit: e.target.checked })}
                      className="w-5 h-5 accent-[#b0004a]"
                    />
                  </div>

                  {profile.requireDeposit && (
                    <div className="flex items-center gap-4 text-xs pt-2 border-t border-gray-200">
                      <span className="font-bold">Deposit Percentage:</span>
                      {[15, 25, 50, 100].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setProfile({ ...profile, depositPercentage: pct })}
                          className={`px-3 py-1.5 rounded-lg border font-bold ${
                            profile.depositPercentage === pct
                              ? 'bg-[#b0004a] text-white border-[#b0004a]'
                              : 'bg-white border-gray-300 text-gray-700'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {currentStep === 10 && (
                <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
                  <label className="font-bold text-xs font-mono-caps text-gray-700">
                    Your Subdomain
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={profile.subdomain}
                      onChange={(e) => setProfile({ ...profile, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                      className="p-3 rounded-xl border border-gray-300 bg-white text-gray-900 font-mono font-bold text-sm flex-1"
                    />
                    <span className="font-mono text-sm text-gray-500">.nexora.in</span>
                  </div>
                  <div className="text-xs text-emerald-600 flex items-center gap-1 font-bold">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span>{profile.subdomain}.nexora.in is available!</span>
                  </div>
                </div>
              )}

              {(currentStep === 7 || currentStep === 9) && (
                <div className="p-8 rounded-2xl border border-dashed border-gray-300 flex flex-col items-center justify-center text-center gap-3">
                  <span className="material-symbols-outlined text-4xl text-[#b0004a]">
                    check_circle
                  </span>
                  <div className="font-bold text-base">Standard Settings Applied</div>
                  <p className="text-xs text-gray-500 max-w-sm">
                    We've configured smart defaults. You can fine-tune operating hours and team permissions anytime in your Salon Dashboard.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 11 & 12: Realtime Generation Progress */}
          {(currentStep === 11 || currentStep === 12 || isGenerating) && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-6 animate-fade-in">
              <div className="w-20 h-20 rounded-full bg-[#b0004a]/10 text-[#b0004a] flex items-center justify-center relative">
                <span className="material-symbols-outlined text-4xl animate-spin">auto_awesome</span>
              </div>

              <div>
                <h2 className="font-display text-3xl font-bold">Generating Your Salon Website...</h2>
                <p className="text-xs text-gray-500 mt-2 font-mono-caps">
                  Building layout, palette, and booking engine for {profile?.businessName || 'your salon'}
                </p>
              </div>

              <div className="w-full max-w-md bg-gray-100 h-3 rounded-full overflow-hidden">
                <div
                  className="bg-[#b0004a] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>

              <div className="text-xs font-bold text-[#b0004a]">
                {generationProgress}% - {generationProgress < 40 ? 'Analyzing brand aesthetic' : generationProgress < 80 ? 'Setting up calendar & booking system' : 'Finalizing live preview...'}
              </div>
            </div>
          )}

          {/* BOTTOM CONTROLS (Hidden on step 6 since SocialConnectivityStep includes its own nav footer) */}
          {!isGenerating && currentStep !== 6 && (
            <div className="flex justify-between items-center border-t border-gray-100 pt-6 mt-6">
              <button
                type="button"
                onClick={prevStep}
                disabled={currentStep === 1}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                <span>Back</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={nextStep}
                  className="bg-[#b0004a] hover:bg-[#d81b60] text-white text-xs font-bold px-7 py-3 rounded-lg shadow-md shadow-[#b0004a]/20 hover:shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <span>{currentStep === totalSteps - 1 ? 'Generate Website' : 'Continue'}</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
