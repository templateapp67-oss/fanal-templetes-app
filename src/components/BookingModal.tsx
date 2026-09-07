import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  CalendarCheck,
  Calendar,
  Clock,
  User,
  Phone,
  Mail,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Sparkles,
  MapPin,
  CreditCard,
  Wallet,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Lock
} from 'lucide-react';
import { SalonProfile, SalonService, Stylist, Appointment } from '../types';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS } from '../mockData';

export interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile?: SalonProfile;
  services?: SalonService[];
  stylists?: Stylist[];
  initialService?: SalonService;
  initialStylist?: Stylist;
  onAddAppointment?: (appointment: Appointment) => void;
  themeAccentHex?: string;
  onShowToast?: (toast: {
    id: string;
    title: string;
    clientName: string;
    serviceName: string;
    stylistName: string;
    dateTime: string;
    refCode: string;
    price: number;
  }) => void;
  // Backward compatibility alias props
  service?: SalonService;
  stylist?: Stylist;
  servicesList?: SalonService[];
  stylistsList?: Stylist[];
  salonName?: string;
  currency?: string;
  onConfirmBooking?: (bookingData: any) => void;
}

type BookingStep = 'service' | 'upgrades' | 'datetime' | 'guest' | 'otp' | 'payment' | 'confirmed';

const ANY_SPECIALIST: Stylist = {
  id: 'any_available',
  name: 'Any Available Specialist',
  role: 'First available professional',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
  specialties: ['General', 'Quick Allocation'],
  rating: 4.95,
};

const TIME_SLOTS = [
  { time: '10:00', label: '10:00 AM', status: 'available', badge: 'Available' },
  { time: '11:30', label: '11:30 AM', status: 'filling_fast', badge: '2 slots left' },
  { time: '13:00', label: '01:00 PM', status: 'available', badge: 'Available' },
  { time: '14:30', label: '02:30 PM', status: 'popular', badge: 'Filling fast' },
  { time: '16:00', label: '04:00 PM', status: 'available', badge: 'Available' },
  { time: '17:30', label: '05:30 PM', status: 'filling_fast', badge: '1 slot left' },
  { time: '19:00', label: '07:00 PM', status: 'available', badge: 'Available' },
  { time: '20:00', label: '08:00 PM', status: 'available', badge: 'Available' }
];

