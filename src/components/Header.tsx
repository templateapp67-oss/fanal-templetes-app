import React, { useState } from 'react';
import { AppView, SalonProfile } from '../types';
import { PartnerProfileModal } from './PartnerProfileModal';
import { NotificationBell } from './NotificationBell';
import { AuthModal } from './AuthModal';
import { supabase } from '../lib/supabaseClient';

interface HeaderProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  salonName: string;
  onBuildWebsiteClick?: () => void;
  user: any;
  setUser: (user: any) => void;
  profile: SalonProfile;
  onProfileSaved: (patch: Partial<SalonProfile>) => void;
  openAuth: (mode: 'login' | 'signup') => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  setCurrentView,
  salonName,
  onBuildWebsiteClick,
  user,
  setUser,
  profile,
  openAuth,
  onProfileSaved,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <header className="bg-surface/80 backdrop-blur-md fixed top-0 w-full z-50 border-b border-outline-variant/30 transition-all duration-300" id="global-nav">
      <div className="flex justify-between items-center px-margin-mobile md:px-gutter max-w-container-max mx-auto h-20">
        {/* Brand */}
        <div 
          onClick={() => setCurrentView('landing')}
          className="flex items-center gap-base cursor-pointer group"
        >
          <img alt="Nexora Logo" className="w-8 h-8 object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDJYocRxmo4vpJ1_AiSXtAMUVqSgd5cKajB-4RUxdyE8aRIhXYKc6rpkP2QfQk08sdDXrCP9Xpc0FsS9TCBIXdCIvQsKMtaXaNapgbxpoP6ZtqwDgiKttI_L1wi-DCFFUdw5zFns1eezsmbwoXe7dlwdAN6mudQV7w2QZhWcRTvgOfjdEndslxxaWrRhgFdVl0nFcwkXUBL3dISegAZ9Wpv-_iyNsyPYyyAeFelbPvSjMco5lgCDlptw6yYIDX8QK0hSWM"/>
          <span className="material-symbols-outlined text-[#C20E5A]" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          <span className="font-display-lg text-display-lg-mobile tracking-tighter text-[#C20E5A]">Nexora</span>
        </div>

        {/* View Switcher Navigation */}
        <nav className="hidden lg:flex items-center gap-1 bg-surface-variant/30 p-1 rounded-full border border-outline-variant/30">
          <button
            onClick={() => setCurrentView('landing')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'landing'
                ? 'bg-[#C20E5A] text-white shadow-sm'
                : 'text-on-surface-variant hover:text-[#C20E5A]'
            }`}
          >
            <span className="material-symbols-outlined text-base">home</span>
            Home
          </button>
          
          <button
            onClick={() => {
              if (onBuildWebsiteClick) {
                onBuildWebsiteClick();
              } else {
                setCurrentView('wizard');
              }
            }}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'preview' || currentView === 'wizard'
                ? 'bg-[#C20E5A] text-white shadow-sm'
                : 'text-on-surface-variant hover:text-[#C20E5A]'
            }`}
          >
            <span className="material-symbols-outlined text-base">devices</span>
            <span>Explore Templates</span>
            <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
              Live
            </span>
          </button>

          <button
            onClick={() => setCurrentView('dashboard')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'dashboard' || currentView === 'staffPerformance' || currentView === 'staffCommission'
                ? 'bg-[#C20E5A] text-white shadow-sm'
                : 'text-on-surface-variant hover:text-[#C20E5A]'
            }`}
          >
            <span className="material-symbols-outlined text-base">dashboard</span>
            SaaS Dashboard
          </button>

          <button
            onClick={() => setCurrentView('bookings')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'bookings'
                ? 'bg-[#C20E5A] text-white shadow-sm'
                : 'text-on-surface-variant hover:text-[#C20E5A]'
            }`}
          >
            <span className="material-symbols-outlined text-base">event_available</span>
            My Bookings
          </button>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <NotificationBell userEmail={user?.email || ""} />
          
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-0.5">Nexora Partner</span>
                <span className="text-sm font-bold text-[#C20E5A]">
                  {profile.ownerName || user.user_metadata?.full_name || 'Owner'}
                </span>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="w-10 h-10 rounded-full overflow-hidden border border-pink-200"
                aria-label="User Profile Settings" title="User Profile Settings"
              >
                {profile.ownerPhotoUrl ? <img src={profile.ownerPhotoUrl} alt="Your profile" className="w-full h-full object-cover" /> : <span>Profile</span>}
              </button>
              <button
                onClick={handleLogout}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all group"
                title="Logout"
              >
                <span className="material-symbols-outlined text-xl group-hover:scale-110 transition-transform">logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => openAuth('login')}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-[#C20E5A] transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => openAuth('signup')}
                className="px-6 py-2 bg-[#C20E5A] text-white rounded-full text-sm font-bold shadow-lg shadow-[#C20E5A]/20 hover:bg-[#A30B4A] hover:-translate-y-0.5 transition-all active:scale-95"
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      </div>
      {profileOpen && <PartnerProfileModal editable profile={profile} onSaved={onProfileSaved} onClose={() => setProfileOpen(false)} />}
    </header>
  );
};

