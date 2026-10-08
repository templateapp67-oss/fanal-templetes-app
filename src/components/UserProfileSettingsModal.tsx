import React, { useState } from 'react';
import { SalonProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { isMockSupabase } from '../lib/supabaseClient';
import { readPartnerProfile, resolveOwnerProfileName, savePartnerProfileSettings } from '../lib/readPartnerProfile';
import { describeProfileLoadFailure, describeProfileSaveFailure } from '../lib/bookingSettingsErrors';
import { normalizeWhatsApp } from '../lib/partnerProfile';

interface UserProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: SalonProfile;
  userId?: string;
  fallbackOwnerName?: string;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onSave?: (updatedProfile: SalonProfile) => Promise<void> | void;
}

export const UserProfileSettingsModal: React.FC<UserProfileSettingsModalProps> = ({
  isOpen,
  onClose,
  profile,
  userId,
  fallbackOwnerName,
  setProfile,
  showToast,
  onSave,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const dirty = React.useRef(false);
  const ownerId = userId || profile.ownerId;
  const [formData, setFormData] = useState({
    ownerName: resolveOwnerProfileName(profile.ownerName, fallbackOwnerName),
    ownerPhotoUrl: profile.ownerPhotoUrl || '',
    whatsapp: profile.whatsapp || profile.phone || '',
    dob: profile.dob || '',
    postalCode: profile.postalCode || '',
    city: profile.city || '',
    areaLocality: profile.areaLocality || '',
  });

  const [whatsappNotificationsEnabled, setWhatsappNotificationsEnabled] = useState(
    profile.whatsappNotificationsEnabled ?? true
  );

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Rehydrate from Supabase whenever this modal opens. Auth metadata is only a
  // fallback for a missing name; saved contact fields always come from the
  // authenticated profiles row.
  React.useEffect(() => {
    if (!isOpen) return;
    let active = true;
    dirty.current = false;
    setFormData({
      ownerName: resolveOwnerProfileName(profile.ownerName, fallbackOwnerName),
      ownerPhotoUrl: profile.ownerPhotoUrl || '',
      whatsapp: profile.whatsapp || profile.phone || '',
      dob: profile.dob || '',
      postalCode: profile.postalCode || '',
      city: profile.city || '',
      areaLocality: profile.areaLocality || '',
    });
    setWhatsappNotificationsEnabled(profile.whatsappNotificationsEnabled ?? true);
    setErrors({});

    if (isMockSupabase) return () => { active = false; };
    setIsLoadingProfile(true);
    void (async () => {
      try {
        const { data, error } = await readPartnerProfile(ownerId);
        if (error) throw error;
        if (!active || !data) return;

        const ownerName = resolveOwnerProfileName(data.ownerName, fallbackOwnerName || profile.ownerName);
        const loadedForm = {
          ownerName,
          ownerPhotoUrl: data.avatar ?? profile.ownerPhotoUrl ?? '',
          whatsapp: data.whatsapp || data.phone || '',
          dob: data.dob || '',
          postalCode: data.postalCode || '',
          city: data.city || '',
          areaLocality: data.areaLocality || '',
        };
        if (!dirty.current) setFormData(loadedForm);
        setWhatsappNotificationsEnabled(data.notifications ?? profile.whatsappNotificationsEnabled ?? true);

        // Keep the global profile and Header in sync with the same database
        // snapshot shown by the form. Preserve unrelated salon/editor fields.
        setProfile((previous) => ({
          ...previous,
          ownerId: data.ownerId || ownerId,
          ownerName,
          ownerPhotoUrl: data.avatar ?? previous.ownerPhotoUrl,
          phone: data.phone ?? previous.phone,
          whatsapp: data.whatsapp ?? previous.whatsapp,
          email: data.email ?? previous.email,
          address: data.address ?? previous.address,
          state: data.state ?? previous.state,
          landmark: data.landmark ?? previous.landmark,
          dob: data.dob ?? '',
          postalCode: data.postalCode ?? '',
          city: data.city ?? '',
          areaLocality: data.areaLocality ?? '',
          whatsappNotificationsEnabled: data.notifications ?? previous.whatsappNotificationsEnabled ?? true,
        }));
      } catch (error: any) {
        if (active) {
          // Full detail (SQLSTATE + message) stays in the console; the owner
          // gets a sentence they can act on instead of the raw driver text.
          console.warn('[UserProfileSettingsModal] Could not load saved profile:', {
            message: error?.message || String(error),
            code: error?.code ?? null,
          });
          showToast(describeProfileLoadFailure(error), 'error');
        }
      } finally {
        if (active) setIsLoadingProfile(false);
      }
    })();

    return () => { active = false; };
  }, [isOpen, ownerId, fallbackOwnerName]);

  if (!isOpen) return null;

  const handleChange = (field: string, value: string) => {
    dirty.current = true;
    let formattedValue = value;

    if (field === 'whatsapp') {
      const digits = value.replace(/\D/g, '').slice(-10);
      if (digits.length > 0) {
        if (digits.length <= 5) {
          formattedValue = `+91 ${digits}`;
        } else {
          formattedValue = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
        }
      } else {
        formattedValue = '+91 ';
      }
    } else if (field === 'postalCode') {
      formattedValue = value.replace(/\D/g, '').slice(0, 6);
    }

    setFormData((prev) => ({ ...prev, [field]: formattedValue }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dirty.current = true;

    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, ownerPhotoUrl: 'File size must be under 5MB.' }));
      showToast('Image size exceeds 5MB limit.', 'error');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, ownerPhotoUrl: 'Please upload a valid image file.' }));
      showToast('Please upload a valid image file.', 'error');
      return;
    }

    if (errors.ownerPhotoUrl) {
      setErrors((prev) => ({ ...prev, ownerPhotoUrl: '' }));
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_SIZE = 500;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          setFormData((prev) => ({ ...prev, ownerPhotoUrl: dataUrl }));
          showToast('Avatar image compressed and loaded successfully!');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const newErrors: Record<string, string> = {};

    if (!formData.ownerName.trim()) newErrors.ownerName = 'Full Name is required.';
    
    let cleanWhatsapp = '';
    try {
      cleanWhatsapp = normalizeWhatsApp(formData.whatsapp, false);
    } catch (error) {
      newErrors.whatsapp = error instanceof Error ? error.message : 'Enter a valid WhatsApp number.';
    }
    
    const cleanPostal = formData.postalCode.trim();
    if (cleanPostal && !/^[1-9]\d{5}$/.test(cleanPostal)) {
      newErrors.postalCode = 'Pin code must be a valid 6-digit Indian PIN code.';
    }

    // Validate and sanitize Date of Birth string
    let validDateStr: string | null = null;
    if (formData.dob.trim()) {
      const dobParsed = Date.parse(formData.dob.trim());
      if (isNaN(dobParsed)) {
        newErrors.dob = 'Please enter a valid date of birth.';
      } else {
        const normalizedDate = new Date(dobParsed).toISOString().slice(0, 10);
        if (normalizedDate > new Date().toISOString().slice(0, 10)) {
          newErrors.dob = 'Date of birth cannot be in the future.';
        } else {
          validDateStr = normalizedDate;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast('Please check the required fields.', 'error');
      return;
    }

    setIsSaving(true);

    const cleanPhone = cleanWhatsapp;

    const updatedProfile: SalonProfile = {
      ...profile,
      ownerId: ownerId || profile.ownerId,
      ownerName: formData.ownerName.trim(),
      ownerPhotoUrl: formData.ownerPhotoUrl || profile.ownerPhotoUrl,
      phone: cleanPhone,
      whatsapp: cleanWhatsapp,
      dob: validDateStr || '',
      postalCode: cleanPostal,
      city: formData.city.trim(),
      areaLocality: formData.areaLocality.trim(),
      whatsappNotificationsEnabled,
    };

    try {
      const avatarToPersist = formData.ownerPhotoUrl === '/nexora-salonos-logo.png'
        ? null
        : formData.ownerPhotoUrl || null;
      if (!isMockSupabase) {
        await savePartnerProfileSettings(ownerId, {
          ownerName: formData.ownerName.trim(),
          phone: cleanPhone || null,
          whatsapp: cleanWhatsapp || null,
          dob: validDateStr,
          postalCode: cleanPostal || null,
          city: formData.city.trim() || null,
          areaLocality: formData.areaLocality.trim() || null,
          avatar: avatarToPersist,
          notifications: whatsappNotificationsEnabled,
        });
      }

      // Sync local app state / context and let the app's save pipeline update
      // its user-scoped localStorage snapshot as well.
      const savedProfile = { ...updatedProfile, ownerPhotoUrl: avatarToPersist || '' };
      setProfile(savedProfile);

      if (onSave) {
        await onSave(savedProfile);
      } else {
        showToast('Profile updated successfully!');
      }

      onClose();
    } catch (error: any) {
      console.error('[Database Profile Settings Save Error] Detailed failure details:', {
        error: error?.message || error,
        payload: {
          full_name: formData.ownerName.trim(),
          whatsapp_number: cleanPhone,
          date_of_birth: validDateStr,
          avatar_url: formData.ownerPhotoUrl
        },
        timestamp: new Date().toISOString()
      });
      showToast(describeProfileSaveFailure(error), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="mx-auto flex max-h-[90dvh] w-full max-w-[min(36rem,95vw)] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl sm:rounded-3xl"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-rose-50 to-pink-50 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C20E5A] text-white flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-xl">manage_accounts</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">User Profile Settings</h2>
              <p className="text-xs text-gray-500">Manage account owner & contact details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1" aria-busy={isLoadingProfile}>
          {isLoadingProfile && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Loading saved profile…
            </div>
          )}
          {/* Avatar Section */}
          <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-2xl bg-gray-50/80 border border-gray-100">
            <div className="relative group shrink-0">
              <img
                src={formData.ownerPhotoUrl || '/nexora-salonos-logo.png'}
                alt="Avatar Preview"
                className="w-20 h-20 rounded-full object-cover ring-4 ring-pink-100 shadow-md bg-slate-950"
              />
            </div>
            <div className="flex-1 w-full space-y-2">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>Partner Logo / Avatar Image</span>
                {errors.ownerPhotoUrl && <span className="text-rose-600 font-medium">{errors.ownerPhotoUrl}</span>}
              </label>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-[#C20E5A] bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center gap-2 transition-all shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">upload</span>
                  {formData.ownerPhotoUrl && formData.ownerPhotoUrl !== '/nexora-salonos-logo.png' ? 'Change Photo / Logo' : 'Upload Custom Logo'}
                </button>
                {formData.ownerPhotoUrl && formData.ownerPhotoUrl !== '/nexora-salonos-logo.png' && (
                  <button
                    type="button"
                    onClick={() => {
                      dirty.current = true;
                      setFormData((prev) => ({ ...prev, ownerPhotoUrl: '/nexora-salonos-logo.png' }));
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 transition-all cursor-pointer"
                  >
                    Reset to Permanent Logo
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-400">Permanent Nexora Salonos logo is active by default. You can change it anytime.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>Full Name <span className="text-rose-500">*</span></span>
                {errors.ownerName && <span className="text-rose-600 font-medium">{errors.ownerName}</span>}
              </label>
              <input
                type="text"
                value={formData.ownerName}
                onChange={(e) => handleChange('ownerName', e.target.value)}
                placeholder="e.g. Alex Morgan"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.ownerName ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>

            {/* WhatsApp Number */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>WhatsApp Number</span>
                {errors.whatsapp && <span className="text-rose-600 font-medium">{errors.whatsapp}</span>}
              </label>
              <input
                type="text"
                value={formData.whatsapp}
                onChange={(e) => handleChange('whatsapp', e.target.value)}
                placeholder="+91 98765 43210"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.whatsapp ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>

            {/* Date of Birth (DOB) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>Date of Birth (DOB)</span>
                {errors.dob && <span className="text-rose-600 font-medium">{errors.dob}</span>}
              </label>
              <input
                type="date"
                value={formData.dob}
                onChange={(e) => handleChange('dob', e.target.value)}
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.dob ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>

            {/* Pin Code */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>Pin Code / Postal Code</span>
                {errors.postalCode && <span className="text-rose-600 font-medium">{errors.postalCode}</span>}
              </label>
              <input
                type="text"
                value={formData.postalCode}
                onChange={(e) => handleChange('postalCode', e.target.value)}
                placeholder="400050"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.postalCode ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>

            {/* City */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>City</span>
                {errors.city && <span className="text-rose-600 font-medium">{errors.city}</span>}
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="e.g. Mumbai"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.city ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>

            {/* Area / Locality */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span>Area / Locality</span>
                {errors.areaLocality && <span className="text-rose-600 font-medium">{errors.areaLocality}</span>}
              </label>
              <input
                type="text"
                value={formData.areaLocality}
                onChange={(e) => handleChange('areaLocality', e.target.value)}
                placeholder="e.g. Bandra West"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 transition-all ${
                  errors.areaLocality ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200'
                }`}
              />
            </div>
          </div>

          {/* WhatsApp Notifications Toggle */}
          <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-lg">chat</span>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">WhatsApp Booking Confirmations</h4>
                <p className="text-[10px] text-gray-500">Enable status alerts using your WhatsApp number (<span className="font-semibold text-emerald-700">{formData.whatsapp || 'Not set'}</span>)</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={whatsappNotificationsEnabled}
                onChange={(e) => {
                  dirty.current = true;
                  setWhatsappNotificationsEnabled(e.target.checked);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isLoadingProfile}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-[#C20E5A] hover:bg-[#A30B4A] shadow-md shadow-[#C20E5A]/20 transition-all active:scale-95 flex items-center gap-2 ${
                isSaving || isLoadingProfile ? 'opacity-80 cursor-not-allowed' : ''
              }`}
            >
              {isSaving && (
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {isSaving ? 'Saving...' : 'Save Profile Settings'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
