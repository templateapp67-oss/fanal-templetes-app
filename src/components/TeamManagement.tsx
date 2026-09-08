import React, { useState } from 'react';
import { Stylist, SalonService } from '../types';
import { 
  UserPlus, 
  Trash2, 
  Edit3, 
  Star, 
  Sparkles, 
  Check, 
  X, 
  Search, 
  Scissors, 
  Award,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Phone,
  Shield,
  Clock,
  EyeOff,
  Percent,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AddStaffModal } from './AddStaffModal';
import { StylistAvatarUpload } from './StylistAvatarUpload';

interface TeamManagementProps {
  stylists: Stylist[];
  setStylists: React.Dispatch<React.SetStateAction<Stylist[]>>;
  primaryAccentColor: string;
  services?: SalonService[];
  onNavigateToPreview?: () => void;
}

// Curated high quality avatar presets for Indian salon specialists
const AVATAR_PRESETS = [
  {
    label: 'Stylist 1 (Female)',
    url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 2 (Male)',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 3 (Female)',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 4 (Male)',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 5 (Female)',
    url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 6 (Male)',
    url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 7 (Female)',
    url: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=400&auto=format&fit=crop&q=80',
  },
  {
    label: 'Stylist 8 (Male)',
    url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80',
  }
];

const COMMON_SPECIALTIES = [
  'Hair Cutting',
  'Hair Coloring',
  'Balayage',
  'Keratin Treatment',
  'Bridal Styling',
  'Beard Sculpting',
  'Skin Aesthetics',
  'Ayurvedic Massage',
  'Nail Art',
  'Lash Extensions',
  'Scalp Detox'
];

