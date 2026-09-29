import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Smartphone, 
  QrCode, 
  Wallet, 
  Clock, 
  Compass, 
  ShieldCheck, 
  ArrowRight, 
  Search, 
  MessageSquare, 
  Settings, 
  Layers, 
  Globe, 
  Palette, 
  Check, 
  Users, 
  Send, 
  Star, 
  Volume2, 
  Lock, 
  Shield, 
  Zap, 
  Award, 
  Activity, 
  TrendingUp, 
  UserCheck, 
  RefreshCw, 
  Play, 
  CheckCircle, 
  Calendar, 
  ChevronRight, 
  Coins, 
  X,
  Phone,
  Building,
  DollarSign,
  MapPin,
  Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Original source visual assets, now bundled with this VIP experience.
import luxurySalonHero from './assets/images/luxury_salon_hero_1780900665832.png';
import luxurySpaService from './assets/images/luxury_spa_service_1780900684934.png';
import luxuryStudioArt from './assets/images/luxury_studio_art_1780900702102.png';

import { salonTemplates, mockAnalytics, sampleRetentionCampaign } from './data';
import { SalonTemplate, Service, Stylist } from './types';
import { AdminPanel } from './admin/AdminPanel';

const locationMatrix: {
  [key: string]: {
    regionName: string,
    coordinates: string,
    salons: {
      letoile: { distance: string, time: string, area: string },
      aura: { distance: string, time: string, area: string },
      obsidian: { distance: string, time: string, area: string },
    }
  }
} = {
  'Mumbai': {
    regionName: 'Mumbai (MH)',
    coordinates: '19.0760° N, 72.8777° E',
    salons: {
      letoile: { distance: '1.4', time: '6 Mins', area: 'Bandra West' },
      aura: { distance: '4.2', time: '15 Mins', area: 'Juhu Overlook' },
      obsidian: { distance: '12.8', time: '35 Mins', area: 'Colaba Spires' }
    }
  },
  'Delhi': {
    regionName: 'Delhi NCR',
    coordinates: '28.6139° N, 77.2090° E',
    salons: {
      letoile: { distance: '2.1', time: '8 Mins', area: 'Connaught Place' },
      aura: { distance: '5.8', time: '18 Mins', area: 'Vasant Vihar' },
      obsidian: { distance: '8.4', time: '22 Mins', area: 'Greater Kailash' }
    }
  },
  'Bengaluru': {
    regionName: 'Bengaluru (KA)',
    coordinates: '12.9716° N, 77.5946° E',
    salons: {
      letoile: { distance: '1.1', time: '4 Mins', area: 'UB City Galleria' },
      aura: { distance: '3.7', time: '12 Mins', area: 'Indiranagar' },
      obsidian: { distance: '6.2', time: '19 Mins', area: 'Koramangala Blocks' }
    }
  },
  'Jaipur': {
    regionName: 'Jaipur (RJ)',
    coordinates: '26.9124° N, 75.7873° E',
    salons: {
      letoile: { distance: '0.9', time: '3 Mins', area: 'C-Scheme Hub' },
      aura: { distance: '7.3', time: '20 Mins', area: 'Malviya Nagar Layout' },
      obsidian: { distance: '5.4', time: '15 Mins', area: 'Vaishali Ridge' }
    }
  },
  'Goa': {
    regionName: 'North Goa',
    coordinates: '15.4909° N, 73.8278° E',
    salons: {
      letoile: { distance: '3.2', time: '10 Mins', area: 'Panaji Waterfront' },
      aura: { distance: '1.2', time: '5 Mins', area: 'Candolim Beach Road' },
      obsidian: { distance: '9.6', time: '25 Mins', area: 'Assagao Valley' }
    }
  }
};

