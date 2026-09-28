import React, { useEffect, useState } from 'react';
import type { BusinessTypeId } from '../types';
import { getTemplateById } from '../data/templates';
import { SALON_IMAGES } from '../assets/images';
import partnerHero from '../assets/nexora-partner-hero.jpg';
import campaignModels from '../assets/posters/nexora-campaign-models.jpg';
import goldBanner from '../assets/posters/nexora-gold-banner.jpg';
import goldSalon from '../assets/posters/nexora-gold-salon.jpg';
import posterWaiting from '../assets/posters/poster-waiting-problem.jpg';
import posterQr from '../assets/posters/poster-qr-standee.jpg';
import posterCrown from '../assets/posters/poster-crown-ranking.jpg';
import posterSuccess from '../assets/posters/poster-booking-success.jpg';

interface LandingPageProps { onBrowseTemplates: (category?: string) => void; selectedTemplateId?: BusinessTypeId; }

/* ------------------------------------------------------------------ */
/*  Content data — everything mirrors the real product configuration  */
/* ------------------------------------------------------------------ */

const HERO_CHIPS = [
  { icon: 'palette', label: 'AI Website Builder' },
  { icon: 'calendar_month', label: '24/7 Online Booking' },
  { icon: 'card_giftcard', label: 'Loyalty & Rewards' },
  { icon: 'currency_rupee', label: 'Payments & Payouts' },
];

const PLATFORM_STATS = [
  { value: '27+', label: 'Business Templates', sub: 'Salon, spa, barber, tattoo & more' },
  { value: '4', label: 'Loyalty Tiers', sub: 'Bronze → Platinum VIP' },
  { value: '5', label: 'Reward Vouchers', sub: 'From 10% OFF to ₹1,500 OFF' },
  { value: '0', label: 'Lines of Code', sub: 'Launch your site in minutes' },
];

const PILLARS = [
  {
    icon: 'auto_awesome',
    tag: 'Build',
    title: 'AI-Powered Website Builder',
    text: 'Pick from 27+ industry-crafted designs for hair salons, barbers, beauty parlours, nails, spas, tattoo studios, skin clinics and more. Nexora writes your bio, generates logo suites and publishes a stunning website — no designers, no code.',
    img: SALON_IMAGES.toolsSetup,
    alt: 'Setting up a Nexora salon website',
  },
  {
    icon: 'event_available',
    tag: 'Run',
    title: 'All-in-One Salon OS',
    text: 'Appointments, booking calendar, staff rosters, commission payouts, offers, notifications and Razorpay payments — every daily operation of your shop lives in one clean dashboard.',
    img: SALON_IMAGES.hero,
    alt: 'Salon owner dashboard',
  },
  {
    icon: 'trending_up',
    tag: 'Grow',
    title: 'Growth & Rewards Engine',
    text: 'Customers earn points on every visit and redeem real coupons. A built-in Growth Partner network brings new salons onboard, while AI client re-engagement brings lapsed customers back to your chair.',
    img: SALON_IMAGES.nailArt,
    alt: 'Rewarding customer experience',
  },
];

interface ShowcaseVideo { id: string; videoId: string; title: string; blurb: string; tag: string; poster: string; }

const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    id: 'v-tour',
    videoId: '3JZ_D3ELwOQ',
    title: 'Inside a Nexora-Powered Salon',
    blurb: 'See how bookings, billing and loyalty flow together on a busy day.',
    tag: 'PLATFORM TOUR',
    poster: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'v-glam',
    videoId: 'fJ9rUzIMcZQ',
    title: 'Glow-Up Transformation Showcase',
    blurb: 'Real makeovers from the Nexora template gallery — hair, skin & glam.',
    tag: 'SHOWCASE',
    poster: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'v-shorts',
    videoId: 'kJQP7kiw5Fk',
    title: 'Behind the Chair — Shorts',
    blurb: 'Quick clips of balayage, nail art and barber craft from partner salons.',
    tag: 'SHORTS',
    poster: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=900&q=80',
  },
];

const CUSTOMER_BENEFITS = [
  { icon: 'bolt', title: 'Book in Under 60 Seconds', text: 'Browse services, pick your stylist and confirm a slot — anytime, from any phone. No calls, no waiting rooms.' },
  { icon: 'stars', title: 'Earn on Every Visit', text: '50 points per check-in plus 10 points for every ₹100 you spend. Points become real discount vouchers.' },
  { icon: 'card_giftcard', title: 'Birthday & Referral Bonuses', text: 'A 250-point birthday bonus every year and 100 bonus points each time a friend you referred checks in.' },
  { icon: 'workspace_premium', title: 'VIP Tier Perks', text: 'Silver, Gold and Platinum members unlock point multipliers, priority weekend slots and a dedicated master stylist.' },
  { icon: 'redeem', title: 'Instant Coupon Wallet', text: 'Rewards turn into ready-to-use codes like GLOW10 and SAVE300 — applied to your bill in one tap.' },
  { icon: 'notifications_active', title: 'Never Miss a Visit', text: 'Smart reminders, booking updates and exclusive festive offers land straight in your notifications.' },
];

const REWARD_LADDER = [
  { pts: 200, code: 'GLOW10', title: '10% OFF Any Service', desc: 'Instant discount on your next hair or skin appointment.' },
  { pts: 400, code: 'SAVE300', title: 'Flat ₹300 OFF', desc: 'On any invoice above ₹1,000 — no category limits.' },
  { pts: 750, code: 'ROYAL20', title: '20% OFF Premium Care', desc: 'Keratin, hair botox & full-body rejuvenation packages.' },
  { pts: 1200, code: 'FREESPA', title: 'Free Spa Ritual', desc: 'Complimentary 30-min scalp detox or crystal hand spa.' },
  { pts: 2000, code: 'VIP1500', title: '₹1,500 OFF Bridal & Makeover', desc: 'VIP luxury voucher for makeovers and bridal sessions.' },
];

const TIERS = [
  { name: 'Bronze', at: '0+ pts', perk: 'Standard earning — 50 pts/visit + 10% spend points', grad: 'from-amber-600 to-amber-800', icon: 'workspace_premium' },
  { name: 'Silver', at: '300+ pts', perk: '1.25x points + complimentary herbal welcome drink', grad: 'from-slate-400 to-slate-600', icon: 'military_tech' },
  { name: 'Gold', at: '800+ pts', perk: '1.5x points + priority weekend appointment booking', grad: 'from-yellow-400 via-amber-500 to-yellow-600', icon: 'stars' },
  { name: 'Platinum', at: '1800+ pts', perk: '2x double points + dedicated master stylist + exclusive previews', grad: 'from-purple-500 via-indigo-600 to-pink-500', icon: 'diamond' },
];

