import { CategoryTemplateConfig, BusinessTypeOption } from './types';
import { SALON_IMAGES } from './assets/images';

export const CATEGORY_TEMPLATES: Record<string, CategoryTemplateConfig> = {
  // 1. Hair Cut & Styling Studio
  hair_salon: {
    id: 'hair_salon',
    title: 'Miraki Hair Cut & Styling Studio',
    shortName: 'Hair Cut & Styling Studio',
    tagline: 'Precision Cuts, Modern Geometry & High-Fashion Hair Artistry',
    about: 'Located in the vibrant heart of Indiranagar, Miraki is Bengaluru’s premier minimalist hair craft studio. We specialize in precision dry cuts, structural bobs, international styling, and restorative keratin smoothing using cruelty-free botanical formulas.',
    icon: 'content_cut',
    layoutStyle: 'modern_minimalist',
    paletteLabel: 'Slate & Silver Theme',
    themePreset: 'slate_silver',
    subCategories: ['Precision Cuts', 'Thermal Styling', 'Keratin & Botox', 'Scalp Rituals'],
    defaultCity: 'Bengaluru, Karnataka',
    defaultAddress: '100 Feet Road, HAL 2nd Stage, Indiranagar',
    defaultPostalCode: '560038',
    phone: '+91 98450 12890',
    whatsapp: '+91 98450 12890',
    ownerName: 'Ananya Sharma',
    ownerRole: 'Creative Hair Director & Vidal Sassoon Alum',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@mirakihair.blr',
    themeStyle: {
      heroBackground: 'bg-[#0f172a]',
      heroTextColor: 'text-slate-100',
      cardBorder: 'border-slate-300',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-none',
      accentColor: 'text-slate-900',
      accentBg: 'bg-slate-900',
      badgeBg: 'bg-slate-100',
      badgeText: 'text-slate-800',
      buttonBg: 'bg-slate-900 hover:bg-slate-800',
      buttonText: 'text-white',
      priceColor: 'text-slate-900',
      isDark: false,
      headerBanner: 'border-b-2 border-slate-900 bg-slate-50'
    },
    services: [
      {
        id: 'hs-1',
        name: 'Master Stylist Precision Cut & Blowdry',
        category: 'Precision Cuts',
        durationMinutes: 45,
        price: 750,
        description: 'Sculpted haircut tailored to face geometry, invigorating scalp wash, and professional salon blowout.',
        icon: 'content_cut',
        popular: true
      },
      {
        id: 'hs-2',
        name: 'Classic Layered Cut & Argan Wash',
        category: 'Precision Cuts',
        durationMinutes: 35,
        price: 450,
        description: 'Texturizing layers, split-end removal, deep cleanse with Moroccan argan oil shampoo.',
        icon: 'styler'
      },
      {
        id: 'hs-3',
        name: 'Formaldehyde-Free Keratin Smoothing',
        category: 'Keratin & Botox',
        durationMinutes: 120,
        price: 4200,
        description: 'Infuses active keratin proteins, eliminating 95% frizz with mirror-like shine for up to 14 weeks.',
        icon: 'auto_fix_high',
        popular: true
      },
      {
        id: 'hs-4',
        name: 'Hair Botox Deep Fiber Reconstruction',
        category: 'Keratin & Botox',
        durationMinutes: 90,
        price: 3600,
        description: 'Intense peptide filler mask for chemically damaged or heat-stressed hair fibers.',
        icon: 'healing'
      },
      {
        id: 'hs-5',
        name: 'Red-Carpet Tong Curls & High-Volume Waves',
        category: 'Thermal Styling',
        durationMinutes: 40,
        price: 850,
        description: 'GHD ceramic iron styling with anti-humidity thermal protectant for party & cocktail evenings.',
        icon: 'waves'
      }
    ],
    stylists: [
      {
        id: 'hs-st-1',
        name: 'Ananya Sharma',
        role: 'Creative Director',
        avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Structural Bobs', 'Precision Fringes', 'Keratin Smoothing'],
        rating: 4.97
      },
      {
        id: 'hs-st-2',
        name: 'Rohan Kapoor',
        role: 'Senior Precision Stylist',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Dry Cutting', 'Men & Women Styling', 'Volume Blowouts'],
        rating: 4.92
      },
      {
        id: 'hs-st-3',
        name: 'Kavita Deshmukh',
        role: 'Hair Texture & Scalp Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?auto=format&fit=crop&w=400&q=80',
        specialties: ['Hair Botox', 'Scalp Analysis', 'Thermal Tongs'],
        rating: 4.89
      }
    ]
  },

  // 2. Barber Shop / Men's Grooming
  barber: {
    id: 'barber',
    title: "The Royal Blade Barber & Men's Club",
    shortName: "Barber Shop / Men's Grooming",
    tagline: 'Vintage Heritage Shaves, Bespoke Fades & Handcrafted Beard Sculpting',
    about: 'Situated on Bandra’s iconic 33rd Road, The Royal Blade revives the timeless charm of Victorian barbershops infused with vintage mahogany, genuine brass fittings, and old-school hot towel straight razor mastery.',
    icon: 'content_cut',
    layoutStyle: 'vintage_industrial',
    paletteLabel: 'Dark Wood & Brass Theme',
    themePreset: 'vintage_brass',
    subCategories: ['Executive Cuts', 'Beard Sculpting', 'Hot Towel Shaves', 'Maharaja Packages'],
    defaultCity: 'Mumbai, Maharashtra',
    defaultAddress: '33rd Road, Off Linking Road, Bandra West',
    defaultPostalCode: '400050',
    phone: '+91 98200 45671',
    whatsapp: '+91 98200 45671',
    ownerName: 'Vikram Malhotra',
    ownerRole: 'Master Barber & Razor Craftsman',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@royalblade.bandra',
    themeStyle: {
      heroBackground: 'bg-[#18110b]',
      heroTextColor: 'text-[#f5e6d3]',
      cardBorder: 'border-[#c59b27]/40',
      cardBackground: 'bg-[#211711]',
      cardRadius: 'rounded-lg',
      accentColor: 'text-[#d4af37]',
      accentBg: 'bg-[#c59b27]',
      badgeBg: 'bg-[#3b2a1e]',
      badgeText: 'text-[#f3d99e]',
      buttonBg: 'bg-[#c59b27] hover:bg-[#b58b1d]',
      buttonText: 'text-[#18110b]',
      priceColor: 'text-[#e5c068]',
      isDark: true,
      headerBanner: 'bg-[#140d07] border-b border-[#c59b27]/30'
    },
    services: [
      {
        id: 'bb-1',
        name: 'Executive Scissor Cut & Charcoal Hair Wash',
        category: 'Executive Cuts',
        durationMinutes: 40,
        price: 450,
        description: 'Tailored fade or gentleman taper, tea-tree scalp rinse, and matte pomade finish.',
        icon: 'content_cut',
        popular: true
      },
      {
        id: 'bb-2',
        name: 'Signature Hot Towel Straight Razor Shave',
        category: 'Hot Towel Shaves',
        durationMinutes: 30,
        price: 350,
        description: 'Eucalyptus pre-shave oil, badger brush warm lather, feather-edge razor shave, and cold stone alum splash.',
        icon: 'face'
      },
      {
        id: 'bb-3',
        name: 'Precision Beard Sculpting & Ozone Steam',
        category: 'Beard Sculpting',
        durationMinutes: 35,
        price: 400,
        description: 'Sharp cheek line outlining, bulk graduation, steam softening, and organic cedarwood beard butter massage.',
        icon: 'cleaning_services',
        popular: true
      },
      {
        id: 'bb-4',
        name: 'The Royal Maharaja Grooming Ritual',
        category: 'Maharaja Packages',
        durationMinutes: 75,
        price: 1350,
        description: 'Full haircut, hot lather straight shave, charcoal blackhead face scrub, neck & shoulder acupressure.',
        icon: 'workspace_premium',
        popular: true
      },
      {
        id: 'bb-5',
        name: 'Grey Camo Beard Toning & Mustache Wax',
        category: 'Beard Sculpting',
        durationMinutes: 30,
        price: 550,
        description: 'Natural subtle grey blending for beards with premium Hungarian mustache wax shape.',
        icon: 'brush'
      }
    ],
    stylists: [
      {
        id: 'bb-st-1',
        name: 'Vikram Malhotra',
        role: 'Master Barber & Proprietor',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Straight Razor Shaves', 'Skin Fades', 'Royal Grooming'],
        rating: 4.98
      },
      {
        id: 'bb-st-2',
        name: 'Rajesh Verma',
        role: 'Senior Beard Artisan',
        avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Beard Geometry', 'Ozone Steam Facials', 'Tapers'],
        rating: 4.93
      },
      {
        id: 'bb-st-3',
        name: 'Kabir Khan',
        role: 'Modern Fade Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&q=80',
        specialties: ['Low/Mid Fades', 'Textured Crops', 'Scissor Work'],
        rating: 4.88
      }
    ]
  },

  // 3. Unisex Salon
  unisex_salon: {
    id: 'unisex_salon',
    title: 'Aura Unisex Salon & Wellness Lounge',
    shortName: 'Unisex Salon',
    tagline: 'Harmonious Beauty, Contemporary Hair & Inclusive Self-Care',
    about: 'Aura Unisex Salon offers a balanced, contemporary space in Koramangala. Designed for modern professionals and families seeking premium hair services, de-tan treatments, and express grooming under one roof.',
    icon: 'diversity_3',
    layoutStyle: 'contemporary_balanced',
    paletteLabel: 'Warm Neutral & Pastel Pink/Grey',
    themePreset: 'pastel_blush',
    subCategories: ['Unisex Haircuts', 'Botanical Color', 'Skin Cleanups', 'Hands & Feet Care'],
    defaultCity: 'Bengaluru, Karnataka',
    defaultAddress: 'Outer Ring Road, 4th Block, Koramangala',
    defaultPostalCode: '560095',
    phone: '+91 98455 33210',
    whatsapp: '+91 98455 33210',
    ownerName: 'Priya Nair',
    ownerRole: 'Executive Salon Director',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@aurasalon.blr',
    themeStyle: {
      heroBackground: 'bg-[#fff5f5]',
      heroTextColor: 'text-gray-900',
      cardBorder: 'border-pink-200',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#d81b60]',
      accentBg: 'bg-[#d81b60]',
      badgeBg: 'bg-pink-100',
      badgeText: 'text-pink-800',
      buttonBg: 'bg-[#d81b60] hover:bg-[#c2185b]',
      buttonText: 'text-white',
      priceColor: 'text-[#d81b60]',
      isDark: false,
      headerBanner: 'bg-[#fff8f8] border-b border-pink-100'
    },
    services: [
      {
        id: 'us-1',
        name: 'Designer Unisex Haircut & Moroccan Conditioning',
        category: 'Unisex Haircuts',
        durationMinutes: 45,
        price: 650,
        description: 'Consultation, scalp revitalizer wash, tailored cut, and heat-protective styling.',
        icon: 'content_cut',
        popular: true
      },
      {
        id: 'us-2',
        name: 'Express Glow Organic Cleanup & De-Tan',
        category: 'Skin Cleanups',
        durationMinutes: 40,
        price: 850,
        description: 'Gentle fruit peel scrub, pore steam, blackhead removal, and saffron brightening mask.',
        icon: 'face',
        popular: true
      },
      {
        id: 'us-3',
        name: 'Global Ammonia-Free Inoa Hair Color',
        category: 'Botanical Color',
        durationMinutes: 90,
        price: 2800,
        description: 'L’Oréal Inoa oil-based color with 100% white hair coverage and zero scalp stinging.',
        icon: 'brush'
      },
      {
        id: 'us-4',
        name: 'Deluxe Paraffin Spa Pedicure',
        category: 'Hands & Feet Care',
        durationMinutes: 50,
        price: 850,
        description: 'Dead sea salt soak, heel filing, warm paraffin dip, and tension-relief foot massage.',
        icon: 'pan_tool'
      },
      {
        id: 'us-5',
        name: 'Olaplex No. 1 & 2 Molecular Bond Repair',
        category: 'Botanical Color',
        durationMinutes: 45,
        price: 1650,
        description: 'Rebuilds broken disulphide bonds caused by chemical processing and pollution.',
        icon: 'auto_awesome'
      }
    ],
    stylists: [
      {
        id: 'us-st-1',
        name: 'Priya Nair',
        role: 'Salon Director & Colorist',
        avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&q=80',
        specialties: ['Inoa Color', 'De-Tan Cleanups', 'Unisex Cuts'],
        rating: 4.95
      },
      {
        id: 'us-st-2',
        name: 'Arjun Mehra',
        role: 'Senior Styling Director',
        avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Layered Blowouts', 'Beard & Hair Combos'],
        rating: 4.91
      },
      {
        id: 'us-st-3',
        name: 'Saniya Sheikh',
        role: 'Skin & Nail Aesthetician',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Paraffin Pedicures', 'Organic Facials'],
        rating: 4.89
      }
    ]
  },

  // 4. Beauty Parlour
  beauty_parlour: {
    id: 'beauty_parlour',
    title: 'Roop Mahal Beauty Parlour & Makeover Space',
    shortName: 'Beauty Parlour',
    tagline: 'Timeless Indian Beauty, Herbal Facials, Threading & Radiance Care',
    about: 'Serving patrons for over 18 years in Connaught Place, Roop Mahal blends classic Indian herbal beauty secrets like turmeric, saffron, and sandalwood with modern waxing and gold facials.',
    icon: 'brush',
    layoutStyle: 'curved_elegant',
    paletteLabel: 'Rose Gold & Ivory Theme',
    themePreset: 'rose_gold_ivory',
    subCategories: ['Threading & Waxing', 'Herbal Facials', 'D-Tan & Bleach', 'Festive Glow Combos'],
    defaultCity: 'New Delhi',
    defaultAddress: 'Inner Circle, Block E, Connaught Place',
    defaultPostalCode: '110001',
    phone: '+91 98110 99882',
    whatsapp: '+91 98110 99882',
    ownerName: 'Sunita Agarwal',
    ownerRole: 'Founder & Herbal Beauty Master',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@roopmahal.delhi',
    themeStyle: {
      heroBackground: 'bg-[#fffaf6]',
      heroTextColor: 'text-gray-900',
      cardBorder: 'border-[#f2d5cf]',
      cardBackground: 'bg-[#ffffff]',
      cardRadius: 'rounded-3xl',
      accentColor: 'text-[#b76e79]',
      accentBg: 'bg-[#b76e79]',
      badgeBg: 'bg-[#faebe8]',
      badgeText: 'text-[#8a424d]',
      buttonBg: 'bg-[#b76e79] hover:bg-[#a65d68]',
      buttonText: 'text-white',
      priceColor: 'text-[#9c4c58]',
      isDark: false,
      headerBanner: 'bg-[#fff6f3] border-b border-[#f0cec6]'
    },
    services: [
      {
        id: 'bp-1',
        name: 'Full Face Organic Threading & Brow Shaping',
        category: 'Threading & Waxing',
        durationMinutes: 25,
        price: 250,
        description: 'Gentle cotton thread shaping for upper lip, chin, forehead with soothing rose water mist.',
        icon: 'content_cut',
        popular: true
      },
      {
        id: 'bp-2',
        name: 'Shahnaz Husain 24K Gold Glow Facial',
        category: 'Herbal Facials',
        durationMinutes: 60,
        price: 1450,
        description: 'Authentic 24k gold leaf serum, lymphatic face massage, and radiant brightening peel-off mask.',
        icon: 'spa',
        popular: true
      },
      {
        id: 'bp-3',
        name: 'Rica White Chocolate Full Body Waxing',
        category: 'Threading & Waxing',
        durationMinutes: 75,
        price: 1550,
        description: 'Colophony-free Italian wax, painless hair removal, and post-wax soothing chamomile lotion.',
        icon: 'clean_hands'
      },
      {
        id: 'bp-4',
        name: 'O3+ Ayurvedic D-Tan Brightening Pack',
        category: 'D-Tan & Bleach',
        durationMinutes: 30,
        price: 600,
        description: 'Instant tan removal formula with eucalyptus and mint extracts for sun-damaged skin.',
        icon: 'flare'
      },
      {
        id: 'bp-5',
        name: 'Karva Chauth & Diwali Shringaar Combo',
        category: 'Festive Glow Combos',
        durationMinutes: 90,
        price: 2100,
        description: 'Gold facial, full arms Rica waxing, threading, and express festive party blowout.',
        icon: 'celebration',
        popular: true
      }
    ],
    stylists: [
      {
        id: 'bp-st-1',
        name: 'Sunita Agarwal',
        role: 'Master Aesthetician',
        avatarUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Gold Facials', 'Threading', 'Herbal Recipes'],
        rating: 4.96
      },
      {
        id: 'bp-st-2',
        name: 'Meenakshi Joshi',
        role: 'Senior Skin Therapist',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Rica Waxing', 'Anti-Tan Peels'],
        rating: 4.92
      },
      {
        id: 'bp-st-3',
        name: 'Pooja Sundaram',
        role: 'Threading & Henna Expert',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['Eyebrow Arching', 'Festive Combos'],
        rating: 4.87
      }
    ]
  },

  // 5. Nail Studio
  nail_studio: {
    id: 'nail_studio',
    title: 'Pinky Nails Studio',
    shortName: 'Nail & Lash Studio',
    tagline: 'Glossy Chrome Gel Nails, Sculpted Extensions, Lash Lifts & Laminated Brows',
    about: 'Located in posh Jubilee Hills, Pinky Nails Studio is a boutique sanctuary for high-definition nail art, lash extensions, and brow lamination. We combine sterilized medical-grade tools, 9-free toxin-safe gel polishes, and custom aesthetic designs in a serene luxury studio.',
    icon: 'pan_tool_alt',
    layoutStyle: 'bento_grid',
    paletteLabel: 'Chic Pink & Dark Rose Luxury Theme',
    themePreset: 'neon_gloss_bento',
    subCategories: ['Gel Extensions', 'Lash & Brow', 'Handpainted Art', 'Russian Manicure', 'Chrome & Glaze'],
    defaultCity: 'Hyderabad, Telangana',
    defaultAddress: 'Road No. 36, Near Peddamma Temple, Jubilee Hills',
    defaultPostalCode: '500033',
    phone: '+91 98490 77654',
    whatsapp: '+91 98490 77654',
    ownerName: 'Aanya Sen',
    ownerRole: 'Celebrity Nail Designer & Lash Artist',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: SALON_IMAGES.hero,
    instagramHandle: '@pinkynails.studio',
    themeStyle: {
      heroBackground: 'bg-[#faf5ff]',
      heroTextColor: 'text-purple-950',
      cardBorder: 'border-purple-200',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-2xl',
      accentColor: 'text-purple-600',
      accentBg: 'bg-gradient-to-r from-purple-600 to-pink-500',
      badgeBg: 'bg-purple-100',
      badgeText: 'text-purple-700',
      buttonBg: 'bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90',
      buttonText: 'text-white',
      priceColor: 'text-purple-700',
      isDark: false,
      headerBanner: 'bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 border-b border-purple-100'
    },
    services: [
      {
        id: 'ns-1',
        name: 'Full Set Gel-X Sculpted Extensions',
        category: 'Gel Extensions',
        durationMinutes: 90,
        price: 2400,
        description: 'Damage-free soft gel tips custom fitted to your natural nail bed with glossy UV seal.',
        icon: 'pan_tool_alt',
        popular: true
      },
      {
        id: 'ns-2',
        name: 'Russian Dry Cuticle Precision Manicure',
        category: 'Russian Manicure',
        durationMinutes: 60,
        price: 1100,
        description: 'E-file precision diamond bit cuticle cleanup, keratin basecoat, and high-shine gel polish.',
        icon: 'auto_awesome',
        popular: true
      },
      {
        id: 'ns-3',
        name: '10-Finger 3D Handpainted & Chrome Art',
        category: 'Handpainted Art',
        durationMinutes: 60,
        price: 1500,
        description: 'Custom micro-art, metallic chrome powder, pearl drops, and encapsulated glitter flakes.',
        icon: 'palette'
      },
      {
        id: 'ns-4',
        name: 'Hailey Glazed Donut Pearlescent Finish',
        category: 'Chrome & Glaze',
        durationMinutes: 45,
        price: 1600,
        description: 'Milky sheer nude base topped with ultra-fine iridescent white chrome powder.',
        icon: 'flare',
        popular: true
      },
      {
        id: 'ns-5',
        name: 'Luxury Rose Petal & Champagne Spa Pedicure',
        category: 'Russian Manicure',
        durationMinutes: 50,
        price: 1350,
        description: 'Warm bubbling floral foot soak, volcanic pumice scrub, and cooling mint gel massage.',
        icon: 'spa'
      }
    ],
    stylists: [
      {
        id: 'ns-st-1',
        name: 'Aanya Sen',
        role: 'Master Nail Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Gel-X Extensions', 'Hailey Chrome', '3D Jelly Art'],
        rating: 4.99
      },
      {
        id: 'ns-st-2',
        name: "Rhea D'Souza",
        role: 'Russian Manicurist',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['E-file Cuticles', 'Ombre Nails'],
        rating: 4.94
      },
      {
        id: 'ns-st-3',
        name: 'Kritika Bose',
        role: 'Creative Nail Stylist',
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
        specialties: ['French Tips', 'Glitter Encapsulation'],
        rating: 4.90
      }
    ]
  },

  // 6. Hair Spa & Treatment
  hair_spa: {
    id: 'hair_spa',
    title: 'Kesh Prakriti Hair Spa & Scalp Sanctuary',
    shortName: 'Hair Spa & Treatment',
    tagline: 'Deep Zen Head Spa, Micro-Mist Scalp Detox & Botanical Revitalization',
    about: 'Nestled in quiet Alwarpet, Chennai, Kesh Prakriti specializes in trichology-backed scalp rejuvenation. Using Japanese ultrasonic mist and traditional Indian medicinal herbs, we reverse scalp stress, hair thinning, and urban pollution.',
    icon: 'spa',
    layoutStyle: 'zen_emerald',
    paletteLabel: 'Deep Emerald Green & Sage Theme',
    themePreset: 'emerald_sage',
    subCategories: ['Scalp Detox', 'Ayurvedic Lepam', 'Intense Moisture Steam', 'Hair Fall Defense'],
    defaultCity: 'Chennai, Tamil Nadu',
    defaultAddress: 'Alwarpet High Road, Near TTK Road, Alwarpet',
    defaultPostalCode: '600018',
    phone: '+91 98400 11993',
    whatsapp: '+91 98400 11993',
    ownerName: 'Dr. Gayatri Raman',
    ownerRole: 'Trichologist & Scalp Wellness Director',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1594824813596-f9479e43b1a2?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@keshprakriti.chennai',
    themeStyle: {
      heroBackground: 'bg-[#064e3b]',
      heroTextColor: 'text-emerald-50',
      cardBorder: 'border-emerald-200',
      cardBackground: 'bg-[#f7fcf9]',
      cardRadius: 'rounded-2xl',
      accentColor: 'text-[#065f46]',
      accentBg: 'bg-[#065f46]',
      badgeBg: 'bg-emerald-100',
      badgeText: 'text-emerald-800',
      buttonBg: 'bg-[#065f46] hover:bg-[#047857]',
      buttonText: 'text-white',
      priceColor: 'text-[#047857]',
      isDark: false,
      headerBanner: 'bg-[#ecfdf5] border-b border-emerald-200'
    },
    services: [
      {
        id: 'hsp-1',
        name: 'Japanese Ultrasonic Head Spa & Scalp Detox',
        category: 'Scalp Detox',
        durationMinutes: 70,
        price: 1950,
        description: 'Micro-camera follicle diagnosis, volcanic clay scrub, waterfall rinse, and herb-steamed scalp bath.',
        icon: 'water_drop',
        popular: true
      },
      {
        id: 'hsp-2',
        name: 'Ayurvedic Bhringraj & Brahmi Kesh Lepam',
        category: 'Ayurvedic Lepam',
        durationMinutes: 60,
        price: 1650,
        description: 'Fresh ground cold-pressed herbs, warm castor oil massage, and soothing banana leaf wrap.',
        icon: 'eco',
        popular: true
      },
      {
        id: 'hsp-3',
        name: 'Moroccan Argan Deep Nourishing Steam Ritual',
        category: 'Intense Moisture Steam',
        durationMinutes: 75,
        price: 2100,
        description: 'Cold-pressed bio-argan oil infusion under warm ozone steam for dry, frizzy, brittle hair strands.',
        icon: 'spa'
      },
      {
        id: 'hsp-4',
        name: 'Anti-Dandruff Tea Tree & Neem Ozone Therapy',
        category: 'Scalp Detox',
        durationMinutes: 50,
        price: 1450,
        description: 'Purifies flaky scalp, kills fungal colonies, and regulates natural sebum production.',
        icon: 'healing'
      },
      {
        id: 'hsp-5',
        name: 'Peptide Root Density & Hair Fall Defense Ritual',
        category: 'Hair Fall Defense',
        durationMinutes: 65,
        price: 2400,
        description: 'Redensyl and Biotinyl peptide infusion stimulated with galvanic high-frequency current.',
        icon: 'vital_signs'
      }
    ],
    stylists: [
      {
        id: 'hsp-st-1',
        name: 'Dr. Gayatri Raman',
        role: 'Chief Trichologist',
        avatarUrl: 'https://images.unsplash.com/photo-1594824813596-f9479e43b1a2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Scalp Diagnostics', 'Follicle Rejuvenation', 'Japanese Head Spa'],
        rating: 4.97
      },
      {
        id: 'hsp-st-2',
        name: 'Karthik Sundaram',
        role: 'Senior Scalp Therapist',
        avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Acupressure Massage', 'Ozone Steam Therapies'],
        rating: 4.93
      },
      {
        id: 'hsp-st-3',
        name: 'Deepa Pillai',
        role: 'Botanical Mask Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Kesh Lepam', 'Argan Moisture Infusion'],
        rating: 4.90
      }
    ]
  },

  // 7. Facial & Skincare Clinic
  skincare_clinic: {
    id: 'skincare_clinic',
    title: 'Dermacure Aesthetic Dermatology & Laser Clinic',
    shortName: 'Facial & Skincare Clinic',
    tagline: 'Evidence-Based Medi-Facials, Chemical Peels & Certified Dermatological Care',
    about: 'Dermacure in Gurugram brings US-FDA approved technologies, medical-grade HydraFacials, and customized peeling regimens under the direct guidance of certified dermatologists for radiant, healthy Indian skin.',
    icon: 'medical_services',
    layoutStyle: 'clinical_clean',
    paletteLabel: 'Fresh Blue & Crisp White Theme',
    themePreset: 'clinical_sky_blue',
    subCategories: ['Medi-Facials', 'Chemical Peels', 'Hydra-Infusion', 'Laser & Pigmentation'],
    defaultCity: 'Gurugram, Haryana',
    defaultAddress: 'Sector 29, Near IFFCO Chowk, Golf Course Road',
    defaultPostalCode: '122002',
    phone: '+91 98124 55432',
    whatsapp: '+91 98124 55432',
    ownerName: 'Dr. Tanvi Deshmukh',
    ownerRole: 'MD Dermatology & Aesthetic Consultant',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@dermacure.clinic',
    themeStyle: {
      heroBackground: 'bg-[#f0f9ff]',
      heroTextColor: 'text-sky-950',
      cardBorder: 'border-sky-200',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#0284c7]',
      accentBg: 'bg-[#0284c7]',
      badgeBg: 'bg-sky-100',
      badgeText: 'text-sky-800',
      buttonBg: 'bg-[#0284c7] hover:bg-[#0369a1]',
      buttonText: 'text-white',
      priceColor: 'text-[#0284c7]',
      isDark: false,
      headerBanner: 'bg-sky-50 border-b border-sky-100'
    },
    services: [
      {
        id: 'sk-1',
        name: 'Medi-Grade Hydra Dermabrasion & Antioxidant Infusion',
        category: 'Hydra-Infusion',
        durationMinutes: 60,
        price: 3200,
        description: '3-in-1 patented vortex suction for deep pore extraction, lactic acid hydration, and peptide sealing.',
        icon: 'water_drop',
        popular: true
      },
      {
        id: 'sk-2',
        name: 'Glycolic Radiance Skin Renewal Peel',
        category: 'Chemical Peels',
        durationMinutes: 45,
        price: 2100,
        description: 'Dermatologist-applied AHA peel tackling melasma, sun spots, and uneven texture.',
        icon: 'science',
        popular: true
      },
      {
        id: 'sk-3',
        name: 'Carbon Hollywood Laser Doll Peel',
        category: 'Laser & Pigmentation',
        durationMinutes: 60,
        price: 3800,
        description: 'Q-switched Nd:YAG laser targeted on activated liquid carbon for porcelain pore tightening.',
        icon: 'flash_on'
      },
      {
        id: 'sk-4',
        name: 'LED Photo-Dynamic Acne Clear Therapy',
        category: 'Medi-Facials',
        durationMinutes: 40,
        price: 1800,
        description: 'Blue (415nm) and Red (633nm) medical LED light matrix that eliminates P. acnes bacteria.',
        icon: 'lightbulb'
      },
      {
        id: 'sk-5',
        name: 'Deep Hyaluronic Multi-Molecular Hydration Boost',
        category: 'Hydra-Infusion',
        durationMinutes: 50,
        price: 2600,
        description: 'Iontophoresis penetration of cross-linked hyaluronic acid for 72-hour dewy radiance.',
        icon: 'opacity'
      }
    ],
    stylists: [
      {
        id: 'sk-st-1',
        name: 'Dr. Tanvi Deshmukh',
        role: 'MD Dermatologist',
        avatarUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80',
        specialties: ['HydraFacial', 'Laser Toning', 'Chemical Peels'],
        rating: 4.99
      },
      {
        id: 'sk-st-2',
        name: 'Dr. Sameer Gill',
        role: 'Clinical Cosmetologist',
        avatarUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Carbon Laser', 'Acne Scar Revision'],
        rating: 4.95
      },
      {
        id: 'sk-st-3',
        name: 'Neha Saxena',
        role: 'Senior Aesthetic Therapist',
        avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
        specialties: ['LED Phototherapy', 'Hydra Infusion'],
        rating: 4.91
      }
    ]
  },

  // 8. Makeup Studio
  makeup_studio: {
    id: 'makeup_studio',
    title: 'Vogue Noir Makeup Studio & Academy',
    shortName: 'Makeup Studio',
    tagline: 'Glamorous Runway Looks, High-Definition Airbrush & Editorial Portfolios',
    about: 'Situated in the chic lanes of Koregaon Park, Pune, Vogue Noir is an elite editorial makeup studio. We craft camera-ready looks for red carpets, commercial shoots, and luxury receptions with luminous liquid gold highlights.',
    icon: 'face_retouching_natural',
    layoutStyle: 'dark_glam',
    paletteLabel: 'Sleek Dark Mode with Gold Accents',
    themePreset: 'obsidian_gold',
    subCategories: ['Red Carpet Glam', '4K Airbrush', 'Cocktail & Party', 'Masterclasses'],
    defaultCity: 'Pune, Maharashtra',
    defaultAddress: 'Lane 7, North Main Road, Koregaon Park',
    defaultPostalCode: '411001',
    phone: '+91 98230 88765',
    whatsapp: '+91 98230 88765',
    ownerName: 'Natasha Poonawalla',
    ownerRole: 'Celebrity Makeup Artist & Creative Director',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@vogue_noir.pune',
    themeStyle: {
      heroBackground: 'bg-[#09090b]',
      heroTextColor: 'text-neutral-100',
      cardBorder: 'border-[#d4af37]/40',
      cardBackground: 'bg-[#121216]',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#d4af37]',
      accentBg: 'bg-[#d4af37]',
      badgeBg: 'bg-[#262010]',
      badgeText: 'text-[#fae596]',
      buttonBg: 'bg-[#d4af37] hover:bg-[#c29e2f]',
      buttonText: 'text-[#09090b]',
      priceColor: 'text-[#e5c068]',
      isDark: true,
      headerBanner: 'bg-[#0e0e12] border-b border-[#d4af37]/30'
    },
    services: [
      {
        id: 'ms-1',
        name: 'Red Carpet HD Glass Skin Glam & Mink Lashes',
        category: 'Red Carpet Glam',
        durationMinutes: 75,
        price: 4500,
        description: 'Flawless non-cakey HD base, smoky wing or cut crease, feather brow sculpting, and magnetic lashes.',
        icon: 'face_retouching_natural',
        popular: true
      },
      {
        id: 'ms-2',
        name: 'Temptu 4K Silicone Airbrush Event Makeup',
        category: '4K Airbrush',
        durationMinutes: 90,
        price: 6500,
        description: 'Micro-fine airbrush application, 24-hour waterproof and sweat-resistant formulation for high-octane events.',
        icon: 'auto_awesome',
        popular: true
      },
      {
        id: 'ms-3',
        name: 'Cocktail & Sangeet Golden Hour Glow',
        category: 'Cocktail & Party',
        durationMinutes: 80,
        price: 5200,
        description: 'Champagne gold strobing, flushed rose cheeks, and smudge-proof velvet matte lips.',
        icon: 'celebration'
      },
      {
        id: 'ms-4',
        name: '1-on-1 Self-Makeup Pro Masterclass',
        category: 'Masterclasses',
        durationMinutes: 120,
        price: 7500,
        description: 'Personalized vanity audit, contouring tricks for your face shape, and mastering everyday glam.',
        icon: 'school'
      },
      {
        id: 'ms-5',
        name: 'Editorial Monochromatic Dewy Glow',
        category: 'Red Carpet Glam',
        durationMinutes: 60,
        price: 3800,
        description: 'Runway glossy lids, fresh skin tint, soap brows, and plumping lip oil finish.',
        icon: 'camera'
      }
    ],
    stylists: [
      {
        id: 'ms-st-1',
        name: 'Natasha Poonawalla',
        role: 'Celebrity Makeup Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Glass Skin Base', 'Airbrush 4K', 'Red Carpet Glam'],
        rating: 4.98
      },
      {
        id: 'ms-st-2',
        name: 'Siddharth Roy',
        role: 'Editorial Artist & Masterclass Lead',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Graphic Liners', 'High-Fashion Contour'],
        rating: 4.94
      },
      {
        id: 'ms-st-3',
        name: 'Tara Merchant',
        role: 'Airbrush Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['Temptu Airbrush', 'Bridal Cocktail Looks'],
        rating: 4.92
      }
    ]
  },

  // 9. Massage & Wellness Center
  massage_wellness: {
    id: 'massage_wellness',
    title: 'Bodhi Tree Massage & Wellness Sanctuary',
    shortName: 'Massage & Wellness Center',
    tagline: 'Peaceful Sanctuary, Himalayan Hot Stone Therapy & Deep Stress Dissolution',
    about: 'Set amidst peaceful surroundings in Candolim, Goa, Bodhi Tree integrates warm Himalayan salt stones, bamboo wood rolls, and therapeutic essential oils to relieve chronic muscle knots and urban fatigue.',
    icon: 'self_improvement',
    layoutStyle: 'earth_bamboo',
    paletteLabel: 'Warm Earth Tones & Bamboo Texture',
    themePreset: 'earth_bamboo',
    subCategories: ['Deep Tissue', 'Himalayan Hot Stone', 'Aromatherapy', 'Reflexology'],
    defaultCity: 'Candolim, Goa',
    defaultAddress: 'Near Fort Aguada Road, Candolim Beach Area',
    defaultPostalCode: '403515',
    phone: '+91 98332 44102',
    whatsapp: '+91 98332 44102',
    ownerName: 'Anand Bodhi',
    ownerRole: 'Holistic Bodywork Master & Healer',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@bodhitree.goa',
    themeStyle: {
      heroBackground: 'bg-[#3b2b1d]',
      heroTextColor: 'text-[#f7f1e6]',
      cardBorder: 'border-[#d4c5b3]',
      cardBackground: 'bg-[#faf6f0]',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#784d2b]',
      accentBg: 'bg-[#784d2b]',
      badgeBg: 'bg-[#ece2d3]',
      badgeText: 'text-[#57351c]',
      buttonBg: 'bg-[#784d2b] hover:bg-[#633e21]',
      buttonText: 'text-white',
      priceColor: 'text-[#784d2b]',
      isDark: false,
      headerBanner: 'bg-[#f4ece1] border-b border-[#ded2c3]'
    },
    services: [
      {
        id: 'mw-1',
        name: '90-Min Deep Tissue Muscle Knot Release',
        category: 'Deep Tissue',
        durationMinutes: 90,
        price: 2600,
        description: 'Firm pressure strokes, trigger point therapy, and warming eucalyptus balm for back & shoulder stiffness.',
        icon: 'self_improvement',
        popular: true
      },
      {
        id: 'mw-2',
        name: 'Himalayan Warm Salt Stone Therapy',
        category: 'Himalayan Hot Stone',
        durationMinutes: 75,
        price: 2900,
        description: 'Heated pink crystal stones infused with 84 essential minerals that melt away stress and muscle tension.',
        icon: 'filter_vintage',
        popular: true
      },
      {
        id: 'mw-3',
        name: 'Kerala Spiced Herbal Potli Massage',
        category: 'Deep Tissue',
        durationMinutes: 60,
        price: 2400,
        description: 'Warm muslin herbal poultices dipped in medicated oil, rhythmically tapped over tired joints.',
        icon: 'local_florist'
      },
      {
        id: 'mw-4',
        name: 'Lavender & Frankincense Aromatherapy Sleep Ritual',
        category: 'Aromatherapy',
        durationMinutes: 60,
        price: 2300,
        description: 'Calming rhythmic effleurage with pure botanical essences designed to restore natural circadian sleep.',
        icon: 'bedtime'
      },
      {
        id: 'mw-5',
        name: 'Tibetan Foot Acupressure & Reflexology',
        category: 'Reflexology',
        durationMinutes: 45,
        price: 1500,
        description: 'Targeted nerve pressure points on the feet connected to vital internal organs and energetic meridians.',
        icon: 'pan_tool'
      }
    ],
    stylists: [
      {
        id: 'mw-st-1',
        name: 'Anand Bodhi',
        role: 'Master Bodywork Therapist',
        avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Deep Tissue', 'Trigger Point', 'Tibetan Singing Bowls'],
        rating: 4.96
      },
      {
        id: 'mw-st-2',
        name: 'Maya Thapa',
        role: 'Aromatherapist',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Himalayan Stone Therapy', 'Herbal Potli'],
        rating: 4.94
      },
      {
        id: 'mw-st-3',
        name: 'Sonam Norbu',
        role: 'Reflexology Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Acupressure', 'Joint Decompression'],
        rating: 4.91
      }
    ]
  },

  // 10. Hair Coloring Studio
  hair_coloring: {
    id: 'hair_coloring',
    title: 'Prism & Chroma Hair Color Atelier',
    shortName: 'Hair Coloring Studio',
    tagline: 'Hand-Painted Balayage, Luminous Metallics & Custom Fantasy Swatches',
    about: 'Located on Wood Street in Ashok Nagar, Bengaluru, Prism & Chroma is an avant-garde hair coloring studio. From honey caramel dimensional balayage to bold fantasy pastels, our certified color masters formulate custom shades tailored to Indian skin tones.',
    icon: 'palette',
    layoutStyle: 'creative_gallery',
    paletteLabel: 'Bold Multi-Color Gradient Accents',
    themePreset: 'chroma_gradient',
    subCategories: ['Balayage & Ombre', 'Fashion Pastels', 'Global Bleach & Tone', 'Money Piece Foils'],
    defaultCity: 'Bengaluru, Karnataka',
    defaultAddress: 'Wood Street, Ashok Nagar, Off Brigade Road',
    defaultPostalCode: '560025',
    phone: '+91 98451 90812',
    whatsapp: '+91 98451 90812',
    ownerName: "Siddharth 'Sid' Sen",
    ownerRole: 'Master Color Alchemist & Wella Passionista',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@prismchroma.color',
    themeStyle: {
      heroBackground: 'bg-gradient-to-r from-[#180924] via-[#240a34] to-[#12051f]',
      heroTextColor: 'text-white',
      cardBorder: 'border-fuchsia-300',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#d946ef]',
      accentBg: 'bg-gradient-to-r from-[#ec4899] via-[#8b5cf6] to-[#06b6d4]',
      badgeBg: 'bg-fuchsia-100',
      badgeText: 'text-fuchsia-800',
      buttonBg: 'bg-gradient-to-r from-[#ec4899] to-[#8b5cf6] hover:opacity-90',
      buttonText: 'text-white',
      priceColor: 'text-fuchsia-700',
      isDark: false,
      headerBanner: 'bg-gradient-to-r from-pink-50 via-purple-50 to-cyan-50 border-b border-fuchsia-200'
    },
    services: [
      {
        id: 'hc-1',
        name: 'Signature Caramel Balayage & Olaplex Glaze',
        category: 'Balayage & Ombre',
        durationMinutes: 180,
        price: 5200,
        description: 'Custom hand-painted multidimensional caramel, copper or hazelnut highlights suited for Indian undertones.',
        icon: 'brush',
        popular: true
      },
      {
        id: 'hc-2',
        name: 'Vivid Pastel / Neon Fantasy Color (Semi-Permanent)',
        category: 'Fashion Pastels',
        durationMinutes: 150,
        price: 4200,
        description: 'Electric magenta, lilac, or emerald mermaid tones applied over pre-lightened hair with bonded conditioning.',
        icon: 'palette',
        popular: true
      },
      {
        id: 'hc-3',
        name: 'Global Ash Platinum Blonde & Tonal Neutralizer',
        category: 'Global Bleach & Tone',
        durationMinutes: 210,
        price: 6200,
        description: 'Full-head gentle lift to level 9/10, brass-canceling cool toner, and deep conditioning seal.',
        icon: 'auto_awesome'
      },
      {
        id: 'hc-4',
        name: 'Face-Framing Money Piece & Crown Foiling',
        category: 'Money Piece Foils',
        durationMinutes: 75,
        price: 2400,
        description: 'Striking blonde or rose-gold ribbons along the hairline to brighten facial contours.',
        icon: 'flare'
      },
      {
        id: 'hc-5',
        name: 'Dimensional Lowlights & Seamless Grey Blending',
        category: 'Balayage & Ombre',
        durationMinutes: 120,
        price: 3600,
        description: 'Natural brunette and espresso lowlights that soften harsh regrowth without full global coloring.',
        icon: 'water_drop'
      }
    ],
    stylists: [
      {
        id: 'hc-st-1',
        name: "Siddharth 'Sid' Sen",
        role: 'Master Color Alchemist',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Balayage', 'Global Bleach', 'Pastel Formulations'],
        rating: 4.98
      },
      {
        id: 'hc-st-2',
        name: 'Tanmayee Kulkarni',
        role: 'Creative Balayage Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Money Piece Highlights', 'Caramel Melts'],
        rating: 4.95
      },
      {
        id: 'hc-st-3',
        name: 'Zoe Fernandez',
        role: 'Tonal & Scalp Colorist',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['Grey Blending', 'Cool Ash Blondes'],
        rating: 4.91
      }
    ]
  },

  // 11. Bridal Makeup & Makeover Lounge
  bridal_lounge: {
    id: 'bridal_lounge',
    title: 'Shringaar Royal Indian Bridal Lounge',
    shortName: 'Bridal Makeup & Makeover Lounge',
    tagline: 'Royal Rajputana Trousseaus, Sabyasachi Aesthetic & Heirloom Makeover Packages',
    about: 'Perched on MI Road in Jaipur, Shringaar is Rajasthan’s most celebrated bridal makeover sanctuary. We specialize in grand wedding day makeup, royal zardozi dupatta settings, airbrush longevity, and customized 7-day pre-bridal ubtan rituals.',
    icon: 'diamond',
    layoutStyle: 'royal_crimson',
    paletteLabel: 'Deep Crimson & Gold Theme',
    themePreset: 'royal_crimson_gold',
    subCategories: ['Royal Bridal Trousseau', 'Mehendi & Sangeet', 'Pre-Bridal Ubtan Glow', 'Draping & Turbans'],
    defaultCity: 'Jaipur, Rajasthan',
    defaultAddress: 'MI Road, Near Panch Batti & Raj Mandir',
    defaultPostalCode: '302001',
    phone: '+91 98290 33411',
    whatsapp: '+91 98290 33411',
    ownerName: 'Smt. Anuradha Rathore',
    ownerRole: 'Celebrity Bridal Couturiere & Stylist',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@shringaar.jaipur',
    themeStyle: {
      heroBackground: 'bg-[#58111a]',
      heroTextColor: 'text-amber-100',
      cardBorder: 'border-amber-300',
      cardBackground: 'bg-[#fffaf5]',
      cardRadius: 'rounded-2xl',
      accentColor: 'text-[#881337]',
      accentBg: 'bg-[#881337]',
      badgeBg: 'bg-amber-100',
      badgeText: 'text-amber-900',
      buttonBg: 'bg-[#881337] hover:bg-[#700f2d]',
      buttonText: 'text-white',
      priceColor: 'text-[#881337]',
      isDark: false,
      headerBanner: 'bg-[#fff5f5] border-b-2 border-amber-300'
    },
    services: [
      {
        id: 'bl-1',
        name: 'Royal Rajputana / Mughal Full Bridal Trousseau',
        category: 'Royal Bridal Trousseau',
        durationMinutes: 240,
        price: 35000,
        description: 'HD/Airbrush bridal makeup, royal mathapatti setting, heirloom jewelry placement, silk saree/lehenga draping.',
        icon: 'workspace_premium',
        popular: true
      },
      {
        id: 'bl-2',
        name: 'Sabyasachi-Style Classic Crimson Red Bridal Glam',
        category: 'Royal Bridal Trousseau',
        durationMinutes: 180,
        price: 24000,
        description: 'Timeless flushed bronze cheeks, winged liner, traditional kohl, and perfectly draped velvet dupatta.',
        icon: 'diamond',
        popular: true
      },
      {
        id: 'bl-3',
        name: 'Cocktail & Sangeet Ultra-Glow HD Look',
        category: 'Mehendi & Sangeet',
        durationMinutes: 120,
        price: 12000,
        description: 'Modern radiant evening glam with shimmer eyes, contouring, and international textured waves styling.',
        icon: 'celebration'
      },
      {
        id: 'bl-4',
        name: 'Pre-Bridal 7-Day Sandalwood & Rose Ubtan Ritual',
        category: 'Pre-Bridal Ubtan Glow',
        durationMinutes: 180,
        price: 16500,
        description: 'Complete pre-wedding body polishing, Ayurvedic kesh spa, full body waxing, and diamond radiance facial.',
        icon: 'spa'
      },
      {
        id: 'bl-5',
        name: 'Traditional Kanjeevaram / Banarasi Saree Draping',
        category: 'Draping & Turbans',
        durationMinutes: 45,
        price: 1800,
        description: 'Crisp ironed box pleats, secure waist pinning, and royal can-can volume structuring.',
        icon: 'styler'
      }
    ],
    stylists: [
      {
        id: 'bl-st-1',
        name: 'Smt. Anuradha Rathore',
        role: 'Bridal Couture Director',
        avatarUrl: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Royal Bridal Trousseau', 'Jewelry Pinning', 'Lehenga Draping'],
        rating: 5.0
      },
      {
        id: 'bl-st-2',
        name: 'Janki Khandelwal',
        role: 'Senior Heritage Makeup Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Sangeet Glam', 'Airbrush Longevity'],
        rating: 4.97
      },
      {
        id: 'bl-st-3',
        name: 'Farzana Sheikh',
        role: 'Draping & Turban Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['Silk Saree Pleats', 'Rajasthani Safa'],
        rating: 4.93
      }
    ]
  },

  // 12. Tattoo & Body Art Studio (Newly Added)
  tattoo_studio: {
    id: 'tattoo_studio',
    title: 'Iron & Ink Urban Tattoo & Body Art Studio',
    shortName: 'Tattoo & Body Art Studio',
    tagline: 'High-Contrast Monochrome, Custom Dark Realism & Surgical Piercings',
    about: 'Located in bohemian Hauz Khas Village, New Delhi, Iron & Ink is a studio dedicated to custom blackwork, fine-line realism, and sterile body piercings using 100% single-use disposable needles.',
    icon: 'draw',
    layoutStyle: 'urban_monochrome',
    paletteLabel: 'Edgy Dark Urban Layout & Monochrome Design',
    themePreset: 'urban_monochrome',
    subCategories: ['Custom Blackwork', 'Fine-Line Realism', 'Body Piercing', 'Tattoo Cover-ups'],
    defaultCity: 'New Delhi',
    defaultAddress: 'Building 14, Hauz Khas Village, Near Deer Park',
    defaultPostalCode: '110016',
    phone: '+91 98118 77621',
    whatsapp: '+91 98118 77621',
    ownerName: "Varun 'Ink' Mathur",
    ownerRole: 'Founder & Realism Tattooist',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1598371839696-5c5bb00bdc28?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@ironandink.delhi',
    themeStyle: {
      heroBackground: 'bg-[#0a0a0a]',
      heroTextColor: 'text-white',
      cardBorder: 'border-white/20',
      cardBackground: 'bg-[#141414]',
      cardRadius: 'rounded-none',
      accentColor: 'text-white',
      accentBg: 'bg-white',
      badgeBg: 'bg-neutral-800',
      badgeText: 'text-neutral-200',
      buttonBg: 'bg-white hover:bg-neutral-200',
      buttonText: 'text-black',
      priceColor: 'text-white',
      isDark: true,
      headerBanner: 'bg-[#050505] border-b border-white/20'
    },
    services: [
      {
        id: 'ts-1',
        name: 'Custom Blackwork Full Sleeve Session (3 Hours)',
        category: 'Custom Blackwork',
        durationMinutes: 180,
        price: 6000,
        description: 'Bespoke geometric dotwork, dark mythological themes, and solid black saturation using Dynamic Triple Black ink.',
        icon: 'brush',
        popular: true
      },
      {
        id: 'ts-2',
        name: 'Minimalist Micro Fine-Line Script / Botanical',
        category: 'Fine-Line Realism',
        durationMinutes: 60,
        price: 2500,
        description: 'Single-needle precise lettering, Devanagari calligraphy, or delicate wildflower outlines.',
        icon: 'edit',
        popular: true
      },
      {
        id: 'ts-3',
        name: 'Hyper-Realistic Portrait & Shading Art',
        category: 'Fine-Line Realism',
        durationMinutes: 240,
        price: 8500,
        description: 'Smooth greywash transitions and photo-realistic animal/portrait execution by master artists.',
        icon: 'image'
      },
      {
        id: 'ts-4',
        name: 'Implant-Grade Titanium Ear/Nose Piercing',
        category: 'Body Piercing',
        durationMinutes: 30,
        price: 1200,
        description: 'Surgical aseptic technique, sterile needle puncture, and ASTM F-136 titanium stud included.',
        icon: 'adjust'
      },
      {
        id: 'ts-5',
        name: 'Old Tattoo Redesign & Blast-Over Cover-up',
        category: 'Tattoo Cover-ups',
        durationMinutes: 150,
        price: 5000,
        description: 'Clever restructuring of faded, unwanted ink into a contemporary high-density dark art piece.',
        icon: 'recycling'
      }
    ],
    stylists: [
      {
        id: 'ts-st-1',
        name: "Varun 'Ink' Mathur",
        role: 'Chief Tattoo Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        specialties: ['Dark Realism', 'Geometric Blackwork', 'Sleeves'],
        rating: 4.98
      },
      {
        id: 'ts-st-2',
        name: 'Tanya Roy',
        role: 'Fine-Line & Script Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Single-Needle Florals', 'Micro Tattoos'],
        rating: 4.95
      },
      {
        id: 'ts-st-3',
        name: 'Chetan Rawat',
        role: 'Senior Body Piercing Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Cartilage Piercing', 'Titanium Jewelry Styling'],
        rating: 4.92
      }
    ]
  },

  // 13. Lash & Brow Bar (Newly Added)
  lash_brow: {
    id: 'lash_brow',
    title: 'Arch & Flutter Lash & Brow Bar',
    shortName: 'Lash & Brow Bar',
    tagline: 'Feather Microblading, Russian Fluffy Volume & Brow Lamination',
    about: 'A chic, intimate micro-studio on Santa Cruz’s Linking Road in Mumbai. Arch & Flutter is devoted purely to eye aesthetics: ultra-light Russian volume lash extensions, semi-permanent feather microblading, and keratin lifts.',
    icon: 'visibility',
    layoutStyle: 'chic_nude',
    paletteLabel: 'Soft Beige & Nude Micro-Studio Theme',
    themePreset: 'chic_nude_beige',
    subCategories: ['Lash Extensions', 'Microblading', 'Brow Lamination', 'Lash Lifts & Tint'],
    defaultCity: 'Mumbai, Maharashtra',
    defaultAddress: 'Linking Road, Near Gazebo Shopping, Santa Cruz West',
    defaultPostalCode: '400054',
    phone: '+91 98205 11234',
    whatsapp: '+91 98205 11234',
    ownerName: 'Nikita Shroff',
    ownerRole: 'PhiBrows Certified Master & Lash Educator',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1583001931096-959e9a1a6223?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@archandflutter.mumbai',
    themeStyle: {
      heroBackground: 'bg-[#faf6f0]',
      heroTextColor: 'text-[#443934]',
      cardBorder: 'border-[#e8ded2]',
      cardBackground: 'bg-white',
      cardRadius: 'rounded-xl',
      accentColor: 'text-[#a17865]',
      accentBg: 'bg-[#a17865]',
      badgeBg: 'bg-[#f0e7dd]',
      badgeText: 'text-[#6b4e40]',
      buttonBg: 'bg-[#a17865] hover:bg-[#8f6856]',
      buttonText: 'text-white',
      priceColor: 'text-[#8f6856]',
      isDark: false,
      headerBanner: 'bg-[#f5ede3] border-b border-[#e2d6c7]'
    },
    services: [
      {
        id: 'lb-1',
        name: 'Russian Volume 4D-6D Fluffy Lash Extensions',
        category: 'Lash Extensions',
        durationMinutes: 120,
        price: 3200,
        description: 'Handmade cashmere fans creating intense darkness and fluttery volume without weighing natural lashes down.',
        icon: 'visibility',
        popular: true
      },
      {
        id: 'lb-2',
        name: 'Semi-Permanent Feather Microblading Eyebrows',
        category: 'Microblading',
        durationMinutes: 150,
        price: 9500,
        description: 'Golden ratio facial mapping, organic iron oxide pigments, and ultra-fine hair strokes lasting up to 18 months.',
        icon: 'edit',
        popular: true
      },
      {
        id: 'lb-3',
        name: 'Keratin Lash Lift & Deep Black Tint',
        category: 'Lash Lifts & Tint',
        durationMinutes: 60,
        price: 1800,
        description: 'Perms natural lashes straight from the root with protein-rich keratin for a mascara-free look for 8 weeks.',
        icon: 'auto_awesome'
      },
      {
        id: 'lb-4',
        name: 'Brow Lamination, Precise Thread & Henna Stain',
        category: 'Brow Lamination',
        durationMinutes: 50,
        price: 1600,
        description: 'Restructures brow hairs into uniform upward direction for full, fluffy model-off-duty arches.',
        icon: 'brush',
        popular: true
      },
      {
        id: 'lb-5',
        name: 'Classic 1:1 Natural Lash Extension Set',
        category: 'Lash Extensions',
        durationMinutes: 90,
        price: 2400,
        description: 'One extension attached per natural lash for elegant, everyday polished definition.',
        icon: 'remove_red_eye'
      }
    ],
    stylists: [
      {
        id: 'lb-st-1',
        name: 'Nikita Shroff',
        role: 'Certified PhiBrows Master',
        avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&q=80',
        specialties: ['Microblading', 'Volume Lashes', 'Golden Ratio Brows'],
        rating: 4.97
      },
      {
        id: 'lb-st-2',
        name: 'Sneha Varma',
        role: 'Lash Extension Specialist',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        specialties: ['Russian 6D Fans', 'Lash Infill & Care'],
        rating: 4.94
      },
      {
        id: 'lb-st-3',
        name: 'Isha Chawla',
        role: 'Brow Lamination Artist',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
        specialties: ['Laminations', 'Keratin Lash Infusions'],
        rating: 4.91
      }
    ]
  },

  // 14. Ayurvedic Rejuvenation Spa (Newly Added)
  ayurvedic_spa: {
    id: 'ayurvedic_spa',
    title: 'Veda Sanjeevani Ayurvedic Wellness & Spa',
    shortName: 'Ayurvedic Rejuvenation Spa',
    tagline: 'Authentic Kerala Panchakarma, Medicated Shirodhara & Vedic Herbal Lepams',
    about: 'Housed in an authentic heritage courtyard in Fort Kochi, Kerala, Veda Sanjeevani practices pure Ashtanga Ayurveda under the stewardship of traditional Vaidyas. Experience centuries-old 4-hand Abhyangam, warm oil Shirodhara, and custom herbal Kizhies.',
    icon: 'eco',
    layoutStyle: 'ayurvedic_terracotta',
    paletteLabel: 'Traditional Indian Heritage & Terracotta/Copper Accents',
    themePreset: 'ayurvedic_terracotta',
    subCategories: ['Abhyangam Therapies', 'Shirodhara Streams', 'Herbal Kizhies', 'Panchakarma Detox'],
    defaultCity: 'Fort Kochi, Kerala',
    defaultAddress: 'Princess Street Heritage Zone, Fort Kochi',
    defaultPostalCode: '682001',
    phone: '+91 98470 22319',
    whatsapp: '+91 98470 22319',
    ownerName: 'Vaidya Harish Nambiar',
    ownerRole: 'BAMS Chief Ayurvedic Physician & Acharya',
    ownerPhotoUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=500&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1600334129128-685c5582fd35?auto=format&fit=crop&w=1200&q=80',
    instagramHandle: '@vedasanjeevani.kerala',
    themeStyle: {
      heroBackground: 'bg-[#5c2409]',
      heroTextColor: 'text-amber-100',
      cardBorder: 'border-[#ea580c]/30',
      cardBackground: 'bg-[#fffaf2]',
      cardRadius: 'rounded-2xl',
      accentColor: 'text-[#c2410c]',
      accentBg: 'bg-[#c2410c]',
      badgeBg: 'bg-[#ffedd5]',
      badgeText: 'text-[#9a3412]',
      buttonBg: 'bg-[#c2410c] hover:bg-[#9a3412]',
      buttonText: 'text-white',
      priceColor: 'text-[#9a3412]',
      isDark: false,
      headerBanner: 'bg-[#fff7ed] border-b border-[#fed7aa]'
    },
    services: [
      {
        id: 'as-1',
        name: 'Traditional 4-Hand Abhyangam Full Body Therapy',
        category: 'Abhyangam Therapies',
        durationMinutes: 75,
        price: 2800,
        description: 'Synchronized massage by two certified masseurs using medicated Dhanwantharam warm herbal oil over wood Droni.',
        icon: 'self_improvement',
        popular: true
      },
      {
        id: 'as-2',
        name: 'Medicated Herbal Oil Shirodhara Stream Therapy',
        category: 'Shirodhara Streams',
        durationMinutes: 60,
        price: 3200,
        description: 'Continuous soothing stream of warm herbal oil poured onto the Ajna third-eye chakra for profound mental peace.',
        icon: 'water_drop',
        popular: true
      },
      {
        id: 'as-3',
        name: 'Elakizhi Warm Herbal Leaf Poultice Relief',
        category: 'Herbal Kizhies',
        durationMinutes: 60,
        price: 2600,
        description: 'Herbal leaves fried in castor oil packed in cloth boluses to eliminate joint inflammation and chronic pain.',
        icon: 'eco'
      },
      {
        id: 'as-4',
        name: 'Full Panchakarma Detox & Vaidya Pulse Diagnosis',
        category: 'Panchakarma Detox',
        durationMinutes: 90,
        price: 4500,
        description: 'Detailed Nadi Pariksha, dosha constitutional mapping, herbal steam bath (Swedana), and personalized dietary chart.',
        icon: 'spa',
        popular: true
      },
      {
        id: 'as-5',
        name: 'Mukha Lepam Ayurvedic Sandalwood Radiance Pack',
        category: 'Abhyangam Therapies',
        durationMinutes: 50,
        price: 1500,
        description: 'Exfoliation with green gram flour followed by fresh red sandalwood and saffron paste for natural glow.',
        icon: 'face'
      }
    ],
    stylists: [
      {
        id: 'as-st-1',
        name: 'Vaidya Harish Nambiar',
        role: 'BAMS Chief Physician',
        avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80',
        specialties: ['Nadi Pariksha', 'Panchakarma Protocol', 'Dosha Balancing'],
        rating: 4.99
      },
      {
        id: 'as-st-2',
        name: 'Sreedhar Kurup',
        role: 'Senior Kalari & Marma Masseur',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
        specialties: ['4-Hand Abhyangam', 'Elakizhi Poultice'],
        rating: 4.96
      },
      {
        id: 'as-st-3',
        name: 'Sarala Devi',
        role: 'Herbal Shirodhara Therapist',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        specialties: ['Shirodhara Streams', 'Mukha Lepam'],
        rating: 4.92
      }
    ]
  }
};