export default function App() {
  // Navigation mode: Landing Showcase vs Admin Panel #22
  const [viewMode, setViewMode] = useState<'showcase' | 'admin'>('showcase');

  useEffect(() => {
    if (window.location.hash === '#admin') {
      setViewMode('admin');
    }
    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setViewMode('admin');
      } else if (window.location.hash === '#showcase' || !window.location.hash) {
        setViewMode('showcase');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Global states
  const [selectedTemplate, setSelectedTemplate] = useState<SalonTemplate>(salonTemplates[0]);
  const [customSubdomain, setCustomSubdomain] = useState<string>('letoile');
  const [customBrandName, setCustomBrandName] = useState<string>('');
  
  // Custom theme tracking for white-label template builder preview
  const [activeTheme, setActiveTheme] = useState<string>('Classic Gold');
  const themeColors: { [key: string]: string } = {
    'Classic Gold': '#D4AF37',
    'Champagne': '#F5D0A1',
    'Platinum Noir': '#E5E5E5',
    'Obsidian Rose': '#FFC0CB',
  };

  // State for Escrow booking flow simulator
  const [bookingStep, setBookingStep] = useState<number>(1);
  const [selectedService, setSelectedService] = useState<Service | null>(salonTemplates[0].services[0]);
  const [selectedStylist, setSelectedStylist] = useState<Stylist | null>(salonTemplates[0].stylists[0]);
  const [vipBookingCode, setVipBookingCode] = useState<string>('NEX-VIP-99');
  const [escrowAuthorized, setEscrowAuthorized] = useState<boolean>(false);

  // State for QR counter settlement simulator
  const [qrScanned, setQrScanned] = useState<boolean>(false);
  const [qrPaid, setQrPaid] = useState<boolean>(false);
  const [walletBalance, setWalletBalance] = useState<number>(3482500);
  const [vipsRetainedCount, setVipsRetainedCount] = useState<number>(842);
  const [retentionDispatching, setRetentionDispatching] = useState<boolean>(false);
  const [retentionSuccess, setRetentionSuccess] = useState<boolean>(false);

  // State for VIP entry application form
  const [inviteName, setInviteName] = useState<string>('');
  const [invitePhone, setInvitePhone] = useState<string>('');
  const [inviteCity, setInviteCity] = useState<string>('Mumbai');
  const [inviteTurnover, setInviteTurnover] = useState<string>('₹15L - ₹50L Monthly');
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [loadingForm, setLoadingForm] = useState<boolean>(false);

  // NEW: Geolocation & Intelligent NLP Search states
  const [detectedRegion, setDetectedRegion] = useState<string>('Mumbai');
  const [gpsDetecting, setGpsDetecting] = useState<boolean>(false);
  const [gpsConsole, setGpsConsole] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [voiceIsSimulating, setVoiceIsSimulating] = useState<boolean>(false);
  const [searchToast, setSearchToast] = useState<string>('');

  const handleDetectGps = () => {
    setGpsDetecting(true);
    setGpsConsole([]);
    
    const logs = [
      'Init browser high-precision geolocation API querying context...',
      'Triangulating SECTOR-9 network beacon... Expected margin: +/- 4.8m',
      'Connecting to Indian sub-continent luxury telemetry router...',
      'Satellite resolved: Connected with high-precision!'
    ];

    logs.forEach((log, index) => {
      setTimeout(() => {
        setGpsConsole(prev => [...prev, log]);
      }, (index + 1) * 350);
    });

    setTimeout(() => {
      const regionsList = ['Mumbai', 'Delhi', 'Bengaluru', 'Jaipur', 'Goa'];
      const filtered = regionsList.filter(r => r !== detectedRegion);
      const chosen = filtered[Math.floor(Math.random() * filtered.length)];
      setDetectedRegion(chosen);
      setGpsDetecting(false);
    }, 1600);
  };

  const handleSimulateVoice = () => {
    if (voiceIsSimulating) return;
    setVoiceIsSimulating(true);
    setSearchQuery('');
    
    const voices = [
      'Signature French Gold Balayage under 20k',
      'Obsidian stone massage',
      'traditional line art'
    ];
    const targetQuery = voices[Math.floor(Math.random() * voices.length)];
    
    let currentText = '';
    let charIndex = 0;
    
    const interval = setInterval(() => {
      if (charIndex < targetQuery.length) {
        currentText += targetQuery[charIndex];
        setSearchQuery(currentText);
        charIndex++;
      } else {
        clearInterval(interval);
        setVoiceIsSimulating(false);
        setSearchToast(`AI Search Intent processed successfully. Match found!`);
        setTimeout(() => setSearchToast(''), 4500);
      }
    }, 50);
  };

  // Elite booking real-time notification simulation ticker
  const [liveReservationsAmt, setLiveReservationsAmt] = useState<number>(542800);
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveReservationsAmt(prev => prev + Math.floor(Math.random() * 850) + 150);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Update dynamic booking configurations when builder changes selected brand
  useEffect(() => {
    setSelectedService(selectedTemplate.services[0]);
    setSelectedStylist(selectedTemplate.stylists[0]);
    setBookingStep(1);
    setEscrowAuthorized(false);
  }, [selectedTemplate]);

  const handleEscrowAuthorization = () => {
    setEscrowAuthorized(true);
    // Add amount to simulated wallet balance in pending
    setTimeout(() => {
      setBookingStep(3);
    }, 1500);
  };

  const handleQRPaySimulator = () => {
    setQrScanned(true);
    setTimeout(() => {
      setQrPaid(true);
      setWalletBalance(prev => prev + 13875); // remaining 75% payment for standard Balayage (₹18500 * 0.75)
    }, 1200);
  };

  const resetQR = () => {
    setQrScanned(false);
    setQrPaid(false);
  };

  const triggerRetentionBespoke = () => {
    setRetentionDispatching(true);
    setTimeout(() => {
      setRetentionDispatching(false);
      setRetentionSuccess(true);
      setVipsRetainedCount(prev => prev + 14);
    }, 2000);
  };

  const handleApplyForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName || !invitePhone) return;
    setLoadingForm(true);
    setTimeout(() => {
      setLoadingForm(false);
      setIsSubmitted(true);
    }, 1800);
  };

  if (viewMode === 'admin') {
    return (
      <AdminPanel
        onBackToLanding={() => {
          setViewMode('showcase');
          window.location.hash = '';
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-[#D4AF37] selection:text-black overflow-x-hidden subtle-grid-overlay">
      
      {/* 1. ELITE BLACK GLASS FLOATING HEADER */}
      <header className="sticky top-0 z-50 w-full bg-[#050505]/80 backdrop-blur-xl border-b border-[#D4AF37]/15">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          
          <div className="flex items-center space-x-3">
            <span className="font-serif tracking-[0.25em] text-xl font-light text-[#D4AF37]">
              NEXORA <span className="text-white font-sans font-semibold tracking-wider text-sm select-none bg-[#D4AF37]/10 px-2 py-0.5 rounded ml-1 border border-[#D4AF37]/25">SALONOS</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-xs tracking-[0.15em] font-light text-gray-400">
            <a href="#prestige" className="hover:text-[#D4AF37] transition-colors">THE VISION</a>
            <a href="#designer" className="hover:text-[#D4AF37] transition-colors">LIVE BUILDER</a>
            <a href="#escrow-section" className="hover:text-[#D4AF37] transition-colors">TRUST ESCROW</a>
            <a href="#qr-section" className="hover:text-[#D4AF37] transition-colors">GOLD QR settlements</a>
            <a href="#ai-defense" className="hover:text-[#D4AF37] transition-colors">AI MARKETING</a>
          </nav>

          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                setViewMode('admin');
                window.location.hash = 'admin';
              }}
              className="px-3 py-2 rounded-sm bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 text-[#D4AF37] border border-[#D4AF37]/40 text-[10px] tracking-[0.15em] uppercase font-mono flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(212,175,55,0.15)]"
              id="header-admin-btn"
              title="Open Nexora Admin Panel #22"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin #22</span>
            </button>
            <div className="hidden lg:flex flex-col items-end border-r border-[#D4AF37]/25 pr-4 mr-1">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Escrow Pipeline</span>
              <span className="text-xs font-mono text-[#D4AF37] font-semibold">
                ₹{liveReservationsAmt.toLocaleString()}
              </span>
            </div>
            <a 
              href="#apply-lounge" 
              className="metallic-button text-[10px] tracking-[0.2em] uppercase font-bold py-2 px-5 rounded-sm"
              id="header-apply-btn"
            >
              Apply for Invitation
            </a>
          </div>

        </div>
      </header>

      {/* 2. MAJESTIC HERO SECTION (Visual First - 70% Image, 30% Content Hero) */}
      <section id="prestige" className="relative min-h-[90vh] flex items-center justify-center py-20 px-6 overflow-hidden">
        
        {/* Deep ambient circular golds glowing behind card container */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] gold-glow-radial-strong rounded-full pointer-events-none animate-gold-pulse"></div>

        <div className="max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
          
          {/* LEFT 30% CONTENT COLUMN */}
          <div className="lg:col-span-4 flex flex-col justify-center space-y-8" id="hero-brand-card">
            
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-[#D4AF37] animate-pulse" />
                <span className="text-xs font-mono text-[#D4AF37] tracking-[0.3em] uppercase">PEHLE NEXORA, PHIR SALON.</span>
              </div>
              
              <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-6xl font-serif font-extralight tracking-tight text-white leading-[1.1]">
                Ye Koi <span className="italic block font-serif font-light text-[#D4AF37]">Normal Salon</span> Booking Nahi Hai.
              </h1>
            </div>

            <p className="text-sm font-light text-gray-400 leading-relaxed max-w-sm">
              Nexora SalonOS is the bespoke operating luxury architecture developed for high-fashion salon brands. We replace clumsy, low-prestige general software with stunning white-label aesthetics, military-grade escrow protection, automated retention intelligence, and state-of-the-art QR desk terminals.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a 
                href="#designer" 
                className="metallic-button-strong py-4 px-8 text-center text-xs tracking-widest uppercase rounded-sm flex items-center justify-center space-x-3 group"
                id="hero-primary-btn"
              >
                <span>Live Studio Demo</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a 
                href="#apply-lounge" 
                className="metallic-button py-4 px-8 text-center text-xs tracking-widest uppercase rounded-sm bg-black/60 hover:bg-black/80"
                id="hero-secondary-btn"
              >
                Request Access
              </a>
            </div>

            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-[#D4AF37]/15">
              <div>
                <p className="text-2xl font-serif text-[#D4AF37]">90%</p>
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Direct To Salon</p>
              </div>
              <div>
                <p className="text-2xl font-serif text-[#D4AF37]">84%</p>
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Avg Retention</p>
              </div>
              <div>
                <p className="text-2xl font-serif text-[#D4AF37]">1.2M+</p>
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Elite Clients</p>
              </div>
            </div>

          </div>

          {/* RIGHT 70% HIGH QUALITY VISUAL - ENCAPSULATED WITH GOLD INNER AND OUTER RIM */}
          <div className="lg:col-span-8 relative">
            
            <div className="absolute inset-0 bg-gradient-to-tr from-[#D4AF37]/10 to-transparent rounded-lg filter blur-2xl pointer-events-none"></div>
            
            {/* Elegant watch-concept floating frames */}
            <div className="relative glass-slate-card p-2 rounded-xl border-2 border-[#D4AF37]/35 shadow-[0_0_50px_rgba(212,175,55,0.1)] group overflow-hidden">
              <div className="relative overflow-hidden rounded-lg aspect-[16/9]">
                <img 
                  src={luxurySalonHero} 
                  alt="Elite Nexora Salon Interior Layout" 
                  className="w-full h-full object-cover grayscale-[30%] group-hover:scale-105 group-hover:grayscale-0 transition-all duration-1000"
                  referrerPolicy="no-referrer"
                  id="hero-main-img"
                />
                
                {/* Gold vignette shadow inside image */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 pointer-events-none"></div>

                {/* Simulated luxury digital metadata Overlay */}
                <div className="absolute top-4 left-4 flex space-x-2">
                  <span className="bg-black/80 backdrop-blur-md rounded border border-[#D4AF37]/30 text-[10px] font-mono text-[#D4AF37] tracking-widest uppercase px-3 py-1">
                    Atelier Grade: EXCLUSIVEVVIP
                  </span>
                </div>
                
                <div className="absolute bottom-6 left-6 right-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-mono text-[#D4AF37] tracking-widest uppercase">Nexora Digital Showcase</span>
                    <h3 className="text-xl font-serif text-white tracking-wide mt-1">L'Étoile Atelier Lounge — Flagship Sector 1</h3>
                  </div>
                  <div className="flex items-center space-x-3 bg-[#0a0a0a]/95 backdrop-blur border border-[#D4AF37]/30 py-2 px-4 rounded-sm">
                    <span className="w-2 h-2 rounded-full bg-[#D4AF37] animate-ping"></span>
                    <span className="text-[11px] font-mono text-gray-300">Live Showroom Synchronizer Active</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Micro decorative accents to suggest premium machinery */}
            <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-[#050505] rounded-full border border-[#D4AF37]/25 flex flex-col items-center justify-center p-3 text-center hidden md:flex shadow-2xl">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Calibre</span>
              <span className="text-xs font-serif text-[#D4AF37]">NEX-900</span>
              <span className="text-[8px] font-mono text-[#D4AF37]/60 mt-1 uppercase tracking-wider">SWISS INSPIRED</span>
            </div>

          </div>

        </div>
      </section>

      {/* INFO STRIP SECTION: ALTERNATING GLASS PRESTIGE */}
      <section className="bg-gradient-to-b from-[#050505] to-[#0A0A0A] py-12 border-y border-[#D4AF37]/10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
          
          <div className="flex items-start space-x-4">
            <span className="text-[#D4AF37] text-2xl font-serif">I.</span>
            <div>
              <h4 className="text-xs font-mono tracking-widest text-[#D4AF37] uppercase">Automated Prestige</h4>
              <p className="text-xs font-light text-gray-400 mt-1 leading-relaxed">Elegant high-fashion custom websites deployed instantly with premium pre-designed layouts.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <span className="text-[#D4AF37] text-2xl font-serif">II.</span>
            <div>
              <h4 className="text-xs font-mono tracking-widest text-[#D4AF37] uppercase">Escrow Protection</h4>
              <p className="text-xs font-light text-gray-400 mt-1 leading-relaxed">No-show protection with a premium 25% holding deposit, released on touchpoint scans.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <span className="text-[#D4AF37] text-2xl font-serif">III.</span>
            <div>
              <h4 className="text-xs font-mono tracking-widest text-[#D4AF37] uppercase">Bespoke Counter QR</h4>
              <p className="text-[#D4AF37] text-xs font-mono tracking-widest uppercase mt-0.5">NEXORA GOLD QR</p>
              <p className="text-xs font-light text-gray-400 mt-1 leading-relaxed">Luxury physical displays matching watch houses. Secure instant remaining 75% resolution.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <span className="text-[#D4AF37] text-2xl font-serif">IV.</span>
            <div>
              <h4 className="text-xs font-mono tracking-widest text-[#D4AF37] uppercase">AI-Driven Retention</h4>
              <p className="text-xs font-light text-gray-400 mt-1 leading-relaxed">Deep customer loyalty modules detecting offline status and writing targeted VIP invitations.</p>
            </div>
          </div>

        </div>
      </section>

      {/* 2.5 PRESTIGE CONCIERGE: GEOLOCATION & REAL-TIME SEARCH INDEX */}
      <section id="concierge-index" className="py-24 px-6 bg-[#050505] relative border-b border-[#D4AF37]/10 overflow-hidden">
        
        {/* Subtle decorative gold circle mesh */}
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] gold-glow-radial opacity-40 pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto space-y-12 relative z-10">
          
          {/* Section Heading */}
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center space-x-2 bg-[#D4AF37]/5 border border-[#D4AF37]/20 px-3 py-1 rounded-full">
              <Compass className="w-3.5 h-3.5 text-[#D4AF37] animate-[spin_4s_linear_infinite]" />
              <span className="text-[10px] font-mono text-[#D4AF37] tracking-[0.25em] uppercase font-bold">PRESTIGE DIRECTORY HUB</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-serif font-extralight tracking-tight text-white animate-fade-in">
              Intelligent Geolocation & <span className="italic font-light text-[#D4AF37] block sm:inline">AI Search Index Desk</span>
            </h2>
            <p className="text-xs font-light text-gray-400 leading-relaxed">
              Experience the luxury of real-time nearby detection and NLP semantic search context. Calibrate your micro-region manually or trigger our browser geolocator to trace closest pilot showrooms.
            </p>
          </div>

          {/* Interactive Bento Master Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            
            {/* LEFT 5 COLS: NLP VOICE SEARCH INDEX CONSOLE */}
            <div className="lg:col-span-5 glass-slate-card p-6 rounded-xl border border-[#D4AF37]/25 flex flex-col justify-between space-y-6 bg-black/40 relative">
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                    <span className="text-[10px] font-mono tracking-widest text-[#D4AF37] uppercase font-bold">AI Intent Decoder (SEC-45)</span>
                  </div>
                  {voiceIsSimulating && (
                    <div className="flex items-center space-x-1 py-1 px-2.5 bg-[#D4AF37]/10 rounded border border-[#D4AF37]/30">
                      <span className="text-[8px] uppercase font-mono text-[#D4AF37] tracking-wider animate-pulse">LISTENING AUDIO</span>
                      <span className="w-1 h-2.5 bg-[#D4AF37] rounded-full animate-bounce"></span>
                      <span className="w-1 h-3.5 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1 h-2 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Search className="w-4 h-4 text-gray-500" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search e.g. 'Balayage under 20k' or 'Traditional Ink'..."
                    className="w-full bg-[#050505] text-xs font-light text-white pl-10 pr-12 py-3.5 rounded border border-[#D4AF37]/25 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] tracking-wide"
                  />
                  <button
                    onClick={handleSimulateVoice}
                    className={`absolute inset-y-1.5 right-1.5 px-3 rounded-sm flex items-center justify-center transition-all ${
                      voiceIsSimulating
                        ? 'bg-[#D4AF37] text-black shadow-[0_0_15px_rgba(212,175,55,0.4)]'
                        : 'bg-[#D4AF37]/15 hover:bg-[#D4AF37]/30 text-[#D4AF37]'
                    }`}
                    title="Simulate Voice Command"
                  >
                    <Mic className={`w-3.5 h-3.5 ${voiceIsSimulating ? 'animate-pulse' : ''}`} />
                  </button>
                </div>

                {/* Suggestions triggers */}
                <div className="space-y-1.5">
                  <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">TEST SEMANTIC SHIELDS</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { query: 'Signature French Gold Balayage under 20k', label: 'French Gold Balayage' },
                      { query: 'Obsidian stone massage', label: 'Obsidian Stone Therapy' },
                      { query: 'traditional line art', label: 'Traditional Lineart Ink' }
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSearchQuery(item.query);
                          setSearchToast(`AI processed search: "${item.query}"`);
                          setTimeout(() => setSearchToast(''), 4000);
                        }}
                        className="text-[9px] font-mono py-1 px-2.5 bg-black/60 hover:bg-black/85 border border-[#D4AF37]/15 hover:border-[#D4AF37]/50 text-gray-400 hover:text-white transition-all text-left"
                      >
                        ✦ {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* SEARCH RESULTS FEED */}
              <div className="flex-1 min-h-[180px] bg-[#050505]/80 rounded p-4 border border-[#D4AF37]/15 flex flex-col justify-between font-mono relative overflow-hidden">
                <div className="space-y-4">
                  <div className="text-[9px] uppercase text-gray-500 tracking-wider flex justify-between border-b border-[#D4AF37]/10 pb-2">
                    <span>Parsed Metadata</span>
                    <span>Matched treatments</span>
                  </div>

                  <AnimatePresence mode="wait">
                    {searchToast && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-[9px] text-[#D4AF37] bg-[#D4AF37]/10 p-2 border border-[#D4AF37]/30 rounded flex items-center"
                      >
                        <Sparkles className="w-3 h-3 mr-2 animate-pulse flex-shrink-0" />
                        <span>{searchToast}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Dynamic filtering of templates services with direct single-click bookings */}
                  {(() => {
                    const filteredServices = searchQuery.trim() === ''
                      ? []
                      : salonTemplates.flatMap(template => 
                          template.services.map(svc => ({
                            ...svc,
                            templateId: template.id,
                            templateName: template.name,
                            templateBg: template.bgGrad,
                            templateAccent: template.accentColor
                          }))
                        ).filter(svc => 
                          svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          svc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          svc.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          svc.templateName.toLowerCase().includes(searchQuery.toLowerCase())
                        );

                    const handleSingleClickBook = (templateId: string, serviceId: string) => {
                      const matchedTemplate = salonTemplates.find(t => t.id === templateId);
                      if (matchedTemplate) {
                        setSelectedTemplate(matchedTemplate);
                        const matchedService = matchedTemplate.services.find(s => s.id === serviceId);
                        if (matchedService) {
                          setSelectedService(matchedService);
                        }
                      }
                      setBookingStep(1);
                      setEscrowAuthorized(false);
                      const escrowEl = document.getElementById('escrow-section');
                      if (escrowEl) {
                        escrowEl.scrollIntoView({ behavior: 'smooth' });
                      }
                      setSearchToast('AI search redirect: select service matching treatment!');
                      setTimeout(() => setSearchToast(''), 4000);
                    };

                    if (filteredServices.length > 0) {
                      return (
                        <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
                          {filteredServices.map(svc => (
                            <div key={svc.id} className="p-2.5 rounded bg-black/60 border border-[#D4AF37]/20 flex flex-col justify-between space-y-2">
                              <div className="flex justify-between items-start gap-2">
                                <div>
                                  <span className="text-[8px] bg-[#D4AF37]/10 text-[#D4AF37] px-1.5 py-0.5 rounded border border-[#D4AF37]/20">
                                    {svc.templateName}
                                  </span>
                                  <h4 className="text-[11px] font-serif tracking-normal text-white mt-1">{svc.name}</h4>
                                </div>
                                <span className="text-[11px] text-[#D4AF37]">₹{svc.price.toLocaleString()}</span>
                              </div>
                              
                              <p className="text-[9px] font-sans font-light text-gray-400 leading-normal">{svc.description}</p>
                              
                              <div className="flex justify-between items-center pt-1.5 border-t border-white/5">
                                <span className="text-[8px] text-gray-500 uppercase">{svc.category} ({svc.duration} mins)</span>
                                <button
                                  onClick={() => handleSingleClickBook(svc.templateId, svc.id)}
                                  className="text-[8px] uppercase tracking-widest font-bold py-1 px-2.5 bg-[#D4AF37] hover:bg-white text-black rounded-sm transition-all cursor-pointer"
                                  id={`search-book-${svc.id}`}
                                >
                                  Reserve now ✦
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <div className="text-center py-8 text-gray-500 flex flex-col items-center justify-center space-y-2 h-[120px]">
                        <Search className="w-5 h-5 text-gray-600 animate-pulse" />
                        <p className="text-[10px] font-mono leading-relaxed max-w-[240px]">
                          {searchQuery.trim() === '' 
                            ? 'Awaiting command input. Set search queries above inside our secure directory.' 
                            : 'No high-fashion treatments mapped with those terms. Try "Balayage under 20k".'}
                        </p>
                      </div>
                    );
                  })()}

                </div>

                <div className="text-[8px] text-[#D4AF37]/60 pt-2 border-t border-white/5 flex justify-between">
                  <span>SSL SECURE SEARCH GATEWAY</span>
                  <span>CAL-99</span>
                </div>
              </div>

            </div>

            {/* RIGHT 7 COLS: SATELLITE GPS REGION ROUTER */}
            <div className="lg:col-span-7 glass-slate-card p-6 rounded-xl border border-[#D4AF37]/25 flex flex-col justify-between space-y-6 bg-black/40">
              
              <div className="space-y-4">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-2">
                    <MapPin className="w-4 h-4 text-[#D4AF37] animate-bounce" />
                    <div>
                      <span className="text-[10px] font-mono text-gray-400 block uppercase">Detected Coordinate Center</span>
                      <span className="text-sm font-serif font-light text-white tracking-wide">
                        {detectedRegion} — <span className="font-mono text-xs text-[#D4AF37]">{locationMatrix[detectedRegion]?.coordinates}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleDetectGps}
                    disabled={gpsDetecting}
                    className="metallic-button py-2 px-4 text-[9px] tracking-widest uppercase font-bold flex items-center justify-center space-x-2 bg-black hover:bg-black/80"
                    id="detect-gps-btn"
                  >
                    <span>{gpsDetecting ? 'Detecting...' : 'Auto-Detect My GPS'}</span>
                    <RefreshCw className={`w-3 h-3 ${gpsDetecting ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Region selections preset */}
                <div className="space-y-2">
                  <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">CHOOSE PRESET INDIAN METROPOLIS METADATA</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Object.keys(locationMatrix).map((region) => (
                      <button
                        key={region}
                        onClick={() => {
                          setDetectedRegion(region);
                          setGpsConsole([`Region updated manually: selected ${region.toUpperCase()}.`]);
                        }}
                        className={`text-[10px] font-mono py-2 px-1 text-center border transition-all rounded-sm cursor-pointer ${
                          detectedRegion === region
                            ? 'bg-[#D4AF37] text-black border-[#D4AF37] font-bold'
                            : 'bg-[#050505] hover:bg-black border-[#D4AF37]/15 text-gray-400 hover:text-white'
                        }`}
                        id={`region-btn-${region}`}
                      >
                        {region}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* TELEMETRY FEED / DYNAMIC BRAND DISTANCE MATRIX */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                
                {/* Simulated Telemetry logs console output */}
                <div className="md:col-span-4 bg-black/85 p-3 rounded border border-[#D4AF37]/15 font-mono text-[9px] text-gray-400 flex flex-col justify-between space-y-3 min-h-[150px]">
                  <div className="space-y-2">
                    <span className="text-[#D4AF37] block font-bold text-[8px] tracking-wider uppercase">GPS Console Logs</span>
                    {gpsDetecting ? (
                      <div className="space-y-1 text-[#D4AF37]/80">
                        {gpsConsole.map((log, index) => (
                          <div key={index} className="animate-pulse leading-snug">› {log}</div>
                        ))}
                        <div className="flex items-center space-x-1.5 pt-2">
                          <span className="inline-block w-1.5 h-1.5 bg-[#D4AF37] rounded-full animate-ping"></span>
                          <span className="text-[8px] text-gray-500 uppercase">Synchronizer Active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 font-light leading-snug">
                        {gpsConsole.length > 0 ? (
                          gpsConsole.map((log, index) => (
                            <div key={index} className="text-gray-400">› {log}</div>
                          ))
                        ) : (
                          <>
                            <div className="text-gray-500">› GPS status: Idle</div>
                            <div className="text-gray-500">› Location Matrix: Registered</div>
                            <div className="text-[#D4AF37]">› Region: {detectedRegion.toUpperCase()} Mapped</div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-[8px] text-gray-600 uppercase block tracking-widest">NEX-GPS-ACTIVE</span>
                </div>

                {/* Lounges sorted dynamically by distance context */}
                <div className="md:col-span-8 space-y-2.5 text-left">
                  <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest block">PARTNER BRAND SHOWROOM DISTANCE INDEX</span>
                  
                  <div className="space-y-2.5">
                    {(() => {
                      const currentRegionObj = locationMatrix[detectedRegion] || locationMatrix['Mumbai'];
                      const mappedSalonsList = [
                        { id: 'letoile', name: "L'Étoile Hair Lounge", key: 'letoile' as const },
                        { id: 'aura', name: "AURA Luxury Spa", key: 'aura' as const },
                        { id: 'obsidian', name: "The Obsidian Atelier", key: 'obsidian' as const }
                      ].map(item => {
                        const data = currentRegionObj.salons[item.key];
                        return {
                          ...item,
                          distance: parseFloat(data.distance),
                          distanceStr: data.distance,
                          time: data.time,
                          area: data.area
                        };
                      }).sort((a, b) => a.distance - b.distance);

                      return mappedSalonsList.map((salon, index) => (
                        <div
                          key={salon.id}
                          className={`p-3.5 rounded border transition-all flex items-center justify-between relative overflow-hidden ${
                            index === 0
                              ? 'bg-[#D4AF37]/10 border-[#D4AF37] shadow-[0_0_20px_rgba(212,175,55,0.15)]'
                              : 'bg-[#050505] border-white/5 hover:border-gray-600'
                          }`}
                        >
                          {index === 0 && (
                            <span className="absolute top-0 right-0 bg-[#D4AF37] text-black text-[7px] font-mono uppercase tracking-widest font-extrabold py-0.5 px-2 rounded-bl">
                              ✦ Nearest Pilot Hub 
                            </span>
                          )}

                          <div className="space-y-1.5">
                            <h4 className="text-xs font-serif text-white flex items-center">
                              <span>{salon.name}</span>
                            </h4>
                            <div className="flex items-center space-x-3 text-[10px] font-mono text-gray-400">
                              <span className="flex items-center text-[#D4AF37]">
                                <MapPin className="w-2.5 h-2.5 mr-1" />
                                {salon.area}
                              </span>
                              <span className="text-gray-600">|</span>
                              <span>{salon.time} Drive</span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end space-y-1 pr-1">
                            <span className="text-sm font-mono text-[#D4AF37] font-semibold">{salon.distanceStr} km</span>
                            <button
                              onClick={() => {
                                const matchedTemplate = salonTemplates.find(t => t.id === salon.id);
                                if (matchedTemplate) {
                                  setSelectedTemplate(matchedTemplate);
                                }
                                const designerEl = document.getElementById('designer');
                                if (designerEl) {
                                  designerEl.scrollIntoView({ behavior: 'smooth' });
                                }
                              }}
                              className="text-[8px] uppercase font-mono tracking-widest font-bold text-gray-400 hover:text-white transition-all underline decoration-[#D4AF37]/50 cursor-pointer"
                              id={`distance-book-${salon.id}`}
                            >
                              Configure Site ›
                            </button>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

              </div>
              
            </div>

          </div>

        </div>
      </section>

      {/* 3. INTERACTIVE SECTION: THE WHITE-LABEL WEBSITE BUILDER */}
      <section id="designer" className="py-24 px-6 bg-[#0A0A0A] relative border-b border-[#D4AF37]/10">
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* LEFT 30% OPERATIONS CONTROLS */}
          <div className="lg:col-span-4 space-y-8">
            <div className="space-y-3">
              <span className="text-xs font-mono text-[#D4AF37] tracking-[0.25em] uppercase block">PREMIUM DESIGN STUDIO</span>
              <h2 className="text-3xl sm:text-4xl font-serif font-extralight tracking-tight text-white leading-tight">
                No-Code Website Generation. <span className="italic block font-serif text-[#D4AF37] mt-1">High-Fashion Aesthetic.</span>
              </h2>
            </div>

            <p className="text-sm font-light text-gray-400 leading-relaxed">
              Experience the white-label customizer. See how effortlessly Nexora SalonOS generates elegant bespoke websites that reflect elite brand identities. Customize the styling variables below and watch the 70% live website render instantly.
            </p>

            <div className="space-y-6 bg-black/40 p-6 rounded-lg border border-[#D4AF37]/15">
              
              {/* SELECT SALON BRAND */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase flex items-center space-x-1">
                  <Building className="w-3.5 h-3.5 mr-1 text-[#D4AF37]" />
                  <span>Select Brand Character</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {salonTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template)}
                      className={`text-[10px] py-2 px-3 tracking-wider text-center font-bold uppercase rounded-sm border transition-all ${
                        selectedTemplate.id === template.id
                          ? 'bg-[#D4AF37] text-black border-[#D4AF37]'
                          : 'bg-black/60 hover:bg-black/30 border-[#D4AF37]/20 text-gray-400'
                      }`}
                      id={`brand-select-${template.id}`}
                    >
                      {template.id === 'letoile' ? "L'Étoile" : template.id === 'aura' ? 'Aura' : 'Atelier'}
                    </button>
                  ))}
                </div>
              </div>

              {/* CHOOSE LUXURY TEMPERATURE ACCENT */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase flex items-center space-x-1">
                  <Palette className="w-3.5 h-3.5 mr-1 text-[#D4AF37]" />
                  <span>Choose Palette Glow</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.keys(themeColors).map((themeName) => (
                    <button
                      key={themeName}
                      onClick={() => setActiveTheme(themeName)}
                      className={`text-[10px] py-1.5 px-2 text-left tracking-wider uppercase font-light rounded-sm border flex items-center justify-between ${
                        activeTheme === themeName
                          ? 'border-[#D4AF37] text-white bg-black/80'
                          : 'border-[#D4AF37]/15 text-gray-400 hover:border-gray-600 bg-black/20'
                      }`}
                      id={`theme-accent-${themeName.replace(' ', '-')}`}
                    >
                      <span className="flex items-center space-x-2">
                        <span 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: themeColors[themeName] }}
                        />
                        <span>{themeName}</span>
                      </span>
                      {activeTheme === themeName && <Check className="w-3 h-3 text-[#D4AF37]" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* ENTER SUBDOMAIN URL */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase flex items-center space-x-1">
                  <Globe className="w-3.5 h-3.5 mr-1 text-[#D4AF37]" />
                  <span>Prestige URL Domain</span>
                </label>
                <div className="flex rounded-sm overflow-hidden border border-[#D4AF37]/35 bg-[#050505]">
                  <input
                    type="text"
                    value={customSubdomain}
                    onChange={(e) => setCustomSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="bg-transparent text-xs text-[#D4AF37] px-3 py-2 w-1/2 focus:outline-none font-mono"
                    placeholder="letoile"
                    id="subdomain-input"
                  />
                  <div className="bg-[#D4AF37]/10 flex items-center px-3 border-l border-[#D4AF37]/20 w-1/2 justify-center text-[10px] font-mono text-gray-400">
                    .nexora.in
                  </div>
                </div>
              </div>

            </div>

            <div className="flex items-center space-x-3 bg-black/20 p-4 rounded-sm border border-[#D4AF37]/10 text-xs font-light text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>All white-label sites receive automated SSL encryption & bespoke responsive grids.</span>
            </div>

          </div>

          {/* RIGHT 70% TEMPLATE LIVE STOREFRONT PREVIEW (VIBRANT REFRESH CYCLES) */}
          <div className="lg:col-span-8">
            
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3 flex items-center justify-between">
              <span>DEPLOYED WEB PREVIEW (.Desktop Frame)</span>
              <span className="text-[#D4AF37] font-semibold">https://{customSubdomain || 'yourbrand'}.nexora.in</span>
            </div>

            {/* Immersive Laptop Device container */}
            <div className="rounded-xl border border-[#D4AF37]/40 bg-[#050505] p-3 shadow-2xl relative overflow-hidden" id="builder-preview-frame">
              
              {/* Laptop Camera dot & speaker elements */}
              <div className="flex items-center justify-between bg-[#111111] px-4 py-2 rounded-t-lg border-b border-[#D4AF37]/20">
                <div className="flex space-x-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-800/40"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-600/40"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-800/40"></div>
                </div>
                <div className="bg-black text-[9px] font-mono text-gray-400 px-6 py-0.5 rounded border border-[#D4AF37]/10 flex items-center space-x-2">
                  <Lock className="w-2.5 h-2.5 text-[#D4AF37]" />
                  <span>Secure Connection (SSL Deployed)</span>
                </div>
                <div className="w-6"></div>
              </div>

              {/* Dynamic live storefront body */}
              <div className={`p-6 bg-gradient-to-b ${selectedTemplate.bgGrad} min-h-[480px] flex flex-col justify-between transition-all duration-700 relative`}>
                
                {/* Visual grid watermark within template background */}
                <div className="absolute inset-0 opacity-[0.03] subtle-grid-overlay pointer-events-none"></div>

                {/* Simulated Storefront Header */}
                <div className="flex justify-between items-center border-b border-[#D4AF37]/10 pb-4 relative z-10">
                  <span className="font-serif tracking-widest text-sm text-white flex items-center space-x-1">
                    <span style={{ color: themeColors[activeTheme] }} className="mr-1">✦</span>
                    {selectedTemplate.name}
                  </span>
                  <div className="flex space-x-4 text-[9px] uppercase tracking-widest text-gray-400">
                    <span className="hover:text-white cursor-pointer">Menu</span>
                    <span className="hover:text-white cursor-pointer">Specialists</span>
                    <span className="hover:text-white cursor-pointer font-bold" style={{ color: themeColors[activeTheme] }}>RESERVE NOW</span>
                  </div>
                </div>

                {/* Front banner visual block */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center my-6 relative z-10">
                  
                  <div className="space-y-4">
                    <span 
                      className="text-[9px] font-mono tracking-[0.25em] uppercase py-0.5 px-2 bg-white/5 rounded inline-block"
                      style={{ color: themeColors[activeTheme], border: `1px solid ${themeColors[activeTheme]}33` }}
                    >
                      {activeTheme} COLLECTION
                    </span>
                    <h3 className="text-2xl font-serif leading-tight font-extralight text-white">
                      {selectedTemplate.tagline}
                    </h3>
                    <p className="text-[11px] font-light text-gray-300 leading-relaxed">
                      Every session includes private vault lounge access, premium imported tea infusions, and complete master consultant mapping.
                    </p>
                    <div>
                      <button 
                        className="py-2.5 px-5 text-[9px] uppercase tracking-widest font-bold font-serif rounded transition-all duration-300 shadow-md"
                        style={{ 
                          backgroundColor: themeColors[activeTheme], 
                          color: activeTheme === 'Platinum Noir' ? '#000000' : '#050505',
                          boxShadow: `0 0 15px ${themeColors[activeTheme]}44`
                        }}
                      >
                        Book Consultation
                      </button>
                    </div>
                  </div>

                  {/* Visual Aspect on Front banner (70% component height) */}
                  <div className="rounded-lg overflow-hidden border border-white/10 shadow-lg aspect-[4/3] relative group">
                    <img 
                      src={selectedTemplate.id === 'letoile' ? luxurySalonHero : selectedTemplate.id === 'aura' ? luxurySpaService : luxuryStudioArt}
                      alt={selectedTemplate.name}
                      className="w-full h-full object-cover grayscale-[20%]"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent"></div>
                    <div className="absolute bottom-3 left-3">
                      <span className="text-[8px] font-mono text-gray-400 block">EXCLUSIVE PARTNERSHIP</span>
                      <span className="text-xs font-serif text-white">{selectedTemplate.name} flagship</span>
                    </div>
                  </div>

                </div>

                {/* Exquisite List of luxury Services */}
                <div className="space-y-3 relative z-10 border-t border-white/10 pt-6">
                  <div className="flex justify-between items-center text-[10px] uppercase tracking-widest font-mono text-gray-400">
                    <span>Signature Salon Luxuries</span>
                    <span>Curated Price Index</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {selectedTemplate.services.slice(0, 3).map((svc) => (
                      <div 
                        key={svc.id} 
                        className="p-3 rounded bg-black/60 border border-white/5 flex flex-col justify-between hover:border-gray-500 transition-colors"
                      >
                        <div>
                          <p className="text-[11px] font-serif font-medium text-white line-clamp-1">{svc.name}</p>
                          <p className="text-[9px] text-gray-400 line-clamp-2 mt-1 leading-normal font-light">{svc.description}</p>
                        </div>
                        <div className="flex justify-between items-end mt-3">
                          <span className="text-[8px] font-mono text-gray-500 uppercase">{svc.category}</span>
                          <span className="text-[11px] font-mono font-medium" style={{ color: themeColors[activeTheme] }}>
                            ₹{svc.price.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>
      </section>

      {/* 4. CLINICAL WORKFLOW: THE 25% TRUST ESCROW ENGINE */}
      <section id="escrow-section" className="py-24 px-6 bg-[#111111] relative border-b border-[#D4AF37]/10">
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] gold-glow-radial rounded-full pointer-events-none animate-gold-pulse"></div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* LEFT 70% INTERACTIVE APPOINTMENT ESCROW WORKBOARD */}
          <div className="lg:col-span-8 order-2 lg:order-1 relative">
            
            <div className="absolute inset-0 bg-gradient-to-b from-[#D4AF37]/5 to-transparent rounded-xl filter blur-xl pointer-events-none"></div>

            {/* Simulated Booking Console */}
            <div className="glass-slate-card p-6 rounded-xl border border-[#D4AF37]/35 relative z-10" id="escrow-simulator-frame">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#D4AF37]/20">
                <div className="flex items-center space-x-3">
                  <div className="bg-[#D4AF37]/10 p-2 rounded-full border border-[#D4AF37]/40">
                    <ShieldCheck className="w-5 h-5 text-[#D4AF37]" />
                  </div>
                  <div>
                    <h3 className="text-md uppercase tracking-wider text-white font-mono flex items-center">
                      <span>SECURE RESERVATION INTERFACES</span>
                      <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded ml-2">ESCROW VERIFIED</span>
                    </h3>
                    <p className="text-[10px] text-gray-500 mt-0.5 font-mono">Nexora Escrow Calibre SEC-75</p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 text-xs text-gray-400 font-mono">
                  <span className={`px-2.5 py-1 rounded ${bookingStep === 1 ? 'bg-[#D4AF37] text-black font-bold' : 'bg-black/60 border border-[#D4AF37]/20 text-gray-500'}`}>1. Select</span>
                  <span className="text-gray-600">→</span>
                  <span className={`px-2.5 py-1 rounded ${bookingStep === 2 ? 'bg-[#D4AF37] text-black font-bold' : 'bg-black/60 border border-[#D4AF37]/20 text-gray-500'}`}>2. Escrow Hold</span>
                  <span className="text-gray-600">→</span>
                  <span className={`px-2.5 py-1 rounded ${bookingStep === 3 ? 'bg-[#D4AF37] text-black font-bold' : 'bg-black/60 border border-[#D4AF37]/20 text-gray-500'}`}>3. Voucher Issued</span>
                </div>
              </div>

              {/* STEP 1: CONSOLE VIEW */}
              <AnimatePresence mode="wait">
                {bookingStep === 1 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="py-6 space-y-6"
                    key="step-select"
                  >
                    
                    {/* SERVICE CATEGORY SELECTOR */}
                    <div className="space-y-3">
                      <p className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">A. Select Prestigious Treatment Category</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {selectedTemplate.services.map((svc) => (
                          <div
                            key={svc.id}
                            onClick={() => setSelectedService(svc)}
                            className={`p-4 rounded border transition-all cursor-pointer relative flex flex-col justify-between ${
                              selectedService?.id === svc.id
                                ? 'bg-[#D4AF37]/10 border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.15)]'
                                : 'bg-black/40 border-[#D4AF37]/10 hover:border-[#D4AF37]/45 text-gray-300'
                            }`}
                            id={`escrow-svc-${svc.id}`}
                          >
                            <div>
                              <div className="flex justify-between items-start">
                                <span className="text-[9px] font-mono text-[#D4AF37] uppercase tracking-wide">{svc.category}</span>
                                {selectedService?.id === svc.id && <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-ping"></div>}
                              </div>
                              <h4 className="text-xs font-serif font-medium text-white mt-1.5">{svc.name}</h4>
                            </div>
                            <div className="flex justify-between items-end mt-4 pt-3 border-t border-white/5">
                              <span className="text-[10px] font-mono text-gray-500">{svc.duration} Mins</span>
                              <span className="text-xs font-mono text-[#D4AF37] font-semibold">₹{svc.price.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* STYLIST SELECTOR */}
                    <div className="space-y-3">
                      <p className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">B. Assign Elite Consultant Specialist</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {selectedTemplate.stylists.map((sty) => (
                          <div
                            key={sty.id}
                            onClick={() => setSelectedStylist(sty)}
                            className={`flex items-center space-x-4 p-3 rounded border cursor-pointer transition-all ${
                              selectedStylist?.id === sty.id
                                ? 'bg-[#D4AF37]/10 border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.15)]'
                                : 'bg-black/40 border-[#D4AF37]/10 hover:border-[#D4AF37]/40 text-gray-300'
                            }`}
                            id={`escrow-stylist-${sty.id}`}
                          >
                            <img 
                              src={sty.image} 
                              alt={sty.name} 
                              className="w-12 h-12 rounded-full object-cover border border-[#D4AF37]/35"
                              referrerPolicy="no-referrer"
                            />
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-medium text-white truncate">{sty.name}</h4>
                              <p className="text-[10px] font-mono text-gray-500 uppercase mt-0.5">{sty.role}</p>
                              <div className="flex space-x-1 mt-1 text-[9px] text-[#D4AF37] font-mono">
                                <span>{sty.rating} ★</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-gray-400">{sty.specialties.join(', ')}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button
                        onClick={() => setBookingStep(2)}
                        className="metallic-button-strong py-3 px-8 text-xs tracking-widest uppercase rounded-sm flex items-center space-x-2"
                        id="escrow-continue-to-step2"
                      >
                        <span>Calculate Luxury Split</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>

                  </motion.div>
                )}

                {/* STEP 2: TRUST COUTURE ESCROW PRE-LEVIED SPLITS */}
                {bookingStep === 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="py-6 space-y-6"
                    key="step-escrow"
                  >
                    
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                      
                      {/* SPLIT BREAKDOWN LEDGER */}
                      <div className="md:col-span-7 bg-black/60 p-5 rounded-lg border border-[#D4AF37]/20 space-y-4">
                        <p className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-widest border-b border-[#D4AF37]/20 pb-2">
                          CALIBRE SEC-75 TRANSPARENT LEDGER
                        </p>
                        
                        <div className="space-y-2 text-xs font-mono">
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Selected Brand Service:</span>
                            <span className="text-white text-right">{selectedService?.name}</span>
                          </div>
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Assigned Elite Consultant:</span>
                            <span className="text-white text-right">{selectedStylist?.name}</span>
                          </div>
                          <hr className="border-gray-800 my-2" />
                          <div className="flex justify-between items-center text-gray-300">
                            <span>Base Service Valuer:</span>
                            <span className="text-white">₹{selectedService ? selectedService.price.toLocaleString() : '0'}</span>
                          </div>
                          <div className="flex justify-between items-center text-[#D4AF37]/90 text-[11px]">
                            <span>90% Direct Salon Share:</span>
                            <span>₹{selectedService ? (selectedService.price * 0.9).toLocaleString() : '0'}</span>
                          </div>
                          <div className="flex justify-between items-center text-gray-500 text-[11px]">
                            <span>10% Nexora Commission:</span>
                            <span>₹{selectedService ? (selectedService.price * 0.1).toLocaleString() : '0'}</span>
                          </div>
                          
                          <hr className="border-[#D4AF37]/20 my-4" />
                          
                          {/* ESCROW CALCULATIONS */}
                          <div className="p-4 bg-[#D4AF37]/5 rounded border border-[#D4AF37]/40 space-y-3">
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="text-xs uppercase font-serif font-semibold tracking-wider text-white">25% Escrow Holder</span>
                                <p className="text-[9px] text-gray-500 mt-0.5 normal-case">Safely held in escrow until counter scanner is verified.</p>
                              </div>
                              <span className="text-lg text-[#D4AF37] font-semibold font-mono">
                                ₹{selectedService ? (selectedService.price * 0.25).toLocaleString() : '0'}
                              </span>
                            </div>
                            
                            <div className="flex justify-between items-center text-[10px] text-gray-400 border-t border-[#D4AF37]/20 pt-2 font-mono">
                              <span>Remaining 75% At SalonCounter:</span>
                              <span className="text-white">₹{selectedService ? (selectedService.price * 0.75).toLocaleString() : '0'}</span>
                            </div>
                          </div>

                        </div>

                        {/* ENTER VIP REFLECTIVE VOUCHER */}
                        <div className="pt-2">
                          <label className="text-[9px] font-mono text-gray-500 uppercase tracking-widest block mb-1">PROMOTIONAL INVITE CODE (OPTIONAL)</label>
                          <input 
                            type="text" 
                            className="w-full bg-[#050505] border border-[#D4AF37]/25 rounded px-3 py-2 text-xs font-mono text-[#D4AF37] focus:outline-none focus:border-[#D4AF37]" 
                            value={vipBookingCode}
                            onChange={(e) => setVipBookingCode(e.target.value.toUpperCase())}
                          />
                        </div>

                      </div>

                      {/* CLIENT TERMS SUMMARY CARD */}
                      <div className="md:col-span-5 bg-black/40 p-5 rounded-lg border border-white/5 space-y-4">
                        <div className="flex items-center space-x-2 text-[#D4AF37]">
                          <Lock className="w-4 h-4" />
                          <h4 className="text-[10px] font-mono tracking-widest uppercase">Escrow Rules</h4>
                        </div>
                        
                        <p className="text-xs font-light text-gray-400 leading-relaxed">
                          By authorizing the security deposit hold, you approve that 25% of the aesthetic base value will be securely captured on Razorpay and placed in Nexora's escrow container. 
                        </p>
                        
                        <div className="space-y-2">
                          <div className="flex items-start space-x-2 text-[10px] text-gray-400">
                            <span className="text-[#D4AF37] font-mono">✓</span>
                            <span>Fully refundable if canceled 24 hours prior.</span>
                          </div>
                          <div className="flex items-start space-x-2 text-[10px] text-gray-400">
                            <span className="text-[#D4AF37] font-mono">✓</span>
                            <span>Auto-settled after counter scanning.</span>
                          </div>
                          <div className="flex items-start space-x-2 text-[10px] text-gray-400">
                            <span className="text-[#D4AF37] font-mono">✓</span>
                            <span>Direct 1-click ledger reconciliation.</span>
                          </div>
                        </div>

                        {/* SUBMIT DEPOSIT BUTTON */}
                        <div className="pt-2">
                          <button
                            onClick={handleEscrowAuthorization}
                            disabled={escrowAuthorized}
                            className={`w-full py-3 px-4 text-center text-xs tracking-widest uppercase rounded-sm font-bold flex items-center justify-center space-x-2 transition-all ${
                              escrowAuthorized 
                                ? 'bg-[#050505] text-[#D4AF37] border border-[#D4AF37]/40 cursor-wait'
                                : 'bg-[#D4AF37] text-black hover:bg-[#AA820A]'
                            }`}
                            id="escrow-authorize-btn"
                          >
                            {escrowAuthorized ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#D4AF37]" />
                                <span>Securing Escrow Block...</span>
                              </>
                            ) : (
                              <>
                                <Shield className="w-3.5 h-3.5 text-black" />
                                <span>Authorize 25% Deposit</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="text-center">
                          <button 
                            onClick={() => setBookingStep(1)} 
                            className="text-[9px] font-mono tracking-widest text-gray-500 hover:text-white uppercase"
                            id="escrow-go-back"
                          >
                            « Back To Customizer
                          </button>
                        </div>

                      </div>

                    </div>

                  </motion.div>
                )}

                {/* STEP 3: VVIP CONFIRMATION SCROLL SUCCESS */}
                {bookingStep === 3 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-12 flex flex-col items-center justify-center text-center space-y-6"
                    key="step-success"
                  >
                    
                    <div className="w-16 h-16 bg-[#D4AF37]/10 rounded-full border border-[#D4AF37] flex items-center justify-center shadow-[0_0_25px_rgba(212,175,55,0.25)]">
                      <Award className="w-8 h-8 text-[#D4AF37] animate-bounce" />
                    </div>

                    <div className="space-y-2 max-w-md">
                      <span className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-[0.3em]">SECURE TRANSACTION SEC-75 REGISTERED</span>
                      <h3 className="text-2xl font-serif text-white uppercase tracking-wider">
                        Prestige Lounge Reservation Issued
                      </h3>
                      <p className="text-xs font-light text-gray-400">
                        Bespoke ledger tracking established under token reference <span className="text-[#D4AF37] font-mono">#LET-ESC-901</span>. An invitation receipt has been dispatched to your private lines. Let's head to the salon and test counter scanning.
                      </p>
                    </div>

                    {/* VVIP Digital Escrow Ticket */}
                    <div className="glass-slate-card p-4 rounded bg-[#0a0a0a] min-w-[280px] text-left border-dashed border-[#D4AF37]/50 max-w-sm space-y-3 font-mono text-[10px]">
                      <div className="flex justify-between items-center text-[#D4AF37] border-b border-white/5 pb-2">
                        <span>NEXORA SALONOS VOUCHER</span>
                        <span>ACTIVE</span>
                      </div>
                      <div className="space-y-1.5 text-gray-400">
                        <div className="flex justify-between">
                          <span>Client Card Code:</span>
                          <span className="text-white font-semibold">VIP-DEVIKA-84</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Assigned Brand:</span>
                          <span className="text-white">{selectedTemplate.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Specialist Consultant:</span>
                          <span className="text-white">{selectedStylist?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Secure Escrow Held:</span>
                          <span className="text-[#D4AF37] font-semibold">₹{selectedService ? (selectedService.price * 0.25).toLocaleString() : '0'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Balance Multiplier:</span>
                          <span className="text-gray-300">₹{selectedService ? (selectedService.price * 0.75).toLocaleString() : '0'} (75% due at scanning)</span>
                        </div>
                      </div>
                      <div className="bg-[#D4AF37]/10 p-2 text-center text-gray-300 border border-[#D4AF37]/30 text-[9px]">
                        Scan counter QR at L'Étoile to fire escrow release.
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 pt-4">
                      <a
                        href="#qr-section"
                        className="metallic-button-strong py-3 px-8 text-xs tracking-widest uppercase rounded-sm flex items-center space-x-2"
                        id="escrow-go-to-scanner"
                      >
                        <span>Scan Remaining 75% Counter QR</span>
                        <ArrowRight className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => {
                          setBookingStep(1);
                          setEscrowAuthorized(false);
                        }}
                        className="metallic-button py-3 px-6 text-xs uppercase tracking-widest rounded-sm"
                        id="escrow-reset-btn"
                      >
                        Reset Simulator
                      </button>
                    </div>

                  </motion.div>
                )}
              </AnimatePresence>

            </div>

          </div>

          {/* RIGHT 30% EXQUISITE COPY RATION (Visual First Rule) */}
          <div className="lg:col-span-4 flex flex-col justify-center space-y-6 order-1 lg:order-2">
            <span className="text-xs font-mono text-[#D4AF37] tracking-[0.25em] uppercase block">SYSTEM MECHANICS: PART II</span>
            <h2 className="text-3xl sm:text-4xl font-serif font-extralight tracking-tight text-white leading-tight">
              A 25% Deposit Holds the Horizon. <span className="italic block font-serif text-[#D4AF37] mt-1">Direct to Salon.</span>
            </h2>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              General software allows clients to select arbitrary slots and fail to show, robbing stylists of precious hours. Nexora implements a rigid 25% booking authorization hold. 
            </p>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              If the booking fails without 24h notification, the stylist receives the deposit directly in their Nexora wallet. No software platform can guarantee zero friction; Nexora SalonOS guarantees absolute visual prestige.
            </p>
            
            <div className="border-t border-[#D4AF37]/20 pt-6">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest block mb-2">Escrow Registry Metrics</span>
              <div className="flex items-center space-x-6">
                <div>
                  <span className="text-2xl font-serif text-white">0%</span>
                  <span className="text-[9px] font-mono text-[#D4AF37] uppercase block mt-1">Unreconciled booking leakage</span>
                </div>
                <div className="w-px h-8 bg-[#D4AF37]/25"></div>
                <div>
                  <span className="text-2xl font-serif text-white">100%</span>
                  <span className="text-[9px] font-mono text-[#D4AF37] uppercase block mt-1">Stylist protection security</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 5. INTERACTIVE SECTION: THE NEXORA QR SETTLEMENT */}
      <section id="qr-section" className="py-24 px-6 bg-[#050505] relative border-b border-[#D4AF37]/10">
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* LEFT 30% VISUAL-FIRST ELEMENT (Visual First Rule) */}
          <div className="lg:col-span-4 space-y-6">
            <span className="text-xs font-mono text-[#D4AF37] tracking-[0.25em] uppercase block">COUNTERPOINT TERMINALS</span>
            <h2 className="text-3xl sm:text-4xl font-serif font-extralight tracking-tight text-white leading-tight">
              The Nexora Gold QR. <span className="italic block font-serif text-[#D4AF37] mt-1">Zero-Friction Cashbacks.</span>
            </h2>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              Say goodbye to awkward UPI exchanges. At the desk, the salon projects Nexora's elegant bespoke Gold QR stand. Custom hardware constructed in heavy slate, black glass, and pristine brass detailing.
            </p>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              When scanned, Nexora instantly maps the reference, calculates the remaining 75%, credits the Salon's Wallet ledger, and fires glowing gold points straight into the VIP digital card.
            </p>

            <div className="border-l-2 border-[#D4AF37] pl-4 py-1">
              <p className="text-xs italic text-gray-300">
                "We do not build software dashboards. We construct absolute loyalty loops."
              </p>
            </div>
          </div>

          {/* RIGHT 70% HIGH QUALITY INTERACTIVE QR SCAN SIMULATOR */}
          <div className="lg:col-span-8 bg-[#0C0C0C] p-8 rounded-xl border border-[#D4AF37]/20 relative">
            
            <div className="absolute top-0 right-0 p-4">
              <span className="bg-black/80 rounded border border-[#D4AF37]/35 text-[9px] font-mono text-gray-400 px-3 py-1">
                Calibre Term: NEX-QR-LEDGER
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center pt-4">
              
              {/* SCAN TERMINAL SCAN SIDE (35% area) */}
              <div className="md:col-span-5 flex flex-col items-center justify-center space-y-4">
                
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">A. SEC-75 COUNTER QR DISPLAY</p>
                
                {/* Stunning Gold QR Frame layout */}
                <div
                  id="qr-display-card"
                  className={`relative p-4 rounded-xl bg-gradient-to-br from-[#111111] via-[#050505] to-[#1a1505] border-2 transition-all duration-700 flex flex-col items-center justify-center aspect-square w-full max-w-[240px] ${
                    qrScanned
                      ? 'qr-shimmer-active border-[#D4AF37] shadow-[0_0_55px_rgba(212,175,55,0.45)] ring-1 ring-[#D4AF37]/40'
                      : 'border-[#D4AF37]/60 shadow-[0_0_50px_rgba(212,175,55,0.15)]'
                  }`}
                >
                  
                  {/* Glowing corners */}
                  <div className={`absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 transition-colors duration-500 z-10 ${qrScanned ? 'border-[#F5D06A]' : 'border-[#D4AF37]'}`}></div>
                  <div className={`absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 transition-colors duration-500 z-10 ${qrScanned ? 'border-[#F5D06A]' : 'border-[#D4AF37]'}`}></div>
                  <div className={`absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 transition-colors duration-500 z-10 ${qrScanned ? 'border-[#F5D06A]' : 'border-[#D4AF37]'}`}></div>
                  <div className={`absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 transition-colors duration-500 z-10 ${qrScanned ? 'border-[#F5D06A]' : 'border-[#D4AF37]'}`}></div>

                  {/* Pulsing QR container */}
                  <div className="bg-[#050505] border border-[#D4AF37]/30 rounded-lg p-3 w-4/5 aspect-square flex flex-col items-center justify-center relative overflow-hidden z-10">
                    <QrCode className="w-full h-full text-[#D4AF37] animate-pulse" />
                    {qrScanned && !qrPaid && (
                      <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-2 text-center">
                        <RefreshCw className="w-8 h-8 text-[#D4AF37] animate-spin mb-1" />
                        <span className="text-[9px] font-mono text-[#D4AF37] uppercase tracking-widest font-semibold animate-pulse">
                          Processing 75%
                        </span>
                        <span className="text-[8px] font-mono text-gray-400 mt-0.5">UPI • ₹13,875</span>
                      </div>
                    )}
                    {qrPaid && (
                      <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-2 text-center">
                        <CheckCircle className="w-9 h-9 text-emerald-400 mb-1" />
                        <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest font-semibold">
                          75% SETTLED
                        </span>
                        <span className="text-[8px] font-mono text-[#D4AF37] mt-0.5">₹13,875 CREDITED</span>
                      </div>
                    )}
                  </div>

                  <span className="text-[9px] font-mono text-gray-400 uppercase tracking-widest mt-3 z-10 flex items-center gap-1.5">
                    {qrScanned ? (
                      <span className="text-[#D4AF37] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-ping inline-block"></span>
                        75% PAYMENT ACTIVE
                      </span>
                    ) : (
                      "L'Étoile Flagship #01"
                    )}
                  </span>

                </div>

                <div className="w-full max-w-[240px]">
                  {!qrScanned ? (
                    <button
                      onClick={handleQRPaySimulator}
                      className="w-full metallic-button-strong py-3 text-xs tracking-widest uppercase rounded"
                      id="qr-mock-scan-btn"
                    >
                      Simulate Guest Scan (75%)
                    </button>
                  ) : (
                    <button
                      onClick={resetQR}
                      className="w-full metallic-button py-2.5 text-xs text-[#D4AF37] tracking-widest uppercase rounded bg-[#0a0a0a]"
                      id="qr-reset-btn"
                    >
                      Reset Scanner
                    </button>
                  )}
                </div>

              </div>

              {/* SALON WALLET LEDGER & VIP CREDIT (65% area) */}
              <div className="md:col-span-7 bg-[#050505] p-5 rounded-lg border border-[#D4AF37]/25 space-y-4">
                
                <div className="flex justify-between items-center border-b border-white/5 pb-3">
                  <div>
                    <span className="text-[9px] font-mono text-gray-500 uppercase">Secure Salon Account balance</span>
                    <h4 className="text-xl font-mono text-[#D4AF37] tracking-wide mt-0.5">
                      ₹{(walletBalance / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                    </h4>
                  </div>
                  <span className="bg-[#D4AF37]/10 border border-[#D4AF37]/35 rounded text-[9px] font-mono text-[#D4AF37] px-2 py-0.5 uppercase">
                    Auto-Settles 10:00 PM
                  </span>
                </div>

                {/* Secure ledger records */}
                <div className="space-y-2">
                  <p className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">SALON REVENUE LEDGER AUDIT</p>
                  
                  <div className="space-y-1.5 font-mono text-[10px]">
                    
                    <div className="flex justify-between text-gray-400 bg-white/[0.02] p-2 rounded">
                      <span>Ref #LET-ESC-901 Deposit Release:</span>
                      <span className="text-[#D4AF37]">₹4,625 CREDIT</span>
                    </div>

                    <div className={`flex justify-between p-2 rounded transition-all ${
                      qrPaid 
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold' 
                        : 'text-gray-600 bg-[#0c0c0c] border border-white/[0.01]'
                    }`}>
                      <span>Ref #LET-REM-901 Remaining UPI scanned:</span>
                      <span>{qrPaid ? '₹13,875 CREDIT' : 'PENDING COUNTER SCAN'}</span>
                    </div>

                    <div className="flex justify-between text-gray-500 bg-[#0c0c0c] p-2 rounded">
                      <span>Nexora Base 10% Platform Slice:</span>
                      <span>₹1,850 DEBIT</span>
                    </div>

                  </div>
                </div>

                {/* Customer VIP Digital Card update view */}
                <div className="p-4 bg-gradient-to-r from-[#0C0C0C] to-[#16130C] rounded border border-[#D4AF37]/15">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="bg-[#D4AF37]/10 p-1.5 rounded border border-[#D4AF37]/20">
                        <Award className="w-5 h-5 text-[#D4AF37]" />
                      </div>
                      <div>
                        <span className="text-[9px] font-mono text-gray-400 uppercase leading-none block">Client Loyalty Grade</span>
                        <h5 className="text-xs font-serif text-white font-medium mt-0.5">Devika Vardhan - L'Étoile VIP CARD</h5>
                      </div>
                    </div>
                    <span className="text-xs text-[#D4AF37] font-mono">GOLD LVL</span>
                  </div>

                  <hr className="border-gray-800 my-2" />

                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[10px] text-gray-400">Total VIP Loyalty Score:</span>
                    <span className="text-white">
                      {qrPaid ? (
                        <span className="text-emerald-400 flex items-center space-x-1">
                          <span>1,480 PTS</span>
                          <span className="text-[9px] text-[#D4AF37] ml-1">(+185 pts earned!)</span>
                        </span>
                      ) : (
                        <span>1,295 PTS</span>
                      )}
                    </span>
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>
      </section>

      {/* 6. OPERATIONAL SECTION: AI GROWTH & RETENTION CONTROL CENTER */}
      <section id="ai-defense" className="py-24 px-6 bg-[#0A0A0A] relative border-b border-[#D4AF37]/10">
        <div className="absolute top-1/2 right-0 w-[550px] h-[550px] gold-glow-radial rounded-full pointer-events-none animate-gold-pulse"></div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* LEFT 70% THE RETENTION AND WORKPLAN DASHBOARD */}
          <div className="lg:col-span-8 space-y-6">
            
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest flex justify-between items-center">
              <span>NEXORA INTEL CORE V-9 | OWNER SECURITY PORTAL</span>
              <span className="text-emerald-400 bg-emerald-500/15 py-0.5 px-2.5 rounded border border-emerald-500/25">AUTONOMUS ANALYTICS RUNNING</span>
            </div>

            {/* Simulated Live Analytics Dashboard */}
            <div className="glass-slate-card p-6 rounded-xl border border-[#D4AF37]/25 relative overflow-hidden" id="ai-dashboard-frame">
              
              {/* Dashboard metrics widgets */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pb-6 border-b border-[#D4AF37]/15">
                
                <div className="bg-[#050505] p-3 rounded border border-white/5 font-mono">
                  <span className="text-[9px] text-gray-500 uppercase block">Total VIP Cohort</span>
                  <p className="text-lg text-white font-medium mt-1">1,842</p>
                  <span className="text-[8px] text-emerald-400 block mt-0.5">✦ Active & Premium</span>
                </div>

                <div className="bg-[#050505] p-3 rounded border border-white/5 font-mono">
                  <span className="text-[9px] text-gray-500 uppercase block">Elite Retention Rate</span>
                  <p className="text-lg text-white font-medium mt-1">94.2%</p>
                  <span className="text-[8px] text-emerald-400 block mt-0.5">✦ +4.1% Since Onboarding</span>
                </div>

                <div className="bg-[#050505] p-3 rounded border border-white/5 font-mono select-none">
                  <span className="text-[9px] text-gray-500 uppercase block">Avg VIP Booking Span</span>
                  <p className="text-lg text-white font-medium mt-1">18.4 Days</p>
                  <span className="text-[8px] text-[#D4AF37] block mt-0.5">✦ Industry Standard: 45d</span>
                </div>

                <div className="bg-[#050505] p-3 rounded border border-white/5 font-mono">
                  <span className="text-[9px] text-gray-500 uppercase block">Nexora Growth Grade</span>
                  <p className="text-lg text-[#D4AF37] font-serif tracking-wider font-semibold mt-1">A+ PLATINUM</p>
                  <span className="text-[8px] text-[#D4AF37]/80 block mt-0.5">✦ Rank #2 in City</span>
                </div>

              </div>

              {/* CRM / Inactive clients trigger simulation */}
              <div className="pt-6 grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Retention control on the left (40% width) */}
                <div className="md:col-span-5 space-y-4 font-mono text-[11px]">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest">AUTOMATED RETENTION SYSTEM TRIGGER</p>
                  
                  <div className="bg-black/60 p-4 rounded border border-[#D4AF37]/20 space-y-3">
                    <div className="flex justify-between uppercase">
                      <span className="text-gray-500">Target Cohort:</span>
                      <span className="text-[#D4AF37] font-semibold">9 Inactive VIPs</span>
                    </div>

                    <div className="flex justify-between uppercase">
                      <span className="text-gray-500">Criteria Trigger:</span>
                      <span className="text-white text-right">45+ Days Since Session</span>
                    </div>

                    <div className="flex justify-between uppercase">
                      <span className="text-gray-500">Churn Risk Level:</span>
                      <span className="text-red-400 text-right font-bold">84% AVERAGE</span>
                    </div>

                    <div className="flex justify-between uppercase pt-2 border-t border-white/5">
                      <span className="text-gray-500">VIPs Retained To Date:</span>
                      <span className="text-emerald-400">{vipsRetainedCount} VIPs</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {!retentionSuccess ? (
                      <button
                        onClick={triggerRetentionBespoke}
                        disabled={retentionDispatching}
                        className={`w-full py-3 px-4 text-center tracking-widest text-[10px] uppercase font-bold rounded ${
                          retentionDispatching
                            ? 'bg-[#050505] text-[#D4AF37] border border-[#D4AF37]/40 cursor-wait'
                            : 'bg-[#D4AF37] text-black hover:bg-[#AA820A]'
                        }`}
                        id="retention-dispatch-btn"
                      >
                        {retentionDispatching ? (
                          <span className="flex items-center justify-center space-x-2">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Despatching Churn Defense...</span>
                          </span>
                        ) : (
                          <span>DESPATCH CHURN DEFENSE</span>
                        )}
                      </button>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-center rounded space-y-2 text-[10px]">
                        <p className="uppercase font-bold">✓ Campaign Successfully Dispatched</p>
                        <p className="normal-case text-gray-400">Nexora WhatsApp Gateway delivered 14 customized invitations containing personalized Balayage voucher credits.</p>
                        <button
                          onClick={() => setRetentionSuccess(false)}
                          className="text-[9px] uppercase tracking-widest text-[#D4AF37] hover:underline"
                          id="btn-crm-simulate-again"
                        >
                          Simulate Loop Again
                        </button>
                      </div>
                    )}
                  </div>

                </div>

                {/* Gemini AI Message Draft output (60% width) */}
                <div className="md:col-span-7 bg-[#050505] p-5 rounded border border-white/5 relative">
                  
                  <div className="absolute top-3 right-3 flex items-center space-x-1.5 text-[8px] font-mono text-gray-550 bg-black py-0.5 px-2 rounded border border-[#D4AF37]/20 uppercase">
                    <Sparkles className="w-2.5 h-2.5 text-[#D4AF37]" />
                    <span>Gemini AI Engine Autoloop</span>
                  </div>

                  <p className="text-[10px] font-mono text-[#D4AF37] uppercase tracking-widest mb-3">CONGIERGE WHATSAPP MESSAGE DRAFT</p>

                  <div className="bg-[#0C0C0C] p-4 rounded border border-white/5 font-mono text-xs text-gray-300 leading-relaxed space-y-3 relative overflow-hidden">
                    
                    {/* Simulated phone chat box bubbles */}
                    <div className="flex space-x-2.5 items-start">
                      <div className="bg-[#D4AF37]/20 rounded-full w-6 h-6 flex items-center justify-center text-[10px] text-[#D4AF37]">✦</div>
                      <div className="bg-black/80 rounded-lg p-3 border border-[#D4AF37]/15">
                        <span className="text-[8px] text-gray-500 block mb-1">To: Devika Vardhan (VIP)</span>
                        <p className="text-gray-300 tracking-wide text-[11px] leading-relaxed">
                          "Greetings Devika from L'Étoile Hair Lounge. We noticed your signature Balayage structure deserves precision maintenance. Jean-Jacques has a reserved private velvet suite for you this Thursday evening. A 20% elite maintenance credit is attached. Confirm reservation block instantly: <span className="text-[#D4AF37] underline">letoile.inv/devika</span>"
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2.5 items-start pt-2">
                      <div className="bg-[#111111] rounded-lg p-2 border border-white/5">
                        <p className="text-xs text-emerald-400">✓ VIP Click Rate Probability: 89.2%</p>
                        <p className="text-[9px] text-gray-500 mt-0.5">Calculated based on previous Thursday evening check-ins.</p>
                      </div>
                    </div>

                  </div>

                </div>

              </div>

            </div>

          </div>

          {/* RIGHT 30% EXQUISITE COPY RATION (Visual First Rule) */}
          <div className="lg:col-span-4 space-y-6">
            <span className="text-xs font-mono text-[#D4AF37] tracking-[0.25em] uppercase block">PREMIUM CRM RETENTION SYSTEM</span>
            <h2 className="text-3xl sm:text-4xl font-serif font-extralight tracking-tight text-white leading-tight">
              Prestige Requires Proactive Care. <span className="italic block font-serif text-[#D4AF37] mt-1">Churn Is Non-Existent.</span>
            </h2>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              High-fashion operators know that client relationships are fragile. Conventional software expects owners to download stale Excel sheets and draft manual messages.
            </p>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              Nexora SalonOS operates an offline customer sensor. When a VIP crosses their custom recommended cycle index (e.g. 45 days), our Gemini AI model crafts private, respectful, hyper-personalized VIP concierge drafts.
            </p>
            <p className="text-sm font-light text-gray-400 leading-relaxed">
              Delivered straight to their private WhatsApp lines with single-click reservation links connected to the escrow bank engine.
            </p>
          </div>

        </div>
      </section>

      {/* 7. BILLION-RUPEE FOUNDER'S VIP APPLICATION SECTION */}
      <section id="apply-lounge" className="py-24 px-6 bg-[#050505] relative z-20">
        
        {/* Subtle circular ambient backdrop */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#D4AF37]/5 rounded-full pointer-events-none filter blur-2xl"></div>

        <div className="max-w-4xl mx-auto glass-slate-card p-8 md:p-12 rounded-xl text-center border-2 border-[#D4AF37]/35 relative" id="invite-application-form">
          
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <Award className="w-10 h-10 text-[#D4AF37] bg-[#050505] p-2 rounded-full border border-[#D4AF37]" />
          </div>

          <div className="space-y-4 pt-6 max-w-xl mx-auto">
            <span className="text-xs font-mono text-[#D4AF37] tracking-[0.3em] uppercase block">PRIVATE NETWORK ENTRY ENTRY</span>
            <h2 className="text-4xl font-serif font-extralight tracking-tight text-white h-auto pb-1 leading-tight">
              Request Your Invite <span className="italic block text-[#D4AF37] mt-1">into the Nexora Ecosystem</span>
            </h2>
            <p className="text-xs font-light text-gray-400 leading-relaxed">
              Nexora SalonOS does not admit arbitrary businesses. We serve selected top-tier high-fashion salons, elite spas, bespoke tattoo lounges, and luxury studios in premier cities. Complete the structural overview below; our concierge team will review eligibility in 48 hours.
            </p>
          </div>

          <AnimatePresence mode="wait">
            {!isSubmitted ? (
              <motion.form 
                onSubmit={handleApplyForm}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-10 col-span-1 border-t border-white/10 pt-8 text-left grid grid-cols-1 md:grid-cols-2 gap-6"
                key="form-entry"
              >
                
                <div className="space-y-2">
                  <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase block">Salon Founder Full Name</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      required
                      className="w-full bg-[#0C0C0C] border border-[#D4AF37]/25 rounded px-4 py-3 text-xs text-white uppercase focus:outline-none focus:border-[#D4AF37] tracking-wider"
                      placeholder="e.g. Vikramaditya Sen"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      id="input-full-name"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase block">Private WhatsApp Contact Line</label>
                  <div className="relative">
                    <input 
                      type="tel" 
                      required
                      pattern="[0-9]{10}"
                      className="w-full bg-[#0C0C0C] border border-[#D4AF37]/25 rounded px-4 py-3 text-xs text-white focus:outline-none focus:border-[#D4AF37] font-mono"
                      placeholder="Enter 10-digit smartphone line"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value.replace(/\D/g, '').slice(0,10))}
                      id="input-phone"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase block">Atelier Location (City)</label>
                  <select 
                    className="w-full bg-[#0C0C0C] border border-[#D4AF37]/25 rounded px-4 py-3 text-xs text-[#D4AF37] focus:outline-none focus:border-[#D4AF37] uppercase tracking-wider"
                    value={inviteCity}
                    onChange={(e) => setInviteCity(e.target.value)}
                    id="input-city-select"
                  >
                    <option value="Mumbai">Mumbai Alliance</option>
                    <option value="Delhi">Delhi NCR Lounge</option>
                    <option value="Bengaluru">Bengaluru Tech Hub</option>
                    <option value="Jaipur">Jaipur Royal Sector</option>
                    <option value="Goa">Goa Retreat Circle</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono tracking-widest text-gray-400 uppercase block">Monthly Estimated Brand Turnover</label>
                  <select
                    className="w-full bg-[#0C0C0C] border border-[#D4AF37]/25 rounded px-4 py-3 text-xs text-[#D4AF37] focus:outline-none focus:border-[#D4AF37] uppercase tracking-wider"
                    value={inviteTurnover}
                    onChange={(e) => setInviteTurnover(e.target.value)}
                    id="input-turnover-select"
                  >
                    <option value="Under ₹15L">Under ₹15L Monthly</option>
                    <option value="₹15L - ₹50L">₹15L - ₹50L Monthly</option>
                    <option value="₹50L - ₹1.5Cr">₹50L - ₹1.5Cr Monthly</option>
                    <option value="Above ₹1.5Cr">Above ₹1.5Cr Enterprise</option>
                  </select>
                </div>

                <div className="md:col-span-2 pt-4">
                  <button
                    type="submit"
                    disabled={loadingForm}
                    className="w-full py-4 metallic-button-strong uppercase text-xs tracking-[0.25em] font-bold rounded flex items-center justify-center space-x-2"
                    id="input-submit-form"
                  >
                    {loadingForm ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        <span>VERIFYING BRAND METRICS...</span>
                      </>
                    ) : (
                      <>
                        <span>TRANSMIT PRIVILEGE DOSSIER</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  <p className="text-[9px] text-gray-500 font-mono text-center mt-3 uppercase tracking-wider">
                    BY SUBMITTING, YOU CERTIFY THE ACCURACY OF ALL LISTED BUSINESS LEDGERS.
                  </p>
                </div>

              </motion.form>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-10 border-t border-[#D4AF37]/30 pt-8 space-y-6 max-w-md mx-auto"
                key="form-success"
              >
                
                <div className="w-12 h-12 bg-emerald-500/15 rounded-full border border-emerald-500 flex items-center justify-center mx-auto shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                  <Check className="w-6 h-6 text-emerald-400" />
                </div>

                <div className="space-y-2">
                  <span className="text-[9px] font-mono text-[#D4AF37] uppercase tracking-[0.3em]">DOSSIER TRANSMITTED SECURELY</span>
                  <h3 className="text-xl font-serif text-white uppercase tracking-wider">Invitation Review Active</h3>
                  <p className="text-xs font-light text-gray-400">
                    Bespoke credentials registered for founder <span className="text-[#D4AF37] font-semibold">{inviteName || 'VIP Guest'}</span> on phone line <span className="text-white font-mono">{invitePhone || 'xxxxxxxxxx'}</span>. A master account manager will contact you on WhatsApp to audit your monthly ledgers.
                  </p>
                </div>

                <div className="bg-[#0A0A0A] p-4 rounded border border-[#D4AF37]/20 text-left space-y-2 font-mono text-[10px]">
                  <p className="text-[#D4AF37] uppercase font-bold text-center">NEXT STEPS AUDIT PANEL</p>
                  <div className="flex justify-between text-gray-400">
                    <span>A. Location Registration:</span>
                    <span className="text-white">{inviteCity} (Alliance approved)</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>B. Revenue Multiplier index:</span>
                    <span className="text-white">{inviteTurnover}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>C. Secure Wallet allocation:</span>
                    <span className="text-emerald-400">APPROVED PENDING VERIFICATION</span>
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setIsSubmitted(false)}
                    className="metallic-button py-2.5 px-6 text-xs uppercase tracking-widest rounded"
                    id="back-to-apply-btn"
                  >
                    Transmit Another Dossier
                  </button>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </section>

      {/* 8. MAJESTIC VISUAL CHRONO GALLERY / FOOTER */}
      <footer className="bg-[#050505] pt-20 pb-12 border-t border-[#D4AF37]/25 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 pb-16 border-b border-white/5">
            
            {/* BRAND CROWN */}
            <div className="space-y-6">
              <span className="font-serif tracking-[0.25em] text-lg font-light text-[#D4AF37] block">
                NEXORA <span className="text-white font-sans font-semibold tracking-wider text-xs select-none bg-[#D4AF37]/10 px-2 py-0.5 rounded ml-1 border border-[#D4AF37]/25">SALONOS</span>
              </span>
              
              <p className="text-xs font-light text-gray-500 leading-relaxed">
                Pehle Nexora, Phir Salon. We construct absolute digital prestige, beautiful pre-designed layouts, and secure counter settlements for India's high-fashion salon houses.
              </p>

              <div className="flex space-x-3">
                <span className="text-xs font-mono text-gray-650 px-2 py-1 rounded bg-[#0a0a0a] border border-[#D4AF37]/20 text-[#D4AF37] uppercase tracking-widest">
                  CHRONO V-2.4 LUXURY EDITION
                </span>
              </div>
            </div>

            {/* PRODUCT NAV */}
            <div className="space-y-4 font-mono text-[11px] uppercase tracking-wider">
              <h5 className="text-white text-xs font-serif font-light tracking-widest text-[#D4AF37] select-none">ARCHITECTURE</h5>
              <ul className="space-y-2.5 text-gray-400">
                <li><a href="#designer" className="hover:text-white transition-colors">White-Label builder</a></li>
                <li><a href="#escrow-section" className="hover:text-white transition-colors">Booking Escrow Vault</a></li>
                <li><a href="#qr-section" className="hover:text-white transition-colors">Gold Counter QR Display</a></li>
                <li><a href="#ai-defense" className="hover:text-white transition-colors">AI WhatsApp Concierge</a></li>
                <li>
                  <button 
                    onClick={() => { setViewMode('admin'); window.location.hash = 'admin'; }} 
                    className="text-[#D4AF37] hover:underline flex items-center gap-1 font-semibold transition-colors"
                  >
                    ★ Admin Panel #22 (HQ Live)
                  </button>
                </li>
              </ul>
            </div>

            {/* ALLIANCES */}
            <div className="space-y-4 font-mono text-[11px] uppercase tracking-wider">
              <h5 className="text-white text-xs font-serif font-light tracking-widest text-[#D4AF37] select-none">ELITE SECTORS</h5>
              <ul className="space-y-2.5 text-gray-400">
                <li><span className="text-gray-500">L'Étoile Hair Houses — Mumbai</span></li>
                <li><span className="text-gray-500">AURA thermal sanctuaries — Delhi NCR</span></li>
                <li><span className="text-gray-500">The Obsidian illustrative studios — Jaipur</span></li>
                <li><span className="text-gray-500">Silk & Ivory Nail lounges — Bengaluru</span></li>
              </ul>
            </div>

            {/* PRIVATE CONCIERGE */}
            <div className="space-y-4">
              <h5 className="text-[#D4AF37] text-xs font-serif font-light tracking-widest uppercase font-mono">PRIVATE DESK</h5>
              <p className="text-xs font-light text-gray-400 leading-relaxed">
                Nexora SalonOS Corporate chambers, Sector 3, Bandra Kurla Complex, Mumbai, India.
              </p>
              <div className="text-xs font-mono text-gray-500">
                <p>concierge@nexorasalonos.com</p>
                <p className="mt-1">+91 (Elite line only)</p>
              </div>
            </div>

          </div>

          <div className="pt-8 flex flex-col sm:flex-row justify-between items-center text-[10px] font-mono text-gray-600 gap-4">
            <div>
              <p>© 2026 NEXORA SALONOS COUTURE. ALL RIGHTS RESERVED DIRECTLY TO THE ECOSYSTEM.</p>
            </div>
            <div className="flex space-x-6">
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Prestige</span>
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Ledgers</span>
              <span className="hover:text-white cursor-pointer transition-colors">Friction Audit Report</span>
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
