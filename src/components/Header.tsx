import React from 'react';
import { AppView } from '../types';

interface HeaderProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  salonName: string;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  setCurrentView,
  salonName,
}) => {
  return (
    <header className="bg-surface/80 backdrop-blur-md fixed top-0 w-full z-50 border-b border-outline-variant/30 transition-all duration-300" id="global-nav">
      <div className="flex justify-between items-center px-margin-mobile md:px-gutter max-w-container-max mx-auto h-20">
        {/* Brand */}
        <div 
          onClick={() => setCurrentView('landing')}
          className="flex items-center gap-base cursor-pointer group"
        >
          <img alt="Nexora Logo" className="w-8 h-8 object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDJYocRxmo4vpJ1_AiSXtAMUVqSgd5cKajB-4RUxdyE8aRIhXYKc6rpkP2QfQk08sdDXrCP9Xpc0FsS9TCBIXdCIvQsKMtaXaNapgbxpoP6ZtqwDgiKttI_L1wi-DCFFUdw5zFns1eezsmbwoXe7dlwdAN6mudQV7w2QZhWcRTvgOfjdEndslxxaWrRhgFdVl0nFcwkXUBL3dISegAZ9Wpv-_iyNsyPYyyAeFelbPvSjMco5lgCDlptw6yYIDX8QK0hSWM"/>
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          <span className="font-display-lg text-display-lg-mobile tracking-tighter text-primary">Nexora</span>
        </div>

        {/* View Switcher Navigation */}
        <nav className="hidden lg:flex items-center gap-1 bg-surface-variant/30 p-1 rounded-full border border-outline-variant/30">
          <button
            onClick={() => setCurrentView('landing')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'landing'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base">home</span>
            Home
          </button>
          
          <button
            onClick={() => setCurrentView('preview')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'preview'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base">edit_document</span>
            <span>Live Visual Editor & Templates</span>
            <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 py-0.2 rounded-full">
              14
            </span>
          </button>

          <button
            onClick={() => setCurrentView('wizard')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'wizard'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base">auto_awesome</span>
            AI Setup Wizard
          </button>

          <button
            onClick={() => setCurrentView('dashboard')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              currentView === 'dashboard'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base">dashboard</span>
            SaaS Dashboard
          </button>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-md">
          <span className="hidden md:inline-block font-body-sm text-on-surface-variant">
            Already have a website?
          </span>

          <button
            onClick={() => setCurrentView('dashboard')}
            className="font-headline-md text-headline-md text-primary hover:text-primary-container transition-colors duration-200"
          >
            Log In
          </button>
        </div>
      </div>
    </header>
  );
};

