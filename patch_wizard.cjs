const fs = require('fs');

let content = fs.readFileSync('src/components/OnboardingWizard.tsx', 'utf8');

// Add import if not exists
if (!content.includes("AboutOwnerForm")) {
  content = content.replace("import { SocialConnectivityStep } from './SocialConnectivityStep';", "import { SocialConnectivityStep } from './SocialConnectivityStep';\nimport { AboutOwnerForm } from './AboutOwnerForm';");
}

const targetSection = `              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-2">`;

// We'll just replace the whole section starting from <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-2"> down to the end of the step 3 </div>
// Actually, it's safer to use a regex or string replacement.

const searchStart = `<div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-2">`;
const searchEnd = `                  </div>\n                </div>\n              </div>\n            </div>`; // Might be tricky to match exactly.

// Let's do a quick regex to replace step 3 content.
const step3Regex = /\{currentStep === 3 && \([\s\S]*?(?=\{currentStep === 4)/;
const newStep3 = `{currentStep === 3 && (
            <div className="flex flex-col gap-6 animate-fade-in pb-8">
              <div>
                <span className="font-mono-caps text-xs font-bold text-[#b0004a] tracking-widest">
                  SALON INFORMATION
                </span>
                <h2 className="font-display text-3xl font-bold mt-1">Tell us about your business</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Add your contact details and founder story to build immediate trust with clients.
                </p>
              </div>

              {/* Basic Details */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 w-full max-w-3xl mx-auto">
                <h3 className="text-lg font-semibold text-[#111827] mb-4">Contact Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-[#111827] mb-1.5">Salon Name</label>
                    <input
                      type="text"
                      value={profile?.businessName || ''}
                      onChange={(e) => setProfile((prev) => ({ ...prev, businessName: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#111827] mb-1.5">Phone Number</label>
                    <input
                      type="text"
                      value={profile.phone}
                      onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#111827] mb-1.5">WhatsApp / Booking Line</label>
                    <input
                      type="text"
                      value={profile.whatsapp}
                      onChange={(e) => setProfile((prev) => ({ ...prev, whatsapp: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827]"
                    />
                  </div>
                </div>
              </div>

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
          )}
          `;

content = content.replace(step3Regex, newStep3);
fs.writeFileSync('src/components/OnboardingWizard.tsx', content);
