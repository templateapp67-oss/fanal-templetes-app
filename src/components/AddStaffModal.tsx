import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Sparkles, 
  Copy, 
  Check, 
  Shield, 
  UserCheck, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Stylist, SalonService, StaffAccessRole, StaffStatus, DaySchedule } from '../types';

interface AddStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddStaff: (newStaff: Stylist) => void;
  primaryAccentColor?: string; // e.g. '#900C3F' or '#800020'
  services?: SalonService[];
}

// 6 Curated circular avatar presets (40x40px)
const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1618077360395-f3068be8e001?q=80&w=200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80'
];

const PRIMARY_ROLES = [
  'Senior Stylist',
  'Junior Stylist',
  'Hair Dresser',
  'Makeup Artist',
  'Nail Artist',
  'Spa Therapist',
  'Salon Manager',
  'Receptionist',
  'Barber',
  'Senior Barber',
  'Color Specialist',
  'Beauty Expert',
  'Other'
];

const ACCESS_ROLES: StaffAccessRole[] = [
  'Service Provider (Assigned)',
  'Manager (Full Access)',
  'Receptionist (Frontdesk)'
];

const STATUS_OPTIONS: StaffStatus[] = ['Available', 'Busy', 'On Leave', 'Inactive'];

// Exact Assigned Services list
const ASSIGNED_SERVICES_LIST = [
  { id: 'srv-p1', name: 'Luxury Spa Pedicure', subtag: 'Pedicure & Manicure' },
  { id: 'srv-p2', name: 'Gel Polish Overlay', subtag: 'Nail Art & Gel' },
  { id: 'srv-p3', name: 'Lash Lift & Tint', subtag: 'Lash & Brow' }
];

// Exact Specializations & Skills list
const DEFAULT_SKILLS = [
  'Balayage',
  'Hair Coloring',
  'Bridal Makeup',
  'Facial Treatments',
  'Nail Art',
  'Hair Extensions',
  'Threading & Waxing',
  'Deep Tissue Massage',
  'Beard Sculpting',
  'Keratin Treatment'
];

const TIME_OPTIONS = [
  '08:00 AM', '08:30 AM', '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM',
  '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM',
  '05:00 PM', '05:30 PM', '06:00 PM', '06:30 PM', '07:00 PM', '07:30 PM',
  '08:00 PM', '08:30 PM', '09:00 PM'
];