export const ALL_CATEGORY_OPTIONS: BusinessTypeOption[] = [
  {
    id: 'hair_salon',
    title: 'Hair Cut & Styling Studio',
    categoryTag: 'Hair Artistry',
    icon: 'content_cut',
    aestheticDescription: 'Modern minimalist layout, sharp geometric cards, slate & silver theme.',
    paletteName: 'Slate & Silver',
    badge: 'Popular',
    defaultServices: CATEGORY_TEMPLATES.hair_salon.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'barber',
    title: "Barber Shop / Men's Grooming",
    categoryTag: "Men's Luxury",
    icon: 'content_cut',
    aestheticDescription: 'Vintage industrial barbershop aesthetic, dark wood & brass theme.',
    paletteName: 'Dark Wood & Brass',
    badge: 'Classic',
    defaultServices: CATEGORY_TEMPLATES.barber.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'unisex_salon',
    title: 'Unisex Salon',
    categoryTag: 'All-Gender Care',
    icon: 'diversity_3',
    aestheticDescription: 'Contemporary balanced layout, warm neutral & pastel pink/grey theme.',
    paletteName: 'Pastel Blush & Stone',
    badge: 'Trending',
    defaultServices: CATEGORY_TEMPLATES.unisex_salon.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'beauty_parlour',
    title: 'Beauty Parlour',
    categoryTag: 'Herbal & Skin',
    icon: 'brush',
    aestheticDescription: 'Soft, elegant aesthetic with curved cards, rose gold & ivory theme.',
    paletteName: 'Rose Gold & Ivory',
    badge: 'Traditional',
    defaultServices: CATEGORY_TEMPLATES.beauty_parlour.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'nail_studio',
    title: 'Nail Studio',
    categoryTag: 'Nail Couture',
    icon: 'pan_tool_alt',
    aestheticDescription: 'Trendy bento-grid layout, vibrant neon pastel & gloss theme.',
    paletteName: 'Neon Pastel & Gloss',
    badge: 'Bento Layout',
    defaultServices: CATEGORY_TEMPLATES.nail_studio.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'hair_spa',
    title: 'Hair Spa & Treatment',
    categoryTag: 'Trichology & Zen',
    icon: 'spa',
    aestheticDescription: 'Relaxing, zen-inspired layout, deep emerald green & sage theme.',
    paletteName: 'Deep Emerald & Sage',
    badge: 'Zen Sanctuary',
    defaultServices: CATEGORY_TEMPLATES.hair_spa.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'skincare_clinic',
    title: 'Facial & Skincare Clinic',
    categoryTag: 'Medi-Aesthetic',
    icon: 'medical_services',
    aestheticDescription: 'Clean clinical/dermatology feel, fresh blue & crisp white theme.',
    paletteName: 'Clinical Sky Blue & White',
    badge: 'Derm Approved',
    defaultServices: CATEGORY_TEMPLATES.skincare_clinic.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'makeup_studio',
    title: 'Makeup Studio',
    categoryTag: 'Editorial Glam',
    icon: 'face_retouching_natural',
    aestheticDescription: 'Glamorous portfolio layout, sleek dark mode with gold accents.',
    paletteName: 'Obsidian & Liquid Gold',
    badge: 'Editorial',
    defaultServices: CATEGORY_TEMPLATES.makeup_studio.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'massage_wellness',
    title: 'Massage & Wellness Center',
    categoryTag: 'Holistic Bodywork',
    icon: 'self_improvement',
    aestheticDescription: 'Peaceful spa layout, warm earth tones & bamboo texture.',
    paletteName: 'Warm Earth & Bamboo',
    badge: 'Holistic',
    defaultServices: CATEGORY_TEMPLATES.massage_wellness.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'hair_coloring',
    title: 'Hair Coloring Studio',
    categoryTag: 'Color Alchemy',
    icon: 'palette',
    aestheticDescription: 'Creative gallery-style layout, bold multi-color gradient accents.',
    paletteName: 'Chroma Gradient Gallery',
    badge: 'Creative Art',
    defaultServices: CATEGORY_TEMPLATES.hair_coloring.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'bridal_lounge',
    title: 'Bridal Makeup & Makeover Lounge',
    categoryTag: 'Royal Weddings',
    icon: 'diamond',
    aestheticDescription: 'Royal Indian wedding aesthetic, deep crimson & gold theme.',
    paletteName: 'Royal Crimson & Gold',
    badge: 'Heritage Luxury',
    defaultServices: CATEGORY_TEMPLATES.bridal_lounge.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'tattoo_studio',
    title: 'Tattoo & Body Art Studio',
    categoryTag: 'Urban Body Art',
    icon: 'draw',
    aestheticDescription: 'Edgy, dark urban layout with high-contrast monochrome design.',
    paletteName: 'Urban Monochrome Ink',
    badge: 'Newly Added',
    defaultServices: CATEGORY_TEMPLATES.tattoo_studio.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'lash_brow',
    title: 'Lash & Brow Bar',
    categoryTag: 'Micro-Studio',
    icon: 'visibility',
    aestheticDescription: 'Chic, minimal micro-studio layout with soft beige & nude theme.',
    paletteName: 'Soft Beige & Warm Nude',
    badge: 'Newly Added',
    defaultServices: CATEGORY_TEMPLATES.lash_brow.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  },
  {
    id: 'ayurvedic_spa',
    title: 'Ayurvedic Rejuvenation Spa',
    categoryTag: 'Vedic Healing',
    icon: 'eco',
    aestheticDescription: 'Traditional Indian heritage aesthetic with terracotta & copper accents.',
    paletteName: 'Terracotta & Copper',
    badge: 'Newly Added',
    defaultServices: CATEGORY_TEMPLATES.ayurvedic_spa.services.map((s) => ({
      name: s.name,
      price: s.price,
      duration: s.durationMinutes,
      category: s.category
    }))
  }
];