const OWNER_BENEFITS = [
  { icon: 'palette', title: 'Website in Minutes', text: 'Choose a template, let AI draft your content, hit “Save & Update Website”. Your salon is live the same day.' },
  { icon: 'event_available', title: 'Smart Appointment Manager', text: 'A live calendar with booking cards, status badges, staff assignment and no-show protection.' },
  { icon: 'groups', title: 'Staff & Commission Engine', text: 'Rosters, performance leaders and automated commission payouts for every stylist and therapist.' },
  { icon: 'payments', title: 'Razorpay Payments', text: 'Collect advance deposits and full payments with instant confirmation — reconciled in your dashboard.' },
  { icon: 'campaign', title: 'Offers & Campaigns', text: 'Launch festive discounts, combo deals and coupon codes that show up right on your website.' },
  { icon: 'loyalty', title: 'Loyalty on Autopilot', text: 'Configurable points, tiers and vouchers — checked in and credited automatically at billing.' },
  { icon: 'insights', title: 'Business Analytics', text: 'Revenue trends, last-7-days leaders and service popularity — clear numbers, not guesswork.' },
  { icon: 'qr_code_2', title: 'QR Check-In & Sharing', text: 'A salon QR code for instant check-ins, review collection and social sharing.' },
];

const PARTNER_PERKS = [
  { icon: 'badge', title: 'Your Own Referral Code', text: 'Get a unique code and share link — every salon that joins through you is linked to you forever.' },
  { icon: 'currency_rupee', title: 'Commission & Withdrawals', text: 'Track earnings and request payouts from a transparent withdrawals ledger.' },
  { icon: 'rocket_launch', title: 'Partner Levels & Leaderboards', text: 'Climb partner tiers, top the leaderboards and unlock bigger rewards.' },
  { icon: 'campaign', title: 'Ready Marketing Kit', text: 'Creatives, materials and milestones to help you onboard salons faster.' },
];