export const AddStaffModal: React.FC<AddStaffModalProps> = ({
  isOpen,
  onClose,
  onAddStaff,
  primaryAccentColor = '#900C3F',
  services = []
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form States
  const [selectedPhoto, setSelectedPhoto] = useState<string>(PRESET_AVATARS[0]);
  const [customPhotoUrl, setCustomPhotoUrl] = useState<string>(PRESET_AVATARS[0]);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  
  // Basic Info
  const [fullName, setFullName] = useState<string>('');
  const [primaryRole, setPrimaryRole] = useState<string>('Senior Stylist');
  const [appAccessRole, setAppAccessRole] = useState<StaffAccessRole>('Service Provider (Assigned)');
  
  // Contact, Commission & Status
  const [mobileNumber, setMobileNumber] = useState<string>('+91 98765 43210');
  const [commissionRate, setCommissionRate] = useState<number>(15);
  const [currentStatus, setCurrentStatus] = useState<StaffStatus>('Available');
  
  // Privacy Settings
  const [hideMobileNumber, setHideMobileNumber] = useState<boolean>(false);
  
  // Assigned Services (default active: Luxury Spa Pedicure, Gel Polish Overlay)
  const [selectedServices, setSelectedServices] = useState<string[]>([
    'Luxury Spa Pedicure',
    'Gel Polish Overlay'
  ]);
  
  // Bio
  const [bio, setBio] = useState<string>('');
  const [isGeneratingBio, setIsGeneratingBio] = useState<boolean>(false);
  
  // Specializations & Skills (default active: Balayage)
  const [selectedSkills, setSelectedSkills] = useState<string[]>(['Balayage']);
  const [customSkillInput, setCustomSkillInput] = useState<string>('');
  const [allAvailableSkills, setAllAvailableSkills] = useState<string[]>(DEFAULT_SKILLS);

  // Weekly Schedule (Monday to Sunday)
  const [weeklySchedule, setWeeklySchedule] = useState<DaySchedule[]>([
    { day: 'Monday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Tuesday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Wednesday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Thursday', enabled: true, fromTime: '09:00 AM', toTime: '06:00 PM' },
    { day: 'Friday', enabled: true, fromTime: '09:00 AM', toTime: '07:00 PM' },
    { day: 'Saturday', enabled: true, fromTime: '10:00 AM', toTime: '05:00 PM' },
    { day: 'Sunday', enabled: true, fromTime: '10:00 AM', toTime: '04:00 PM' }
  ]);

  // Photo Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setUploadedPreviewUrl(url);
      setSelectedPhoto(url);
    }
  };

  const handleRemoveUploadedPhoto = () => {
    if (uploadedPreviewUrl && uploadedPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedPreviewUrl);
    }
    setUploadedPreviewUrl(null);
    setSelectedPhoto(PRESET_AVATARS[0]);
  };

  const handleSelectPreset = (url: string) => {
    setSelectedPhoto(url);
    setCustomPhotoUrl(url);
    if (uploadedPreviewUrl && uploadedPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedPreviewUrl);
    }
    setUploadedPreviewUrl(null);
  };

  const handleCustomPhotoChange = (url: string) => {
    setCustomPhotoUrl(url);
    setSelectedPhoto(url);
  };

  // Clean up any active Blob URL on component unmount
  useEffect(() => {
    return () => {
      if (uploadedPreviewUrl && uploadedPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedPreviewUrl);
      }
    };
  }, [uploadedPreviewUrl]);

  // Software Permissions Modal Dialog
  const [showPermissionsModal, setShowPermissionsModal] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  if (!isOpen) return null;

  // Toggle Assigned Service
  const handleToggleService = (serviceName: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceName)
        ? prev.filter((s) => s !== serviceName)
        : [...prev, serviceName]
    );
  };

  // Toggle Skill
  const handleToggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill]
    );
  };

  // Add Custom Skill
  const handleAddCustomSkill = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customSkillInput.trim();
    if (!trimmed) return;
    if (!allAvailableSkills.includes(trimmed)) {
      setAllAvailableSkills((prev) => [...prev, trimmed]);
    }
    if (!selectedSkills.includes(trimmed)) {
      setSelectedSkills((prev) => [...prev, trimmed]);
    }
    setCustomSkillInput('');
  };

  // AI Bio Generator
  const handleGenerateAiBio = () => {
    setIsGeneratingBio(true);
    const name = fullName.trim() || 'Sarah Jenkins';
    const role = primaryRole || 'Senior Stylist';
    const skillsText = selectedSkills.length > 0 ? selectedSkills.slice(0, 3).join(', ') : 'precision hair styling, balayage, and restorative treatments';

    setTimeout(() => {
      const bioTemplates = [
        `${name} is an accomplished ${role} specializing in ${skillsText}. With extensive salon experience, ${name} creates tailored client transformations, effortless styling, and memorable guest experiences.`,
        `Passionate and certified ${role} with master craft in ${skillsText}. ${name} combines contemporary aesthetics with detailed consultations to deliver luminous, personalized results.`,
        `Known for exceptional precision in ${skillsText}, ${name} is dedicated to bringing out every client's unique confidence through bespoke hair artistry and care.`
      ];
      const randomBio = bioTemplates[Math.floor(Math.random() * bioTemplates.length)];
      setBio(randomBio);
      setIsGeneratingBio(false);
    }, 500);
  };

  // Copy Monday to all working days
  const handleCopyMondayToAll = () => {
    const monday = weeklySchedule.find((s) => s.day === 'Monday');
    if (!monday) return;
    setWeeklySchedule((prev) =>
      prev.map((dayItem) => ({
        ...dayItem,
        enabled: monday.enabled,
        fromTime: monday.fromTime,
        toTime: monday.toTime
      }))
    );
  };

  // Schedule Row Update
  const handleScheduleChange = (
    index: number,
    field: 'enabled' | 'fromTime' | 'toTime',
    value: boolean | string
  ) => {
    setWeeklySchedule((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: value
      };
      return updated;
    });
  };

  // Submit Handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setFormError('Full Name is required.');
      return;
    }

    const newStaff: Stylist = {
      id: `staff-${Date.now()}`,
      name: fullName.trim(),
      role: primaryRole,
      avatarUrl: selectedPhoto || PRESET_AVATARS[0],
      rating: 4.9,
      specialties: selectedSkills.length > 0 ? selectedSkills : ['General Styling'],
      phone: mobileNumber.trim(),
      commissionRate: Number(commissionRate) || 15,
      status: currentStatus,
      accessRole: appAccessRole,
      hidePhone: hideMobileNumber,
      assignedServices: selectedServices,
      bio: bio.trim(),
      schedule: weeklySchedule
    };

    onAddStaff(newStaff);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-xs font-sans text-gray-800"
      id="add-staff-modal-container"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-[680px] max-h-[90vh] flex flex-col overflow-hidden relative"
      >
        {/* ========================================================= */}
        {/* 1. HEADER */}
        {/* ========================================================= */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between bg-white shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              Add New Staff Member
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure staff details, access roles, assigned services, and availability.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ========================================================= */}
        {/* SCROLLABLE FORM BODY */}
        {/* ========================================================= */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 1: STAFF PHOTO */}
          {/* ========================================================= */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              STAFF PHOTO
            </label>

            <span className="block text-xs text-gray-600 mb-2.5">
              {uploadedPreviewUrl ? 'Custom Photo Uploaded' : 'Select Preset Avatar or Upload Photo'}
            </span>

            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/png,image/jpeg,image/webp,image/jpg"
              className="hidden"
            />

            {uploadedPreviewUrl ? (
              /* Custom Uploaded Photo Preview State */
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 p-3 rounded-xl border border-gray-200 bg-gray-50/70">
                <div className="relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-[#900C3F] ring-offset-2 shadow-sm shrink-0">
                  <img
                    src={uploadedPreviewUrl}
                    alt="Uploaded Staff Avatar"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute inset-0 bg-black/20 flex items-center justify-center text-white">
                    <Check className="w-4 h-4 stroke-[3]" />
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">Custom Uploaded Photo</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Active
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    Preview generated from local device
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-400 bg-white text-gray-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-gray-500" />
                    <span>Change</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoveUploadedPhoto}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Choose Presets
                  </button>
                </div>
              </div>
            ) : (
              /* Preset Avatars Selection Row */
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* 6 Circular Avatar Presets (40x40px) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_AVATARS.map((url, idx) => {
                    const isSelected = selectedPhoto === url;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectPreset(url)}
                        className={`relative w-10 h-10 rounded-full overflow-hidden transition-all cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-[#900C3F] ring-offset-2 scale-105 shadow-sm'
                            : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Preset ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        {isSelected && (
                          <span className="absolute inset-0 bg-black/25 flex items-center justify-center text-white">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Upload Photo Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-3.5 rounded-lg border border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-700 text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-gray-500" />
                    <span>Upload Photo</span>
                  </button>
                </div>
              </div>
            )}

            {/* Photo URL Input */}
            <div className="mt-3">
              <input
                type="text"
                value={customPhotoUrl}
                onChange={(e) => handleCustomPhotoChange(e.target.value)}
                placeholder="https://images.unsplash.com/photo-1618077360395-f3068be8e001?q=80&w=200&auto=format&fit=crop"
                className="w-full px-3.5 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 font-mono focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent bg-gray-50/50 truncate"
              />
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 2: BASIC INFORMATION (2-COLUMN GRID) */}
          {/* ========================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                FULL NAME <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="e.g. Sarah Jenkins"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent placeholder:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                PRIMARY ROLE <span className="text-rose-500">*</span>
              </label>
              <select
                value={primaryRole}
                onChange={(e) => setPrimaryRole(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent bg-white text-gray-800"
              >
                {PRIMARY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 3: APP ACCESS ROLE */}
          {/* ========================================================= */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                APP ACCESS ROLE <span className="text-rose-500">*</span>
              </label>

              <button
                type="button"
                onClick={() => setShowPermissionsModal(true)}
                className="text-xs font-semibold text-[#900C3F] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-[#900C3F]" />
                <span>Software Permissions</span>
              </button>
            </div>

            <select
              value={appAccessRole}
              onChange={(e) => setAppAccessRole(e.target.value as StaffAccessRole)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent bg-white text-gray-800"
            >
              {ACCESS_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>

            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              Primary Role defines their professional title on your website. App Access Role defines their software permissions in Nexora.
            </p>
          </div>

          {/* ========================================================= */}
          {/* SECTION 4: CONTACT, COMMISSION & STATUS (3-COLUMN GRID) */}
          {/* ========================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                MOBILE NUMBER
              </label>
              <div className="relative">
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                COMMISSION %
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value))}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent font-mono"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-mono font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                CURRENT STATUS
              </label>
              <select
                value={currentStatus}
                onChange={(e) => setCurrentStatus(e.target.value as StaffStatus)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent bg-white text-gray-800"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 5: PRIVACY SETTINGS */}
          {/* ========================================================= */}
          <div className="p-3.5 rounded-xl border border-gray-200 bg-white">
            <div className="flex items-start gap-3">
              <input
                id="hide-phone-checkbox"
                type="checkbox"
                checked={hideMobileNumber}
                onChange={(e) => setHideMobileNumber(e.target.checked)}
                className="w-4 h-4 rounded text-[#900C3F] focus:ring-[#900C3F] cursor-pointer mt-0.5"
              />
              <div>
                <label 
                  htmlFor="hide-phone-checkbox"
                  className="text-xs font-bold text-gray-900 block cursor-pointer"
                >
                  Hide Mobile Number from Public/Staff List
                </label>
                <p className="text-xs text-gray-500 mt-0.5">
                  When enabled, phone contact is kept private and hidden from customer booking views.
                </p>
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 6: ASSIGNED SERVICES */}
          {/* ========================================================= */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2.5">
              ASSIGNED SERVICES
            </label>

            <div className="flex flex-wrap gap-2.5">
              {ASSIGNED_SERVICES_LIST.map((srv) => {
                const isSelected = selectedServices.includes(srv.name);
                return (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => handleToggleService(srv.name)}
                    className={`px-3.5 py-2 rounded-xl text-left border transition-all cursor-pointer flex flex-col gap-0.5 ${
                      isSelected
                        ? 'border-[#900C3F] bg-[#900C3F]/5 text-gray-900 shadow-xs'
                        : 'border-gray-300 bg-white hover:border-gray-400 text-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      {isSelected ? (
                        <span className="w-4 h-4 rounded-full bg-[#900C3F] text-white flex items-center justify-center shrink-0">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center shrink-0" />
                      )}
                      <span>{srv.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-medium pl-5.5">
                      {srv.subtag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 7: PROFESSIONAL BIOGRAPHY */}
          {/* ========================================================= */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                PROFESSIONAL BIOGRAPHY
              </label>

              <button
                type="button"
                onClick={handleGenerateAiBio}
                disabled={isGeneratingBio}
                className="text-xs font-medium px-2.5 py-1 rounded-lg border border-[#900C3F] text-[#900C3F] hover:bg-[#900C3F]/5 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGeneratingBio ? 'Writing Bio...' : 'Write Bio with AI'}</span>
              </button>
            </div>

            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio for customer booking profiles..."
              className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent resize-none leading-relaxed"
            />
          </div>

          {/* ========================================================= */}
          {/* SECTION 8: SPECIALIZATIONS & SKILLS */}
          {/* ========================================================= */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              SPECIALIZATIONS & SKILLS
            </label>

            {/* Skills Grid / Wrap */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {allAvailableSkills.map((skill) => {
                const isSelected = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => handleToggleSkill(skill)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                      isSelected
                        ? 'bg-[#900C3F] text-white shadow-xs border border-[#900C3F]'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                    }`}
                  >
                    <span>{isSelected ? `✓ ${skill}` : `+ ${skill}`}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom Skill Add Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customSkillInput}
                onChange={(e) => setCustomSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomSkill();
                  }
                }}
                placeholder="Add custom skill..."
                className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#900C3F] focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => handleAddCustomSkill()}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors cursor-pointer border border-gray-200"
              >
                Add
              </button>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION 9: WEEKLY SCHEDULE & HOURS */}
          {/* ========================================================= */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50">
            <div className="flex items-center justify-between mb-3 border-b border-gray-200/60 pb-2">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
                  WEEKLY SCHEDULE & HOURS
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopyMondayToAll}
                className="text-xs font-semibold text-[#900C3F] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Monday to all working days</span>
              </button>
            </div>

            <div className="space-y-2">
              {weeklySchedule.map((scheduleItem, idx) => (
                <div
                  key={scheduleItem.day}
                  className={`p-2.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                    scheduleItem.enabled
                      ? 'bg-white border-gray-200 shadow-xs'
                      : 'bg-gray-100/60 border-gray-200/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={scheduleItem.enabled}
                      onChange={(e) =>
                        handleScheduleChange(idx, 'enabled', e.target.checked)
                      }
                      className="w-4 h-4 rounded text-[#900C3F] focus:ring-[#900C3F] cursor-pointer"
                    />
                    <span className="font-bold text-xs text-gray-900 w-24">
                      {scheduleItem.day}
                    </span>
                  </div>

                  {scheduleItem.enabled ? (
                    <div className="flex items-center gap-2 text-xs pl-7 sm:pl-0">
                      <span className="text-[11px] font-mono text-gray-400">From</span>
                      <select
                        value={scheduleItem.fromTime}
                        onChange={(e) =>
                          handleScheduleChange(idx, 'fromTime', e.target.value)
                        }
                        className="px-2.5 py-1 text-xs rounded-md border border-gray-300 font-mono bg-white text-gray-700"
                      >
                        {TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>

                      <span className="text-[11px] font-mono text-gray-400">To</span>
                      <select
                        value={scheduleItem.toTime}
                        onChange={(e) =>
                          handleScheduleChange(idx, 'toTime', e.target.value)
                        }
                        className="px-2.5 py-1 text-xs rounded-md border border-gray-300 font-mono bg-white text-gray-700"
                      >
                        {TIME_OPTIONS.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="text-[11px] font-medium text-gray-400 italic pl-7 sm:pl-0">
                      Day Off / Unavailable
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </form>

        {/* ========================================================= */}
        {/* 3. FOOTER (STICKY BOTTOM CONTAINER) */}
        {/* ========================================================= */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 text-xs font-medium rounded-md text-white shadow-sm flex items-center gap-1.5 transition-all hover:opacity-95 active:scale-98 cursor-pointer"
            style={{ backgroundColor: primaryAccentColor }}
          >
            <UserCheck className="w-4 h-4" />
            <span>Add Staff Member</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* SOFTWARE PERMISSIONS MODAL DIALOG */}
        {/* ========================================================= */}
        <AnimatePresence>
          {showPermissionsModal && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl p-5 max-w-md w-full border border-gray-200 shadow-2xl space-y-4"
              >
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-[#900C3F]" />
                    <h3 className="font-bold text-sm text-gray-900">
                      Nexora Software Permissions
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPermissionsModal(false)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3 text-xs text-gray-600">
                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="font-bold text-gray-900 block mb-1">
                      1. Service Provider (Assigned)
                    </span>
                    <p className="text-xs text-gray-500">
                      Can view their own appointment calendar, mark services as complete, and view their individual tips & commissions.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="font-bold text-gray-900 block mb-1">
                      2. Receptionist (Frontdesk)
                    </span>
                    <p className="text-xs text-gray-500">
                      Can book appointments for all stylists, process POS payments, manage client check-ins, and view client contact details.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <span className="font-bold text-gray-900 block mb-1">
                      3. Manager (Full Access)
                    </span>
                    <p className="text-xs text-gray-500">
                      Full administrative access to reports, revenue analytics, staff commissions, service pricing, and salon configuration.
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPermissionsModal(false)}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-[#900C3F] text-white cursor-pointer"
                  >
                    Got It
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
