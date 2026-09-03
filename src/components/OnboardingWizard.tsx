import React, { useState } from 'react';
import { SalonProfile, SalonService, Stylist, BusinessTypeId } from '../types';
import { BUSINESS_TYPES } from '../mockData';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { AIBioModal } from './AIBioModal';
import { SocialConnectivityStep } from './SocialConnectivityStep';
import { AboutOwnerForm } from './AboutOwnerForm';

interface OnboardingWizardProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  stylists: Stylist[];
  setStylists: React.Dispatch<React.SetStateAction<Stylist[]>>;
  initialStep?: number;
  onComplete: () => void;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  stylists,
  setStylists,
  initialStep = 1,
  onComplete,
  saveStatus = 'idle',
}) => {
  const [currentStep, setCurrentStep] = useState<number>(initialStep);
  const [isBioModalOpen, setIsBioModalOpen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);

  // Define the core steps for the simplified flow
  // 1: Business Type (Category) - if not coming from landing page category select
  // 2: Tell us about your business (Business Info + About Owner)
  // 3: Connect your social media
  // 4: Claim your free domain name
  const totalSteps = 4;
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
    // Move to next step: Tell us about business
    setCurrentStep(2);
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
    if (currentStep === totalSteps) {
      startAIGeneration();
    } else {
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

      <div className={`${currentStep === 3 ? 'max-w-7xl' : 'max-w-4xl'} w-full px-4 sm:px-6 transition-all duration-300`}>
        {/* Progress Header */}
        <div className="mb-8 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[#C20E5A] text-white text-xs font-bold flex items-center justify-center">
                  {currentStep}
                </span>
                <span className="font-display font-bold text-sm text-gray-800">
                  Step {currentStep} of {totalSteps}
                </span>
              </div>

              {/* Save Status Indicator */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 transition-all">
                {saveStatus === 'saving' && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <span className="material-symbols-outlined text-xs animate-spin">progress_activity</span>
                    Saving...
                  </div>
                )}
                {saveStatus === 'saved' && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600">
                    <span className="material-symbols-outlined text-xs">check_circle</span>
                    Saved
                  </div>
                )}
                {saveStatus === 'error' && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
                    <span className="material-symbols-outlined text-xs">error</span>
                    Error
                  </div>
                )}
                {saveStatus === 'idle' && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    <span className="material-symbols-outlined text-xs">cloud_done</span>
                    Synced
                  </div>
                )}
              </div>
            </div>
            <span className="font-mono-caps text-xs font-bold text-[#C20E5A]">
              {progressPercent}% Completed
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-[#C20E5A] h-full transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* STEP CONTENT CONTAINER */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-xl min-h-[460px] flex flex-col justify-between">
          
          {/* STEP 1: Select your salon category */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#C20E5A] tracking-widest">
                  STEP 1
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Select your salon category</h2>
                <p className="text-gray-600 text-sm mt-1">
                  This helps us auto-generate the perfect layout and services for your brand.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 my-2 max-h-[420px] overflow-y-auto pr-1">
                {BUSINESS_TYPES.map((bt) => {
                  const isSelected = profile.businessType === bt.id;
                  return (
                    <div
                      key={bt.id}
                      onClick={() => handleBusinessTypeSelect(bt.id)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3 relative ${
                        isSelected
                          ? 'border-[#C20E5A] bg-[#C20E5A]/5 text-[#C20E5A] font-bold shadow-md'
                          : 'border-gray-200 hover:border-gray-300 text-gray-800'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#C20E5A] text-white' : 'bg-gray-100 text-gray-700'
                      }`}>
                        <span className="material-symbols-outlined text-2xl">{bt.icon}</span>
                      </div>
                      <div className="flex flex-col pr-4 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="font-display text-sm font-bold">{bt.title}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">
                          {bt.aestheticDescription || bt.description}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="material-symbols-outlined text-[#C20E5A] text-lg absolute top-3 right-3 fill-1">
                          check_circle
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Tell us about your business (Business Details & About Owner) */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-8 animate-fade-in pb-4">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#C20E5A] tracking-widest">
                  STEP 2
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Tell us about your business (बिजनेस की जानकारी)</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Add your contact details and founder story to build trust with your future clients.
                </p>
              </div>

              <div className="space-y-8">
                {/* Contact Details Section */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 w-full max-w-3xl mx-auto">
                  <h3 className="text-lg font-semibold text-[#111827] mb-6">Contact Details</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">Salon Name <span className="text-[#C20E5A]">*</span></label>
                      <input
                        type="text"
                        placeholder="Nexora Luxury Spa"
                        value={profile?.businessName || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, businessName: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">Phone Number</label>
                      <input
                        type="text"
                        placeholder="+91 98765 43210"
                        value={profile.phone}
                        onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">WhatsApp / Booking Line</label>
                      <input
                        type="text"
                        placeholder="+91 98765 43210"
                        value={profile.whatsapp}
                        onChange={(e) => setProfile((prev) => ({ ...prev, whatsapp: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">Full Address</label>
                      <input
                        type="text"
                        placeholder="Shop No. 12, Crystal Plaza, MG Road"
                        value={profile.address}
                        onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">City</label>
                      <input
                        type="text"
                        placeholder="Mumbai"
                        value={profile.city}
                        onChange={(e) => setProfile((prev) => ({ ...prev, city: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1.5">Postal Code</label>
                      <input
                        type="text"
                        placeholder="400001"
                        value={profile.postalCode}
                        onChange={(e) => setProfile((prev) => ({ ...prev, postalCode: e.target.value }))}
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF]"
                      />
                    </div>
                  </div>
                </div>

                {/* About Owner Form Component */}
                <AboutOwnerForm
                  ownerName={profile.ownerName}
                  setOwnerName={(val) => setProfile((p) => ({ ...p, ownerName: val }))}
                  ownerPhotoUrl={profile.ownerPhotoUrl}
                  setOwnerPhotoUrl={(val) => setProfile((p) => ({ ...p, ownerPhotoUrl: val }))}
                  ownerRole={profile.ownerRole || ''}
                  setOwnerRole={(val) => setProfile((p) => ({ ...p, ownerRole: val }))}
                  about={profile.about}
                  setAbout={(val) => setProfile((p) => ({ ...p, about: val }))}
                  onWriteWithAI={() => setIsBioModalOpen(true)}
                  onSpeak={() => setIsBioModalOpen(true)}
                />
              </div>
            </div>
          )}

          {/* STEP 3: Connect your social media */}
          {currentStep === 3 && (
            <div className="animate-fade-in w-full">
              <div className="mb-6">
                <span className="font-mono-caps text-xs font-bold text-[#C20E5A] tracking-widest">
                  STEP 3
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Connect your social media</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Sync your Instagram and Facebook to automatically pull photos and build trust.
                </p>
              </div>
              <SocialConnectivityStep
                profile={profile}
                setProfile={setProfile}
                onBack={prevStep}
                onContinue={nextStep}
              />
            </div>
          )}

          {/* STEP 4: Claim your free domain name */}
          {currentStep === 4 && (
            <div className="flex flex-col gap-6 animate-fade-in">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#C20E5A] tracking-widest">
                  STEP 4
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Claim your free domain name (डोमेन नाम चुनना)</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Choose a unique address for your salon website. It's free and included!
                </p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 w-full max-w-2xl mx-auto flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[#111827]">
                    Your Salon Address
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      value={profile.subdomain}
                      onChange={(e) => {
                        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setProfile((prev) => ({ ...prev, subdomain: val }));
                      }}
                      className="flex-1 p-3.5 rounded-l-xl border border-gray-200 border-r-0 bg-white text-gray-900 font-mono font-bold text-base focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A]"
                      placeholder="mysalon"
                    />
                    <div className="bg-gray-50 px-4 py-3.5 border border-gray-200 rounded-r-xl font-mono text-base font-bold text-gray-500">
                      .nexora.in
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3">
                  <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-emerald-900">Great news!</span>
                    <span className="text-xs text-emerald-700"><strong>{profile.subdomain || 'mysalon'}.nexora.in</strong> is currently available for your brand.</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50/50 flex items-start gap-3">
                    <span className="material-symbols-outlined text-[#C20E5A] text-lg mt-0.5">verified</span>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-gray-900">SSL Secure</span>
                      <span className="text-[10px] text-gray-500">HTTPS encrypted browsing</span>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50/50 flex items-start gap-3">
                    <span className="material-symbols-outlined text-[#C20E5A] text-lg mt-0.5">bolt</span>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-gray-900">Fast CDN</span>
                      <span className="text-[10px] text-gray-500">Global edge delivery</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* GENERATION PROGRESS */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-6 animate-fade-in">
              <div className="w-20 h-20 rounded-full bg-[#C20E5A]/10 text-[#C20E5A] flex items-center justify-center relative">
                <span className="material-symbols-outlined text-4xl animate-spin">auto_awesome</span>
              </div>

              <div>
                <h2 className="font-display text-3xl font-bold">Generating Your Salon Website...</h2>
                <p className="text-xs text-gray-500 mt-2 font-mono-caps tracking-wider">
                  Building layout, palette, and booking engine for {profile?.businessName || 'your salon'}
                </p>
              </div>

              <div className="w-full max-w-md bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#C20E5A] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>

              <div className="text-xs font-bold text-[#C20E5A] tracking-wide">
                {generationProgress}% - {generationProgress < 40 ? 'Analyzing brand aesthetic' : generationProgress < 80 ? 'Setting up calendar & booking system' : 'Finalizing live preview...'}
              </div>
            </div>
          )}

          {/* BOTTOM CONTROLS */}
          {!isGenerating && currentStep !== 3 && (
            <div className="flex justify-between items-center border-t border-gray-100 pt-6 mt-6">
              <button
                type="button"
                onClick={prevStep}
                disabled={currentStep === 1}
                className="px-6 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2 transition-all"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                <span>Back</span>
              </button>

              <button
                type="button"
                onClick={nextStep}
                className="bg-[#C20E5A] hover:bg-[#A30B4A] text-white text-sm font-bold px-10 py-3 rounded-xl shadow-lg shadow-[#C20E5A]/20 hover:shadow-[#C20E5A]/30 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>{currentStep === totalSteps ? 'Generate Website' : 'Continue'}</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
