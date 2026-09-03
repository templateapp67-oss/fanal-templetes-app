import React, { useState, useRef } from 'react';
import { Mic, Sparkles, Image as ImageIcon, X } from 'lucide-react';

interface AboutOwnerFormProps {
  ownerName: string;
  setOwnerName: (val: string) => void;
  ownerPhotoUrl: string;
  setOwnerPhotoUrl: (val: string) => void;
  ownerRole: string;
  setOwnerRole: (val: string) => void;
  about: string;
  setAbout: (val: string) => void;
  onWriteWithAI?: () => void;
  onSpeak?: () => void;
}

export const AboutOwnerForm: React.FC<AboutOwnerFormProps> = ({
  ownerName,
  setOwnerName,
  ownerPhotoUrl,
  setOwnerPhotoUrl,
  ownerRole,
  setOwnerRole,
  about,
  setAbout,
  onWriteWithAI,
  onSpeak,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Create an object URL for preview
      const previewUrl = URL.createObjectURL(file);
      setOwnerPhotoUrl(previewUrl);
    }
  };

  const removePhoto = () => {
    setOwnerPhotoUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const roles = [
    'Owner',
    'Founder',
    'Co-Founder',
    'Managing Director',
    'Creative Director',
    'Master Stylist',
    'Salon Manager',
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 w-full max-w-3xl mx-auto font-sans">
      <h2 className="text-xl font-semibold text-[#111827] mb-6 tracking-tight">About the Owner</h2>

      <div className="space-y-6">
        {/* Row 1: Owner Name */}
        <div>
          <label className="block text-sm font-medium text-[#111827] mb-1.5">
            Owner / Founder Name <span className="text-[#C20E5A]">*</span>
          </label>
          <input
            type="text"
            required
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF] transition-colors"
            placeholder="Jane Doe"
          />
        </div>

        {/* Row 2: 2-column layout on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Owner Photo */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1.5">
              Owner Photo (Optional)
            </label>
            <div className="flex items-center gap-4">
              {ownerPhotoUrl ? (
                <>
                  <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                    <img src={ownerPhotoUrl} alt="Owner preview" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-[#111827]">Photo added</span>
                    <span className="text-[11px] text-gray-500 mb-1.5">JPG, PNG, WEBP or GIF · max 2MB</span>
                    <div className="flex items-center gap-3 text-xs font-semibold">
                      <button 
                        type="button" 
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[#C20E5A] hover:underline transition-colors"
                      >
                        Change
                      </button>
                      <button 
                        type="button" 
                        onClick={removePhoto}
                        className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-0.5"
                      >
                        <X className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div 
                  className="w-full border border-dashed border-gray-200 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#C20E5A]/50 transition-colors bg-white"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center mb-2 border border-gray-100">
                    <ImageIcon className="w-5 h-5 text-gray-400" />
                  </div>
                  <span className="text-sm font-medium text-[#C20E5A]">Upload photo</span>
                  <span className="text-[11px] text-gray-500 mt-1">JPG, PNG, WEBP or GIF · max 2MB</span>
                </div>
              )}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handlePhotoUpload}
                accept="image/jpeg, image/png, image/webp, image/gif" 
                className="hidden" 
              />
            </div>
          </div>

          {/* Owner Role */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1.5">
              Owner Role (Optional)
            </label>
            <div className="relative">
              <select
                value={ownerRole}
                onChange={(e) => setOwnerRole(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] bg-white appearance-none transition-colors"
              >
                <option value="" disabled>Select a role</option>
                {roles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: About Textarea */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
            <label className="block text-sm font-medium text-[#111827]">
              Tell customers about your business (Optional)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSpeak}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-100 transition-colors"
              >
                <Mic className="w-3.5 h-3.5 text-[#C20E5A]" /> Speak instead
              </button>
              <button
                type="button"
                onClick={onWriteWithAI}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C20E5A] hover:bg-[#A30B4A] rounded-md shadow-sm transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" /> Write with AI
              </button>
            </div>
          </div>
          <textarea
            rows={4}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A] text-[#111827] placeholder-[#9CA3AF] resize-none transition-colors"
            placeholder="Briefly describe your services, ambiance, or specialties..."
          ></textarea>
        </div>
      </div>
    </div>
  );
};