export const TeamManagement: React.FC<TeamManagementProps> = ({
  stylists,
  setStylists,
  primaryAccentColor,
  services = [],
  onNavigateToPreview
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState<string>('all');
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStylist, setEditingStylist] = useState<Stylist | null>(null);
  const [deletingStylistId, setDeletingStylistId] = useState<string | null>(null);

  // Form states for Add / Edit
  const [formData, setFormData] = useState<{
    name: string;
    role: string;
    avatarUrl: string;
    rating: number;
    specialties: string[];
    customSpecialtyInput: string;
  }>({
    name: '',
    role: '',
    avatarUrl: AVATAR_PRESETS[0].url,
    rating: 4.9,
    specialties: ['Hair Cutting', 'Hair Coloring'],
    customSpecialtyInput: ''
  });

  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      role: 'Senior Hair Stylist',
      avatarUrl: AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)].url,
      rating: 4.9,
      specialties: ['Hair Cutting', 'Hair Coloring'],
      customSpecialtyInput: ''
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (st: Stylist) => {
    setEditingStylist(st);
    setFormData({
      name: st.name,
      role: st.role,
      avatarUrl: st.avatarUrl,
      rating: st.rating,
      specialties: [...st.specialties],
      customSpecialtyInput: ''
    });
  };

  const handleToggleSpecialty = (spec: string) => {
    setFormData((prev) => {
      const exists = prev.specialties.includes(spec);
      return {
        ...prev,
        specialties: exists
          ? prev.specialties.filter((s) => s !== spec)
          : [...prev.specialties, spec]
      };
    });
  };

  const handleAddCustomSpecialty = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = formData.customSpecialtyInput.trim();
    if (trimmed && !formData.specialties.includes(trimmed)) {
      setFormData((prev) => ({
        ...prev,
        specialties: [...prev.specialties, trimmed],
        customSpecialtyInput: ''
      }));
    }
  };

  const handleRemoveSpecialty = (spec: string) => {
    setFormData((prev) => ({
      ...prev,
      specialties: prev.specialties.filter((s) => s !== spec)
    }));
  };

  const handleSaveNewStaffMember = (newStaff: Stylist) => {
    setStylists((prev) => [...prev, newStaff]);
    setIsAddModalOpen(false);
    showNotification(`Specialist "${newStaff.name}" (${newStaff.role}) successfully onboarded!`);
  };

  const handleSaveEditStylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStylist || !formData.name.trim()) return;

    const updated: Stylist = {
      ...editingStylist,
      name: formData.name.trim(),
      role: formData.role.trim() || 'Stylist Specialist',
      avatarUrl: formData.avatarUrl || editingStylist.avatarUrl,
      rating: Number(formData.rating) || 4.8,
      specialties: formData.specialties.length > 0 ? formData.specialties : ['Hair Cutting']
    };

    setStylists((prev) => prev.map((s) => (s.id === editingStylist.id ? updated : s)));
    setEditingStylist(null);
    showNotification(`Stylist profile for "${updated.name}" updated!`);
  };

  const handleDeleteStylist = (id: string) => {
    const st = stylists.find((s) => s.id === id);
    setStylists((prev) => prev.filter((s) => s.id !== id));
    setDeletingStylistId(null);
    showNotification(`Stylist "${st?.name || 'Member'}" removed from team.`);
  };

  // Collect all unique specialties across all existing stylists
  const allUniqueSpecialties = Array.from(
    new Set((stylists || []).flatMap((s) => s.specialties || []))
  );

  // Filter stylists
  const filteredStylists = (stylists || []).filter((st) => {
    const matchesQuery = 
      (st.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (st.role || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (st.specialties || []).some((sp) => sp.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesSpecialty = 
      selectedSpecialtyFilter === 'all' || 
      (st.specialties || []).includes(selectedSpecialtyFilter);

    return matchesQuery && matchesSpecialty;
  });

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-6">
      
      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 text-xs border border-slate-700 font-medium"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-xs shrink-0"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <Scissors className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-xl text-gray-900">
                  Team & Stylists Management
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {stylists.length} {stylists.length === 1 ? 'Specialist' : 'Specialists'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage salon specialists and service providers available for client bookings and scheduling.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onNavigateToPreview && (
            <button
              onClick={onNavigateToPreview}
              className="text-xs font-bold px-3.5 py-2.5 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-700 flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span>View in Booking Page</span>
            </button>
          )}

          {/* ADD NEW STYLIST BUTTON */}
          <button
            onClick={handleOpenAddModal}
            className="text-xs font-bold px-4 py-2.5 rounded-xl text-white flex items-center gap-2 shadow-sm transition-all hover:opacity-95 active:scale-[0.98] cursor-pointer"
            style={{ backgroundColor: primaryAccentColor }}
            id="add-new-stylist-btn"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add New Stylist</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by stylist name, role or skill..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 bg-gray-50/50 outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {allUniqueSpecialties.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider shrink-0 mr-1">
              Filter:
            </span>
            <button
              onClick={() => setSelectedSpecialtyFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedSpecialtyFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Skills ({stylists.length})
            </button>
            {allUniqueSpecialties.slice(0, 5).map((sp) => (
              <button
                key={sp}
                onClick={() => setSelectedSpecialtyFilter(sp)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  selectedSpecialtyFilter === sp
                    ? 'bg-slate-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {sp}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stylist Cards Grid */}
      {filteredStylists.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center">
            <Scissors className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-800">No stylists found</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              {searchQuery || selectedSpecialtyFilter !== 'all'
                ? 'No specialists matched your search filters. Try clearing the filter or search term.'
                : 'Your salon team has no stylists yet. Add your first specialist to enable appointments on your website.'}
            </p>
          </div>
          <button
            onClick={handleOpenAddModal}
            className="mt-2 text-xs font-bold px-4 py-2 rounded-xl text-white flex items-center gap-2 cursor-pointer hover:opacity-90"
            style={{ backgroundColor: primaryAccentColor }}
          >
            <UserPlus className="w-4 h-4" />
            <span>Add First Stylist</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStylists.map((st) => (
            <div
              key={st.id}
              className="bg-white border border-gray-200 hover:border-gray-300 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-4 group"
            >
              {/* Card top */}
              <div className="flex items-start gap-3.5">
                <div className="relative shrink-0">
                  <img
                    src={st.avatarUrl}
                    alt={st.name}
                    className="w-14 h-14 rounded-2xl object-cover border border-gray-100 shadow-xs"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = AVATAR_PRESETS[0].url;
                    }}
                  />
                  <span 
                    className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 border-2 border-white rounded-full ${
                      st.status === 'Inactive' 
                        ? 'bg-gray-400' 
                        : st.status === 'On Leave'
                        ? 'bg-amber-500'
                        : st.status === 'Busy'
                        ? 'bg-rose-500'
                        : 'bg-emerald-500'
                    }`} 
                    title={st.status || 'Available'} 
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <h3 className="font-bold text-sm text-gray-900 truncate">
                      {st.name}
                    </h3>
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded-md text-[11px] font-bold text-amber-800 shrink-0">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                      <span>{st.rating.toFixed(1)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                    {st.role}
                  </p>

                  {/* Metadata Row: Access Role, Status, Commission */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-100">
                      {st.accessRole || 'Service Provider'}
                    </span>

                    {st.commissionRate !== undefined && (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                        {st.commissionRate}% comm.
                      </span>
                    )}

                    {st.hidePhone && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 flex items-center gap-0.5">
                        <EyeOff className="w-2.5 h-2.5" />
                        <span>Private</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Assigned Services / Specialties */}
              <div className="pt-2 border-t border-gray-100 flex flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Specialties & Expertise
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {st.specialties && st.specialties.length > 0 ? (
                    st.specialties.map((spec, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200/70"
                      >
                        {spec}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-gray-400 italic">General Salon Services</span>
                  )}
                </div>

                {st.assignedServices && st.assignedServices.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                    <Layers className="w-3 h-3 text-gray-400" />
                    <span>{st.assignedServices.length} Assigned Services</span>
                  </div>
                )}
              </div>

              {/* Card Actions */}
              <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-gray-400">
                  ID: {st.id.slice(-6)}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEditModal(st)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
                    title="Edit Stylist Details"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setDeletingStylistId(st.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete Stylist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingStylistId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full border border-gray-200 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-gray-900">Remove Stylist?</h3>
                <p className="text-xs text-gray-500">This member will no longer appear on the live booking page.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setDeletingStylistId(null)}
                className="px-3.5 py-2 text-xs font-bold rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteStylist(deletingStylistId)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIXEL-PERFECT ADD NEW STAFF MODAL */}
      <AddStaffModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddStaff={handleSaveNewStaffMember}
        primaryAccentColor={primaryAccentColor || '#900C3F'}
        services={services}
      />

      {/* EDIT STYLIST MODAL */}
      {editingStylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-gray-200 shadow-2xl flex flex-col gap-4 my-8 max-h-[90vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  <Edit3 className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-base text-gray-900">Edit Stylist Profile</h3>
                  <p className="text-xs text-gray-500">Update specialist details, avatar, and specialties</p>
                </div>
              </div>
              <button
                onClick={() => setEditingStylist(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveEditStylist} className="flex flex-col gap-4">
              
              {/* Full Name */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 outline-none"
                />
              </div>

              {/* Role / Designation & Rating */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Designation / Title
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Client Rating (★)
                  </label>
                  <select
                    value={formData.rating}
                    onChange={(e) => setFormData({ ...formData, rating: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 bg-white focus:border-gray-500 focus:ring-2 focus:ring-gray-200 outline-none font-mono"
                  >
                    <option value="5.0">5.0 ★★★★★</option>
                    <option value="4.9">4.9 ★★★★☆</option>
                    <option value="4.8">4.8 ★★★★☆</option>
                    <option value="4.7">4.7 ★★★★☆</option>
                    <option value="4.6">4.6 ★★★★☆</option>
                    <option value="4.5">4.5 ★★★★☆</option>
                  </select>
                </div>
              </div>

              {/* Avatar Selection */}
              <div>
                <StylistAvatarUpload
                  value={formData.avatarUrl}
                  onChange={(avatarUrl) => setFormData({ ...formData, avatarUrl })}
                  accentHex={primaryAccentColor}
                  fallbackUrl={AVATAR_PRESETS[0].url}
                />

                <input
                  type="url"
                  value={formData.avatarUrl.startsWith('data:') ? '' : formData.avatarUrl}
                  onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value })}
                  placeholder="Or paste a photo URL"
                  className="mt-2 w-full px-3 py-2 text-xs rounded-xl border border-gray-300 text-gray-700 font-mono focus:border-gray-500 outline-none"
                />

                <div className="flex flex-col gap-1.5 mt-2">
                  <span className="text-[11px] text-gray-500">Or pick preset avatar:</span>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {AVATAR_PRESETS.map((preset, idx) => {
                      const isSelected = formData.avatarUrl === preset.url;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setFormData({ ...formData, avatarUrl: preset.url })}
                          className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all cursor-pointer ${
                            isSelected ? 'border-slate-900 scale-105 shadow-sm' : 'border-transparent opacity-75 hover:opacity-100'
                          }`}
                        >
                          <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                          {isSelected && (
                            <span className="absolute inset-0 bg-black/30 flex items-center justify-center text-white">
                              <Check className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Specialties / Skills Tags */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Specialties & Skills
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_SPECIALTIES.map((spec) => {
                    const isSelected = formData.specialties.includes(spec);
                    return (
                      <button
                        key={spec}
                        type="button"
                        onClick={() => handleToggleSpecialty(spec)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                      >
                        {isSelected ? `✓ ${spec}` : `+ ${spec}`}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add custom skill..."
                    value={formData.customSpecialtyInput}
                    onChange={(e) => setFormData({ ...formData, customSpecialtyInput: e.target.value })}
                    onKeyDown={handleAddCustomSpecialty}
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-gray-300 focus:border-gray-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSpecialty}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                {formData.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
                    <span className="text-[11px] text-gray-400 font-bold mr-1 self-center">Assigned:</span>
                    {formData.specialties.map((spec) => (
                      <span
                        key={spec}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md"
                      >
                        <span>{spec}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSpecialty(spec)}
                          className="hover:text-emerald-950 p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingStylist(null)}
                  className="px-4 py-2.5 text-xs font-bold rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-xs font-bold rounded-xl text-white shadow-sm flex items-center gap-1.5 cursor-pointer hover:opacity-95"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  <Check className="w-4 h-4" />
                  <span>Save Stylist Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
