import React, { useState } from 'react';
import {
  Save,
  Eye,
  ExternalLink,
  Copy,
  Check,
  MapPin,
  Phone,
  Mail,
  MessageSquare,
  Clock,
  Scissors,
  Plus,
  Trash2,
  Globe,
  Loader2,
  Store,
  UserRound,
  Building2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { CATEGORY_TEMPLATES } from '../categoryTemplates';
import { slugifySalonName } from '../lib/salonStore';
import { AIBioModal } from './AIBioModal';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface WebsiteEditorProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services: SalonService[];
  setServices: React.Dispatch<React.SetStateAction<SalonService[]>>;
  saveStatus: SaveStatus;
  onComplete: () => void;
  onSelectTemplate?: (catId: BusinessTypeId) => void;
  selectedTemplateId?: BusinessTypeId;
  siteUrl?: string;
  onSave?: () => void;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

const CATEGORY_OPTIONS = Object.values(CATEGORY_TEMPLATES);

export const WebsiteEditor: React.FC<WebsiteEditorProps> = ({
  profile,
  setProfile,
  services,
  setServices,
  saveStatus,
  onComplete,
  onSelectTemplate,
  selectedTemplateId,
  siteUrl,
  onSave,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [isBioModalOpen, setIsBioModalOpen] = useState(false);

  const upd = (patch: Partial<SalonProfile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  // -- Services ------------------------------------------------
  const addService = () => {
    const srv: SalonService = {
      id: `srv-${Date.now()}`,
      name: 'New Service',
      category: CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.subCategories?.[0] || 'General',
      durationMinutes: 45,
      price: 500,
      description: 'Description coming soon.',
      icon: 'sparkles',
      popular: false,
    };
    setServices((prev) => [...prev, srv]);
    showToast?.('New service added to your menu.');
  };

  const updateService = (id: string, patch: Partial<SalonService>) =>
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeService = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
    showToast?.('Service removed.');
  };

  const handleTemplateChange = (catId: BusinessTypeId) => {
    onSelectTemplate?.(catId);
  };

  const handleCopyLink = () => {
    if (!siteUrl) return;
    navigator.clipboard?.writeText(siteUrl);
    setCopied(true);
    showToast?.('Website link copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onSave?.();
    showToast?.('Website details updated successfully!');
  };

  const subCategories =
    CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.subCategories || [];

  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'error'
      ? 'Save failed'
      : saveStatus === 'saved'
      ? 'Auto-Saved'
      : 'All changes saved';

  return (
    <div className="min-h-screen pt-24 pb-16 bg-[#f6f7fb] text-[#151c27]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
        {/* ===== Top sticky save bar ===== */}
        <div className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-sm px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#C20E5A]/10 text-[#C20E5A] flex items-center justify-center shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight truncate">
                Website Editor
              </h1>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 font-medium">
                <span className="font-mono text-[#C20E5A] font-bold">
                  {CATEGORY_TEMPLATES[selectedTemplateId || profile.businessType]?.title || 'Salon'}
                </span>
                <span className="text-gray-300">•</span>
                <span className="truncate">{siteUrl}</span>
              </div>
            </div>
          </div>

          {/* Save status pill */}
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                saveStatus === 'saving'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : saveStatus === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : saveStatus === 'saved'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveStatus === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{saveLabel}</span>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Save &amp; Update Website</span>
            </button>

            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Live Preview</span>
            </button>
          </div>
        </div>

        {/* ===== 1. SALON DETAILS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Store className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Salon Details</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            This is the identity shown on your live website header, hero and about section.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Salon/Studio Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={profile.businessName}
                onChange={(e) =>
                  upd({ businessName: e.target.value, subdomain: slugifySalonName(e.target.value) || profile.subdomain })
                }
                placeholder="e.g. Miraki Hair Studio"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold font-mono-caps text-gray-700">
                  Tagline / Catchphrase
                </label>
                <button
                  type="button"
                  onClick={() => setIsBioModalOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C20E5A] hover:text-[#A30B4A] hover:underline cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Generate with AI / Voice</span>
                </button>
              </div>
              <input
                type="text"
                value={profile.tagline}
                onChange={(e) => upd({ tagline: e.target.value })}
                placeholder="e.g. Redefining luxury salon care"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold font-mono-caps text-gray-700">
                  About / Story
                </label>
                <button
                  type="button"
                  onClick={() => setIsBioModalOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C20E5A] hover:text-[#A30B4A] hover:underline cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Generate with AI / Voice</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={profile.about}
                onChange={(e) => upd({ about: e.target.value })}
                placeholder="Tell clients about your salon's vision, philosophy and experience..."
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Owner / Founder Name
              </label>
              <input
                type="text"
                value={profile.ownerName}
                onChange={(e) => upd({ ownerName: e.target.value })}
                placeholder="e.g. Priya Sharma"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 2. CONTACT & LOCATION ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <UserRound className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Contact &amp; Location</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            How customers reach, call, WhatsApp or find your physical salon.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => upd({ phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                WhatsApp Number
              </label>
              <div className="relative">
                <MessageSquare className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={profile.whatsapp}
                  onChange={(e) => upd({ whatsapp: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => upd({ email: e.target.value })}
                  placeholder="hello@miraki.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Physical Address / Location <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={profile.address}
                  onChange={(e) => upd({ address: e.target.value })}
                  placeholder="Plot 42, Road No 36, Jubilee Hills"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                City / Area
              </label>
              <input
                type="text"
                value={profile.city}
                onChange={(e) => upd({ city: e.target.value })}
                placeholder="e.g. Hyderabad, Telangana"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 3. SERVICES & PRICING ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-[#C20E5A]" />
              <h2 className="font-display font-bold text-base">Services &amp; Pricing</h2>
            </div>
            <button
              type="button"
              onClick={addService}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C20E5A]/10 hover:bg-[#C20E5A]/20 text-[#C20E5A] text-xs font-bold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Service</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Add or edit the treatments your customers can book online with prices in ₹.
          </p>

          <div className="space-y-3">
            {services.map((srv, idx) => (
              <div
                key={srv.id}
                className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-[#C20E5A]/30 transition-all flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="w-6 text-center text-xs font-mono font-bold text-gray-400">
                  {idx + 1}
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                      Service Name
                    </label>
                    <input
                      type="text"
                      value={srv.name}
                      onChange={(e) => updateService(srv.id, { name: e.target.value })}
                      placeholder="e.g. Signature Haircut & Styling"
                      className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                      Category
                    </label>
                    <select
                      value={srv.category}
                      onChange={(e) => updateService(srv.id, { category: e.target.value })}
                      className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                    >
                      {subCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                        Price (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={srv.price}
                        onChange={(e) =>
                          updateService(srv.id, { price: Number(e.target.value) || 0 })
                        }
                        className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono-caps text-gray-500 block mb-0.5">
                        Mins
                      </label>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={srv.durationMinutes}
                        onChange={(e) =>
                          updateService(srv.id, {
                            durationMinutes: Number(e.target.value) || 15,
                          })
                        }
                        className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeService(srv.id)}
                  className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors self-end md:self-center cursor-pointer"
                  title="Delete service"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ===== 4. WORKING HOURS / TIMINGS ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Timings</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Displayed on your website header and footer so clients know when you’re open.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Mon – Fri
              </label>
              <input
                type="text"
                value={profile.workingHoursMonFri || ''}
                onChange={(e) => upd({ workingHoursMonFri: e.target.value })}
                placeholder="10:00 AM - 08:30 PM"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Saturday
              </label>
              <input
                type="text"
                value={profile.workingHoursSat || ''}
                onChange={(e) => upd({ workingHoursSat: e.target.value })}
                placeholder="09:00 AM - 09:00 PM"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Sunday
              </label>
              <input
                type="text"
                value={profile.workingHoursSun || ''}
                onChange={(e) => upd({ workingHoursSun: e.target.value })}
                placeholder="Closed / By appointment"
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              />
            </div>
          </div>
        </section>

        {/* ===== 5. TEMPLATE & LIVE SITE ===== */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-[#C20E5A]" />
            <h2 className="font-display font-bold text-base">Template &amp; Live Website</h2>
          </div>
          <p className="text-[11px] text-gray-500 mb-5">
            Pick a template (your data is preserved) and grab your white-label link.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Active Template
              </label>
              <select
                value={selectedTemplateId || profile.businessType}
                onChange={(e) => handleTemplateChange(e.target.value as BusinessTypeId)}
                className="w-full p-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
              >
                {CATEGORY_OPTIONS.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.title} ({tmpl.paletteLabel.split('(')[0]})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-500 mt-1">
                Switching keeps your salon details, services &amp; pricing.
              </p>
            </div>

            <div>
              <label className="text-xs font-bold font-mono-caps text-gray-700 block mb-1">
                Sub-domain (white-label)
              </label>
              <div className="flex items-center">
                <input
                  type="text"
                  value={profile.subdomain}
                  onChange={(e) =>
                    upd({
                      subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    })
                  }
                  placeholder="mysalon"
                  className="flex-1 p-2.5 rounded-l-xl border border-gray-300 border-r-0 text-sm font-mono focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] outline-none"
                />
                <span className="bg-gray-50 px-3 py-2.5 border border-gray-300 rounded-r-xl text-sm font-mono text-gray-500">
                  .nexora.in
                </span>
              </div>
            </div>

            <div className="md:col-span-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-mono text-sm font-bold text-emerald-900 truncate">
                  {siteUrl}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-[11px] font-bold hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </button>
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Site</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ===== BOTTOM SAVE BAR ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            {saveStatus === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span>
              {saveStatus === 'error'
                ? 'We couldn’t save your changes. Please try again.'
                : 'Your details are saved and already reflected in the live preview.'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#C20E5A] hover:bg-[#A30B4A] disabled:opacity-60 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            {saveStatus === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save &amp; Update Website</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Count of fields for transparency (dedup guard) */}
        <p className="text-center text-[10px] text-gray-400 font-mono">
          One form • Each field asked once • Auto-synced with the live template
        </p>
      </div>

      <AIBioModal
        isOpen={isBioModalOpen}
        onClose={() => setIsBioModalOpen(false)}
        businessName={profile.businessName}
        businessType={profile.businessType}
        ownerName={profile.ownerName}
        onApply={(bio, tagline) => {
          upd({ about: bio, tagline });
          showToast?.('AI Bio & Tagline generated and applied!');
        }}
      />
    </div>
  );
};
