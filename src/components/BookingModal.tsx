import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { postBookingWithRetry, getBookingAccessToken } from '../lib/bookingApi';
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
  Check,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Sparkles,
  MapPin,
  CreditCard,
  Wallet,
  AlertCircle,
  ChevronRight,
  Lock,
  Plus,
  Minus
} from 'lucide-react';
import { SalonProfile, SalonService, Stylist, Appointment } from '../types';
import { payAdvanceWithRazorpay, type PaymentGatewayMode, type RazorpayOutcome } from '../lib/razorpayCheckout';
import {
  buildBookingDraft,
  toAdvancePaymentInput,
  recordPaymentAttempt,
  describeBookingDraft,
  draftHomeAddress,
  saveBookingDraft,
  loadBookingDraft,
  clearBookingDraft,
  type BookingDraft,
} from '../lib/bookingDraft';
import { computeAdvanceDeposit, DEFAULT_DEPOSIT_PERCENT } from '../lib/advanceDeposit';
import { BookingConfirmation } from './BookingConfirmation';
import {
  buildConfirmationSummary,
  describeWhatsappConfirmation,
  buildWhatsappConfirmationMessage,
  formatSalonAddress,
  resolveConfirmationStatus,
} from '../lib/bookingConfirmation';

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
  /** The signed-in customer. Booking creation is unavailable without it. */
  user?: { id?: string; email?: string } | null;
  /** Opens the existing login/signup flow without discarding this form. */
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  /**
   * True when the customer opened this modal from their booking history rather
   * than from the service menu. It is the only case where the confirmation
   * page offers a rebook CTA; offering it after a fresh checkout would just
   * duplicate "Book Another Service".
   */
  fromHistory?: boolean;
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

