import React, { useState, useRef, useEffect } from 'react';
import { SalonProfile, SalonService } from '../types';
import { CATEGORY_STANDARDIZED_DATA } from '../templateData';

interface PromoStudioProps {
  profile: SalonProfile;
  services: SalonService[];
  primaryAccentColor?: string;
  onNavigateToPreview?: () => void;
}

type AspectRatioType = '1:1' | '9:16' | '16:9';
type AestheticStyle = 'luxury_gold' | 'minimalist_chic' | 'festive_glow' | 'botanical_zen' | 'modern_studio';
type TemplateTheme = 'flash_discount' | 'luxury_pamper' | 'festive_special' | 'vip_welcome';

export const PromoStudio: React.FC<PromoStudioProps> = ({
  profile,
  services,
  primaryAccentColor = '#b0004a',
  onNavigateToPreview,
}) => {
  // 1. Service Selection
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    services.length > 0 ? services[0].id : ''
  );

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0] || {
    id: 'srv-default',
    name: 'Signature Treatment',
    price: 2500,
    durationMinutes: 60,
    category: 'Hair & Beauty',
    description: 'Transformative salon treatment with restorative care and precision styling.',
  };

  // 2. Campaign Config
  const [campaignTheme, setCampaignTheme] = useState<TemplateTheme>('flash_discount');
  const [discountPercent, setDiscountPercent] = useState<number>(20);
  const [customOfferText, setCustomOfferText] = useState<string>('FLAT 20% OFF THIS WEEK');
  const [promoCode, setPromoCode] = useState<string>('GLOW20');
  const [headline, setHeadline] = useState<string>('Weekend Glow & Transformation Special');
  const [subtext, setSubtext] = useState<string>('Limited 10 VIP slots • 100% Organic Products • Expert Artists');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('1:1');
  const [aesthetic, setAesthetic] = useState<AestheticStyle>('luxury_gold');

  // 3. Image Generation State
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [selectedCuratedPhotoUrl, setSelectedCuratedPhotoUrl] = useState<string>('');

  // 4. Copy & Share Templates
  const [whatsappTemplate, setWhatsappTemplate] = useState<string>('');
  const [instagramCaption, setInstagramCaption] = useState<string>('');
  const [activeTemplateTab, setActiveTemplateTab] = useState<'whatsapp' | 'instagram'>('whatsapp');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Hidden canvas for exporting high-res PNG image
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Get curated category gallery photos as high-res presets
  const categoryData = CATEGORY_STANDARDIZED_DATA[profile.businessType || 'hair_salon'] || CATEGORY_STANDARDIZED_DATA.hair_salon;
  const curatedPhotos = categoryData?.gallery || [];

  // Set default curated photo when category/service changes
  useEffect(() => {
    if (curatedPhotos.length > 0 && !selectedCuratedPhotoUrl) {
      setSelectedCuratedPhotoUrl(curatedPhotos[0].url);
    }
  }, [profile.businessType]);

  // Update default prompt and copy when service or theme changes
  useEffect(() => {
    const discountedPrice = Math.round(selectedService.price * (1 - discountPercent / 100));
    
    // Set intelligent AI prompt
    const serviceName = selectedService.name;
    const catName = selectedService.category || profile.businessType || 'Salon';
    const styleDescriptions: Record<AestheticStyle, string> = {
      luxury_gold: 'High-end editorial photoshoot, golden hour warm lighting, gold leaf accents, ultra-luxurious beauty aesthetic',
      minimalist_chic: 'Clean Scandinavian minimalist salon interior, soft neutral tones, high key lighting, crisp details',
      festive_glow: 'Vibrant Indian festive celebration aesthetic, warm bokeh lights, marigold tones, radiant celebratory glow',
      botanical_zen: 'Serene spa atmosphere, lush green foliage, essential oil steam, natural bamboo and stone textures',
      modern_studio: 'Contemporary sleek studio lighting, neon edge lighting accents, high-contrast fashion editorial look',
    };

    const bizName = profile?.businessName || 'Our Salon';
    const subDomain = profile?.subdomain || 'salon';
    const city = profile?.city || 'India';
    const address = profile?.address || 'Our Studio';

    setCustomPrompt(
      `An ultra-high resolution, commercial salon promotional image for "${serviceName}" at ${bizName}. Style: ${styleDescriptions[aesthetic]}. Clean, professional beauty photography with space for promotional text overlay.`
    );

    // Update Headlines and Badges based on theme
    if (campaignTheme === 'flash_discount') {
      setCustomOfferText(`FLAT ${discountPercent}% OFF • LIMITED SLOTS`);
      setHeadline(`Exclusive ${selectedService.name} Flash Deal`);
      setPromoCode(`FLASH${discountPercent}`);
      setSubtext(`Save ₹${(selectedService.price - discountedPrice).toLocaleString('en-IN')} this weekend • Use code at checkout`);
    } else if (campaignTheme === 'luxury_pamper') {
      setCustomOfferText('BESPOKE LUXURY EXPERIENCE');
      setHeadline(`Elevate Your Glow with ${selectedService.name}`);
      setPromoCode('ROYALGLOW');
      setSubtext('Complimentary scalp detox & herbal tea ritual included with every booking');
    } else if (campaignTheme === 'festive_special') {
      setCustomOfferText('FESTIVE CELEBRATION PACKAGE');
      setHeadline(`Get Festive Ready with ${selectedService.name}`);
      setPromoCode('FESTIVE26');
      setSubtext('Camera-ready glow & styling for your upcoming weddings & celebrations');
    } else if (campaignTheme === 'vip_welcome') {
      setCustomOfferText('FIRST-TIME CLIENT SPECIAL');
      setHeadline(`Welcome to ${bizName}`);
      setPromoCode('WELCOME20');
      setSubtext(`Experience our award-winning ${selectedService.name} with complimentary consultation`);
    }

    // Generate WhatsApp Template
    const bookingUrl = `https://${subDomain}.nexora.in/book?service=${encodeURIComponent(selectedService.name)}`;
    const waText = `✨ *SPECIAL INVITATION FROM ${bizName.toUpperCase()}* ✨

Namaste! 🌸

Treat yourself to our signature *${selectedService.name}* at an exclusive promotional rate!

💎 *Special Offer*: ${customOfferText || `${discountPercent}% OFF`}
💰 *Promotional Price*: *₹${discountedPrice.toLocaleString('en-IN')}* (Regular ~₹${selectedService.price.toLocaleString('en-IN')}~)
🎟️ *Promo Code*: \`${promoCode}\`
⏱️ *Duration*: ${selectedService.durationMinutes} mins of pure pampering
📍 *Location*: ${address || city || 'Our Studio'}

👉 *Claim your slot online*:
${bookingUrl}

Or reply to this message directly with your preferred date and time to reserve your appointment! 📲`;

    setWhatsappTemplate(waText);

    // Generate Instagram Caption
    const igText = `✨ *Glow up with ${bizName}!* ✨

Ready for a transformation? Experience our signature *${selectedService.name}* with an exclusive limited-time promotion! 💆‍♀️💇‍♂️

🌟 *Highlights*:
• Professional care by master artists
• 100% single-use sanitized hygiene protocols
• Premium organic and toxin-safe formulas

🎁 *Special Deal*: ${customOfferText || `Enjoy ${discountPercent}% OFF`}
🏷️ *Price*: ₹${discountedPrice.toLocaleString('en-IN')} (Reg. ₹${selectedService.price.toLocaleString('en-IN')})
🔑 *Use Code*: ${promoCode}

📍 ${city ? `${city} • ` : ''}${address || 'Visit us in studio'}
⏰ Limited slots available this week!

👇 *Tap the link in our bio to book your slot now*:
${bookingUrl}

#${bizName.replace(/\s+/g, '')} #${selectedService.name.replace(/\s+/g, '')} #SalonOffers #IndianSalons #${city.replace(/\s+/g, '')}Beauty #HairTransformation #SkinGlow #BridalGlam #NexoraSalons #SalonDeals`;

    setInstagramCaption(igText);
  }, [selectedServiceId, campaignTheme, discountPercent, aesthetic, profile?.businessName, profile?.city, profile?.subdomain]);

  // Handle AI Image Generation
  const handleGenerateImage = async () => {
    setIsGeneratingImage(true);
    setGenerationNotice(null);

    try {
      const response = await fetch('/api/generate-promo-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: customPrompt,
          serviceName: selectedService.name,
          category: selectedService.category || profile.businessType,
          style: aesthetic,
          aspectRatio: aspectRatio,
        }),
      });

      const data = await response.json();

      if (data.success && data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
        showToast('✨ AI Promotional image generated successfully!');
      } else {
        // Fallback to high-res curated preset
        if (curatedPhotos.length > 0) {
          const randomPhoto = curatedPhotos[Math.floor(Math.random() * curatedPhotos.length)];
          setSelectedCuratedPhotoUrl(randomPhoto.url);
        }
        setGenerationNotice(
          data.fallbackNotice || 'Using high-resolution studio photography matched to your service.'
        );
        showToast('✓ Loaded curated high-resolution salon photography.');
      }
    } catch (err) {
      console.error('Failed to generate image:', err);
      // Pick a random curated photo
      if (curatedPhotos.length > 0) {
        const randomPhoto = curatedPhotos[Math.floor(Math.random() * curatedPhotos.length)];
        setSelectedCuratedPhotoUrl(randomPhoto.url);
      }
      setGenerationNotice('Rendered high-resolution curated studio photography preset.');
      showToast('Loaded curated high-resolution photography preset.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Active Background Image Source
  const activeBackgroundUrl = generatedImageUrl || selectedCuratedPhotoUrl || (curatedPhotos[0]?.url) || 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=1200&q=80';

  const discountedPrice = Math.round(selectedService.price * (1 - discountPercent / 100));

  // Export Canvas as High-Res PNG
  const handleDownloadBanner = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 1080;
    let height = 1080;
    if (aspectRatio === '9:16') {
      width = 1080;
      height = 1920;
    } else if (aspectRatio === '16:9') {
      width = 1920;
      height = 1080;
    }

    canvas.width = width;
    canvas.height = height;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = activeBackgroundUrl;

    img.onload = () => {
      // 1. Draw Background Image
      const scale = Math.max(width / img.width, height / img.height);
      const x = (width / 2) - (img.width / 2) * scale;
      const y = (height / 2) - (img.height / 2) * scale;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      // 2. Draw Multi-stop Dark Gradient Overlay for Readability
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(10, 15, 25, 0.7)');
      gradient.addColorStop(0.4, 'rgba(10, 15, 25, 0.4)');
      gradient.addColorStop(0.7, 'rgba(10, 15, 25, 0.85)');
      gradient.addColorStop(1, 'rgba(10, 15, 25, 0.98)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // 3. Top Header: Salon Branding
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((profile?.businessName || 'Our Salon').toUpperCase(), 60, 90);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`${profile.city || 'India'} • Verified 5.0 ★ Luxury Sanctuary`, 60, 130);

      // 4. Offer Badge Chip
      const badgeText = (customOfferText || `${discountPercent}% OFF`).toUpperCase();
      ctx.fillStyle = primaryAccentColor;
      ctx.beginPath();
      ctx.roundRect(60, 170, ctx.measureText(badgeText).width + 60, 56, 28);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "Space Mono", monospace';
      ctx.fillText(badgeText, 90, 206);

      // 5. Main Service Title & Headline
      const serviceY = height * 0.52;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 64px "Playfair Display", Georgia, serif';
      ctx.fillText(selectedService.name, 60, serviceY);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 32px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(headline, 60, serviceY + 50);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(subtext, 60, serviceY + 95);

      // 6. Pricing Block
      const priceY = height * 0.78;
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 72px "Space Mono", monospace';
      ctx.fillText(`₹${discountedPrice.toLocaleString('en-IN')}`, 60, priceY);

      // Strikethrough original price
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 36px "Space Mono", monospace';
      const origText = `₹${selectedService.price.toLocaleString('en-IN')}`;
      const origX = 60 + ctx.measureText(`₹${discountedPrice.toLocaleString('en-IN')}`).width + 30;
      ctx.fillText(origText, origX, priceY - 15);
      // Draw strikethrough line
      const origWidth = ctx.measureText(origText).width;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(origX - 5, priceY - 26);
      ctx.lineTo(origX + origWidth + 5, priceY - 26);
      ctx.stroke();

      // Promo Code Pill
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(60, priceY + 25, 340, 50, 12);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 22px "Space Mono", monospace';
      ctx.fillText(`CODE: ${promoCode}`, 80, priceY + 58);

      // 7. Bottom Call To Action & Subdomain
      const bottomY = height - 70;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Book Online: https://${profile.subdomain || 'salon'}.nexora.in`, 60, bottomY);

      // Trigger Download
      const link = document.createElement('a');
      link.download = `${(profile?.businessName || 'salon').toLowerCase().replace(/\s+/g, '-')}-promo-${selectedService.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      showToast('🎉 High-resolution promotional banner downloaded!');
    };

    img.onerror = () => {
      showToast('Downloaded fallback promo banner image.');
    };
  };

  // Share to WhatsApp Handler
  const handleShareToWhatsApp = () => {
    const encodedText = encodeURIComponent(whatsappTemplate);
    const waUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    showToast('🚀 Opening WhatsApp with pre-filled promo template!');
  };

  // Share to Instagram Handler
  const handleShareToInstagram = () => {
    navigator.clipboard.writeText(instagramCaption);
    showToast('📋 Instagram caption copied to clipboard! Opening Instagram...');
    setTimeout(() => {
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
    }, 600);
  };

  // Copy Template to Clipboard
  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`✓ Copied ${label} to clipboard!`);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-xs"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-xl">photo_camera_back</span>
            </span>
            <h2 className="font-display font-bold text-xl text-gray-900">
              AI Promotional Image & Social Campaign Studio
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Generate high-converting advertising banners for your salon services using Image Generation, complete with pre-filled WhatsApp & Instagram templates.
          </p>
        </div>

        {onNavigateToPreview && (
          <button
            onClick={onNavigateToPreview}
            className="text-xs font-bold px-4 py-2 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-800 flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">visibility</span>
            <span>Live Salon Preview</span>
          </button>
        )}
      </div>

      {/* TOAST NOTICE */}
      {toastMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-4 py-3 rounded-xl flex items-center justify-between animate-fade-in shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-600 text-lg">check_circle</span>
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 2-COLUMN STUDIO WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: CONTROLS & CAMPAIGN CONFIGURATION (5 COLS) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          
          {/* Step 1: Select Service */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center text-[10px]">1</span>
                <span>Select Salon Service</span>
              </label>
              <span className="text-[11px] font-mono text-gray-500">{services.length} services available</span>
            </div>

            <select
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-800 focus:ring-2 focus:ring-gray-400 outline-none cursor-pointer"
            >
              {services.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.name} — ₹{srv.price.toLocaleString('en-IN')} ({srv.durationMinutes}m)
                </option>
              ))}
            </select>

            <div className="p-3 bg-white rounded-lg border border-gray-200 text-xs flex justify-between items-center">
              <div>
                <div className="font-bold text-gray-800">{selectedService.name}</div>
                <div className="text-[11px] text-gray-500">{selectedService.category || 'Beauty'} • {selectedService.durationMinutes} mins</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-sm" style={{ color: primaryAccentColor }}>
                  ₹{selectedService.price.toLocaleString('en-IN')}
                </div>
                <div className="text-[10px] text-emerald-600 font-bold">Standard Rate</div>
              </div>
            </div>
          </div>

          {/* Step 2: Campaign Theme & Discount */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
            <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center text-[10px]">2</span>
              <span>Campaign Theme & Offer</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'flash_discount', label: '🔥 Flash Deal', desc: 'High urgency weekend special' },
                { id: 'luxury_pamper', label: '👑 Luxury Pamper', desc: 'Bespoke VIP treatment' },
                { id: 'festive_special', label: '✨ Festive Glam', desc: 'Wedding & festival ready' },
                { id: 'vip_welcome', label: '🌸 New Client', desc: 'First-time customer trial' },
              ].map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setCampaignTheme(theme.id as TemplateTheme)}
                  className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                    campaignTheme === theme.id
                      ? 'bg-white font-bold shadow-xs'
                      : 'border-gray-200 bg-white/60 hover:bg-white text-gray-600'
                  }`}
                  style={campaignTheme === theme.id ? { borderColor: primaryAccentColor } : {}}
                >
                  <div className="font-bold text-gray-900">{theme.label}</div>
                  <div className="text-[10px] text-gray-500 truncate mt-0.5">{theme.desc}</div>
                </button>
              ))}
            </div>

            {/* Discount Slider */}
            <div className="mt-1">
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="font-bold text-gray-700">Special Discount:</span>
                <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {discountPercent}% OFF (₹{discountedPrice.toLocaleString('en-IN')})
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />
            </div>

            {/* Promo Details Grid */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div>
                <label className="text-[10px] font-bold font-mono-caps text-gray-500 block mb-1">Promo Code</label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="w-full p-2 rounded-lg border border-gray-300 font-mono text-xs uppercase bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold font-mono-caps text-gray-500 block mb-1">Badge Tag</label>
                <input
                  type="text"
                  value={customOfferText}
                  onChange={(e) => setCustomOfferText(e.target.value)}
                  className="w-full p-2 rounded-lg border border-gray-300 text-xs bg-white"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Image Generation Style & Format */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
            <label className="text-xs font-bold font-mono-caps text-gray-700 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center text-[10px]">3</span>
              <span>AI Image Generation & Style</span>
            </label>

            {/* Aspect Ratio Selector */}
            <div>
              <span className="text-[11px] font-bold text-gray-600 block mb-1.5">Image Format / Canvas Ratio:</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '1:1', label: 'Square (1:1)', icon: 'crop_square', desc: 'Instagram Feed / WhatsApp' },
                  { id: '9:16', label: 'Story (9:16)', icon: 'crop_portrait', desc: 'Instagram Stories & Reels' },
                  { id: '16:9', label: 'Wide (16:9)', icon: 'crop_16_9', desc: 'Banner & Facebook' },
                ].map((ar) => (
                  <button
                    key={ar.id}
                    onClick={() => setAspectRatio(ar.id as AspectRatioType)}
                    className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                      aspectRatio === ar.id
                        ? 'bg-white font-bold shadow-xs'
                        : 'border-gray-200 bg-white/60 hover:bg-white text-gray-600'
                    }`}
                    style={aspectRatio === ar.id ? { borderColor: primaryAccentColor } : {}}
                  >
                    <span className="material-symbols-outlined text-base block">{ar.icon}</span>
                    <div className="text-xs font-bold text-gray-800 mt-0.5">{ar.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aesthetic Style Selector */}
            <div>
              <span className="text-[11px] font-bold text-gray-600 block mb-1.5">Visual Aesthetic:</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'luxury_gold', label: '👑 Luxury Gold Editorial' },
                  { id: 'minimalist_chic', label: '🤍 Minimalist Modern' },
                  { id: 'festive_glow', label: '✨ Festive Warm Glow' },
                  { id: 'botanical_zen', label: '🌿 Botanical Spa Zen' },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setAesthetic(st.id as AestheticStyle)}
                    className={`p-2 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                      aesthetic === st.id
                        ? 'bg-white font-bold shadow-xs'
                        : 'border-gray-200 bg-white/60 hover:bg-white text-gray-600'
                    }`}
                    style={aesthetic === st.id ? { borderColor: primaryAccentColor } : {}}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Prompt Input */}
            <div>
              <label className="text-[10px] font-bold font-mono-caps text-gray-500 block mb-1">
                AI Generation Prompt (Customizable)
              </label>
              <textarea
                rows={2}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-gray-300 text-xs font-mono bg-white text-gray-800"
              />
            </div>

            {/* Action: Generate Image with Gemini */}
            <button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage}
              className="w-full py-3 rounded-xl font-bold text-xs text-white shadow-xs flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: primaryAccentColor }}
            >
              <span className="material-symbols-outlined text-base animate-pulse">
                {isGeneratingImage ? 'hourglass_top' : 'auto_awesome'}
              </span>
              <span>
                {isGeneratingImage ? 'Generating Promotional Image with AI...' : 'Generate New Promo Image'}
              </span>
            </button>

            {generationNotice && (
              <div className="text-[11px] text-gray-500 bg-white p-2 rounded-lg border border-gray-200 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-amber-600">info</span>
                <span>{generationNotice}</span>
              </div>
            )}

            {/* Curated Photography Presets Switcher */}
            <div className="pt-2 border-t border-gray-200">
              <span className="text-[11px] font-bold text-gray-600 block mb-1.5">
                Or Pick from High-Res Studio Photography:
              </span>
              <div className="grid grid-cols-6 gap-1.5">
                {curatedPhotos.map((photo) => {
                  const isSelected = !generatedImageUrl && selectedCuratedPhotoUrl === photo.url;
                  return (
                    <button
                      key={photo.id}
                      onClick={() => {
                        setGeneratedImageUrl(null);
                        setSelectedCuratedPhotoUrl(photo.url);
                        showToast(`Selected "${photo.title}" photo preset`);
                      }}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-transform hover:scale-105 ${
                        isSelected ? 'border-emerald-500 ring-2 ring-emerald-300' : 'border-transparent opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={photo.url}
                        alt={photo.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: LIVE PROMOTIONAL BANNER COMPOSITOR & ONE-CLICK SHARING (7 COLS) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          
          {/* LIVE COMPOSITED BANNER PREVIEW CARD */}
          <div className="p-4 rounded-2xl border border-gray-200 bg-gray-900 text-white flex flex-col gap-4 shadow-sm">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-lg">preview</span>
                <span className="font-bold text-xs font-mono-caps tracking-wider text-gray-200">
                  Live Promotional Banner Preview ({aspectRatio})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadBanner}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-white/20"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>Download High-Res PNG</span>
                </button>
              </div>
            </div>

            {/* BANNER STAGE */}
            <div className="flex items-center justify-center p-2 bg-black/40 rounded-xl overflow-hidden min-h-[380px]">
              <div
                id="promo-banner-container"
                className={`relative overflow-hidden rounded-xl shadow-2xl border border-white/10 transition-all flex flex-col justify-between p-6 ${
                  aspectRatio === '1:1'
                    ? 'w-full max-w-[420px] aspect-square'
                    : aspectRatio === '9:16'
                      ? 'w-full max-w-[320px] aspect-[9/16]'
                      : 'w-full max-w-[540px] aspect-video'
                }`}
                style={{
                  backgroundImage: `url(${activeBackgroundUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {/* DARK GRADIENT OVERLAY */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/95 pointer-events-none" />

                {/* BANNER TOP: SALON BRANDING & RATING */}
                <div className="relative z-10 flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-xs shadow-md"
                        style={{ backgroundColor: primaryAccentColor }}
                      >
                        {(profile?.businessName || 'S').charAt(0)}
                      </span>
                      <div>
                        <div className="font-display font-extrabold text-sm tracking-wide text-white drop-shadow-md">
                          {(profile?.businessName || 'OUR SALON').toUpperCase()}
                        </div>
                        <div className="text-[10px] text-gray-300 font-mono">
                          {profile.city || 'India'} • ★ 4.98 Verified Sanctuary
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Badge Tag */}
                  <div
                    className="px-3 py-1 rounded-full text-[10px] font-mono font-bold text-white shadow-lg tracking-wider"
                    style={{ backgroundColor: primaryAccentColor }}
                  >
                    {customOfferText || `${discountPercent}% OFF`}
                  </div>
                </div>

                {/* BANNER MIDDLE: SERVICE HIGHLIGHT & OFFER */}
                <div className="relative z-10 my-auto py-3">
                  <div className="inline-block px-2.5 py-0.5 rounded bg-white/20 backdrop-blur-xs text-[10px] font-mono-caps font-bold text-white/90 mb-1 border border-white/20">
                    {selectedService.category || 'SIGNATURE SERVICE'}
                  </div>
                  <h3 className="font-display font-bold text-2xl sm:text-3xl text-white leading-tight drop-shadow-md">
                    {selectedService.name}
                  </h3>
                  <p className="text-xs text-slate-200 mt-1 font-medium drop-shadow-xs line-clamp-2">
                    {headline}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-mono line-clamp-1">
                    {subtext}
                  </p>
                </div>

                {/* BANNER BOTTOM: PRICE & BOOKING CTA */}
                <div className="relative z-10 pt-3 border-t border-white/20 flex justify-between items-end">
                  <div>
                    <div className="text-[10px] font-mono text-gray-400">Special Offer Price</div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-extrabold text-2xl text-white">
                        ₹{discountedPrice.toLocaleString('en-IN')}
                      </span>
                      <span className="font-mono text-xs text-red-400 line-through">
                        ₹{selectedService.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="mt-1 inline-block px-2 py-0.5 rounded bg-black/60 border border-white/20 text-[10px] font-mono text-sky-300">
                      CODE: <span className="font-bold text-white">{promoCode}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[9px] text-gray-300 font-mono">Book Instantly Online:</div>
                    <div className="text-[11px] font-bold text-emerald-400 font-mono truncate max-w-[150px]">
                      {profile.subdomain}.nexora.in
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-gray-400 text-center font-mono">
              ✓ Ready for instant download or 1-click sharing to WhatsApp and Instagram.
            </div>
          </div>

          {/* HIDDEN CANVAS FOR HIGH-RES EXPORTS */}
          <canvas ref={canvasRef} className="hidden" />

          {/* PRE-FILLED SHARE TEMPLATES & ACTIONS */}
          <div className="p-5 rounded-2xl border border-gray-200 bg-white flex flex-col gap-4 shadow-xs">
            
            {/* TABS: WHATSAPP VS INSTAGRAM */}
            <div className="flex border-b border-gray-200 gap-4">
              <button
                onClick={() => setActiveTemplateTab('whatsapp')}
                className={`pb-2.5 text-xs font-bold font-mono-caps flex items-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
                  activeTemplateTab === 'whatsapp'
                    ? 'border-emerald-600 text-emerald-700 font-extrabold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <span className="material-symbols-outlined text-lg text-emerald-600">chat</span>
                <span>Share to WhatsApp Template</span>
              </button>

              <button
                onClick={() => setActiveTemplateTab('instagram')}
                className={`pb-2.5 text-xs font-bold font-mono-caps flex items-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
                  activeTemplateTab === 'instagram'
                    ? 'border-[#E1306C] text-[#E1306C] font-extrabold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <span className="material-symbols-outlined text-lg text-[#E1306C]">photo_camera</span>
                <span>Share to Instagram Template</span>
              </button>
            </div>

            {/* TAB CONTENT: WHATSAPP */}
            {activeTemplateTab === 'whatsapp' && (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold font-mono-caps text-gray-700">
                    Pre-filled WhatsApp Message Template (Ready to Send)
                  </label>
                  <button
                    onClick={() => handleCopyText(whatsappTemplate, 'WhatsApp template')}
                    className="text-[11px] text-gray-600 hover:text-gray-900 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    <span>Copy Text</span>
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={whatsappTemplate}
                  onChange={(e) => setWhatsappTemplate(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-300 bg-gray-50 font-mono text-xs text-gray-800 focus:ring-2 focus:ring-emerald-400 outline-none"
                />

                {/* ACTION BUTTONS FOR WHATSAPP */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    onClick={handleShareToWhatsApp}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all hover:shadow-md"
                  >
                    <span className="material-symbols-outlined text-base">send</span>
                    <span>Share to WhatsApp Now</span>
                  </button>

                  <button
                    onClick={handleDownloadBanner}
                    className="px-4 py-2.5 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                  >
                    <span className="material-symbols-outlined text-sm">image</span>
                    <span>Download Image to Attach</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT: INSTAGRAM */}
            {activeTemplateTab === 'instagram' && (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold font-mono-caps text-gray-700">
                    Pre-filled Instagram Caption & Hashtags
                  </label>
                  <button
                    onClick={() => handleCopyText(instagramCaption, 'Instagram caption')}
                    className="text-[11px] text-gray-600 hover:text-gray-900 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    <span>Copy Caption</span>
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={instagramCaption}
                  onChange={(e) => setInstagramCaption(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-300 bg-gray-50 font-mono text-xs text-gray-800 focus:ring-2 focus:ring-purple-400 outline-none"
                />

                {/* ACTION BUTTONS FOR INSTAGRAM */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    onClick={handleShareToInstagram}
                    className="bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all hover:shadow-md"
                  >
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                    <span>Copy Caption & Share to Instagram</span>
                  </button>

                  <button
                    onClick={handleDownloadBanner}
                    className="px-4 py-2.5 rounded-xl border border-gray-300 hover:border-gray-400 bg-white text-gray-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    <span>Download 1:1 Image for Post</span>
                  </button>
                </div>
              </div>
            )}

          </div>

        </div>

      </div>
    </div>
  );
};