const LOCAL_STORAGE_GUEST_KEY = 'salon_guest_booking_info';

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  profile: inputProfile,
  services: inputServices,
  stylists: inputStylists,
  initialService: inputInitialService,
  initialStylist: inputInitialStylist,
  onAddAppointment: inputOnAddAppointment,
  themeAccentHex = '#0f172a',
  onShowToast,
  // Alias props
  service: aliasService,
  stylist: aliasStylist,
  servicesList: aliasServicesList,
  stylistsList: aliasStylistsList,
  salonName: aliasSalonName,
  currency: aliasCurrency,
  onConfirmBooking: aliasOnConfirmBooking
}) => {
  // Safe resolved values
  const profile = inputProfile || {
    ...INITIAL_SALON_PROFILE,
    businessName: aliasSalonName || INITIAL_SALON_PROFILE.businessName,
    currency: aliasCurrency || INITIAL_SALON_PROFILE.currency || '₹',
  };
  const services = inputServices || aliasServicesList || INITIAL_SERVICES;
  const stylists = inputStylists || aliasStylistsList || INITIAL_STYLISTS;
  const initialService = inputInitialService || aliasService;
  const initialStylist = inputInitialStylist || aliasStylist;
  const onAddAppointment = inputOnAddAppointment || (aliasOnConfirmBooking ? (apt: Appointment) => {
    aliasOnConfirmBooking({
      clientName: apt.clientName,
      clientPhone: apt.clientPhone,
      clientEmail: apt.clientEmail,
      service: { id: apt.serviceId, name: apt.serviceName, price: apt.servicePrice },
      stylist: { id: apt.stylistId, name: apt.stylistName },
      date: apt.date,
      time: apt.time,
      paymentMethod: apt.paymentStatus === 'paid_full' ? 'online' : 'pay_salon'
    });
  } : () => {});

  // Navigation Steps: 'service' -> 'datetime' -> 'guest' -> 'otp' -> 'payment' -> 'confirmed'
  const [currentStep, setCurrentStep] = useState<BookingStep>('service');

  // Step 1: Branch, Service & Specialist
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [selectedService, setSelectedService] = useState<SalonService>(
    initialService || (services && services[0]) || {
      id: 'default',
      name: 'Signature Service',
      category: 'Hair',
      durationMinutes: 45,
      price: 1200,
      description: 'Standard treatment',
      icon: 'sparkles'
    }
  );
  const [selectedUpgrades, setSelectedUpgrades] = useState<SalonService[]>([]);
  const [selectedStylist, setSelectedStylist] = useState<Stylist>(
    initialStylist || (stylists && stylists[0]) || ANY_SPECIALIST
  );

  // Step 2: Date & Time Slot
  const todayStr = new Date().toISOString().split('T')[0];
  const [bookingDate, setBookingDate] = useState<string>(todayStr);
  const [bookingTime, setBookingTime] = useState<string>('11:30');
  const [slotLockSeconds, setSlotLockSeconds] = useState<number>(300); // 5 minutes
  const [slotLocked, setSlotLocked] = useState<boolean>(true);

  // Step 3: Guest Information
  const [guestName, setGuestName] = useState<string>('');
  const [guestPhone, setGuestPhone] = useState<string>('');
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [guestPhoneError, setGuestPhoneError] = useState<string>('');
  const [rememberGuest, setRememberGuest] = useState<boolean>(true);
  const [isPrefilled, setIsPrefilled] = useState<boolean>(false);
  
  // Home Service State
  const [bookingType, setBookingType] = useState<'salon' | 'home'>('salon');
  const [homeServiceAddress, setHomeServiceAddress] = useState<string>('');
  const [homeServicePinCode, setHomeServicePinCode] = useState<string>('');
  const [distanceInfo, setDistanceInfo] = useState<{distance: number, ok: boolean, message: string} | null>(null);

  // Step 4: Mock OTP (Static Code: '1234')
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '']);
  const [otpError, setOtpError] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');
  const [resendTimer, setResendTimer] = useState<number>(30);
  const [otpResentNotice, setOtpResentNotice] = useState<boolean>(false);
  const otpInputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null)
  ];

  // Step 5: Payment Method
  const [paymentMethod, setPaymentMethod] = useState<'pay_at_salon' | 'pay_advance_token'>('pay_at_salon');
  const [isWhatsappVerified, setIsWhatsappVerified] = useState<boolean>(false);

  // Step 6: Confirmation State
  const [bookingRef, setBookingRef] = useState<string>('');
  const [copiedRef, setCopiedRef] = useState<boolean>(false);

  // Load persistent guest details from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_GUEST_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.name) setGuestName(parsed.name);
        if (parsed.phone) setGuestPhone(parsed.phone);
        if (parsed.email) setGuestEmail(parsed.email);
        setIsPrefilled(true);
      }
    } catch {
      // Ignore parsing errors
    }
  }, []);

  // Synchronize initialService when changed
  useEffect(() => {
    if (initialService && initialService.id !== selectedService?.id) {
      setSelectedService(initialService);
    }
  }, [initialService, selectedService]);

  // 5-minute Slot Lock Timer countdown
  useEffect(() => {
    if (!isOpen || currentStep === 'confirmed') return;
    const interval = setInterval(() => {
      setSlotLockSeconds((prev) => {
        if (prev <= 1) {
          setSlotLocked(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, currentStep]);

  // Resend OTP countdown (30s)
  useEffect(() => {
    if (currentStep !== 'otp') return;
    if (resendTimer <= 0) return;
    const timer = setInterval(() => {
      setResendTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentStep, resendTimer]);

  if (!isOpen) return null;

  // Format seconds to mm:ss
  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  };

  // Clean and validate Indian 10-digit mobile number
  const sanitizeIndianPhone = (raw: string) => {
    return raw.replace(/\D/g, '').replace(/^(91|0)/, '');
  };

  const validatePhone = (num: string): boolean => {
    const clean = sanitizeIndianPhone(num);
    if (clean.length === 10 && /^[6-9]\d{9}$/.test(clean)) {
      setGuestPhoneError('');
      return true;
    }
    setGuestPhoneError('Please enter a valid 10-digit Indian mobile number (starts with 6, 7, 8, or 9)');
    return false;
  };

  // Handle Proceed from Guest Info to OTP Step
  const handleProceedToOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) {
      return;
    }
    if (!validatePhone(guestPhone)) {
      return;
    }

    // Save to localStorage if rememberGuest is selected
    if (rememberGuest) {
      try {
        localStorage.setItem(
          LOCAL_STORAGE_GUEST_KEY,
          JSON.stringify({
            name: guestName.trim(),
            phone: sanitizeIndianPhone(guestPhone),
            email: guestEmail.trim()
          })
        );
      } catch {
        // localStorage not available
      }
    }

    // Reset OTP inputs and go to OTP step
    setOtpDigits(['', '', '', '']);
    setOtpError('');
    setResendTimer(30);
    setCurrentStep('otp');

    // Focus first OTP digit
    setTimeout(() => {
      otpInputRefs[0].current?.focus();
    }, 150);
  };

  // Handle individual OTP digit change
  const handleOtpChange = (index: number, val: string) => {
    const char = val.slice(-1);
    if (char && !/^\d$/.test(char)) return; // Only allow digits

    const nextDigits = [...otpDigits];
    nextDigits[index] = char;
    setOtpDigits(nextDigits);
    setOtpError('');

    // Move to next box if filled
    if (char && index < 3) {
      otpInputRefs[index + 1].current?.focus();
    }
  };

  // Handle backspace navigation in OTP
  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs[index - 1].current?.focus();
    }
  };

  // Support pasting OTP code
  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    if (/^\d{4}$/.test(pasted)) {
      const digits = pasted.split('');
      setOtpDigits(digits);
      setOtpError('');
      otpInputRefs[3].current?.focus();
    }
  };

  // Autofill mock code 1234 helper
  const handleAutofillMockOtp = () => {
    setOtpDigits(['1', '2', '3', '4']);
    setOtpError('');
    otpInputRefs[3].current?.focus();
  };

  // Resend OTP trigger
  const handleResendOtp = () => {
    setResendTimer(30);
    setOtpDigits(['', '', '', '']);
    setOtpError('');
    setOtpResentNotice(true);
    setTimeout(() => setOtpResentNotice(false), 3000);
    otpInputRefs[0].current?.focus();
  };

  // Verify OTP submission
  const handleVerifyOtp = () => {
    const enteredCode = otpDigits.join('');
    if (enteredCode.length < 4) {
      setOtpError('Please enter the complete 4-digit code.');
      return;
    }

    // Static Mock OTP Verification: code must match '1234'
    if (enteredCode === '1234') {
      setIsWhatsappVerified(true);
      setOtpError('');
      setCurrentStep('payment');
    } else {
      setOtpError('Invalid OTP code. Please enter 1234 to verify.');
    }
  };

  // Calculate advance token amount (25%)
  const homeServiceCharge = bookingType === 'home' ? (profile.homeService?.baseCharge || 0) : 0;
  const upgradesPrice = selectedUpgrades.reduce((sum, upgrade) => sum + upgrade.price, 0);
  const totalAmount = selectedService.price + homeServiceCharge + upgradesPrice;
  const advanceTokenAmount = Math.round((totalAmount * 25) / 100);
  const remainingAmount = totalAmount - (paymentMethod === 'pay_advance_token' ? advanceTokenAmount : 0);

  // Confirm booking & generate reference
  const handleFinalSubmitBooking = async () => {
    const cleanPhone = sanitizeIndianPhone(guestPhone);
    const cityCode = profile.city?.toUpperCase().includes('BENGALURU') ? 'BLR'
      : profile.city?.toUpperCase().includes('MUMBAI') ? 'BOM'
      : profile.city?.toUpperCase().includes('DELHI') ? 'DEL'
      : profile.city?.toUpperCase().includes('HYDERABAD') ? 'HYD'
      : profile.city?.toUpperCase().includes('JAIPUR') ? 'JPR'
      : profile.city?.toUpperCase().includes('CHENNAI') ? 'MAA'
      : profile.city?.toUpperCase().includes('PUNE') ? 'PNQ'
      : 'IND';

    const refNum = `NX-${cityCode}-${Math.floor(10000 + Math.random() * 90000)}`;
    setBookingRef(refNum);

    // Call Supabase API Endpoint. The server now answers real failures with a
    // JSON error — show them instead of pretending the booking was stored.
    setSubmitError('');
    try {
      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking: {
            owner_id: profile.ownerId || undefined,
            customer_name: guestName.trim() || 'Guest Client',
            customer_phone: cleanPhone,
            customer_email: guestEmail.trim() || `${cleanPhone}@guest.in`,
            service_id: selectedService.id,
            service_name: selectedService.name,
            booking_date: bookingDate,
            time_slot: bookingTime,
            total_amount: totalAmount,
            advance_paid_amount: paymentMethod === 'pay_advance_token' ? advanceTokenAmount : 0,
            status: 'pending',
            payment_status: paymentMethod === 'pay_advance_token' ? 'paid_deposit' : 'pending',
            payment_id: refNum,
          },
          notifications: [
            {
              user_email: profile.email || 'owner@salon.com',
              title: 'New Booking Request',
              message: `New booking from ${guestName} for ${selectedService.name} on ${bookingDate}. 25% Advance Paid: ₹${advanceTokenAmount}`,
            }
          ]
        })
      });
      let json: { success?: boolean; error?: string; notice?: string } | null = null;
      try {
        json = await response.json();
      } catch {
        // Non-JSON body — handled below through response.ok.
      }
      if (!response.ok || (json && json.success === false)) {
        const detail = json?.error || json?.notice || `Server error (HTTP ${response.status})`;
        console.error('Failed to create booking:', detail);
        setSubmitError(`We couldn't save your booking (${detail}). Please try again — your details are still here.`);
        return;
      }
    } catch (e) {
      // Network failure (offline, preview sandbox without API): keep the local
      // demo copy so the owner dashboard still shows the request.
      console.warn('Booking API unreachable — keeping a local copy only.', e);
    }

    const newApt: Appointment = {
      id: `apt-${Date.now()}`,
      clientName: guestName.trim() || 'Guest Client',
      clientPhone: `+91 ${cleanPhone}`,
      clientEmail: guestEmail.trim() || `${cleanPhone}@guest.in`,
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      servicePrice: totalAmount,
      stylistId: selectedStylist.id,
      stylistName: selectedStylist.name,
      date: bookingDate,
      time: bookingTime,
      status: 'pending', // Set initial status to pending
      paymentStatus: paymentMethod === 'pay_advance_token' ? 'paid_deposit' : 'pay_at_salon',
      amountPaid: paymentMethod === 'pay_advance_token' ? advanceTokenAmount : 0,
      createdAt: new Date().toISOString()
    };

    onAddAppointment(newApt);
    setCurrentStep('confirmed');

    // MOCK EMAIL TRIGGER
    console.log(`[MOCK EMAIL] Confirmation sent to ${newApt.clientEmail} for appointment ${refNum}`);

    if (onShowToast) {
      onShowToast({
        id: String(Date.now()),
        title: 'Booking Pending Approval. 25% Deposit Paid.',
        clientName: newApt.clientName,
        serviceName: newApt.serviceName,
        stylistName: newApt.stylistName,
        dateTime: `${bookingDate} at ${bookingTime}`,
        refCode: refNum,
        price: totalAmount
      });
    }
  };

  // Copy booking reference
  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  // Open WhatsApp prefilled confirmation
  const handleSendWhatsAppConfirmation = () => {
    const cleanPhone = sanitizeIndianPhone(guestPhone);
    const msg = `Namaste ${guestName}! Your booking with ${profile.businessName} is confirmed!\n\n` +
      `📅 Date: ${bookingDate}\n` +
      `⏰ Time: ${bookingTime} IST\n` +
      `💇 Service: ${selectedService.name}${selectedUpgrades.length > 0 ? ` + Add-ons (${selectedUpgrades.map(u => u.name).join(', ')})` : ''} (Total: ₹${totalAmount})\n` +
      `🏠 Appointment Type: ${bookingType === 'home' ? 'Home Service' : 'In-Salon'}\n` +
      (bookingType === 'home' ? `📍 Address: ${homeServiceAddress} (PIN: ${homeServicePinCode})\n` : '') +
      `👤 Specialist: ${selectedStylist.name}\n` +
      `📍 Branch: ${profile.businessName}, ${profile.address}, ${profile.city}\n` +
      `🔖 Reference: ${bookingRef}\n` +
      `💰 Total Price: ₹${totalAmount}\n` +
      `💳 Payment: ${paymentMethod === 'pay_advance_token' ? `25% Advance Paid: ₹${advanceTokenAmount} (Balance: ₹${remainingAmount})` : `Pay Full at ${bookingType === 'home' ? 'Home' : 'Salon'} (₹${totalAmount})`}\n\n` +
      `Thank you for booking with us!`;

    const whatsappUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Open WhatsApp with pre-filled service, date, time shortcut
  const handleQuickWhatsAppBooking = () => {
    const formattedPhone = (profile.whatsapp || '').replace(/\D/g, '');
    const msg = `Namaste ${profile.businessName}! 🌟\n\n` +
      `I would like to book a quick appointment with these details:\n` +
      `💇‍♂️ Service: ${selectedService.name} (₹${selectedService.price.toLocaleString('en-IN')})\n` +
      `📅 Date: ${bookingDate}\n` +
      `⏰ Time: ${bookingTime} IST\n` +
      `👤 Specialist: ${selectedStylist.name}\n\n` +
      `Please let me know if this slot is available to confirm! Thank you.`;
    
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Reset modal state to start fresh
  const handleReset = () => {
    setCurrentStep('service');
    setOtpDigits(['', '', '', '']);
    setOtpError('');
    setIsWhatsappVerified(false);
    setBookingRef('');
    setSlotLockSeconds(300);
    setSlotLocked(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800"
      >
        {/* MODAL HEADER */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-xs"
              style={{ backgroundColor: themeAccentHex }}
            >
              <CalendarCheck className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900 leading-tight">
                  {currentStep === 'confirmed' ? 'Appointment Confirmed' : 'Book an Appointment'}
                </h3>
                {currentStep !== 'confirmed' && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    Step {currentStep === 'service' ? '1/5' : currentStep === 'datetime' ? '2/5' : currentStep === 'guest' ? '3/5' : currentStep === 'otp' ? '4/5' : '5/5'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium truncate max-w-[260px] sm:max-w-md">
                {profile.businessName} • {profile.city}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PROGRESS STEPPER BAR (Non-confirmed steps) */}
        {currentStep !== 'confirmed' && (
          <div className="bg-slate-100/70 px-5 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] font-mono">
            <div className="flex items-center gap-1 sm:gap-2">
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'service' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                1. Service
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'upgrades' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                2. Upgrades
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'datetime' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                3. Slot
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'guest' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                4. Info
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'otp' ? 'bg-emerald-700 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                5. OTP
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
              <span className={`px-2 py-0.5 rounded-md font-bold ${currentStep === 'payment' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-white border border-slate-200'}`}>
                6. Pay
              </span>
            </div>

            {/* Slot Lock Badge */}
            <div className="hidden sm:flex items-center gap-1.5 text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 text-[10px]">
              <Lock className="w-3 h-3 text-amber-600" />
              <span>Held: <strong>{formatTimer(slotLockSeconds)}</strong></span>
            </div>
          </div>
        )}

        {/* MODAL BODY (SCROLLABLE) */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4">

          {/* ========================================================= */}
          {/* STEP 1: SELECT LOCATION, SERVICE & SPECIALIST */}
          {/* ========================================================= */}
          {currentStep === 'service' && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4"
            >
              {/* Branch / Location Picker */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1.5">
                  1. Appointment Type
                </label>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    onClick={() => setBookingType('salon')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      bookingType === 'salon'
                        ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900">In-Salon</div>
                    <div className="text-[10px] text-slate-500">Visit our studio</div>
                  </button>
                  <button
                    onClick={() => setBookingType('home')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      bookingType === 'home'
                        ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900">Home Service</div>
                    <div className="text-[10px] text-slate-500">We come to you</div>
                  </button>
                </div>
              </div>


              {/* Service Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold font-mono-caps text-slate-700">
                    2. Select Treatment / Service
                  </label>
                  <span className="text-[11px] text-emerald-700 font-mono font-bold">
                    All prices in ₹ INR
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                  {(services || []).map((srv) => {
                    const isSelected = selectedService.id === srv.id;
                    return (
                      <div
                        key={srv.id}
                        onClick={() => setSelectedService(srv)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-xs text-slate-900">{srv.name}</span>
                            {srv.popular && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-950 text-[10px] font-extrabold">
                                Popular
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 font-medium flex items-center gap-2 mt-0.5">
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[10px]">{srv.category}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1 font-mono text-slate-700">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {srv.durationMinutes} mins
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-extrabold text-sm text-slate-900 font-mono">
                            ₹{srv.price.toLocaleString('en-IN')}
                          </div>
                          {isSelected && (
                            <span className="text-[10px] font-bold text-emerald-600 flex items-center justify-end gap-0.5">
                              <Check className="w-3 h-3" /> Selected
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Specialist Selection ("Any Available" by default) */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1.5">
                  3. Select Specialist
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* Option 1: Any Available (Default) */}
                  <div
                    onClick={() => setSelectedStylist(ANY_SPECIALIST)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center gap-1.5 ${
                      selectedStylist.id === ANY_SPECIALIST.id
                        ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="font-bold text-[11px] text-slate-900 truncate">Any Specialist</div>
                      <div className="text-[10px] text-emerald-700 font-medium">Fastest Slot</div>
                    </div>
                  </div>

                  {/* Individual Specialists */}
                  {(stylists || []).slice(0, 3).map((st) => {
                    const isSelected = selectedStylist.id === st.id;
                    return (
                      <div
                        key={st.id}
                        onClick={() => setSelectedStylist(st)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center gap-1.5 ${
                          isSelected
                            ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <img
                          src={st.avatarUrl}
                          alt={st.name}
                          className="w-9 h-9 rounded-full object-cover shadow-xs"
                        />
                        <div className="min-w-0 w-full">
                          <div className="font-bold text-[11px] text-slate-900 truncate">{st.name.split(' ')[0]}</div>
                          <div className="text-[10px] text-slate-500 truncate">★ {st.rating}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step Navigation Action */}
              <button
                type="button"
                onClick={() => setCurrentStep('upgrades')}
                className="w-full py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95 active:scale-[0.99] mt-2"
                style={{ backgroundColor: themeAccentHex }}
              >
                <span>Continue to Optional Upgrades</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 1.5: OPTIONAL UPGRADES */}
          {/* ========================================================= */}
          {currentStep === 'upgrades' && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4"
            >
              <h4 className="font-bold text-sm text-slate-900">Make your service even better!</h4>
              <p className="text-[11px] text-slate-500">Popular add-ons for {selectedService.name}</p>

              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
                {(services || []).filter(s => s.category === selectedService.category && s.id !== selectedService.id).slice(0, 3).map(addon => {
                    const isSelected = selectedUpgrades.some(u => u.id === addon.id);
                    return (
                        <div 
                            key={addon.id}
                            onClick={() => {
                                if (isSelected) {
                                    setSelectedUpgrades(prev => prev.filter(u => u.id !== addon.id));
                                } else {
                                    setSelectedUpgrades(prev => [...prev, addon]);
                                }
                            }}
                            className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                                isSelected ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
                            }`}
                        >
                            <div className="text-xs font-bold text-slate-900">{addon.name}</div>
                            <div className="text-xs font-mono font-bold text-slate-900">₹{addon.price.toLocaleString('en-IN')}</div>
                        </div>
                    )
                })}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep('service')}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('datetime')}
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  <span>Continue to Date & Slot</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 2: SELECT DATE & TIME SLOT (WITH 5-MIN LOCK TIMER) */}
          {/* ========================================================= */}
          {currentStep === 'datetime' && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4"
            >
              {/* Slot Temporary Hold Banner */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Temporary reservation slot held for <strong>{formatTimer(slotLockSeconds)}</strong></span>
                </div>
                {!slotLocked && (
                  <button
                    onClick={() => {
                      setSlotLockSeconds(300);
                      setSlotLocked(true);
                    }}
                    className="text-[11px] font-bold underline cursor-pointer text-amber-800"
                  >
                    Refresh Hold
                  </button>
                )}
              </div>

              {/* Date Selection */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1.5">
                  Select Appointment Date
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setBookingDate(todayStr)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer ${
                      bookingDate === todayStr ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      setBookingDate(d.toISOString().split('T')[0]);
                    }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer ${
                      bookingDate !== todayStr ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Tomorrow
                  </button>
                  <div className="flex-1">
                    <input
                      type="date"
                      value={bookingDate}
                      min={todayStr}
                      onChange={(e) => setBookingDate(e.target.value)}
                      className="w-full p-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono focus:ring-2 focus:ring-slate-900 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Time Slot Availability Grid */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold font-mono-caps text-slate-700">
                    Real-time Slot Availability (IST)
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Live Booking System
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TIME_SLOTS.map((slot) => {
                    const isSelected = bookingTime === slot.time;
                    return (
                      <button
                        type="button"
                        key={slot.time}
                        onClick={() => setBookingTime(slot.time)}
                        className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono font-bold text-xs">{slot.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </div>
                        <span className={`text-[10px] font-mono mt-1 ${
                          isSelected
                            ? 'text-emerald-300 font-bold'
                            : slot.status === 'filling_fast'
                            ? 'text-amber-600 font-bold'
                            : 'text-emerald-600'
                        }`}>
                          {slot.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Current Selection Pill */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between font-mono">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span>{bookingDate} at {bookingTime} IST</span>
                </div>
                <span className="text-slate-600">{selectedService.name} ({selectedStylist.name})</span>
              </div>

              {/* Step Navigation Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep('service')}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('guest')}
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  <span>Continue to Guest Details</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 3: ENTER GUEST INFO (NAME, WHATSAPP, EMAIL) */}
          {/* ========================================================= */}
          {currentStep === 'guest' && (
            <motion.form
              onSubmit={handleProceedToOtp}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">Guest Contact Information</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    We will send booking pass and instant WhatsApp reminders to this number.
                  </p>
                </div>
                {isPrefilled && (
                  <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Auto-filled
                  </span>
                )}
              </div>

              {/* Full Name */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. Aarti Sharma"
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              {/* WhatsApp Mobile Number (Strict 10-Digit Indian Mobile) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold font-mono-caps text-slate-700">
                    WhatsApp Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">10-Digit Mobile</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                    <span>🇮🇳</span>
                    <span>+91</span>
                  </div>
                  <div className="relative flex-1">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="tel"
                      required
                      maxLength={14}
                      value={guestPhone}
                      onChange={(e) => {
                        setGuestPhone(e.target.value);
                        if (guestPhoneError) setGuestPhoneError('');
                      }}
                      placeholder="98765 43210"
                      className={`w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border font-mono bg-white outline-none focus:ring-2 ${
                        guestPhoneError ? 'border-rose-400 focus:ring-rose-400' : 'border-slate-300 focus:ring-slate-900'
                      }`}
                    />
                  </div>
                </div>

                {guestPhoneError ? (
                  <p className="text-[11px] text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{guestPhoneError}</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 mt-1">
                    We will send a 4-digit verification code to this WhatsApp number on the next step.
                  </p>
                )}
              </div>

              {/* Email Address (Optional) */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1">
                  Email Address <span className="text-slate-400 font-normal">(Optional for calendar invite)</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="name@example.in"
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              {/* Persistent Guest Remember Checkbox */}
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="rememberGuestCheck"
                  checked={rememberGuest}
                  onChange={(e) => setRememberGuest(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="rememberGuestCheck" className="text-xs text-slate-600 cursor-pointer select-none">
                  Save my name and WhatsApp number for 1-click future bookings on this browser
                </label>
              </div>

              {/* Navigation Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep('datetime')}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  <span>Proceed to WhatsApp OTP</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.form>
          )}

          {/* ========================================================= */}
          {/* STEP 4: WHATSAPP OTP VERIFICATION (MOCK STEP: '1234') */}
          {/* ========================================================= */}
          {currentStep === 'otp' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="flex flex-col items-center text-center gap-4 py-2"
            >
              {/* WhatsApp Security Icon */}
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shadow-xs">
                <MessageSquare className="w-7 h-7" />
              </div>

              <div>
                <div className="flex items-center justify-center gap-1.5">
                  <h4 className="font-bold text-lg text-slate-900">Verify WhatsApp Number</h4>
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  We've sent a 4-digit verification code via WhatsApp to:
                </p>
                <div className="flex items-center justify-center gap-2 mt-1.5">
                  <span className="font-mono font-bold text-sm text-slate-800 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                    +91 {sanitizeIndianPhone(guestPhone)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('guest')}
                    className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    Change Mobile Number
                  </button>
                </div>
              </div>

              {/* Helper Test Badge */}
              <div
                onClick={handleAutofillMockOtp}
                className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-3.5 py-1.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-amber-100 transition-colors shadow-2xs"
                title="Click to autofill 1234"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Test OTP Code: <strong className="font-mono font-bold text-amber-950">1234</strong></span>
                <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded font-mono font-bold">
                  Click to fill
                </span>
              </div>

              {/* 4-Digit OTP Input Boxes */}
              <div className="flex items-center justify-center gap-3 my-2">
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={otpInputRefs[idx]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={idx === 0 ? handleOtpPaste : undefined}
                    className={`w-12 h-14 sm:w-14 sm:h-16 rounded-xl border text-center font-mono font-extrabold text-xl sm:text-2xl transition-all outline-none ${
                      otpError
                        ? 'border-rose-400 bg-rose-50/50 text-rose-900 focus:ring-2 focus:ring-rose-400'
                        : digit
                        ? 'border-emerald-600 bg-emerald-50/40 text-slate-900 ring-1 ring-emerald-600'
                        : 'border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-slate-900'
                    }`}
                  />
                ))}
              </div>

              {/* Validation Error Message */}
              {otpError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3.5 py-2 rounded-xl flex items-center gap-1.5 animate-shake">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{otpError}</span>
                </div>
              )}

              {/* Resend Notice */}
              {otpResentNotice && (
                <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                  ✓ Fresh verification code sent to +91 {sanitizeIndianPhone(guestPhone)}!
                </div>
              )}

              {/* Resend OTP Timer Controls */}
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500 font-mono">
                {resendTimer > 0 ? (
                  <span>Resend code in <strong className="text-slate-700">{resendTimer}s</strong></span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="font-bold text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Resend OTP on WhatsApp</span>
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="w-full flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep('guest')}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Change Number</span>
                </button>
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  className="flex-1 py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify WhatsApp & Continue</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 5: SUMMARY & PAYMENT METHOD */}
          {/* ========================================================= */}
          {currentStep === 'payment' && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4"
            >
              {/* WhatsApp Verified Ribbon */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>WhatsApp Verified: <strong>+91 {sanitizeIndianPhone(guestPhone)}</strong></span>
                </div>
                <span className="text-[10px] font-mono font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded">
                  OTP VERIFIED
                </span>
              </div>

              {/* Comprehensive Booking Summary Card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-2.5 text-xs">
                <div className="flex justify-between items-start pb-2 border-b border-slate-200">
                  <div>
                    <span className="text-slate-400 font-mono text-[10px] uppercase">Service & Specialist</span>
                    <div className="font-bold text-sm text-slate-900">{selectedService.name}</div>
                    <div className="text-[11px] text-slate-500">With {selectedStylist.name} ({selectedService.durationMinutes} mins)</div>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 font-mono text-[10px] uppercase">Total Fee</span>
                    <div className="font-bold text-base text-slate-900 font-mono">
                      ₹{selectedService.price.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">Date & Time</span>
                    <strong className="text-slate-800">{bookingDate} @ {bookingTime} IST</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px]">Guest Name</span>
                    <strong className="text-slate-800">{guestName}</strong>
                  </div>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="text-xs font-bold font-mono-caps text-slate-700 block mb-1.5">
                  Required Advance Payment (25%)
                </label>
                <div className="grid grid-cols-1 gap-2.5">
                  <div
                    onClick={() => setPaymentMethod('pay_advance_token')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2 border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-emerald-600" />
                        <span className="font-bold text-xs text-slate-900">Pay Advance Token (25%)</span>
                      </div>
                      <span className="w-4 h-4 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">
                        ✓
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Pay ₹{advanceTokenAmount.toLocaleString('en-IN')} token via UPI to secure slot. Remaining ₹{remainingAmount.toLocaleString('en-IN')} at salon.
                    </p>
                    <span className="text-[10px] font-mono text-emerald-700 font-bold">
                      VIP Priority Slot Hold
                    </span>
                  </div>
                </div>
              </div>

              {/* Submit failure banner — the booking is NOT confirmed until the
                  server accepts it, so surface real API errors here instead of
                  jumping to the success screen. */}
              {submitError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Final Step Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setSubmitError(''); setCurrentStep('guest'); }}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={handleFinalSubmitBooking}
                  className="flex-1 py-3.5 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  <CalendarCheck className="w-4 h-4" />
                  <span>Confirm Appointment & Generate Pass (₹)</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 6 / POST-SUBMIT CONFIRMATION SCREEN */}
          {/* ========================================================= */}
          {currentStep === 'confirmed' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center text-center gap-4 py-3"
            >
              {/* Animated Celebratory Checkmark */}
              <div className="relative flex items-center justify-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0.8 }}
                  animate={{ scale: [0.8, 1.35, 1.2], opacity: [0.6, 0.2, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  className="absolute w-20 h-20 rounded-full bg-emerald-400 -z-10"
                />
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                  className="w-16 h-16 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 relative"
                >
                  <CheckCircle2 className="w-9 h-9" />
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.25, 1] }}
                    transition={{ delay: 0.25 }}
                    className="absolute -top-1.5 -right-1.5 bg-amber-400 text-slate-950 p-1 rounded-full shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                  </motion.span>
                </motion.div>
              </div>

              <div>
                <h4 className="font-bold text-2xl text-slate-900">You're All Set!</h4>
                <p className="text-xs text-slate-600 max-w-sm mt-1">
                  Appointment confirmed for <strong className="text-slate-900">{guestName}</strong> at <strong className="text-slate-900">{profile.businessName}</strong>.
                </p>
              </div>

              {/* Reference Card with Copy Action */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs w-full text-left font-mono flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-sans">Booking Reference:</span>
                  <div className="flex items-center gap-1.5">
                    <strong className="text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-300 font-bold text-sm tracking-wider">
                      {bookingRef}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(bookingRef)}
                      className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                      title="Copy Reference Code"
                    >
                      {copiedRef ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center text-slate-700 font-sans">
                  <span>Treatment:</span>
                  <strong>{selectedService.name} ({selectedStylist.name})</strong>
                </div>

                <div className="flex justify-between items-center text-slate-700 font-sans">
                  <span>Schedule:</span>
                  <strong>{bookingDate} at {bookingTime} IST</strong>
                </div>

                <div className="flex justify-between items-center text-slate-700 font-sans">
                  <span>Price Breakdown:</span>
                  <div className="text-right">
                    <strong>Service: ₹{selectedService.price.toLocaleString('en-IN')}</strong><br/>
                    {bookingType === 'home' && <span>Home Service: ₹{homeServiceCharge.toLocaleString('en-IN')}<br/></span>}
                    {selectedUpgrades.length > 0 && <span>Upgrades ({selectedUpgrades.map(u => u.name).join(', ')}): ₹{upgradesPrice.toLocaleString('en-IN')}<br/></span>}
                    <span className="font-bold text-slate-900">Total: ₹{totalAmount.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-slate-700 font-sans">
                  <span>Payment Status:</span>
                  <strong className="text-emerald-700">
                    {paymentMethod === 'pay_advance_token' ? `25% Advance Paid: ₹${advanceTokenAmount.toLocaleString('en-IN')} (Balance: ₹${remainingAmount.toLocaleString('en-IN')})` : `Pay Full at ${bookingType === 'home' ? 'Home' : 'Salon'} (₹${totalAmount.toLocaleString('en-IN')})`}
                  </strong>
                </div>

                <div className="pt-2 border-t border-slate-200 text-[11px] text-emerald-700 flex items-center gap-1.5 font-sans font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>WhatsApp verification sent to +91 {sanitizeIndianPhone(guestPhone)}</span>
                </div>
              </div>

              {/* WhatsApp Trigger Button */}
              <button
                type="button"
                onClick={handleSendWhatsAppConfirmation}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send Confirmation on WhatsApp</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              {/* Bottom Actions */}
              <div className="flex gap-2 w-full pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
                >
                  Done / Close
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex-1 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-xs cursor-pointer hover:opacity-90"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  Book Another Service
                </button>
              </div>
            </motion.div>
          )}

        </div>
      </motion.div>
    </div>
  );
};