const formatIndianMoney = (value: number) => (value || 0).toLocaleString('en-IN');

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
  onConfirmBooking: aliasOnConfirmBooking,
  user,
  onRequireAuth,
  fromHistory = false,
}) => {
  // Safe resolved values.
  //
  // These used to fall back to INITIAL_SALON_PROFILE / INITIAL_SERVICES /
  // INITIAL_STYLISTS from src/mockData.ts, i.e. a fictional salon with a
  // fictional price list. The only caller (SalonWebsitePreview) always passes the
  // real rows, so the fallback could only ever fire when the salon's own data had
  // NOT loaded — precisely the moment a booking widget must not invent a business
  // name, a currency or a menu for a customer to look at. Now an absent salon
  // yields an empty catalogue, which the existing empty states already handle.
  const profile: SalonProfile = inputProfile || ({ businessName: aliasSalonName || '', currency: aliasCurrency || '₹' } as SalonProfile);
  const services = inputServices || aliasServicesList || [];
  const stylists = inputStylists || aliasStylistsList || [];
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
  // MULTI-SERVICE selection: customers can tick several treatments (e.g.
  // haircut + balayage + nails) and every later step — totals, draft, payment
  // and confirmation — works from the whole array. Order = click order; the
  // first entry is the "primary" service used for the single-service fields
  // the salon database still stores (bookings.service_id/service_name).
  const [selectedServices, setSelectedServices] = useState<SalonService[]>(() => {
    const initial = initialService || (services && services[0]);
    return initial ? [initial] : [];
  });
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
  // Optional message the customer leaves for the salon (allergies, hair type,
  // "ring the bell"). Optional, so never validated.
  const [guestNotes, setGuestNotes] = useState<string>('');
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
  // The payment step renders the "Pay Advance Token (25%)" card as already
  // selected, so the state must start there too. It used to default to
  // 'pay_at_salon', which silently sent advance_paid_amount: 0 (and skipped
  // the gateway) even though the customer saw the advance card ticked.
  const [paymentMethod, setPaymentMethod] = useState<'pay_at_salon' | 'pay_advance_token'>('pay_advance_token');
  const [isWhatsappVerified, setIsWhatsappVerified] = useState<boolean>(false);

  // Step 6: Confirmation State
  const [bookingRef, setBookingRef] = useState<string>('');
  // The status the salon's database actually stored, read back from the create
  // response. The confirmation page headlines itself from THIS rather than from
  // what the client sent, so a booking written as `pending` reads "submitted"
  // and only one the salon has accepted reads "confirmed".
  const [storedStatus, setStoredStatus] = useState<string>('pending');
  // Did the customer actually open the WhatsApp confirmation? The old screen
  // printed "WhatsApp verification sent" unconditionally, even for bookings
  // where nothing was ever sent.
  const [whatsappConfirmationSent, setWhatsappConfirmationSent] = useState<boolean>(false);

  // Checkout state — the confirm button must never fire twice (a double click
  // used to create two bookings / two Razorpay orders) and the customer needs
  // to see what is happening while the payment window is open.
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStage, setSubmitStage] = useState<'idle' | 'paying' | 'saving'>('idle');
  const [paymentNotice, setPaymentNotice] = useState<string>('');
  const [advancePaid, setAdvancePaid] = useState<boolean>(false);
  const [paymentReceiptId, setPaymentReceiptId] = useState<string>('');
  // Which gateway took the advance. 'mock' = simulated (dev/preview) — the
  // pass and the toast must never claim real money moved in that case.
  const [paymentMode, setPaymentMode] = useState<PaymentGatewayMode | null>(null);

  // ---- Active draft -------------------------------------------------------
  // Frozen snapshot of salon / service / add-ons / specialist / slot / contact
  // / deposit taken when the customer taps confirm (src/lib/bookingDraft.ts).
  // "Retry Payment" re-opens checkout from THIS object, so a re-render, a
  // changed default or a stale closure can never charge a different amount or
  // book a different slot than the one the customer saw. Mirrored to
  // sessionStorage so a reload mid-payment (UPI app hand-offs) keeps it.
  const [activeDraft, setActiveDraft] = useState<BookingDraft | null>(null);
  // "Payment Failure / Advance Payment Incomplete" panel state. `null` = no
  // failure to show. The payment never blocks the customer from reviewing or
  // editing the draft: every field stays exactly as entered.
  const [paymentFailure, setPaymentFailure] = useState<{
    title: string;
    detail: string;
    /** True when tapping Retry can reasonably succeed (declined card, closed window, network blip). */
    retryable: boolean;
    /** Salon-side gap (gateway disabled/unreachable) — offer pay-at-salon. */
    canPayAtSalon: boolean;
  } | null>(null);
  const [showDraftReview, setShowDraftReview] = useState<boolean>(false);
  // A draft found in sessionStorage from an interrupted attempt (e.g. the tab
  // reloaded while the UPI app was open). Offered back to the customer rather
  // than silently applied.
  const [resumableDraft, setResumableDraft] = useState<BookingDraft | null>(null);
  const restoredDraftRef = useRef<boolean>(false);
  // Did the booking actually reach the salon's database? When the API is
  // unreachable we still keep a local copy, but the pass must SAY it is not
  // confirmed with the salon yet instead of implying everything is fine.
  const [savedToCloud, setSavedToCloud] = useState<boolean>(true);

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

  // Synchronize the *starting* service whenever the modal opens or is retargeted
  // (service-card "Book" buttons and "Rebook" pre-select one service in the
  // caller before opening). Reset to just that service so a previous session's
  // multi-selection never leaks into a new booking. While the modal stays open
  // the effect does not refire (isOpen unchanged, same target id), so choices
  // made inside the flow — and while navigating steps — are never clobbered.
  const targetServiceId = initialService?.id ?? null;
  useEffect(() => {
    if (!isOpen) return;
    const target = initialService || (services && services[0]) || null;
    setSelectedServices(target ? [target] : []);
    setSelectedUpgrades([]);
  }, [isOpen, targetServiceId]);

  // Catalog loaded after the modal opened (first load): seed the default pick.
  useEffect(() => {
    if (!isOpen || selectedServices.length > 0 || services.length === 0) return;
    setSelectedServices([services[0]]);
  }, [isOpen, services, selectedServices.length]);

  // Offer to resume a draft whose payment was interrupted (same salon only,
  // unpaid, less than 30 minutes old). Checked once per open.
  useEffect(() => {
    if (!isOpen) {
      restoredDraftRef.current = false;
      return;
    }
    if (restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    const found = loadBookingDraft({
      salon: { ownerId: profile.ownerId, subdomain: profile.subdomain, name: profile.businessName },
    });
    if (found && found.payment.attempts > 0) setResumableDraft(found);
  }, [isOpen, profile.ownerId, profile.subdomain, profile.businessName]);

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

  // Calculate advance token amount (25%). The same helper runs on the server
  // when the order is created, so the ₹ on the button and the paise in the
  // Razorpay order can never disagree (src/lib/advanceDeposit.ts).
  const homeServiceCharge = bookingType === 'home' ? (profile.homeService?.baseCharge || 0) : 0;
  // Combined totals over EVERY chosen service (+ optional add-ons + home visit
  // fee). These drive the live summary bar, the deposit maths, the payment
  // step and the confirmation — always the sum of what the customer picked.
  const servicesTotalPrice = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const servicesTotalMinutes = selectedServices.reduce((sum, service) => sum + (service.durationMinutes || 0), 0);
  const upgradesPrice = selectedUpgrades.reduce((sum, upgrade) => sum + upgrade.price, 0);
  const upgradesTotalMinutes = selectedUpgrades.reduce((sum, upgrade) => sum + (upgrade.durationMinutes || 0), 0);
  const totalAmount = servicesTotalPrice + upgradesPrice + homeServiceCharge;
  const totalDurationMinutes = servicesTotalMinutes + upgradesTotalMinutes;
  const depositPercent = DEFAULT_DEPOSIT_PERCENT;
  // First-picked treatment — drives the single-service columns the database
  // still stores and the add-on suggestions shown on step 2.
  const primarySelectedService: SalonService | null = selectedServices[0] || null;
  // Optional-upgrades list: same-category menu items that are not already
  // chosen anywhere (services or add-ons), so nothing is offered twice.
  const chosenServiceIds = new Set([...selectedServices, ...selectedUpgrades].map((s) => s.id));
  const addonCandidates = (
    primarySelectedService
      ? services.filter((s) => s.category === primarySelectedService.category && !chosenServiceIds.has(s.id))
      : []
  ).slice(0, 4);
  const advanceTokenAmount = computeAdvanceDeposit(totalAmount, depositPercent).rupees;
  const remainingAmount = totalAmount - (paymentMethod === 'pay_advance_token' ? advanceTokenAmount : 0);

  // ==========================================================================
  // CONFIRMATION PAGE DATA
  // --------------------------------------------------------------------------
  // Derived here rather than inside the JSX because the WhatsApp handler needs
  // the same summary, and because the address resolves differently for a home
  // visit: that is where the stylist is going, not the salon's own address.
  // ==========================================================================
  const confirmationAddress =
    bookingType === 'home'
      ? `${homeServiceAddress}${homeServicePinCode ? ` (PIN: ${homeServicePinCode})` : ''}`.trim()
      : formatSalonAddress(profile);

  const confirmationStatus = resolveConfirmationStatus({ savedToCloud, storedStatus });

  const confirmationSummary = buildConfirmationSummary({
    bookingId: bookingRef,
    salonName: profile.businessName,
    // Full list — "Haircut + Balayage + Gel-X Nails" — so the pass, the
    // calendar event and the WhatsApp message all describe the real booking.
    serviceName: [...selectedServices, ...selectedUpgrades].map((s) => s.name).join(' + ') || 'Selected service',
    staffName: selectedStylist.name,
    date: bookingDate,
    time: bookingTime,
    address: confirmationAddress,
    addressKind: bookingType === 'home' ? 'home' : 'salon',
    totalAmount,
    currency: profile.currency || '₹',
    durationMinutes: totalDurationMinutes,
    // A home visit has no salon pin to route to; fall back to the typed address.
    latitude: bookingType === 'home' ? null : profile.latitude ?? null,
    longitude: bookingType === 'home' ? null : profile.longitude ?? null,
  });

  const whatsappStatus = describeWhatsappConfirmation({
    phone: guestPhone,
    otpVerified: isWhatsappVerified,
    confirmationSent: whatsappConfirmationSent,
  });

  // ==========================================================================
  // CONFIRM BOOKING  (draft → payment → persist → pass)
  // --------------------------------------------------------------------------
  // Order of operations, and why:
  //   1. Validate locally so obviously incomplete details never hit the API.
  //   2. Freeze every parameter into a BookingDraft (salon, slot, stylist,
  //      services, deposit). Everything below works from that snapshot.
  //   3. Take the 25% advance through Razorpay (server derives the paise
  //      amount, creates the order and verifies the signature — the key secret
  //      never touches the browser). A failed / dismissed payment shows the
  //      "Advance Payment Incomplete" panel with Retry Payment + Review Draft
  //      and KEEPS the draft. If the gateway is disabled server-side the flow
  //      degrades to "pay at salon" instead of failing the booking.
  //   4. POST the booking. The API answers a readable error for validation /
  //      owner / database problems; only then do we show the pass.
  // ==========================================================================

  /** Snapshot the current selections + contact details into a draft. */
  const buildDraftFromForm = (refNum: string): BookingDraft => {
    // A draft stores one `service` (the database row) plus everything else in
    // `upgrades` — same convention the customer app uses, and what lets the
    // booking detail page list every treatment the customer picked.
    const [primaryService, ...extraServices] = selectedServices;
    return buildBookingDraft({
      id: refNum,
      salon: {
        ownerId: profile.ownerId || null,
        subdomain: profile.subdomain || null,
        businessName: profile.businessName,
        city: profile.city || null,
        email: profile.email || null,
        currency: profile.currency || '₹',
      },
      service: primaryService
        ? {
            id: primaryService.id,
            name: primaryService.name,
            price: primaryService.price,
            durationMinutes: primaryService.durationMinutes,
          }
        : { id: 'none', name: 'Unselected service', price: 0 },
      upgrades: [
        ...extraServices.map((s) => ({ id: s.id, name: s.name, price: s.price, durationMinutes: s.durationMinutes })),
        ...selectedUpgrades.map((u) => ({ id: u.id, name: u.name, price: u.price, durationMinutes: u.durationMinutes })),
      ],
      stylist: { id: selectedStylist.id, name: selectedStylist.name },
      date: bookingDate,
      time: bookingTime,
      bookingType,
      homeAddress: homeServiceAddress,
      homePinCode: homeServicePinCode,
      homeServiceCharge: profile.homeService?.baseCharge || 0,
      customer: {
        name: guestName.trim() || 'Guest Client',
        phone: sanitizeIndianPhone(guestPhone),
        email: guestEmail.trim() || user?.email || null,
        notes: guestNotes.trim() || null,
      },
      paymentMethod,
      depositPercent,
    });
  };

  /** "Haircut + Balayage + Gel-X Nails" from a frozen draft (primary + extras + add-ons). */
  const draftServicesLabel = (draft: BookingDraft): string =>
    [draft.service, ...draft.upgrades]
      .map((s) => s.name)
      .filter(Boolean)
      .join(' + ');

  /** Toggle one treatment in/out of the multi-service selection. */
  const toggleServiceSelection = (srv: SalonService) => {
    const alreadyChosen = selectedServices.some((s) => s.id === srv.id);
    if (alreadyChosen) {
      setSelectedServices((prev) => prev.filter((s) => s.id !== srv.id));
    } else {
      setSelectedServices((prev) => [...prev, srv]);
      // A treatment can only live in one basket: if it was ticked earlier as
      // an add-on (step 2), promote it to a fully selected service.
      setSelectedUpgrades((prev) => (prev.some((u) => u.id === srv.id) ? prev.filter((u) => u.id !== srv.id) : prev));
    }
  };

  /** "Haircut + Balayage +2 more" — compact names for pills and banners. */
  const shortServiceListLabel = (list: SalonService[], maxNames = 2): string => {
    if (!list.length) return 'No services selected';
    const names = list.slice(0, maxNames).map((s) => s.name);
    const rest = list.length - maxNames;
    return rest > 0 ? `${names.join(' + ')} +${rest} more` : names.join(' + ');
  };

  /** Human wording for the failure panel, from a typed checkout outcome. */
  const describePaymentFailure = (outcome: RazorpayOutcome) => {
    if (outcome.status === 'dismissed') {
      return {
        title: 'Advance payment incomplete',
        detail: 'The payment window was closed before the advance was paid. Nothing was charged and no appointment was created — your slot, specialist and services are still saved below.',
        retryable: true,
        canPayAtSalon: false,
      };
    }
    if (outcome.status === 'failed') {
      return {
        title: 'Payment failed',
        detail: `${outcome.reason.replace(/\.?$/, '.')} No amount was charged and no appointment was created.`,
        retryable: outcome.retryable,
        canPayAtSalon: false,
      };
    }
    // 'unavailable' — salon-side gap, not the customer's fault.
    return {
      title: 'Online payment unavailable',
      detail: `Online booking payment is temporarily unavailable because the secure payment service is not configured (${outcome.reason}). No appointment was created.`,
      retryable: true,
      canPayAtSalon: true,
    };
  };

  /**
   * Run checkout for a draft: payment (if an advance is due) → persist → pass.
   * Shared by the confirm button and "Retry Payment". `options.skipPayment`
   * is the explicit "book now, pay at salon" choice offered when the gateway
   * itself is unavailable.
   */
  const runCheckout = async (
    draft: BookingDraft,
    options: { skipPayment?: boolean; accessToken: string }
  ): Promise<void> => {
    let workingDraft = draft;
    let paymentPayload: {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    } | undefined;
    let paidAdvance = false;
    let paidMode: PaymentGatewayMode | null = null;

    // ---- 3. Advance payment via Razorpay ------------------------------------
    const advanceDue = workingDraft.payment.method === 'pay_advance_token' && workingDraft.pricing.depositAmount > 0;
    if (advanceDue && !options.skipPayment) {
      setSubmitStage('paying');
      // The payload comes from the DRAFT, never from live form state.
      const outcome = await payAdvanceWithRazorpay(
        toAdvancePaymentInput(workingDraft, { themeColor: themeAccentHex, accountEmail: user?.email || null })
      );

      if (outcome.status === 'paid') {
        paidAdvance = true;
        paidMode = outcome.mode;
        paymentPayload = {
          razorpay_order_id: outcome.orderId,
          razorpay_payment_id: outcome.paymentId,
          razorpay_signature: outcome.signature,
        };
        workingDraft = recordPaymentAttempt(workingDraft, {
          status: 'paid',
          orderId: outcome.orderId,
          paymentId: outcome.paymentId,
          signature: outcome.signature,
          mode: outcome.mode,
        });
        setActiveDraft(workingDraft);
        saveBookingDraft(workingDraft);
        setPaymentReceiptId(outcome.paymentId);
        setPaymentMode(outcome.mode);
      } else if (outcome.status === 'unavailable') {
        // Salon-side gap (gateway disabled / unreachable). Do NOT silently
        // book as pay-at-salon: show the panel and let the customer choose.
        console.warn('[Booking] Razorpay unavailable:', outcome.reason);
        workingDraft = recordPaymentAttempt(workingDraft, { status: 'failed', error: outcome.reason });
        setActiveDraft(workingDraft);
        saveBookingDraft(workingDraft);
        setPaymentFailure(describePaymentFailure(outcome));
        return;
      } else {
        // 'dismissed' | 'failed' — keep the draft, show Retry / Review.
        workingDraft = recordPaymentAttempt(workingDraft, {
          status: outcome.status === 'dismissed' ? 'dismissed' : 'failed',
          error: outcome.status === 'failed' ? outcome.reason : 'Payment window closed',
          orderId: outcome.orderId || null,
        });
        setActiveDraft(workingDraft);
        saveBookingDraft(workingDraft);
        setPaymentFailure(describePaymentFailure(outcome));
        return;
      }
    } else if (advanceDue && options.skipPayment) {
      setPaymentNotice('Online payment is not enabled for this salon yet — your slot is held and you can pay at the salon.');
    }

    setAdvancePaid(paidAdvance);
    if (!paidAdvance) setPaymentMode(null);

    // ---- 4. Persist the booking -------------------------------------------
    setSubmitStage('saving');
    let savedRemotely = false;
    // Whatever the salon's database wrote back is the status the confirmation
    // page will show. Never assume: a duplicate submission returns the row
    // that already existed, which the owner may have confirmed or cancelled.
    let remoteStatus: unknown = 'pending';
    const advanceAmount = paidAdvance ? workingDraft.pricing.depositAmount : 0;
    try {
      const requestBody = JSON.stringify({
        owner_id: workingDraft.salon.ownerId || undefined,
        subdomain: workingDraft.salon.subdomain || undefined,
        owner_email: workingDraft.salon.email || undefined,
        payment: paymentPayload,
        booking: {
          owner_id: workingDraft.salon.ownerId || undefined,
          customer_name: workingDraft.customer.name,
          customer_phone: workingDraft.customer.phone,
          customer_email: workingDraft.customer.email || undefined,
          service_id: workingDraft.service.id,
          service_name: workingDraft.service.name,
          // Every treatment the customer picked, in click order, as structured
          // lines (primary + extras + add-ons). `bookings` has one parent row,
          // so the API persists these into `metadata.services` and rebuilds the
          // parent `service_name` from them — the same line shape the customer
          // app writes, which lets "My Bookings", the detail page and rebooking
          // show every service instead of only the primary.
          services: [workingDraft.service, ...workingDraft.upgrades].map((item) => ({
            service_id: String(item.id ?? ''),
            name: String(item.name ?? '').trim(),
            price: Number(item.price) || 0,
            duration_minutes: Number(item.durationMinutes) || 0,
          })),
          // Persisted into the booking's metadata by the API. The customer's
          // "My Bookings" cards need these: `bookings` has no salon or
          // stylist column, so without them the card cannot say who or where.
          staff_id: workingDraft.stylist.id === ANY_SPECIALIST.id ? undefined : workingDraft.stylist.id,
          stylist_name: workingDraft.stylist.name,
          salon_name: workingDraft.salon.name,
          // `bookings` stores one service plus a total; checkout folds the
          // add-on prices in without itemising them. Sending them here is
          // what lets older reads (and rows created before the structured
          // `services` lines above existed) still list everything the
          // customer actually picked.
          service_addons: workingDraft.upgrades.map((addon) => ({
            name: addon.name,
            price: addon.price,
            duration: addon.durationMinutes,
          })),
          // Optional message for the salon. `bookings.notes` is the column
          // for it — distinct from the Razorpay *order* note further down.
          notes: workingDraft.customer.notes || undefined,
          booking_date: workingDraft.slot.date,
          time_slot: workingDraft.slot.time,
          total_amount: workingDraft.pricing.total,
          advance_paid_amount: advanceAmount,
          status: 'pending',
          payment_status: paidAdvance ? 'paid_deposit' : 'pending',
          payment_id: paymentPayload?.razorpay_payment_id || workingDraft.id,
          booking_type: workingDraft.bookingType,
          home_address: draftHomeAddress(workingDraft),
        },
        notifications: [
          {
            user_email: workingDraft.salon.email || 'owner@salon.com',
            title: 'New Booking Request',
            message: `New booking from ${workingDraft.customer.name} for ${draftServicesLabel(workingDraft)} on ${workingDraft.slot.date}. ${
              paidAdvance
                ? `${workingDraft.pricing.depositPercent}% Advance Paid: ₹${advanceAmount}${paidMode === 'mock' ? ' (TEST — simulated)' : ''}`
                : 'Advance not paid (pay at salon).'
            }`,
          },
        ],
      });

      // Transient faults (cold serverless start, a database blip, a dropped
      // mobile connection) used to surface as a dead-end "Server error
      // (HTTP 500)". Retry those automatically before bothering the customer;
      // 4xx answers are the customer's own input and are never retried.
      const outcome = await postBookingWithRetry(requestBody, { accessToken: options.accessToken });

      if (outcome.ok) {
        savedRemotely = true;
        if (outcome.data && typeof outcome.data === 'object' && 'status' in outcome.data) {
          remoteStatus = (outcome.data as any).status;
        }
      } else if (outcome.kind === 'offline') {
        // Truly unreachable (offline / preview sandbox with no API): keep a
        // local copy so the salon dashboard on this device still shows it,
        // but SAY SO on the pass instead of pretending it was confirmed.
        console.warn('Booking API unreachable — keeping a local copy only.', outcome.detail);
      } else {
        console.error('Failed to create booking:', outcome.detail, outcome);
        if (outcome.code === 'auth_required') {
          setSubmitError('Your session has expired. Please sign in again. Your booking details are still here.');
          onRequireAuth?.('login');
          return;
        }
        const support = outcome.requestId ? ` (ref ${outcome.requestId})` : '';
        const retryHint = outcome.retryable
          ? ' This is usually temporary — please try again in a minute.'
          : ' Please try again — your details are still here.';
        setSubmitError(
          paidAdvance
            ? `Your payment went through (ref ${paymentPayload?.razorpay_payment_id}) but we couldn't save the booking (${outcome.detail})${support}. Please share this reference with the salon — you will not be charged twice.`
            : `We couldn't save your booking (${outcome.detail})${support}.${retryHint}`
        );
        return;
      }
    } catch (e: any) {
      // Nothing above should throw; treat it like an unreachable API rather
      // than losing the customer's details.
      console.warn('Booking save threw unexpectedly — keeping a local copy only.', e);
    }
    setSavedToCloud(savedRemotely);
    setStoredStatus(String(remoteStatus ?? 'pending'));
    // The draft did its job — a paid/saved booking must not be offered for
    // "resume" on the next open.
    clearBookingDraft();
    setPaymentFailure(null);
    setShowDraftReview(false);

    const newApt: Appointment = {
      id: `apt-${Date.now()}`,
      clientName: workingDraft.customer.name,
      clientPhone: `+91 ${workingDraft.customer.phone}`,
      clientEmail: workingDraft.customer.email || `${workingDraft.customer.phone}@guest.in`,
      serviceId: workingDraft.service.id,
      serviceName: workingDraft.service.name,
      servicePrice: workingDraft.pricing.total,
      stylistId: workingDraft.stylist.id,
      stylistName: workingDraft.stylist.name,
      date: workingDraft.slot.date,
      time: workingDraft.slot.time,
      status: 'pending', // Set initial status to pending
      paymentStatus: paidAdvance ? 'paid_deposit' : 'pay_at_salon',
      amountPaid: advanceAmount,
      createdAt: new Date().toISOString()
    };

    onAddAppointment(newApt);
    setCurrentStep('confirmed');

    // MOCK EMAIL TRIGGER
    console.log(`[MOCK EMAIL] Confirmation sent to ${newApt.clientEmail} for appointment ${workingDraft.id}`);

    if (onShowToast) {
      onShowToast({
        id: String(Date.now()),
        title: paidAdvance
          ? paidMode === 'mock'
            ? `Booking Pending Approval. ${workingDraft.pricing.depositPercent}% Deposit Simulated (test mode).`
            : `Booking Pending Approval. ${workingDraft.pricing.depositPercent}% Deposit Paid.`
          : 'Booking Pending Approval. Pay at salon.',
        clientName: newApt.clientName,
        serviceName: draftServicesLabel(workingDraft),
        stylistName: newApt.stylistName,
        dateTime: `${workingDraft.slot.date} at ${workingDraft.slot.time}`,
        refCode: workingDraft.id,
        price: workingDraft.pricing.total
      });
    }
  };

  /** Common guard + bookkeeping around runCheckout. */
  const startCheckout = async (draft: BookingDraft, options: { skipPayment?: boolean } = {}) => {
    if (isSubmitting) return; // guard against double clicks / double charges

    // Keep a second client-side gate in addition to the public-site trigger.
    // This protects against a session expiring while the modal is open and
    // leaves all entered service/date/contact details in place for after login.
    if (!user?.id) {
      setSubmitError('Please log in or create an account before confirming this appointment.');
      onRequireAuth?.('login');
      return;
    }

    // Shared with "My Bookings" (src/lib/bookingApi.ts). Mock auth is a
    // namespaced token understood only by the local/mock server; live bookings
    // use the short-lived Supabase access token. The service-role key is never
    // present in client code or request headers.
    const accessToken = await getBookingAccessToken(user);
    if (!accessToken) {
      setSubmitError('Your session has expired. Please sign in again before confirming this appointment.');
      onRequireAuth?.('login');
      return;
    }

    setBookingRef(draft.id);
    setActiveDraft(draft);
    saveBookingDraft(draft);
    setSubmitError('');
    setPaymentNotice('');
    setPaymentFailure(null);
    setShowDraftReview(false);
    setResumableDraft(null);
    setSavedToCloud(true);
    setStoredStatus('pending');
    setWhatsappConfirmationSent(false);
    setIsSubmitting(true);

    try {
      await runCheckout(draft, { ...options, accessToken });
    } catch (err: any) {
      // Nothing in the flow above should throw, but a stray exception must not
      // leave the button spinning forever with no explanation.
      console.error('[Booking] Unexpected checkout error:', err);
      setSubmitError(`Something went wrong while confirming (${err?.message || 'unknown error'}). Please try again.`);
    } finally {
      setIsSubmitting(false);
      setSubmitStage('idle');
    }
  };

  const handleFinalSubmitBooking = async () => {
    if (isSubmitting) return;

    const cleanPhone = sanitizeIndianPhone(guestPhone);

    // ---- 1. Client-side validation ------------------------------------------
    const problems: string[] = [];
    if (!guestName.trim()) problems.push('your name');
    if (cleanPhone.length !== 10) problems.push('a valid 10-digit mobile number');
    if (!bookingDate) problems.push('a booking date');
    if (!bookingTime) problems.push('a time slot');
    if (selectedServices.length === 0) problems.push('at least one service');
    if (problems.length > 0) {
      setSubmitError(`Please add ${problems.join(', ')} before confirming.`);
      setCurrentStep('guest');
      return;
    }

    const cityCode = profile.city?.toUpperCase().includes('BENGALURU') ? 'BLR'
      : profile.city?.toUpperCase().includes('MUMBAI') ? 'BOM'
      : profile.city?.toUpperCase().includes('DELHI') ? 'DEL'
      : profile.city?.toUpperCase().includes('HYDERABAD') ? 'HYD'
      : profile.city?.toUpperCase().includes('JAIPUR') ? 'JPR'
      : profile.city?.toUpperCase().includes('CHENNAI') ? 'MAA'
      : profile.city?.toUpperCase().includes('PUNE') ? 'PNQ'
      : 'IND';

    // ---- 2. Freeze the draft --------------------------------------------------
    // Reuse the reference (and attempt history) when the customer confirms
    // again after a failed payment without changing anything, so the salon
    // sees ONE booking reference across retries.
    const refNum = bookingRef || `NX-${cityCode}-${Math.floor(10000 + Math.random() * 90000)}`;
    const fresh = buildDraftFromForm(refNum);
    const draft =
      activeDraft && activeDraft.id === refNum
        ? { ...fresh, createdAt: activeDraft.createdAt, payment: { ...fresh.payment, attempts: activeDraft.payment.attempts } }
        : fresh;

    await startCheckout(draft);
  };

  /**
   * "Retry Payment": re-open Razorpay Checkout with the ACTIVE draft payload —
   * same salon, slot, stylist, services and deposit. A new Razorpay order is
   * created for the same booking reference (orders are single-use once an
   * attempt failed), and the server verifies the new signature as usual.
   */
  const handleRetryPayment = async () => {
    if (!activeDraft) return handleFinalSubmitBooking();
    await startCheckout({ ...activeDraft, payment: { ...activeDraft.payment, method: 'pay_advance_token' } });
  };

  /** "Book now, pay at salon" — offered only when the gateway itself is down. */
  const handleContinueWithoutPayment = async () => {
    if (!activeDraft) return;
    await startCheckout(activeDraft, { skipPayment: true });
  };

  /** Put a stored draft back into the form so every field can be edited. */
  const applyDraftToForm = (draft: BookingDraft) => {
    // The draft folds everything except the primary service into `upgrades`;
    // restore the whole list into the multi-select so every treatment the
    // customer picked comes back checked on the service step (add-ons they
    // added later simply appear among the chosen services, which is honest).
    const restoreService = (item: { id: string; name: string; price: number; durationMinutes?: number }, category: string): SalonService =>
      services.find((s) => s.id === item.id) || {
        id: item.id,
        name: item.name,
        category,
        durationMinutes: item.durationMinutes || 0,
        price: item.price,
        description: '',
        icon: 'sparkles',
      };
    const primaryFromCatalog = services.find((s) => s.id === draft.service.id);
    const fallbackCategory = primaryFromCatalog?.category || selectedServices[0]?.category || 'General';
    const restoredServices = [
      primaryFromCatalog || restoreService(draft.service, fallbackCategory),
      ...draft.upgrades.map((u) => restoreService(u, fallbackCategory)),
    ];
    setSelectedServices(restoredServices);
    setSelectedUpgrades([]);
    const stylist = draft.stylist.id === ANY_SPECIALIST.id ? ANY_SPECIALIST : stylists.find((s) => s.id === draft.stylist.id);
    setSelectedStylist(stylist || { ...ANY_SPECIALIST, id: draft.stylist.id, name: draft.stylist.name });
    setBookingDate(draft.slot.date);
    setBookingTime(draft.slot.time);
    setBookingType(draft.bookingType);
    setHomeServiceAddress(draft.homeAddress || '');
    setHomeServicePinCode(draft.homePinCode || '');
    setGuestName(draft.customer.name);
    setGuestPhone(draft.customer.phone);
    setGuestEmail(draft.customer.email || '');
    setGuestNotes(draft.customer.notes || '');
    setPaymentMethod(draft.payment.method);
    setBookingRef(draft.id);
    setActiveDraft(draft);
  };

  /** Resume an interrupted draft found in sessionStorage. */
  const handleResumeDraft = () => {
    if (!resumableDraft) return;
    applyDraftToForm(resumableDraft);
    setIsWhatsappVerified(true);
    setResumableDraft(null);
    setPaymentFailure({
      title: 'Advance payment incomplete',
      detail: `Your previous attempt for ${draftServicesLabel(resumableDraft)} on ${resumableDraft.slot.date} at ${resumableDraft.slot.time} did not complete${
        resumableDraft.payment.lastError ? ` (${resumableDraft.payment.lastError})` : ''
      }. Nothing was charged — retry the payment or review the details below.`,
      retryable: true,
      canPayAtSalon: false,
    });
    setCurrentStep('payment');
  };

  const handleDiscardResumableDraft = () => {
    clearBookingDraft();
    setResumableDraft(null);
  };

  /** "Review Draft" → jump to the step that edits a field; nothing is lost. */
  const handleEditDraftField = (step: 'service' | 'upgrades' | 'datetime' | 'guest') => {
    setShowDraftReview(false);
    setPaymentFailure(null);
    setSubmitError('');
    setCurrentStep(step);
  };

  // Open WhatsApp prefilled confirmation.
  // The message is built by src/lib/bookingConfirmation.ts so it always carries
  // the booking id and the address, and so its exact wording is covered by
  // tests rather than only ever being seen by a customer.
  const handleSendWhatsAppConfirmation = () => {
    const msg = buildWhatsappConfirmationMessage({
      summary: confirmationSummary,
      customerName: guestName,
      status: confirmationStatus,
      advancePaid,
      advanceAmount: advanceTokenAmount,
      balanceAmount: remainingAmount,
      // summary.serviceName already carries the full "A + B + C" list, so no
      // separate add-on string is needed (it would repeat names).
      upgrades: [],
      bookingTypeLabel: bookingType === 'home' ? 'Home Service' : 'In-Salon',
    });

    const whatsappUrl = `https://api.whatsapp.com/send?phone=91${whatsappStatus.phone}&text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank');
    // The link opened in a new tab; that is all the page can honestly claim.
    setWhatsappConfirmationSent(true);
  };

  // Open WhatsApp with pre-filled services, date, time shortcut
  const handleQuickWhatsAppBooking = () => {
    const formattedPhone = (profile.whatsapp || '').replace(/\D/g, '');
    const chosen = [...selectedServices, ...selectedUpgrades];
    const serviceLines = chosen
      .map((s) => `• ${s.name} — ₹${formatIndianMoney(s.price)} (${s.durationMinutes || 0} mins)`)
      .join('\n');
    const totalNote =
      chosen.length > 1
        ? `💰 Total for ${chosen.length} services: ₹${formatIndianMoney(totalAmount)} (${totalDurationMinutes} mins)`
        : `💰 Estimated total: ₹${formatIndianMoney(totalAmount)}`;
    const msg = `Namaste ${profile.businessName}! 🌟\n\n` +
      `I would like to book a quick appointment with these details:\n` +
      `💇‍♂️ Service${chosen.length > 1 ? 's' : ''}:\n${serviceLines}\n` +
      `${totalNote}\n` +
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
    setSubmitError('');
    setPaymentNotice('');
    setAdvancePaid(false);
    setPaymentReceiptId('');
    setPaymentMode(null);
    setIsSubmitting(false);
    setSubmitStage('idle');
    setSavedToCloud(true);
    setStoredStatus('pending');
    setWhatsappConfirmationSent(false);
    setActiveDraft(null);
    setPaymentFailure(null);
    setShowDraftReview(false);
    setResumableDraft(null);
    clearBookingDraft();
    // Deliberate: name/phone/email are remembered for 1-click rebooking, but a
    // note is specific to this visit — carrying "ring the bell" into the next
    // appointment would be wrong.
    setGuestNotes('');
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

          {/* Interrupted-payment draft found for THIS salon (e.g. the tab
              reloaded while the UPI app was open). Offered, never forced. */}
          {resumableDraft && currentStep !== 'confirmed' && !activeDraft && (
            <div
              className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex flex-col gap-2"
              data-testid="resume-draft-banner"
            >
              <div className="flex items-start gap-2">
                <RotateCcw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Unfinished booking found:</strong> {draftServicesLabel(resumableDraft)} with {resumableDraft.stylist.name} on{' '}
                  {resumableDraft.slot.date} at {resumableDraft.slot.time} — advance of ₹
                  {resumableDraft.pricing.depositAmount.toLocaleString('en-IN')} was not paid (ref {resumableDraft.id}).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResumeDraft}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-[11px] cursor-pointer hover:bg-amber-700"
                >
                  Resume &amp; Retry Payment
                </button>
                <button
                  type="button"
                  onClick={handleDiscardResumableDraft}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-900 font-bold text-[11px] cursor-pointer hover:bg-amber-100"
                >
                  Start fresh
                </button>
              </div>
            </div>
          )}

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


              {/* Service Selection — MULTI-SELECT: tick any number of
                  treatments (haircut + colour + nails); each card carries an
                  explicit Add to Booking / Remove toggle, and the summary bar
                  at the bottom of the modal updates price + duration live. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold font-mono-caps text-slate-700">
                    2. Select Treatment / Service
                  </label>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      selectedServices.length > 0
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    {selectedServices.length} Selected
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  Combine treatments in one visit (e.g. haircut + balayage + nails) — tap a card or use its button. Price &amp; duration update instantly.
                </p>
                {services.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] text-slate-500">
                    The service menu is still loading — please try again in a moment.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1" role="group" aria-label="Available services">
                    {(services || []).map((srv) => {
                      const isSelected = selectedServices.some((s) => s.id === srv.id);
                      return (
                        <div
                          key={srv.id}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={() => toggleServiceSelection(srv)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleServiceSelection(srv);
                            }
                          }}
                          className={`group p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                            isSelected
                              ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          {/* Checkbox affordance */}
                          <span
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                              isSelected
                                ? 'bg-slate-900 border-slate-900 text-white'
                                : 'bg-white border-slate-300 text-transparent group-hover:border-slate-400'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" strokeWidth={4} />
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-extrabold text-xs ${isSelected ? 'text-slate-900' : 'text-slate-800'}`}>{srv.name}</span>
                              {srv.popular && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-950 text-[10px] font-extrabold shrink-0">
                                  Popular
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 font-medium flex items-center gap-2 mt-1">
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[10px]">{srv.category}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1 font-mono text-slate-700">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {srv.durationMinutes} mins
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                            <div className="font-extrabold text-sm text-slate-900 font-mono">
                              ₹{formatIndianMoney(srv.price)}
                            </div>
                            <button
                              type="button"
                              aria-label={isSelected ? `Remove ${srv.name} from booking` : `Add ${srv.name} to booking`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleServiceSelection(srv);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border transition-colors cursor-pointer flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                                  : 'bg-white border-slate-300 text-slate-700 hover:border-slate-900 hover:text-slate-900'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <Minus className="w-3 h-3" /> Remove
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" /> Add to Booking
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedServices.length === 0 && (
                  <p className="text-[11px] text-rose-600 font-semibold mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Select at least one service to continue booking.</span>
                  </p>
                )}
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
                disabled={selectedServices.length === 0}
                className="w-full py-3 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 mt-2 transition-opacity hover:opacity-95 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: themeAccentHex }}
              >
                <span>
                  Continue to Optional Upgrades
                  {selectedServices.length > 0 && (
                    <span className="font-mono font-bold ml-2 opacity-90">
                      ₹{formatIndianMoney(totalAmount)} • {totalDurationMinutes} mins
                    </span>
                  )}
                </span>
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
              <p className="text-[11px] text-slate-500">
                {selectedUpgrades.length > 0
                  ? `${selectedUpgrades.length} add-on${selectedUpgrades.length > 1 ? 's' : ''} added · same-category extras for ${primarySelectedService?.name || 'your visit'}`
                  : `Popular add-ons for ${primarySelectedService?.name || 'your visit'}`}
              </p>

              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-1">
                {addonCandidates.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] text-slate-500">
                    Nothing left to add here — every {primarySelectedService?.category || 'recommended'} option is already in your booking. Jump to the slot picker!
                  </div>
                ) : (
                  addonCandidates.map(addon => {
                    const isSelected = selectedUpgrades.some(u => u.id === addon.id);
                    return (
                        <div
                            key={addon.id}
                            role="checkbox"
                            aria-checked={isSelected}
                            onClick={() => {
                                if (isSelected) {
                                    setSelectedUpgrades(prev => prev.filter(u => u.id !== addon.id));
                                } else {
                                    setSelectedUpgrades(prev => [...prev, addon]);
                                }
                            }}
                            className={`group p-3 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${
                                isSelected ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                        >
                            <span
                              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                                isSelected
                                  ? 'bg-slate-900 border-slate-900 text-white'
                                  : 'bg-white border-slate-300 text-transparent group-hover:border-slate-400'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={4} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-slate-900">{addon.name}</div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {addon.durationMinutes} mins
                              </div>
                            </div>
                            <div className="text-xs font-mono font-bold text-slate-900 shrink-0">₹{formatIndianMoney(addon.price)}</div>
                        </div>
                    )
                })
                )}
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
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between gap-3 font-mono">
                <div className="flex items-center gap-2 shrink-0">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span>{bookingDate} at {bookingTime} IST</span>
                </div>
                <span className="text-slate-600 text-right min-w-0 truncate">
                  {shortServiceListLabel(selectedServices, 2)} • {selectedStylist.name}
                </span>
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

              {/* Note for the salon */}
              <div>
                <label htmlFor="guestNotesInput" className="text-xs font-bold font-mono-caps text-slate-700 block mb-1">
                  Note for the salon <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  id="guestNotesInput"
                  value={guestNotes}
                  onChange={(e) => setGuestNotes(e.target.value.slice(0, 500))}
                  rows={3}
                  maxLength={500}
                  placeholder="Allergies, hair type, how to reach you at the door…"
                  className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-slate-900 outline-none resize-none"
                />
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

              {/* Comprehensive Booking Summary Card — itemises EVERY chosen
                  service + add-on, and shows the combined total & duration. */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-2.5 text-xs">
                <div>
                  <span className="text-slate-400 font-mono text-[10px] uppercase">
                    Service{selectedServices.length !== 1 ? 's' : ''} & Specialist
                  </span>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    With {selectedStylist.name} • {totalDurationMinutes} mins total
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1 border-y border-slate-200 py-2">
                  {selectedServices.map((srv, idx) => (
                    <div key={srv.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 font-semibold text-slate-800">
                        {selectedServices.length > 1 && <span className="text-slate-400 font-mono mr-1">{idx + 1}.</span>}
                        {srv.name}
                        <span className="text-slate-400 font-normal"> ({srv.durationMinutes} mins)</span>
                      </span>
                      <span className="font-mono font-bold text-slate-900 shrink-0">₹{formatIndianMoney(srv.price)}</span>
                    </div>
                  ))}
                  {selectedUpgrades.map((upgrade) => (
                    <div key={upgrade.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-slate-700">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-slate-400 mr-1">Add-on:</span>
                        {upgrade.name}
                        <span className="text-slate-400 font-normal"> ({upgrade.durationMinutes} mins)</span>
                      </span>
                      <span className="font-mono font-bold text-slate-900 shrink-0">₹{formatIndianMoney(upgrade.price)}</span>
                    </div>
                  ))}
                  {homeServiceCharge > 0 && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-slate-700">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-slate-400 mr-1">Travel:</span>
                        Home visit base charge
                      </span>
                      <span className="font-mono font-bold text-slate-900 shrink-0">₹{formatIndianMoney(homeServiceCharge)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <div>
                    <span className="text-slate-400 block font-mono text-[10px] uppercase">Total Fee</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {selectedServices.length + selectedUpgrades.length} item{selectedServices.length + selectedUpgrades.length !== 1 ? 's' : ''} • {totalDurationMinutes} mins
                    </span>
                  </div>
                  <div className="font-bold text-base text-slate-900 font-mono">
                    ₹{formatIndianMoney(totalAmount)}
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

              {/* Gateway-unavailable notice (booking still goes through) */}
              {paymentNotice && !submitError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>{paymentNotice}</span>
                </div>
              )}

              {/* ===== PAYMENT FAILURE / ADVANCE PAYMENT INCOMPLETE =====
                  Shown when the Razorpay attempt was declined, closed, could
                  not be verified, or the gateway is unavailable. The draft is
                  intact: Retry re-opens checkout with the SAME payload, Review
                  lists every parameter it will use. */}
              {paymentFailure && activeDraft && !isSubmitting && (
                <div
                  className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col gap-3"
                  role="alert"
                  data-testid="payment-failure-panel"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-rose-900">{paymentFailure.title}</div>
                      <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">{paymentFailure.detail}</p>
                      <p className="text-[10px] font-mono text-rose-700/80 mt-1">
                        Draft {activeDraft.id} · attempt {activeDraft.payment.attempts}
                        {activeDraft.payment.lastOrderId ? ` · order ${activeDraft.payment.lastOrderId}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRetryPayment}
                      data-testid="retry-payment-button"
                      className="flex-1 min-w-[140px] py-2.5 px-3 rounded-xl font-bold text-xs text-white shadow-sm flex items-center justify-center gap-1.5 cursor-pointer hover:opacity-95"
                      style={{ backgroundColor: themeAccentHex }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Payment (₹{activeDraft.pricing.depositAmount.toLocaleString('en-IN')})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDraftReview((v) => !v)}
                      data-testid="review-draft-button"
                      aria-expanded={showDraftReview}
                      className="flex-1 min-w-[120px] py-2.5 px-3 rounded-xl border border-rose-300 bg-white text-rose-900 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer hover:bg-rose-100/60"
                    >
                      <span>{showDraftReview ? 'Hide Draft' : 'Review Draft'}</span>
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showDraftReview ? 'rotate-90' : ''}`} />
                    </button>
                    {paymentFailure.canPayAtSalon && (
                      <button
                        type="button"
                        onClick={handleContinueWithoutPayment}
                        data-testid="pay-at-salon-button"
                        className="w-full py-2.5 px-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer hover:bg-amber-100"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>Book now &amp; pay ₹{activeDraft.pricing.total.toLocaleString('en-IN')} at the salon</span>
                      </button>
                    )}
                  </div>

                  {showDraftReview && (
                    <div className="rounded-xl bg-white border border-rose-100 divide-y divide-slate-100" data-testid="draft-review">
                      {describeBookingDraft(activeDraft).map((row) => (
                        <div key={row.key} className="flex items-start justify-between gap-3 px-3 py-2 text-[11px]">
                          <span className="text-slate-500 font-mono text-[10px] uppercase shrink-0 pt-0.5">{row.label}</span>
                          <span className="text-slate-900 font-semibold text-right flex-1 break-words">{row.value}</span>
                          {row.editStep && (
                            <button
                              type="button"
                              onClick={() => handleEditDraftField(row.editStep!)}
                              className="text-[10px] font-bold underline text-slate-600 hover:text-slate-900 cursor-pointer shrink-0"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Final Step Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setSubmitError(''); setPaymentFailure(null); setShowDraftReview(false); setCurrentStep('guest'); }}
                  disabled={isSubmitting}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={paymentFailure && activeDraft ? handleRetryPayment : handleFinalSubmitBooking}
                  disabled={isSubmitting}
                  data-testid="confirm-booking-button"
                  className="flex-1 py-3.5 rounded-xl font-bold text-xs text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95 disabled:opacity-70 disabled:cursor-wait"
                  style={{ backgroundColor: themeAccentHex }}
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      <span>
                        {submitStage === 'paying'
                          ? `Opening secure payment (₹${advanceTokenAmount.toLocaleString('en-IN')})…`
                          : 'Saving your booking…'}
                      </span>
                    </>
                  ) : paymentFailure && activeDraft ? (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Retry Payment &amp; Generate Pass (₹{activeDraft.pricing.depositAmount.toLocaleString('en-IN')})</span>
                    </>
                  ) : (
                    <>
                      <CalendarCheck className="w-4 h-4" />
                      <span>Confirm Appointment &amp; Generate Pass (₹{advanceTokenAmount.toLocaleString('en-IN')})</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* ========================================================= */}
          {/* STEP 6 / POST-SUBMIT CONFIRMATION SCREEN */}
          {/* Extracted into <BookingConfirmation> so every row, the .ics file,
              the Google Calendar link and the map link are derived from the
              booking in one tested place, and so the headline comes from the
              status the salon actually stored rather than a hardcoded
              "confirmed". */}
          {/* ========================================================= */}
          {currentStep === 'confirmed' && (
            <BookingConfirmation
              summary={confirmationSummary}
              status={confirmationStatus}
              customerName={guestName}
              salonPhone={profile.phone || profile.whatsapp}
              payment={{
                advancePaid,
                advanceAmount: advanceTokenAmount,
                balanceAmount: remainingAmount,
                receiptId: paymentReceiptId,
                simulated: paymentMode === 'mock',
              }}
              upgrades={[]}
              bookingTypeLabel={bookingType === 'home' ? 'Home Service' : 'In-Salon'}
              whatsapp={whatsappStatus}
              onSendWhatsapp={handleSendWhatsAppConfirmation}
              fromHistory={fromHistory}
              onRebook={handleReset}
              onBookAnother={handleReset}
              onClose={onClose}
              accentHex={themeAccentHex}
            />
          )}

        </div>

        {/* FLOATING SUMMARY BAR — always visible while navigating steps so the
            customer sees the running Total (₹) & Total Duration (mins) for all
            selected services (+ add-ons) without scrolling back to step 1. */}
        {currentStep !== 'confirmed' && (
          <div
            className="shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.25)]"
            data-testid="booking-summary-bar"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`px-2 py-1 rounded-lg text-[10px] font-extrabold font-mono shrink-0 ${
                  selectedServices.length > 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {selectedServices.length} Service{selectedServices.length !== 1 ? 's' : ''} Selected
              </span>
              {selectedUpgrades.length > 0 && (
                <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                  +{selectedUpgrades.length} Add-on{selectedUpgrades.length !== 1 ? 's' : ''}
                </span>
              )}
              <span className="hidden md:inline text-[10px] text-slate-500 font-mono truncate min-w-0 max-w-[240px]">
                {shortServiceListLabel(selectedServices, 2)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono shrink-0">
              <span className="text-slate-700">
                Total: <strong className="text-slate-900 font-extrabold">₹{formatIndianMoney(totalAmount)}</strong>
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <strong className="text-slate-900 font-extrabold">{totalDurationMinutes}</strong> mins
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