const TEMPLATE_CATEGORIES: { cat: string; label: string; count: string; img: string }[] = [
  { cat: 'hair', label: 'Hair & Styling Studios', count: '5 designs', img: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80' },
  { cat: 'barber', label: 'Barber Shops & Grooming Clubs', count: '2 designs', img: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80' },
  { cat: 'beauty', label: 'Beauty & Makeup', count: '4 designs', img: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80' },
  { cat: 'nails', label: 'Nails, Lashes & Brows', count: '4 designs', img: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80' },
  { cat: 'spa', label: 'Spa & Wellness', count: '4 designs', img: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80' },
  { cat: 'skin', label: 'Skin & Laser Clinics', count: '2 designs', img: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80' },
  { cat: 'ayurvedic', label: 'Ayurvedic Wellness', count: '4 designs', img: 'https://images.unsplash.com/photo-1600334129128-685c5582fd35?auto=format&fit=crop&w=800&q=80' },
  { cat: 'tattoo', label: 'Tattoo Studios', count: '1 design', img: 'https://images.unsplash.com/photo-1598371839696-5c5bb00bdc28?auto=format&fit=crop&w=800&q=80' },
];

const TESTIMONIALS = [
  {
    quote: 'I picked a template after lunch and my parlour had a live website before dinner. Customers now book at night while I sleep — and the loyalty points keep them coming back.',
    name: 'Ananya Sharma', role: 'Salon Owner, Mumbai', emoji: '💇‍♀️',
  },
  {
    quote: 'The rewards ladder is addictive — I planned my facial and keratin appointments around the ROYAL20 unlock. Checkout with my coupon took literally one tap.',
    name: 'Rohan Kapoor', role: 'Nexora Customer, Delhi', emoji: '🎁',
  },
  {
    quote: 'As a growth partner I share my referral link, help local salons set up, and watch my dashboard grow. The leaderboards keep the whole team motivated.',
    name: 'Kabir Khan', role: 'Growth Partner, Bengaluru', emoji: '🚀',
  },
];

/* ----------------- Customer problems → solution ----------------- */

const CUSTOMER_PROBLEMS = [
  { icon: 'hourglass_top', title: 'Time ki barbadi?', text: 'Salon pahunchne par pata chalta hai 60–90 minute ka waiting hai. Aadha din kharab.' },
  { icon: 'sentiment_dissatisfied', title: 'Waiting ki pareshani?', text: 'Weekend par bheed itni ki baithne ki jagah nahi — service se zyada queue yaad rehti hai.' },
  { icon: 'event_busy', title: 'Appointment ka koi confirmation nahi?', text: 'Phone karne par “aa jao bhai” — pahunchne par 3 aur log aage. Na slot, na guarantee.' },
];

const SOLUTION_POINTS = [
  { icon: 'calendar_month', title: 'Online Booking', text: 'Kabhi bhi, kahin se bhi — 60 second me asaani se booking karein.' },
  { icon: 'chat', title: 'WhatsApp Par Confirmation', text: 'Turant booking confirm message payein — koi confusion nahi.' },
  { icon: 'location_on', title: 'Manpasand Salon Chune', text: 'Apni location par Jaipur ke sabhi partner salons me se chune.' },
  { icon: 'savings', title: 'Time Aur Paise Dono Bachaye', text: 'Smart booking se time bhi bache, paise bhi — dono.' },
];

/* ----------------- Jaipur 15% QR discount ----------------- */

const QR_CATEGORIES = [
  { icon: 'content_cut', label: 'Salon' },
  { icon: 'face_retouching_natural', label: 'Beauty Parlour' },
  { icon: 'spa', label: 'Spa' },
  { icon: 'draw', label: 'Tattoo' },
  { icon: 'self_improvement', label: 'Massage' },
  { icon: 'brush', label: 'Nail Art' },
];

const QR_STEPS = [
  { step: '1', title: 'Partner salon par Nexora QR dekho', text: 'Jaipur ke har partner salon ke counter par golden QR standee rakhi hai.' },
  { step: '2', title: 'Scan karke payment karo', text: 'Phone camera se scan karo — secure payment window khul jayega.' },
  { step: '3', title: 'Turant 15% discount pao', text: 'Payment hote hi discount apply — koi coupon code nahi, koi waiting nahi.' },
];

const FAQS = [
  { q: 'What exactly is Nexora?', a: 'Nexora is an AI-powered website builder and all-in-one management platform for beauty businesses — salons, barbers, spas, nail and tattoo studios, bridal lounges and skin clinics. It gives you a beautiful customer-facing website plus a full back-office: appointments, staff, loyalty rewards, payments and analytics.' },
  { q: 'Do I need coding or design skills?', a: 'No. You choose a ready-made template, Nexora’s AI drafts your content and logo, and you publish with a single “Save & Update Website” action. Everything is editable with simple inline editors.' },
  { q: 'How do customer rewards work?', a: 'Customers earn 50 points per visit plus 10 points per ₹100 spent (with birthday and referral bonuses). Points unlock vouchers — like 10% OFF at 200 points or a free spa ritual at 1,200 — and tiers from Bronze to Platinum multiply everything they earn.' },
  { q: 'What does it cost salon owners?', a: 'Getting started is free: pick a template, set up your services and publish your website. Payment collection via Razorpay uses standard gateway charges. You only grow into paid tooling as your business does.' },
  { q: 'How do I earn as a Growth Partner?', a: 'Sign up, get your unique referral code and share your link with salon owners. Every salon that signs up through you is permanently attributed to you — you then track referrals, commissions and levels from your partner dashboard.' },
  { q: 'Can customers book without calling the salon?', a: 'Yes — every Nexora website has a live booking portal. Customers browse services, see real availability, book and even pay an advance deposit online, 24/7.' },
];

/* ------------------------------------------------------------------ */
/*  Tiny building blocks                                              */
/* ------------------------------------------------------------------ */

const Ic: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>
);

const SectionHeading: React.FC<{ eyebrow: string; icon: string; title: React.ReactNode; sub?: string; light?: boolean }> = ({ eyebrow, icon, title, sub, light }) => (
  <div className="mx-auto max-w-2xl text-center">
    <span className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] ${light ? 'bg-white/25 text-white border border-white/40 backdrop-blur-md' : 'bg-rose-50 text-[#C20E5A] border border-rose-100'}`}>
      <Ic name={icon} className="text-sm" />{eyebrow}
    </span>
    <h2 className={`mt-4 text-3xl font-black tracking-tight sm:text-4xl ${light ? 'text-white' : 'text-on-surface'}`}>{title}</h2>
    {sub && <p className={`mt-3 text-base leading-7 ${light ? 'text-rose-50/90' : 'text-on-surface-variant'}`}>{sub}</p>}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Video showcase (click-to-load YouTube embeds)                     */
/* ------------------------------------------------------------------ */

const VideoShowcase: React.FC = () => {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  return (
    <section id="nexora-videos" className="scroll-mt-24 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <SectionHeading
          eyebrow="Videos"
          icon="play_circle"
          title={<>See Nexora in <span className="text-[#C20E5A]">action</span></>}
          sub="Tours, transformations and shorts from salons running on the platform. Tap any card to play."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE_VIDEOS.map((video) => (
            <figure key={video.id} className="nx-glass nx-lift group overflow-hidden rounded-3xl">
              <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                {activeId === video.id ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0&modestbranding=1`}
                    title={video.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                  />
                ) : (
                  <button type="button" onClick={() => setActiveId(video.id)} className="absolute inset-0 h-full w-full" aria-label={`Play video: ${video.title}`}>
                    <img src={video.poster} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                    <span className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/10 to-transparent" />
                    <span className="nx-play-pulse absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#C20E5A] text-white shadow-xl">
                      <Ic name="play_arrow" className="text-3xl fill-1" />
                    </span>
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black tracking-widest text-[#C20E5A]">{video.tag}</span>
                  </button>
                )}
              </div>
              <figcaption className="p-5">
                <h3 className="font-black tracking-tight">{video.title}</h3>
                <p className="mt-1 text-sm leading-6 text-on-surface-variant">{video.blurb}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-on-surface-variant">Videos play via YouTube. Press Esc or tap another card to switch.</p>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/*  Campaign poster — "Salon ja rhe ho? Pehle Nexora!"                */
/* ------------------------------------------------------------------ */

const CampaignPoster: React.FC = () => (
  <section id="campaign" className="relative scroll-mt-24 overflow-hidden bg-[#070502] py-20 sm:py-24">
    {/* gold ambience */}
    <div className="nx-blob pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
    <div className="nx-blob-alt pointer-events-none absolute -right-20 bottom-16 h-80 w-80 rounded-full bg-yellow-400/10 blur-3xl" />
    <div className="nx-dots pointer-events-none absolute left-0 top-0 h-40 w-40 opacity-60" />
    <div className="nx-dots pointer-events-none absolute bottom-0 right-0 h-40 w-40 opacity-60" />

    <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
      <SectionHeading
        light
        eyebrow="Campaign"
        icon="campaign"
        title={<>Salon ja rhe ho? <span className="nx-gold-text">Pehle Nexora!</span></>}
        sub="India ka apna salon ritual — appointment lock karo, rewards kamao, phir style karo. #PehleNexoraPhirSalon"
      />

      {/* poster card — recreation of the Nexora black & gold campaign creative */}
      <div className="nx-poster-frame nx-lift relative mx-auto mt-14 max-w-md overflow-hidden rounded-[2.5rem] bg-black">
        <img src={campaignModels} alt="Nexora Salon OS campaign — salon ja rhe ho? Pehle Nexora kiya?" className="aspect-[3/4] w-full object-cover" loading="lazy" />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/75" aria-hidden="true" />

        {/* wordmark */}
        <div className="absolute inset-x-0 top-6 text-center">
          <p className="nx-gold-text text-3xl font-black tracking-[0.28em]">NEXORA</p>
          <p className="mt-1 text-[11px] font-black tracking-[0.5em] text-amber-100/90">SALON OS</p>
          <span className="mx-auto mt-2 block h-px w-24 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
        </div>

        {/* main campaign line */}
        <div className="absolute inset-x-0 top-[30%] px-6 text-center">
          <p className="text-4xl font-black leading-[1.05] tracking-tight text-white drop-shadow-lg sm:text-5xl">SALON<br />JA RHE HO?</p>
          <p className="nx-gold-text mt-2 text-5xl font-black tracking-tight drop-shadow-lg sm:text-6xl">NEXORA</p>
          <p className="text-4xl font-black tracking-tight text-white drop-shadow-lg sm:text-5xl">KIYA?</p>
        </div>

        {/* calendar icon + badge */}
        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-3 px-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/70 bg-black/70 text-amber-300 backdrop-blur-sm">
            <Ic name="calendar_month" className="text-2xl" />
          </span>
          <div className="w-full max-w-[240px] rounded-2xl border border-amber-400/60 bg-black/65 px-4 py-3 text-center backdrop-blur-md">
            <p className="text-lg font-black leading-tight"><span className="nx-gold-text">PAHLE NEXORA</span></p>
            <p className="my-0.5 text-xs font-black text-amber-400" aria-hidden="true">•</p>
            <p className="text-lg font-black leading-tight text-white">PHIR <span className="nx-gold-text">SALON</span></p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-sm font-bold text-amber-100/70">Book smart. Earn points. Shine golden — har visit par.</p>

      {/* gold gallery strip — brand imagery */}
      <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
        <figure className="nx-poster-frame nx-lift group overflow-hidden rounded-3xl">
          <img src={goldBanner} alt="Golden scissors and comb — the Nexora standard" className="h-52 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-60" loading="lazy" />
          <figcaption className="bg-black px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-amber-200">The Nexora Standard</figcaption>
        </figure>
        <figure className="nx-poster-frame nx-lift group overflow-hidden rounded-3xl">
          <img src={goldSalon} alt="Luxury black and gold salon interior" className="h-52 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-60" loading="lazy" />
          <figcaption className="bg-black px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-amber-200">Partner Salons, Luxury Vibes</figcaption>
        </figure>
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Rewards ladder + tiers                                            */
/* ------------------------------------------------------------------ */

const RewardsSection: React.FC = () => (
  <section id="rewards" className="scroll-mt-24 relative overflow-hidden bg-gradient-to-b from-[#2a0616] via-[#4a0b26] to-[#2a0616] py-20 sm:py-24">
    <div className="nx-blob pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-fuchsia-600/30 blur-3xl" />
    <div className="nx-blob-alt pointer-events-none absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-rose-500/25 blur-3xl" />
    <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
      <SectionHeading
        light
        eyebrow="Rewards"
        icon="redeem"
        title={<>The Nexora <span className="text-rose-300">Rewards Ladder</span></>}
        sub="Every check-in and every rupee earns points. Points unlock real vouchers — automatically, at billing."
      />
      <div className="mt-14 grid gap-4 md:grid-cols-5">
        {REWARD_LADDER.map((r, i) => (
          <div key={r.code} className="nx-glass nx-lift relative flex flex-col rounded-3xl p-5 text-center">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#C20E5A] px-3 py-1 text-[11px] font-black text-white shadow-lg">{r.pts} pts</span>
            <div className="mt-4 flex justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/30 text-white border border-white/40"><Ic name={i === 4 ? 'diamond' : 'card_giftcard'} className="text-2xl" /></span>
            </div>
            <p className="mt-3 text-[10px] font-black tracking-[0.2em] text-rose-200">{r.code}</p>
            <h3 className="mt-1 text-sm font-black text-white">{r.title}</h3>
            <p className="mt-2 text-xs leading-5 text-rose-100/80">{r.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => (
          <div key={t.name} className="nx-glass nx-lift rounded-3xl p-6">
            <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${t.grad} text-white shadow-lg`}><Ic name={t.icon} className="text-xl" /></span>
            <h3 className="mt-4 font-black text-white">{t.name} <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-rose-100">{t.at}</span></h3>
            <p className="mt-2 text-xs leading-5 text-rose-100/85">{t.perk}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-rose-100/70">Earning rates: 50 pts per check-in · 10 pts per ₹100 spent · 250 pts birthday bonus · 100 pts referral bonus.</p>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Customer problems → Nexora solution                               */
/* ------------------------------------------------------------------ */

const ProblemSolutionSection: React.FC = () => (
  <section id="solution" className="relative scroll-mt-24 overflow-hidden bg-[#070502] py-20 sm:py-24">
    <div className="nx-dots pointer-events-none absolute right-0 top-0 h-44 w-44 opacity-50" />
    <div className="nx-blob pointer-events-none absolute -left-24 bottom-10 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />

    <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
      <SectionHeading
        light
        eyebrow="Is problem ka"
        icon="emoji_objects"
        title={<span className="nx-gold-text">Solution hai na!</span>}
        sub="Har baar waiting, confirmation na milna, time waste — Nexora in teeno ka ek jawaab hai."
      />

      <div className="mt-14 grid items-center gap-10 lg:grid-cols-2">
        <figure className="nx-poster-frame nx-lift relative overflow-hidden rounded-[2rem]">
          <img src={posterWaiting} alt="Salon me lambi waiting — ek aam problem" className="h-72 w-full object-cover sm:h-96" loading="lazy" />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden="true" />
          <figcaption className="absolute inset-x-0 bottom-0 p-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-red-500/90 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white">
              <Ic name="sentiment_very_dissatisfied" className="text-sm" /> Same problems, same everytime!
            </span>
          </figcaption>
        </figure>

        <div className="space-y-4">
          {CUSTOMER_PROBLEMS.map((p) => (
            <div key={p.title} className="nx-poster-frame flex items-start gap-4 rounded-3xl bg-black/70 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-400/50 bg-black text-amber-300"><Ic name={p.icon} className="text-xl" /></span>
              <div>
                <h3 className="font-black tracking-tight text-white">{p.title}</h3>
                <p className="mt-1 text-sm leading-6 text-amber-100/75">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="nx-poster-frame mt-12 rounded-[2rem] bg-gradient-to-b from-[#15100a] to-black p-8 sm:p-10">
        <p className="text-center text-xs font-black uppercase tracking-[0.3em] text-amber-400">— Is problem ka solution hai na! —</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SOLUTION_POINTS.map((s) => (
            <div key={s.title} className="nx-lift rounded-3xl border border-amber-400/30 bg-black/60 p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-yellow-600 text-black shadow-lg"><Ic name={s.icon} className="text-xl" /></span>
              <h3 className="mt-4 text-sm font-black text-white">{s.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-amber-100/70">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Jaipur 15% QR discount                                            */
/* ------------------------------------------------------------------ */

const JaipurDiscountSection: React.FC = () => (
  <section id="jaipur-offer" className="relative scroll-mt-24 overflow-hidden py-20 sm:py-24" style={{ background: 'radial-gradient(900px 500px at 50% -10%, #2a1f05 0%, #070502 55%)' }}>
    <div className="nx-blob pointer-events-none absolute right-0 top-24 h-80 w-80 rounded-full bg-amber-400/10 blur-3xl" />
    <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
      <SectionHeading
        light
        eyebrow="Jaipur special"
        icon="qr_code_2"
        title={<>Jaipur ke har salon par <span className="nx-gold-text">15% instant discount*</span></>}
        sub="Hair Salon · Beauty Parlour · Spa · Tattoo Studio · Massage · Nail Art — ek hi QR, har jagah benefits."
      />

      <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          {QR_STEPS.map((s) => (
            <div key={s.step} className="nx-poster-frame nx-lift flex items-start gap-4 rounded-3xl bg-black/70 p-5">
              <span className="nx-gold-text flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-400/50 bg-black text-2xl font-black">{s.step}</span>
              <div>
                <h3 className="font-black tracking-tight text-white">{s.title}</h3>
                <p className="mt-1 text-sm leading-6 text-amber-100/75">{s.text}</p>
              </div>
            </div>
          ))}
          <div className="nx-poster-frame rounded-3xl bg-black/70 p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400">Kahan kahan milta hai?</p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {QR_CATEGORIES.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-black px-3.5 py-2 text-xs font-bold text-amber-100">
                  <Ic name={c.icon} className="text-sm text-amber-300" />{c.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <figure className="nx-poster-frame nx-lift relative overflow-hidden rounded-[2rem]">
          <img src={posterQr} alt="Nexora golden QR standee — scan karke 15% discount pao" className="h-80 w-full object-cover sm:h-[26rem]" loading="lazy" />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30" aria-hidden="true" />
          <figcaption className="absolute inset-x-0 bottom-0 p-6 text-center">
            <p className="nx-gold-text text-3xl font-black tracking-tight">SCAN. PAY. SAVE 15%.</p>
            <p className="mt-1 text-xs font-bold text-amber-100/80">Repeat — har visit par, kisi bhi partner shop par</p>
          </figcaption>
        </figure>
      </div>

      <p className="mt-8 text-center text-xs text-amber-100/60">*Offer Jaipur ke partner salons par Nexora QR payment ke saath. Details ke liye website visit karein.</p>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Campaign poster wall                                              */
/* ------------------------------------------------------------------ */

const POSTER_WALL = [
  { img: posterCrown, title: 'Top Jaipur Ranking', text: 'AI Growth System ke saath apne salon ko #1 tak le jao — reviews, QR payments aur referrals sab ek jagah.' },
  { img: posterSuccess, title: 'Book Pehle, Jao Baad Me', text: 'Aap haircut ke paise dete ho, waiting ke nahi. Confirmed slot, zero waiting, full style.' },
  { img: goldBanner, title: 'The Nexora Standard', text: 'Golden scissors wala premium experience — har partner salon me same standard, same trust.' },
  { img: goldSalon, title: 'Luxury Vibes, Partner Salons', text: 'Jaipur ke best salons, parlours, spas aur studios — sab Nexora network me.' },
];

const PosterWall: React.FC = () => (
  <section id="posters" className="scroll-mt-24 bg-white py-20 sm:py-24">
    <div className="mx-auto max-w-6xl px-4 sm:px-8">
      <SectionHeading
        eyebrow="Poster wall"
        icon="image"
        title={<>The <span className="text-[#C20E5A]">#PehleNexoraPhirSalon</span> campaign</>}
        sub="Salon ja rhe ho? Pehle Nexora kiya! — posters jo Jaipur bhar me dikh rahe hain."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {POSTER_WALL.map((p) => (
          <figure key={p.title} className="nx-glass nx-lift group overflow-hidden rounded-[2rem]">
            <span className="block overflow-hidden">
              <img src={p.img} alt={p.title} className="h-56 w-full object-cover transition-transform duration-700 group-hover:scale-105 sm:h-72" loading="lazy" />
            </span>
            <figcaption className="p-6">
              <h3 className="font-black tracking-tight">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-on-surface-variant">{p.text}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  FAQ                                                               */
/* ------------------------------------------------------------------ */

const FaqSection: React.FC = () => (
  <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-24">
    <div className="mx-auto max-w-3xl px-4 sm:px-8">
      <SectionHeading eyebrow="FAQ" icon="support_agent" title="Complete information, zero confusion" sub="Everything owners, customers and partners usually ask before starting." />
      <div className="mt-10 space-y-3">
        {FAQS.map((f) => (
          <details key={f.q} className="group rounded-2xl border border-rose-100 bg-[#fffafc] p-5 open:shadow-md open:shadow-rose-900/5 transition-shadow">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-black tracking-tight">
              {f.q}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[#C20E5A] transition-transform duration-300 group-open:rotate-45"><Ic name="add" className="text-base" /></span>
            </summary>
            <p className="mt-3 text-sm leading-7 text-on-surface-variant">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Landing page                                                      */
/* ------------------------------------------------------------------ */

export const LandingPage: React.FC<LandingPageProps> = ({ onBrowseTemplates, selectedTemplateId }) => {
  const selected = getTemplateById(selectedTemplateId);

  return (
    <main className="bg-surface text-on-surface">

      {/* ============================ HERO ============================ */}
      <section id="top" className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-20">
        {/* dreamy backdrop that makes the frosted glass pop */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_600px_at_80%_-10%,#ffe1ec_0%,transparent_60%),radial-gradient(900px_500px_at_0%_10%,#fde7f1_0%,transparent_55%),radial-gradient(700px_500px_at_50%_110%,#fff0f6_0%,transparent_60%)]" />
        <div className="nx-blob pointer-events-none absolute -left-24 top-32 h-80 w-80 rounded-full bg-[#f9a8c9]/50 blur-3xl" />
        <div className="nx-blob-alt pointer-events-none absolute right-0 top-16 h-96 w-96 rounded-full bg-[#e1b8ff]/40 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-8 lg:grid-cols-[1.05fr_.95fr]">
          {/* ---- Copy ---- */}
          <div>
            <span className="nx-rise inline-flex items-center gap-2 rounded-full border border-rose-200/70 bg-white/60 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#C20E5A] backdrop-blur-md">
              <Ic name="auto_awesome" className="text-sm" /> India’s AI-Powered Salon OS
            </span>
            <h1 className="nx-rise nx-rise-d1 mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Your Entire Salon.
              <span className="block bg-gradient-to-r from-[#C20E5A] via-[#e0447e] to-[#9333ea] bg-clip-text text-transparent">One Beautiful Platform.</span>
            </h1>
            <p className="nx-rise nx-rise-d2 mt-5 max-w-xl text-base leading-7 text-on-surface-variant sm:text-lg sm:leading-8">
              <strong className="font-extrabold text-on-surface">Nexora</strong> builds your salon a stunning website in minutes — then runs the whole business behind it:
              online bookings, loyalty rewards, staff &amp; commissions, offers, payments and analytics. Aapka salon, ab online — beautiful, bookable aur profitable.
            </p>

            <div className="nx-rise nx-rise-d3 mt-7 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => onBrowseTemplates()} className="group inline-flex items-center gap-2 rounded-2xl bg-[#C20E5A] px-7 py-3.5 text-sm font-black text-white shadow-xl shadow-rose-900/25 transition-all duration-300 hover:scale-[1.04] hover:bg-[#A30B4A] hover:shadow-2xl hover:shadow-rose-900/30">
                Choose Your Template <Ic name="arrow_forward" className="text-base transition-transform duration-300 group-hover:translate-x-1" />
              </button>
              <a href="#nexora-videos" className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/70 px-6 py-3.5 text-sm font-black text-[#C20E5A] backdrop-blur-md transition-all duration-300 hover:scale-[1.04] hover:border-rose-300 hover:bg-white">
                <Ic name="play_circle" className="text-lg" /> Watch It in Action
              </a>
              <a href="/growth-partner" className="inline-flex items-center gap-2 px-2 py-3.5 text-sm font-black text-[#C20E5A] transition-colors hover:underline">
                Earn as Growth Partner →
              </a>
            </div>

            <div className="nx-rise nx-rise-d4 mt-8 flex flex-wrap gap-2">
              {HERO_CHIPS.map((chip) => (
                <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full border border-rose-100 bg-white/80 px-3.5 py-2 text-xs font-bold text-on-surface backdrop-blur-sm">
                  <Ic name={chip.icon} className="text-sm text-[#C20E5A]" />{chip.label}
                </span>
              ))}
            </div>

            <div className="nx-rise nx-rise-d4 mt-8 flex items-center gap-3 text-sm">
              <span className="flex text-amber-400" aria-label="Rated 4.9 out of 5">
                {Array.from({ length: 5 }).map((_, i) => <Ic key={i} name="star" className="text-base fill-1" />)}
              </span>
              <span className="font-bold">4.9/5</span>
              <span className="text-on-surface-variant">loved by salon owners, stylists &amp; customers across India</span>
            </div>
          </div>

          {/* ---- THE MAIN CENTRAL GLASS CARD ---- */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            {/* floating chips around the card */}
            <div className="nx-glass-chip nx-float absolute -left-4 -top-5 z-20 hidden items-center gap-2 rounded-2xl px-4 py-3 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/90 text-white"><Ic name="event_available" className="text-lg" /></span>
              <span><span className="block text-[10px] font-black uppercase tracking-wider text-on-surface-variant">New Booking</span><span className="block text-xs font-extrabold">Balayage · Today 4:30 PM</span></span>
            </div>
            <div className="nx-glass-chip nx-float-delayed absolute -right-3 top-1/3 z-20 hidden items-center gap-2 rounded-2xl px-4 py-3 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-amber-950"><Ic name="redeem" className="text-lg" /></span>
              <span><span className="block text-[10px] font-black uppercase tracking-wider text-on-surface-variant">Reward Unlocked</span><span className="block text-xs font-extrabold">GLOW10 · 10% OFF 🎉</span></span>
            </div>
            <div className="nx-glass-chip nx-float absolute -bottom-5 left-8 z-20 hidden items-center gap-2 rounded-2xl px-4 py-3 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C20E5A] text-white"><Ic name="trending_up" className="text-lg" /></span>
              <span><span className="block text-[10px] font-black uppercase tracking-wider text-on-surface-variant">This Week</span><span className="block text-xs font-extrabold">₹48,200 · 62 bookings</span></span>
            </div>

            {/* the glass card itself */}
            <div className="nx-glass nx-lift relative z-10 rounded-[2rem] p-4 sm:p-5">
              <div className="flex items-center justify-between px-2 pb-3 pt-1">
                <span className="inline-flex items-center gap-2 text-xs font-black tracking-tight text-[#C20E5A]">
                  <Ic name="spa" className="text-base fill-1" /> Nexora Live Preview
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
                </span>
              </div>
              <div className="overflow-hidden rounded-3xl border border-white/60 shadow-inner">
                <img src={SALON_IMAGES.hero} alt="Nexora salon website preview" className="h-64 w-full object-cover sm:h-80" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {[
                  { icon: 'calendar_month', k: 'Bookings', v: '24/7' },
                  { icon: 'loyalty', k: 'Points', v: '2x Tier' },
                  { icon: 'payments', k: 'Payouts', v: 'Instant' },
                ].map((m) => (
                  <div key={m.k} className="nx-glass-chip rounded-2xl px-2 py-3 text-center">
                    <Ic name={m.icon} className="text-lg text-[#C20E5A]" />
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{m.k}</p>
                    <p className="text-xs font-black">{m.v}</p>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => onBrowseTemplates()} className="mt-4 w-full rounded-2xl bg-[#C20E5A] py-3 text-sm font-black text-white shadow-lg shadow-rose-900/25 transition-all duration-300 hover:bg-[#A30B4A]">
                Launch Yours Free →
              </button>
            </div>
          </div>
        </div>

        {/* ---- factual stats band ---- */}
        <div className="relative mx-auto mt-16 max-w-6xl px-4 sm:px-8">
          <div className="nx-glass grid grid-cols-2 gap-6 rounded-[2rem] p-6 sm:p-8 lg:grid-cols-4">
            {PLATFORM_STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="bg-gradient-to-r from-[#C20E5A] to-[#9333ea] bg-clip-text text-3xl font-black text-transparent sm:text-4xl">{s.value}</p>
                <p className="mt-1 text-sm font-black">{s.label}</p>
                <p className="text-xs text-on-surface-variant">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ ABOUT ============================ */}
      <section id="about" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <SectionHeading
            eyebrow="About the app"
            icon="info"
            title={<>What is <span className="text-[#C20E5A]">Nexora</span>?</>}
            sub="One platform with three superpowers — build your presence, run your shop, grow your crowd. Built for India’s beauty & wellness businesses."
          />
          <div className="mt-14 space-y-8">
            {PILLARS.map((p, i) => (
              <article key={p.title} className={`nx-glass nx-lift grid items-center gap-8 overflow-hidden rounded-[2rem] p-6 sm:p-8 lg:grid-cols-2 ${i % 2 === 1 ? 'lg:[&>figure]:order-first' : ''}`}>
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C20E5A] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">
                    <Ic name={p.icon} className="text-sm" />{p.tag}
                  </span>
                  <h3 className="mt-4 text-2xl font-black tracking-tight">{p.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-on-surface-variant sm:text-base">{p.text}</p>
                </div>
                <figure className="overflow-hidden rounded-3xl border border-white/60 shadow-lg">
                  <img src={p.img} alt={p.alt} className="h-56 w-full object-cover sm:h-72" loading="lazy" />
                </figure>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ VIDEOS ============================ */}
      <VideoShowcase />

      {/* ============================ CAMPAIGN POSTER ============================ */}
      <CampaignPoster />

      {/* ============================ PROBLEM TO SOLUTION ============================ */}
      <ProblemSolutionSection />

      {/* ============================ JAIPUR 15 PERCENT QR OFFER ============================ */}
      <JaipurDiscountSection />

      {/* ============================ CUSTOMERS ============================ */}
      <section id="customers" className="scroll-mt-24 bg-gradient-to-b from-[#fff5f8] to-surface py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <SectionHeading
            eyebrow="For customers"
            icon="favorite"
            title={<>Why customers <span className="text-[#C20E5A]">keep coming back</span></>}
            sub="A five-star experience before, during and after the appointment — from first tap to free rewards."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CUSTOMER_BENEFITS.map((b) => (
              <div key={b.title} className="nx-glass nx-lift rounded-3xl p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#C20E5A]/10 text-[#C20E5A]"><Ic name={b.icon} className="text-xl" /></span>
                <h3 className="mt-4 font-black tracking-tight">{b.title}</h3>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">{b.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm font-bold text-on-surface-variant">
            Book your next appointment on any Nexora-powered salon website — rewards start from your very first visit.
          </p>
        </div>
      </section>

      {/* ============================ REWARDS ============================ */}
      <RewardsSection />

      {/* ============================ POSTER WALL ============================ */}
      <PosterWall />

      {/* ============================ OWNERS ============================ */}
      <section id="owners" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <SectionHeading
            eyebrow="For shop owners"
            icon="storefront"
            title={<>Run your shop like a <span className="text-[#C20E5A]">chain, not a struggle</span></>}
            sub="Everything a salon, spa or parlour owner needs on one dashboard — so you spend time on customers, not paperwork."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {OWNER_BENEFITS.map((b) => (
              <div key={b.title} className="nx-glass nx-lift rounded-3xl p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#C20E5A] to-[#9333ea] text-white shadow-lg"><Ic name={b.icon} className="text-xl" /></span>
                <h3 className="mt-4 text-sm font-black tracking-tight">{b.title}</h3>
                <p className="mt-2 text-xs leading-6 text-on-surface-variant">{b.text}</p>
              </div>
            ))}
          </div>
          <div className="nx-glass mt-10 flex flex-col items-center gap-6 rounded-[2rem] p-8 text-center lg:flex-row lg:text-left">
            <img src={SALON_IMAGES.lashBrow} alt="Happy salon customer" className="h-40 w-full rounded-3xl object-cover lg:h-32 lg:w-56" loading="lazy" />
            <div className="flex-1">
              <h3 className="text-xl font-black tracking-tight">“Best decision we made this year.”</h3>
              <p className="mt-2 text-sm leading-7 text-on-surface-variant">
                Owners on Nexora replace 4–5 separate tools — website builder, booking app, POS, loyalty program and marketing tool — with one login, one bill and one beautiful experience for their customers.
              </p>
            </div>
            <button type="button" onClick={() => onBrowseTemplates()} className="shrink-0 rounded-2xl bg-[#C20E5A] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-rose-900/25 transition-all duration-300 hover:scale-[1.04] hover:bg-[#A30B4A]">
              Start Free Today
            </button>
          </div>
        </div>
      </section>

      {/* ============================ GROWTH PARTNER ============================ */}
      <section id="partner" className="scroll-mt-24 bg-gradient-to-b from-surface to-[#fff5f8] py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-8 lg:grid-cols-2">
          <figure className="nx-glass nx-lift overflow-hidden rounded-[2rem] p-3">
            <img src={partnerHero} alt="Nexora Growth Partner program" className="h-72 w-full rounded-3xl object-cover sm:h-96" loading="lazy" />
          </figure>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C20E5A] px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white">
              <Ic name="handshake" className="text-sm" /> Growth Partner Program
            </span>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Earn with Nexora, <span className="text-[#C20E5A]">not just on it</span></h2>
            <p className="mt-4 text-sm leading-7 text-on-surface-variant sm:text-base">
              Love the beauty industry? Become a Growth Partner: get your own referral code, help local salons launch on Nexora,
              and build a recurring income stream with full transparency.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {PARTNER_PERKS.map((p) => (
                <div key={p.title} className="nx-glass rounded-2xl p-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C20E5A]/10 text-[#C20E5A]"><Ic name={p.icon} className="text-lg" /></span>
                  <h3 className="mt-3 text-sm font-black">{p.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-on-surface-variant">{p.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/growth-partner" className="inline-flex items-center gap-2 rounded-2xl bg-[#C20E5A] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-rose-900/25 transition-all duration-300 hover:scale-[1.04] hover:bg-[#A30B4A]">
                <Ic name="rocket_launch" className="text-base" /> Join the Program
              </a>
              <a href="/growth-partner/login" className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/70 px-6 py-3.5 text-sm font-black text-[#C20E5A] backdrop-blur-md transition-all duration-300 hover:scale-[1.04] hover:bg-white">
                Partner Login
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ TEMPLATES ============================ */}
      <section id="templates" className="scroll-mt-24 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <SectionHeading
            eyebrow="Templates"
            icon="palette"
            title={<>A design for <span className="text-[#C20E5A]">every kind of beauty business</span></>}
            sub="27+ ready websites across hair, barber, beauty, nails, spa, skin, tattoo, bridal and more. Pick one, make it yours, go live."
          />
          <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
            {TEMPLATE_CATEGORIES.map((t) => (
              <button key={t.label} type="button" onClick={() => onBrowseTemplates(t.cat)} className="nx-glass nx-lift group overflow-hidden rounded-3xl text-left">
                <span className="block overflow-hidden">
                  <img src={t.img} alt={t.label} className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-44" loading="lazy" />
                </span>
                <span className="block p-4">
                  <span className="block text-sm font-black tracking-tight">{t.label}</span>
                  <span className="mt-1 flex items-center justify-between text-xs font-bold text-on-surface-variant">
                    {t.count}
                    <Ic name="arrow_forward" className="text-sm text-[#C20E5A] transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-10 text-center">
            <button type="button" onClick={() => onBrowseTemplates()} className="inline-flex items-center gap-2 rounded-2xl bg-[#C20E5A] px-8 py-4 text-sm font-black text-white shadow-xl shadow-rose-900/25 transition-all duration-300 hover:scale-[1.04] hover:bg-[#A30B4A]">
              Browse All 27+ Templates <Ic name="arrow_forward" className="text-base" />
            </button>
          </div>
        </div>
      </section>

      {/* ============================ TESTIMONIALS ============================ */}
      <section id="stories" className="scroll-mt-24 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <SectionHeading eyebrow="Community stories" icon="forum" title="Loved by owners, customers & partners" sub="One platform, three happy sides of the counter." />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <blockquote key={t.name} className="nx-glass nx-lift flex flex-col rounded-3xl p-7">
                <span className="flex text-amber-400" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, i) => <Ic key={i} name="star" className="text-base fill-1" />)}
                </span>
                <p className="mt-4 flex-1 text-sm leading-7 text-on-surface-variant">“{t.quote}”</p>
                <footer className="mt-6 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-lg" aria-hidden="true">{t.emoji}</span>
                  <span>
                    <span className="block text-sm font-black">{t.name}</span>
                    <span className="block text-xs font-bold text-on-surface-variant">{t.role}</span>
                  </span>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FAQ ============================ */}
      <FaqSection />

      {/* ============================ FINAL CTA ============================ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#C20E5A] via-[#a81263] to-[#6d28d9] py-20 sm:py-24">
        <div className="nx-blob pointer-events-none absolute left-10 top-8 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
        <div className="nx-blob-alt pointer-events-none absolute bottom-6 right-10 h-80 w-80 rounded-full bg-fuchsia-300/25 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-8">
          <div className="nx-glass nx-lift rounded-[2.5rem] p-10 sm:p-14">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white/30 text-white border border-white/50 backdrop-blur-md"><Ic name="spa" className="text-3xl fill-1" /></span>
            <h2 className="mt-6 text-3xl font-black tracking-tight text-white sm:text-4xl">Ready to give your salon its digital glow-up?</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-rose-50/90 sm:text-base">
              Join Nexora free — pick your template today and be bookable by tonight. Customers get rewards, owners get growth, partners get income.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => onBrowseTemplates()} className="rounded-2xl bg-white px-8 py-4 text-sm font-black text-[#C20E5A] shadow-2xl transition-all duration-300 hover:scale-[1.05] hover:shadow-white/25">
                Choose Your Template
              </button>
              <a href="/signup" className="rounded-2xl border border-white/60 bg-white/15 px-8 py-4 text-sm font-black text-white backdrop-blur-md transition-all duration-300 hover:scale-[1.05] hover:bg-white/25">
                Create Free Account
              </a>
            </div>
            <p className="mt-6 text-xs font-bold text-rose-100/80">No credit card · No code · Live in minutes</p>
          </div>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="border-t border-rose-100 bg-[#fffafc] py-12">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 text-xl font-black tracking-tight text-[#C20E5A]">
              <Ic name="spa" className="text-2xl fill-1" /> Nexora
            </span>
            <p className="mt-3 max-w-sm text-sm leading-6 text-on-surface-variant">
              The AI-powered website builder and all-in-one operating system for salons, spas, barbers and every beauty business in between.
            </p>
            <p className="mt-4 text-xs font-bold text-on-surface-variant">Made with <span className="text-[#C20E5A]">♥</span> in India</p>
          </div>
          <nav aria-label="Product links">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-on-surface-variant">Explore</h3>
            <ul className="mt-4 space-y-2.5 text-sm font-bold">
              <li><button type="button" onClick={() => onBrowseTemplates()} className="text-on-surface transition-colors hover:text-[#C20E5A]">Templates</button></li>
              <li><a href="/growth-partner" className="text-on-surface transition-colors hover:text-[#C20E5A]">Growth Partner Program</a></li>
              <li><a href="/customer/bookings" className="text-on-surface transition-colors hover:text-[#C20E5A]">My Bookings</a></li>
              <li><a href="#faq" className="text-on-surface transition-colors hover:text-[#C20E5A]">FAQ</a></li>
            </ul>
          </nav>
          <nav aria-label="Get started links">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-on-surface-variant">Get Started</h3>
            <ul className="mt-4 space-y-2.5 text-sm font-bold">
              <li><a href="/signup" className="text-on-surface transition-colors hover:text-[#C20E5A]">Create Account</a></li>
              <li><button type="button" onClick={() => onBrowseTemplates()} className="text-on-surface transition-colors hover:text-[#C20E5A]">Choose a Template</button></li>
              <li><a href="#nexora-videos" className="text-on-surface transition-colors hover:text-[#C20E5A]">Watch Videos</a></li>
              <li><a href="#top" className="text-on-surface transition-colors hover:text-[#C20E5A]">Back to Top ↑</a></li>
            </ul>
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl px-4 text-xs text-on-surface-variant sm:px-8">© {new Date().getFullYear()} Nexora · Salon OS. All rights reserved.</p>
      </footer>

      {/* ---- continuity: previously selected template ---- */}
      {selected && (
        <section className="mx-auto max-w-6xl px-4 pb-10 sm:px-8">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <img src={selected.thumbnailUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Selected design</p>
              <p className="font-black">{selected.name}</p>
            </div>
            <button type="button" onClick={() => onBrowseTemplates()} className="ml-auto text-sm font-black text-emerald-800 hover:underline">Change Template</button>
          </div>
        </section>
      )}
    </main>
  );
};
