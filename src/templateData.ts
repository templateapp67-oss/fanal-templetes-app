import { BusinessTypeId } from './types';
import { SALON_IMAGES } from './assets/images';

export interface GalleryPhoto {
  id: string;
  url: string;
  title: string;
  tag: string;
}

export interface Testimonial {
  id: string;
  name: string;
  location: string;
  rating: number;
  serviceName: string;
  comment: string;
  avatarUrl: string;
  date: string;
}

export interface CategoryStandardData {
  foundingYear: string;
  foundingNarrative: string;
  specialties: string[];
  certifications: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  gallery: GalleryPhoto[];
  reviews: Testimonial[];
  totalReviewCount: number;
  averageRating: number;
  landmark: string;
  parkingInfo: string;
  openHourText: string;
  closeHourText: string;
}

export const CATEGORY_STANDARDIZED_DATA: Record<BusinessTypeId, CategoryStandardData> = {
  hair_salon: {
    foundingYear: '2019',
    foundingNarrative: 'Founded in Indiranagar by master hair artisans, Miraki was built to introduce geometric precision cutting, custom hair textures, and restorative botanical treatments without toxic formaldehyde or harsh chemical fumes.',
    specialties: ['Structural Bob & Layering', 'Formaldehyde-Free Smoothing', 'Scalp Barrier Detox', 'Bridal Blowouts'],
    certifications: [
      { icon: 'verified', title: '100% Autoclaved Shears', description: 'All Japanese steel shears & combs sanitized at 134°C between clients.' },
      { icon: 'eco', title: 'Cruelty-Free Formulas', description: 'Certified organic shampoos and European bond-building treatments.' },
      { icon: 'dry_cleaning', title: 'Single-Use Sealed Linen', description: 'Fresh biodegradable disposable salon capes for every appointment.' },
      { icon: 'workspace_premium', title: 'Vidal Sassoon Certified', description: 'Senior artists trained in international structural cutting techniques.' }
    ],
    gallery: [
      { id: 'hs-g1', url: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80', title: 'Balayage Dimension & Blowdry', tag: 'Color & Cut' },
      { id: 'hs-g2', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Precision Texturized Layers', tag: 'Precision Cut' },
      { id: 'hs-g3', url: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80', title: 'Studio Styling Station & Chairs', tag: 'Studio Interior' },
      { id: 'hs-g4', url: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=800&q=80', title: 'Mirror Shine Keratin Transformation', tag: 'Restoration' },
      { id: 'hs-g5', url: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80', title: 'Thermal Soft Waves Styling', tag: 'Occasion Hair' },
      { id: 'hs-g6', url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?auto=format&fit=crop&w=800&q=80', title: 'Consultation & Hair Diagnostics', tag: 'Consultation' }
    ],
    reviews: [
      { id: 'hs-r1', name: 'Pooja Mehra', location: 'Indiranagar, Bengaluru', rating: 5, serviceName: 'Formaldehyde-Free Keratin Smoothing', comment: 'Hands down the best hair studio in Bengaluru! My frizzy monsoon hair is silky straight yet retains natural bounce. The hygiene standard is unmatched.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '2 days ago' },
      { id: 'hs-r2', name: 'Aditya Sen', location: 'Koramangala, Bengaluru', rating: 5, serviceName: 'Master Stylist Precision Cut & Blowdry', comment: 'Ananya took 10 minutes just analyzing my face shape and crown geometry before picking up scissors. The precision is world-class.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'hs-r3', name: 'Kavita Rao', location: 'HSR Layout, Bengaluru', rating: 5, serviceName: 'Classic Layered Cut & Argan Wash', comment: 'Spotless salon, calming interior, and zero product pushing. You get exactly what you ask for with transparent ₹ pricing upfront.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 524,
    averageRating: 4.96,
    landmark: 'Opposite Metro Pillar 128, Near 100 Feet Road Junction',
    parkingInfo: 'Valet parking available for all clients at studio entrance',
    openHourText: '10:00 AM',
    closeHourText: '8:30 PM'
  },

  barber: {
    foundingYear: '2018',
    foundingNarrative: 'The Royal Blade revives the gentleman’s sanctuary on Bandra’s 33rd Road. We pair time-honored straight razor hot towel shaves with modern skin fades, beard architecture, and imported organic pomades.',
    specialties: ['Straight Razor Hot Shave', 'Low & Mid Skin Fades', 'Charcoal Beard Sculpting', 'Maharaja Head Massage'],
    certifications: [
      { icon: 'verified', title: 'Single-Use Japanese Blades', description: 'Fresh Feather Hi-Stainless razor blade unwrapped for every customer.' },
      { icon: 'wash', title: 'Steam & Hot Towel Sanitation', description: 'Towels sterilized in high-pressure thermal chambers infused with eucalyptus.' },
      { icon: 'shield', title: 'Skin Barrier Protection', description: 'Pre-shave essential oils and alcohol-free calming alum treatments.' },
      { icon: 'workspace_premium', title: 'Master Guild Barbers', description: 'Specialists trained in traditional British & Italian barbering arts.' }
    ],
    gallery: [
      { id: 'bb-g1', url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80', title: 'Vintage Barber Chair & Brass Mirrors', tag: 'Interior' },
      { id: 'bb-g2', url: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=800&q=80', title: 'Hot Towel Straight Razor Treatment', tag: 'Traditional Shave' },
      { id: 'bb-g3', url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=800&q=80', title: 'Sculpted Beard Fade & Sharp Lines', tag: 'Beard Craft' },
      { id: 'bb-g4', url: 'https://images.unsplash.com/photo-1517832606589-7157be614532?auto=format&fit=crop&w=800&q=80', title: 'Classic Pompadour Precision Cut', tag: 'Haircut' },
      { id: 'bb-g5', url: 'https://images.unsplash.com/photo-1534778356534-d3d45b6df1da?auto=format&fit=crop&w=800&q=80', title: 'Authentic Grooming Stations', tag: 'Ambience' },
      { id: 'bb-g6', url: 'https://images.unsplash.com/photo-1593702295094-aea22597af65?auto=format&fit=crop&w=800&q=80', title: 'Eucalyptus Steamed Towel Ritual', tag: 'Relaxation' }
    ],
    reviews: [
      { id: 'bb-r1', name: 'Rohan Mehta', location: 'Bandra West, Mumbai', rating: 5, serviceName: 'Royal Maharaja Shave & Steam', comment: 'The eucalyptus hot towel followed by straight razor shave was pure heaven. Vikram is an absolute master of his craft. Unbelievable vibe!', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', date: 'Yesterday' },
      { id: 'bb-r2', name: 'Kabir Singhania', location: 'Juhu, Mumbai', rating: 5, serviceName: 'Signature Skin Fade & Beard Sculpt', comment: 'Found my permanent barber in Mumbai. Cleanest skin fade with razor-sharp beard edges. Super disciplined appointments with zero delays.', avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=200&q=80', date: '4 days ago' },
      { id: 'bb-r3', name: 'Farhan Merchant', location: 'Khar, Mumbai', rating: 5, serviceName: 'Executive Scissor Cut & Charcoal Hair Wash', comment: 'Old-world charm with top-tier hygiene. They sanitize every scissor and clippers right in front of you. Worth every single rupee.', avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80', date: '1 week ago' }
    ],
    totalReviewCount: 680,
    averageRating: 4.98,
    landmark: 'Near Linking Road Junction, Opposite Olive Bistro',
    parkingInfo: 'Dedicated valet parking stall on 33rd Road',
    openHourText: '09:30 AM',
    closeHourText: '9:00 PM'
  },

  unisex_salon: {
    foundingYear: '2020',
    foundingNarrative: 'Aura Luxe was created to give contemporary families, professionals, and couples a unified sanctuary where hair design, clinical aesthetic rituals, and restorative pedicures meet under one roof.',
    specialties: ['Couple Spa & Hair Rituals', 'Cysteine Anti-Frizz', 'Korean Glass Skin Facials', 'Spa Pedicures'],
    certifications: [
      { icon: 'verified', title: 'Hospital-Grade Hygiene', description: 'Dual UV-C autoclaves ensuring pristine equipment for every station.' },
      { icon: 'spa', title: 'Clean Dermatology Formulations', description: 'Hypoallergenic European & Korean aesthetic care lines.' },
      { icon: 'group', title: 'Private & Shared Suites', description: 'Dedicated VIP consultation rooms and couple treatment chambers.' },
      { icon: 'military_tech', title: 'ISO 9001 Salon Certified', description: 'Standardized operational procedures for time, safety, and hygiene.' }
    ],
    gallery: [
      { id: 'us-g1', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Modern Minimalist Styling Floor', tag: 'Interior' },
      { id: 'us-g2', url: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80', title: 'Deep Conditioning Scalp Basin', tag: 'Wash Station' },
      { id: 'us-g3', url: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80', title: 'Cysteine Smoothing Transformation', tag: 'Hair Result' },
      { id: 'us-g4', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Hydra-Facial Clinical Room', tag: 'Skin Care' },
      { id: 'us-g5', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Private Couple Treatment Suite', tag: 'Private Lounge' },
      { id: 'us-g6', url: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80', title: 'Deluxe Manicure & Pedicure Bay', tag: 'Nail Spa' }
    ],
    reviews: [
      { id: 'us-r1', name: 'Simran & Kunal Bajaj', location: 'Cyber City, Gurugram', rating: 5, serviceName: 'Couple Weekend Makeover Package', comment: 'We booked the couple package for our anniversary. Outstanding care, private suite, and both our hair transformations turned out phenomenal!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'us-r2', name: 'Deepak Sharma', location: 'Golf Course Road, Gurugram', rating: 5, serviceName: 'Signature Haircut & Beard Shaping', comment: 'Always prompt, hygienic, and extremely professional. The booking system with ₹ pricing makes scheduling effortless.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'us-r3', name: 'Megha Taneja', location: 'DLF Phase 5, Gurugram', rating: 5, serviceName: 'Hydra-Dermabrasion Glow Facial', comment: 'My skin was glowing instantly without any redness. Certified products and lovely hospitality from the team.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 710,
    averageRating: 4.95,
    landmark: 'Near Cyber Hub Gateway Tower, Sector 24',
    parkingInfo: 'Reserved 2-hour underground parking slots available',
    openHourText: '10:00 AM',
    closeHourText: '8:30 PM'
  },

  beauty_parlour: {
    foundingYear: '2016',
    foundingNarrative: 'Gulabini is a curated women’s botanical beauty sanctuary in South Delhi, celebrating traditional Indian herbal recipes alongside modern pain-free waxing, organic facial therapies, and bridal skincare.',
    specialties: ['Kesar & Haldi Bridal Facials', 'Rica Brazilian Peel Waxing', 'Organic Hair Spa', 'Threading Artistry'],
    certifications: [
      { icon: 'verified', title: '100% Female Staff Sanctuary', description: 'Private, secure, and serene environment managed completely by women.' },
      { icon: 'eco', title: 'Cold-Pressed Herbal Ingredients', description: 'Kashmiri saffron, sandalwood, and virgin coconut botanical elixirs.' },
      { icon: 'medical_services', title: 'No Double-Dipping Waxing', description: 'Single-use wooden spatulas and hypoallergenic Italian waxes.' },
      { icon: 'grade', title: 'Awarded Best South Delhi Parlour', description: 'Voted top neighbourhood beauty parlour 3 consecutive years.' }
    ],
    gallery: [
      { id: 'bp-g1', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Bridal Herbal Face Treatment', tag: 'Facial Glow' },
      { id: 'bp-g2', url: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80', title: 'Organic Steam Hair Spa Therapy', tag: 'Hair Spa' },
      { id: 'bp-g3', url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', title: 'Herbal Rose Water & Clay Masking', tag: 'Ayurvedic Skin' },
      { id: 'bp-g4', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Private Treatment Suite & Linens', tag: 'Interior' },
      { id: 'bp-g5', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Pain-Free Threading & Brow Shaping', tag: 'Brows' },
      { id: 'bp-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Floral Foot Soak & Pedicure', tag: 'Body Care' }
    ],
    reviews: [
      { id: 'bp-r1', name: 'Neelam Oberoi', location: 'Greater Kailash 1, New Delhi', rating: 5, serviceName: 'Shahnaz Husain Gold Radiance Facial', comment: 'The most trustworthy beauty parlour in South Delhi. Sunita ji treats every client with maternal warmth and immaculate hygiene.', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'bp-r2', name: 'Ritu Varma', location: 'Hauz Khas, New Delhi', rating: 5, serviceName: 'Rica White Chocolate Full Body Wax', comment: 'Pain-free waxing with strictly no double dipping. The private rooms are spotless and scented with pure jasmine.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'bp-r3', name: 'Tanya Grover', location: 'Defence Colony, New Delhi', rating: 5, serviceName: 'Bridal Pre-Glow Herbal Body Polish', comment: 'Booked my complete pre-bridal package here. My skin looked luminous on my wedding day. Highest recommendation!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 840,
    averageRating: 4.97,
    landmark: 'M-Block Market, GK-1, Near Nik Bakers',
    parkingInfo: 'Valet and dedicated market parking lot nearby',
    openHourText: '10:00 AM',
    closeHourText: '8:00 PM'
  },

  nail_studio: {
    foundingYear: '2021',
    foundingNarrative: 'Polished Palette was established to turn nail aesthetics into bespoke micro-art. From mirror-chrome glazed donuts to Russian cuticle precision, our studio sets the benchmark for high-fashion nail extensions.',
    specialties: ['Russian Dry E-File Cuticle Care', 'Chrome & Cat-Eye Gel Art', 'Sculpted Gel Extensions', 'Spa Paraffin Pedicures'],
    certifications: [
      { icon: 'verified', title: 'Individual Sealed Drill Bits', description: 'Diamond and ceramic E-file bits sterilized in medical autoclave bags.' },
      { icon: 'eco', title: '9-Free Toxin-Safe Gel Polishes', description: 'Formulations free from formaldehyde, toluene, and DBP.' },
      { icon: 'airline_seat_recline_extra', title: 'Ergonomic Japanese Nail Desks', description: 'Built-in HEPA dust collectors for zero inhalation of fine nail powders.' },
      { icon: 'brush', title: 'Certified Russian Manicurists', description: 'Precision e-file cuticle techniques that last up to 4 weeks without peeling.' }
    ],
    gallery: [
      { id: 'ns-g1', url: SALON_IMAGES.nailArt, title: 'Glossy Chrome Gel Nail Art & Aura Design', tag: 'Nail Art' },
      { id: 'ns-g2', url: SALON_IMAGES.lashBrow, title: 'Lash Extensions & Laminated Brows', tag: 'Lash & Brow' },
      { id: 'ns-g3', url: SALON_IMAGES.hero, title: 'Modern Nail, Lash & Brow Studio Interior', tag: 'Studio Interior' },
      { id: 'ns-g4', url: SALON_IMAGES.toolsSetup, title: 'Sterilized Salon Tools & Gel Polish Flatlay', tag: 'Tools & Setup' },
      { id: 'ns-g5', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Russian Dry Manicure Cuticle Precision', tag: 'Cuticle Care' },
      { id: 'ns-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Luxury Jelly Pedicure Station', tag: 'Pedicure Lounge' }
    ],
    reviews: [
      { id: 'ns-r1', name: 'Ayesha Shroff', location: 'Jubilee Hills, Hyderabad', rating: 5, serviceName: 'Russian Dry E-File Gel Manicure', comment: 'My nails have never looked this clean. The Russian technique is unbelievable—zero hangnails and still perfect after 3 weeks!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'ns-r2', name: 'Zoya Qureshi', location: 'Banjara Hills, Hyderabad', rating: 5, serviceName: 'Full Set Sculpted Hard Gel Extensions', comment: 'They created the exact Pinterest chrome design I requested. The studio has built-in dust collectors so no chemical smells whatsoever.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'ns-r3', name: 'Sneha Reddy', location: 'Gachibowli, Hyderabad', rating: 5, serviceName: 'Cat-Eye Magnetic Gel Overlay', comment: 'The lighting, velvet chairs, and iced green tea they serve makes this a 5-star experience every single time.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 460,
    averageRating: 4.96,
    landmark: 'Road No. 36, Jubilee Hills, Beside Starbucks',
    parkingInfo: 'Complimentary valet parking right outside the studio',
    openHourText: '10:30 AM',
    closeHourText: '8:30 PM'
  },

  hair_spa: {
    foundingYear: '2020',
    foundingNarrative: 'Trichology Sanctuary is an oasis engineered to heal scalp inflammation, revive thinning follicles, and restore biological hair health through micro-mist ozone chambers and deep Ayurvedic hair rituals.',
    specialties: ['Trichology Scalp Barrier Therapy', 'Ozone Steam Follicle Infusion', 'Dandruff Peeling Detox', 'Caviar Hair Hydration'],
    certifications: [
      { icon: 'verified', title: 'Trichological Scalp Camera Diagnostics', description: '500x digital magnification mapping pore density and sebum before treatment.' },
      { icon: 'spa', title: 'Cold-Pressed Botanical Elixirs', description: 'Handcrafted bhringraj, brahmi, and rosemary essential blends.' },
      { icon: 'air', title: 'Japanese Ultrasonic Micro-Mister', description: 'Splits water particles to microscopic size for 90% deeper moisture penetration.' },
      { icon: 'science', title: 'Clinical Trichology Protocol', description: 'Non-invasive therapies supervised by certified scalp wellness experts.' }
    ],
    gallery: [
      { id: 'sp-g1', url: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80', title: 'Japanese Head Spa Ozone Mist Dome', tag: 'Micro-Mist' },
      { id: 'sp-g2', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Digital 500x Scalp Diagnostic Camera', tag: 'Trichology' },
      { id: 'sp-g3', url: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80', title: 'Botanical Hair Mask Application', tag: 'Herbal Therapy' },
      { id: 'sp-g4', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Serene Zen Head Wash Beds', tag: 'Interior' },
      { id: 'sp-g5', url: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=800&q=80', title: 'Silky Gloss Follicle Restoration', tag: 'Results' },
      { id: 'sp-g6', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Aromatherapy Scalp Pressure Points', tag: 'Acupressure' }
    ],
    reviews: [
      { id: 'sp-r1', name: 'Priya Nambiar', location: 'Kakkanad, Kochi', rating: 5, serviceName: 'Intense Anti-Hairfall Keratin Stem Cell Infusion', comment: 'I was losing hair severely postpartum. After 3 sessions of their ozone mist treatment, shedding dropped drastically. Pure clinical magic!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'sp-r2', name: 'Gautam Menon', location: 'Panampilly Nagar, Kochi', rating: 5, serviceName: 'Deep Scalp Clarifying & Peeling Treatment', comment: 'The digital scalp diagnostic before and after was eye-opening. Cleared my chronic scalp buildup in one session.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'sp-r3', name: 'Divya Kurup', location: 'Marine Drive, Kochi', rating: 5, serviceName: 'Ayurvedic Kesh Vardhana Head Massage', comment: 'The warm herbal oils and head acupressure melted away months of desk stress. Felt completely rejuvenated.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 390,
    averageRating: 4.97,
    landmark: 'Main Avenue, Panampilly Nagar, Near Central Park',
    parkingInfo: 'Dedicated customer car parking available in front of clinic',
    openHourText: '09:30 AM',
    closeHourText: '8:00 PM'
  },

  skincare_clinic: {
    foundingYear: '2019',
    foundingNarrative: 'Dermalux is a clinical medical-aesthetic clinic bridging certified dermatology science and luxurious restorative facial protocols. We specialize in non-invasive skin remodeling, pigmentation correction, and medical hydra-dermabrasion.',
    specialties: ['Medical Hydra-Dermabrasion', 'Glutathione Radiance Peel', 'LED Phototherapy', 'Acne Scar Rejuvenation'],
    certifications: [
      { icon: 'verified', title: 'US-FDA Approved Technology', description: 'All clinical medical devices certified for safety across Indian Fitzpatrick skin types.' },
      { icon: 'sanitizer', title: 'Sterile Clinical Environment', description: 'Hospital-standard laminar airflow and sterile disposables.' },
      { icon: 'dermatology', title: 'Board-Certified Cosmetologists', description: 'Skin assessments directed by licensed medical dermatologists.' },
      { icon: 'science', title: 'Targeted Active Ingredients', description: 'Medical grade serums with clinical actives including niacinamide & peptides.' }
    ],
    gallery: [
      { id: 'sc-g1', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Clinical Medical Hydra-Facial Suite', tag: 'Treatment Room' },
      { id: 'sc-g2', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Blue & Red Light LED Phototherapy', tag: 'Technology' },
      { id: 'sc-g3', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Clinical Skin Consultation & Mapping', tag: 'Diagnostics' },
      { id: 'sc-g4', url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', title: 'Targeted Hyaluronic Acid Infusion', tag: 'Hydration' },
      { id: 'sc-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Sterile Reception & Consultation Bay', tag: 'Interior' },
      { id: 'sc-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Glass Skin Radiance Transformation', tag: 'Results' }
    ],
    reviews: [
      { id: 'sc-r1', name: 'Dr. Shalini Ghosh', location: 'Salt Lake Sector V, Kolkata', rating: 5, serviceName: 'Hydra-Facial MD with Peptides', comment: 'As a medical professional, I am extremely picky about clinics. Dermalux maintains flawless sterilization and top US-FDA machines. Skin looked radiant!', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80', date: '2 days ago' },
      { id: 'sc-r2', name: 'Tanmoy Mukherjee', location: 'Park Street, Kolkata', rating: 5, serviceName: 'Clinical Carbon Laser Peel', comment: 'Removed stubborn open pores and hyperpigmentation after just 2 sessions. Transparent pricing and no false promises.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: '5 days ago' },
      { id: 'sc-r3', name: 'Sayantani Sen', location: 'New Town, Kolkata', rating: 5, serviceName: 'Glutathione Brightening Peel', comment: 'Zero downtime and glowing skin for my cousin’s wedding. The team explains every ingredient they apply to your face.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 580,
    averageRating: 4.97,
    landmark: 'Block EP & GP, Sector V, Near Wipro Circle',
    parkingInfo: 'Free on-site basement visitor parking available',
    openHourText: '10:00 AM',
    closeHourText: '8:00 PM'
  },

  makeup_studio: {
    foundingYear: '2017',
    foundingNarrative: 'Glamour House is an editorial, bridal, and celebrity makeup atelier in South Mumbai. We engineer camera-ready, sweatproof makeup for high-profile weddings, red carpets, and digital film productions.',
    specialties: ['HD Airbrush Bridal Glam', 'Cocktail & Sangeet Makeovers', 'Monochrome Editorial Looks', 'Masterclasses'],
    certifications: [
      { icon: 'verified', title: '100% Original Global Cosmetics', description: 'Authenticated palettes from Charlotte Tilbury, Dior, NARS, and MAC.' },
      { icon: 'brush', title: 'Disinfected Brushes & Palettes', description: 'Cinema Secrets 99.9% antibacterial brush sanitation between every face.' },
      { icon: 'wb_incandescent', title: 'High-CRI 98+ Vanity Lighting', description: 'Daylight balanced 5500K mirror illumination to ensure 100% true tone match.' },
      { icon: 'workspace_premium', title: 'Bollywood Celebrity Credits', description: 'Artists trusted by leading models, actresses, and destination brides.' }
    ],
    gallery: [
      { id: 'ms-g1', url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', title: 'Royal Indian Bridal HD Glow', tag: 'Bridal' },
      { id: 'ms-g2', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Hollywood Vanity Mirror Lighting', tag: 'Vanity Station' },
      { id: 'ms-g3', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Soft Glam Sangeet & Reception Look', tag: 'Evening Glam' },
      { id: 'ms-g4', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Precision Wing & Editorial Smokey Eye', tag: 'Eye Artistry' },
      { id: 'ms-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Bridal Suite & Dressing Mirrors', tag: 'Lounge' },
      { id: 'ms-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Flawless Airbrush Base Application', tag: 'Airbrush' }
    ],
    reviews: [
      { id: 'ms-r1', name: 'Natasha Poonawalla', location: 'Colaba, Mumbai', rating: 5, serviceName: 'Bridal HD Airbrush Makeover', comment: 'Rhea made me look like the best version of myself on my wedding day! My makeup stayed flawless through 14 hours of humid coastal weather.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'ms-r2', name: 'Tara Sutaria', location: 'Altamount Road, Mumbai', rating: 5, serviceName: 'Red Carpet Cocktail Glow', comment: 'The skin prep was sublime. No caked foundation—just radiant, luminous skin that photographed like dream editorial magazine covers.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'ms-r3', name: 'Mira Rajput', location: 'Worli Sea Face, Mumbai', rating: 5, serviceName: 'Editorial Sangeet Smokey Eye', comment: 'Utterly professional. The sanitized brush hygiene was reassuring, and the studio vanity lighting was mesmerizing.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '3 weeks ago' }
    ],
    totalReviewCount: 620,
    averageRating: 4.98,
    landmark: 'Babulnath Road, Chowpatty, Near Wilson College',
    parkingInfo: 'Secure valet parking inside the studio premises',
    openHourText: '09:00 AM',
    closeHourText: '8:30 PM'
  },

  massage_wellness: {
    foundingYear: '2019',
    foundingNarrative: 'Serene Palm is a tranquil wellness oasis designed to detoxify the urban nervous system through Swedish deep tissue therapy, warm volcanic basalt stones, and custom cold-pressed botanical aromatherapy.',
    specialties: ['Deep Tissue Muscle Release', 'Volcanic Hot Stone Therapy', 'Balinese Aromatherapy', 'Foot Reflexology'],
    certifications: [
      { icon: 'verified', title: '100% Certified Therapists', description: 'Certified massage therapists trained in Thai, Swedish, and trigger-point anatomy.' },
      { icon: 'spa', title: 'Cold-Pressed Virgin Oils', description: 'Pure carrier oils infused with organic French lavender and Himalayan cedarwood.' },
      { icon: 'dry_cleaning', title: 'Linen Thermal Sterilization', description: '100% Egyptian cotton linens sanitized in high-temperature laundries.' },
      { icon: 'volume_off', title: 'Acoustic Soundproofing', description: 'Therapy chambers built with sound-dampening walls for total silence.' }
    ],
    gallery: [
      { id: 'mw-g1', url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&q=80', title: 'Volcanic Basalt Hot Stone Therapy', tag: 'Hot Stone' },
      { id: 'mw-g2', url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80', title: 'Tranquil Couple Massage Suite', tag: 'Couple Suite' },
      { id: 'mw-g3', url: 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?auto=format&fit=crop&w=800&q=80', title: 'Aromatherapy Herbal Oil Selection', tag: 'Botanical Oils' },
      { id: 'mw-g4', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Private Steam & Shower Chamber', tag: 'Facilities' },
      { id: 'mw-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Bamboo Lounge & Herbal Tea Bar', tag: 'Lounge' },
      { id: 'mw-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Thai Herbal Compress Healing', tag: 'Herbal Compress' }
    ],
    reviews: [
      { id: 'mw-r1', name: 'Vikram Joshi', location: 'Koregaon Park, Pune', rating: 5, serviceName: 'Deep Tissue Sports Therapy 90 mins', comment: 'Had severe lumbar knotting from marathon training. The therapist worked out every muscle knot with surgical precision. Best spa in Pune.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: 'Yesterday' },
      { id: 'mw-r2', name: 'Radhika Kirloskar', location: 'Kalyani Nagar, Pune', rating: 5, serviceName: 'Warm Volcanic Stone & Lavender Ritual', comment: 'Total serenity. From the lemongrass cold towel upon arrival to the warm stone glide, every detail was transcendent.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '4 days ago' },
      { id: 'mw-r3', name: 'Ashok Deshmukh', location: 'Viman Nagar, Pune', rating: 5, serviceName: 'Balinese Aromatherapy Massage', comment: 'Incredible acoustic insulation—you cannot hear a whisper of city traffic. Came out feeling 10 years younger.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', date: '1 week ago' }
    ],
    totalReviewCount: 750,
    averageRating: 4.98,
    landmark: 'Lane 7, Koregaon Park, Near Osho Ashram Gate',
    parkingInfo: 'Private gated courtyard with free valet parking',
    openHourText: '09:00 AM',
    closeHourText: '9:30 PM'
  },

  hair_coloring: {
    foundingYear: '2020',
    foundingNarrative: 'Chroma Hair Coloring Studio is North India’s dedicated color chemistry and balayage atelier. We specialize in seamless Asian dark-hair lightening, ash blonde transitions, and vibrant copper tones with bond-protecting Plex science.',
    specialties: ['French Freehand Balayage', 'Ash & Biscuit Blonde Lightening', 'Rich Auburn & Copper Waves', 'Bond-Builder Olaplex Reversal'],
    certifications: [
      { icon: 'verified', title: 'Bond Multiplier Technology', description: 'Every bleaching formulation fortified with Olaplex to protect 98% hair integrity.' },
      { icon: 'palette', title: 'Ammonia-Free European Pigments', description: 'Enriched with argan oil and silk proteins for mirror-like color shine.' },
      { icon: 'flare', title: 'CRI 98+ True-Spectrum Wash Stations', description: 'Color diagnostics under daylight lighting to guarantee zero brassiness.' },
      { icon: 'workspace_premium', title: 'L’Oréal Master Color Certified', description: 'Colorists undergo 300+ hours of advanced color chemistry training.' }
    ],
    gallery: [
      { id: 'hc-g1', url: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80', title: 'Seamless Caramel Balayage on Dark Hair', tag: 'Balayage' },
      { id: 'hc-g2', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Cool Ash Blonde Transition with Olaplex', tag: 'Lightening' },
      { id: 'hc-g3', url: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80', title: 'Color Mixing Bar & Custom Swatches', tag: 'Color Lab' },
      { id: 'hc-g4', url: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=800&q=80', title: 'Rich Copper Cinnamon Dimensional Tone', tag: 'Copper Tones' },
      { id: 'hc-g5', url: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80', title: 'Pastel Rose Gold Money Piece', tag: 'Fashion Color' },
      { id: 'hc-g6', url: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?auto=format&fit=crop&w=800&q=80', title: 'Post-Color Glaze Wash & Conditioning', tag: 'Gloss Finish' }
    ],
    reviews: [
      { id: 'hc-r1', name: 'Kritika Khurana', location: 'Vasant Vihar, New Delhi', rating: 5, serviceName: 'Bespoke Balayage & Glaze Gloss', comment: 'Lightening dark Indian hair without brassiness is an art few understand. Chroma gave me the softest, most seamless hazelnut balayage ever!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '2 days ago' },
      { id: 'hc-r2', name: 'Ishita Mangal', location: 'Chanakyapuri, New Delhi', rating: 5, serviceName: 'Ash Blonde Transformation + Olaplex', comment: 'Zero breakage thanks to their Olaplex protocol. The colorists here are real chemists who understand tone neutralization.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'hc-r3', name: 'Mallika Dua', location: 'Hauz Khas, New Delhi', rating: 5, serviceName: 'Global Gloss Tone & Anti-Brass Wash', comment: 'Refreshed my dull faded color in 40 minutes. Gorgeous mirror gloss and very chic studio atmosphere.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 490,
    averageRating: 4.96,
    landmark: 'Basant Lok Community Centre, Vasant Vihar, Near Priya Cinema',
    parkingInfo: 'Valet parking available at Basant Lok plaza',
    openHourText: '10:00 AM',
    closeHourText: '8:30 PM'
  },

  bridal_lounge: {
    foundingYear: '2015',
    foundingNarrative: 'Maharani Bridal Lounge is Rajasthan’s premier luxury bridal styling sanctum. We design heirloom bridal makeovers, dupatta draping, royal mehendi looks, and jewelry integration for destination and royal Indian palace weddings.',
    specialties: ['Royal Palace HD Bridal Makeover', 'Heritage Dupatta & Saree Draping', 'Airbrush 24H Waterproof Base', 'Pre-Bridal Saffron Polish'],
    certifications: [
      { icon: 'verified', title: 'Private Presidential Bridal Suites', description: 'Luxurious private dressing chambers accommodating bride and her bridal party.' },
      { icon: 'diamond', title: 'Jewelry & Fabric Integration Care', description: 'Specialist drape artists certified in heavy antique zardozi, silk, and kundan styling.' },
      { icon: 'water_drop', title: '24-Hour Tears & Humidity Proof', description: 'Custom waterproofing sealants certified for 18+ hours of varmala & pheras.' },
      { icon: 'stars', title: 'Featured in Vogue & WedMeGood', description: 'Ranked top luxury destination wedding salon in Rajasthan.' }
    ],
    gallery: [
      { id: 'bl-g1', url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', title: 'Royal Rajasthani Heritage Bridal Glow', tag: 'Bridal Makeover' },
      { id: 'bl-g2', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Kundan Matha Patti & Dupatta Draping', tag: 'Draping Art' },
      { id: 'bl-g3', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Private Palatial Bridal Suite', tag: 'Suite Interior' },
      { id: 'bl-g4', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Floral Bun & Hair Jewelry Architecture', tag: 'Hair Architecture' },
      { id: 'bl-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Pre-Wedding Saffron Body Polish Room', tag: 'Pre-Bridal' },
      { id: 'bl-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Destination Bride Sunset Portrait', tag: 'Destination' }
    ],
    reviews: [
      { id: 'bl-r1', name: 'Princess Gayatri Rathore', location: 'C-Scheme, Jaipur', rating: 5, serviceName: 'Maharani Full Bridal HD Makeover & Draping', comment: 'Gayatri ji and her bridal team made me look like royalty for my palace wedding. The dupatta draping held 12kg of zardozi comfortably for 14 hours!', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'bl-r2', name: 'Ananya Singhal', location: 'Rambagh, Jaipur', rating: 5, serviceName: 'Destination Bride Sangeet Look', comment: 'Traveled from London for my Jaipur wedding. The team was punctual, reassuring, and the airbrush base stayed immaculate throughout the pheras.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'bl-r3', name: 'Pooja Shekhawat', location: 'Civil Lines, Jaipur', rating: 5, serviceName: 'Pre-Bridal Royal Kesar Ubtan Polish', comment: 'The pre-bridal skin therapy cleared all fatigue and gave my face an ethereal golden sheen. The private suite feels like a royal palace.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 890,
    averageRating: 4.99,
    landmark: 'Mirza Ismail Road (MI Road), Opposite Raj Mandir Cinema',
    parkingInfo: 'Private gated bridal courtyard with security and valet',
    openHourText: '09:00 AM',
    closeHourText: '9:00 PM'
  },

  tattoo_studio: {
    foundingYear: '2017',
    foundingNarrative: 'Iron & Ink is Bengaluru’s foremost sterile custom tattoo and body piercing studio on Church Street. We specialize in intricate fine-line micro-realism, sacred geometry, and custom Indian mythological sleeves.',
    specialties: ['Single-Needle Fine Line', 'Sacred Geometry & Mandalas', 'Micro-Realism Portraits', 'Titanium Body Piercings'],
    certifications: [
      { icon: 'verified', title: 'Hospital Class-B Autoclave Sterilization', description: 'Every grip, tube, and tool sanitized in medical vacuum chambers.' },
      { icon: 'colorize', title: 'Single-Use Sealed Needle Cartridges', description: 'Cheyenne and Kwadron sterile cartridges opened fresh in front of the client.' },
      { icon: 'eco', title: '100% Vegan Certified Inks', description: 'Kuro Sumi and Dynamic pure black pigments, non-toxic and hypoallergenic.' },
      { icon: 'healing', title: 'Medical Derm-Shield Aftercare', description: 'Second-skin sterile waterproof barrier application for 100% infection prevention.' }
    ],
    gallery: [
      { id: 'ts-g1', url: 'https://images.unsplash.com/photo-1598371839696-5c5bb00bdc28?auto=format&fit=crop&w=800&q=80', title: 'Fine-Line Micro Realism Mandala', tag: 'Fine Line' },
      { id: 'ts-g2', url: 'https://images.unsplash.com/photo-1562962230-16e4623d36e6?auto=format&fit=crop&w=800&q=80', title: 'Sterile Black Metal Tattoo Station', tag: 'Studio Interior' },
      { id: 'ts-g3', url: 'https://images.unsplash.com/photo-1611501275019-9b5cda994e8d?auto=format&fit=crop&w=800&q=80', title: 'Intricate Sacred Geometry Sleeve', tag: 'Custom Sleeve' },
      { id: 'ts-g4', url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80', title: 'Consultation & Digital Stencil Drafting', tag: 'Custom Design' },
      { id: 'ts-g5', url: 'https://images.unsplash.com/photo-1517832606589-7157be614532?auto=format&fit=crop&w=800&q=80', title: 'Minimalist Botanical Floral Ankle Tattoo', tag: 'Minimalist' },
      { id: 'ts-g6', url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=800&q=80', title: 'Implant-Grade Titanium Ear Curation', tag: 'Piercing' }
    ],
    reviews: [
      { id: 'ts-r1', name: 'Devendra Gowda', location: 'Church Street, Bengaluru', rating: 5, serviceName: 'Custom Fine-Line Sacred Geometry Tattoo', comment: 'Rudra is a genius. Cleanest needle work in India. The studio hygiene looks cleaner than a hospital operating theatre. 10/10.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: 'Yesterday' },
      { id: 'ts-r2', name: 'Natasha D’Souza', location: 'MG Road, Bengaluru', rating: 5, serviceName: 'Micro-Realism Pet Portrait', comment: 'The fine line detail on my dog’s portrait blew my mind. Healed seamlessly with the Derm-Shield they provided.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'ts-r3', name: 'Karthik Raman', location: 'Indiranagar, Bengaluru', rating: 5, serviceName: 'Implant-Grade Titanium Helix Piercing', comment: 'Pierced with surgical needle, not a gun! Virtually zero pain, and the titanium jewelry looks stunning.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', date: '1 week ago' }
    ],
    totalReviewCount: 790,
    averageRating: 4.99,
    landmark: 'Church Street, Off Brigade Road, Above Blossoms Book House',
    parkingInfo: 'MG Road Metro station parking 2 mins walk away',
    openHourText: '11:00 AM',
    closeHourText: '9:00 PM'
  },

  lash_brow: {
    foundingYear: '2020',
    foundingNarrative: 'The Brow & Lash Loft is South Delhi’s premier boutique specializing in Russian volume lash extensions, semi-permanent nano-blading, and keratin lash lifts tailored to elevate natural facial architecture.',
    specialties: ['Russian Volume Mega Lashes', 'Keratin Lash Infusion Lift', 'HD Brow Lamination', 'Nano-Blading Hair Strokes'],
    certifications: [
      { icon: 'verified', title: 'Medical-Grade Fume-Free Adhesives', description: 'Latex-free and formaldehyde-free surgical adhesives safe for sensitive eyes.' },
      { icon: 'remove_red_eye', title: 'Natural Lash Weight Safety', description: 'Zero damage to natural follicles through custom 0.05mm ultra-lightweight silk fibers.' },
      { icon: 'sanitizer', title: 'Surgical Tweezers Sterilization', description: 'Precision tweezers autoclaved and UV-sterilized before every client.' },
      { icon: 'workspace_premium', title: 'PhiBrows Royal Artist Certified', description: 'Permanent makeup performed by internationally certified microblading masters.' }
    ],
    gallery: [
      { id: 'lb-g1', url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', title: 'Feathered Brow Lamination & Tint', tag: 'Brows' },
      { id: 'lb-g2', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', title: 'Fluffy Russian Volume Lash Set', tag: 'Lashes' },
      { id: 'lb-g3', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Ergonomic Memory Foam Lash Beds', tag: 'Studio Interior' },
      { id: 'lb-g4', url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', title: 'Keratin Lash Lift Before & After', tag: 'Natural Lift' },
      { id: 'lb-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Precision Nano-Blading Hair Strokes', tag: 'Microblading' },
      { id: 'lb-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Clean Consultation & Brow Mapping', tag: 'Consultation' }
    ],
    reviews: [
      { id: 'lb-r1', name: 'Sonam Kapoor Ahuja', location: 'Khan Market, New Delhi', rating: 5, serviceName: 'Russian Volume Lashes & Brow Lamination', comment: 'The memory foam beds are so comfy I fell asleep immediately! Woke up with the fluffiest, lightest lashes imaginable. Total game changer.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', date: '3 days ago' },
      { id: 'lb-r2', name: 'Mallika Sherawat', location: 'Golf Links, New Delhi', rating: 5, serviceName: 'Keratin Lash Lift & Botox Tint', comment: 'Zero burning or red eyes. My natural lashes look curly and dark without needing mascara for 8 weeks.', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80', date: '1 week ago' },
      { id: 'lb-r3', name: 'Ananya Birla', location: 'Sundar Nagar, New Delhi', rating: 5, serviceName: 'PhiBrows Microblading Hair Strokes', comment: 'Restored my overplucked 90s brows to lush, natural perfection. The artist mapped my bone structure with precision calipers.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 440,
    averageRating: 4.96,
    landmark: 'Middle Lane, Khan Market, Near Cafe Turtle',
    parkingInfo: 'Market parking lot with attendant assistance',
    openHourText: '10:30 AM',
    closeHourText: '8:00 PM'
  },

  ayurvedic_spa: {
    foundingYear: '2016',
    foundingNarrative: 'Sanjivani Ayurvedic Rejuvenation Spa honors the centuries-old Kerala Vaidya tradition in Chennai. We practice authentic Panchakarma therapies, continuous warm herbal Shirodhara oil streams, and Kizhi herbal poultice therapies.',
    specialties: ['Shirodhara Medicated Oil Stream', 'Traditional Kerala Abhyanga', 'Navara Kizhi Rice Poultice', 'Mukha Lepam Herbal Facial'],
    certifications: [
      { icon: 'verified', title: 'Authentic Kerala Droni Wooden Beds', description: 'Handcrafted seasoned Neem and Vengai wood massage tables.' },
      { icon: 'spa', title: 'Kottakkal Arya Vaidya Sala Oils', description: 'Certified classical medicated thailams prepared per Ashtanga Hridaya texts.' },
      { icon: 'local_pharmacy', title: 'Consultations by BAMS Ayurvedic Doctors', description: 'Prakriti (Vata, Pitta, Kapha) dosha analysis before oil formulation.' },
      { icon: 'eco', title: '100% Chemical-Free Botanical Care', description: 'Organic sun-dried wild herbs, cow’s milk, and Navara medicinal rice.' }
    ],
    gallery: [
      { id: 'ay-g1', url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&q=80', title: 'Bronze Vessel Shirodhara Oil Stream', tag: 'Shirodhara' },
      { id: 'ay-g2', url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80', title: 'Authentic Teakwood Droni Therapy Bed', tag: 'Traditional Bed' },
      { id: 'ay-g3', url: 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?auto=format&fit=crop&w=800&q=80', title: 'Warm Herbal Kizhi Poultice Preparation', tag: 'Herbal Kizhi' },
      { id: 'ay-g4', url: 'https://images.unsplash.com/photo-1512290900672-1f55b9e07506?auto=format&fit=crop&w=800&q=80', title: 'Brass Herb Steamer & Herbal Bath', tag: 'Herbal Steam' },
      { id: 'ay-g5', url: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', title: 'Ayurvedic Doctor Consultation Chamber', tag: 'Diagnostics' },
      { id: 'ay-g6', url: 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&w=800&q=80', title: 'Classical Medicated Tailam Dispensary', tag: 'Herbal Oils' }
    ],
    reviews: [
      { id: 'ay-r1', name: 'Sundararajan Krishnan', location: 'Besant Nagar, Chennai', rating: 5, serviceName: 'Authentic Kerala Shirodhara & Abhyanga', comment: 'The Shirodhara with warm medicated sesame oil cured my insomnia within 2 sessions. Genuine Kerala Vaidyas and pristine herbal aromas.', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', date: '2 days ago' },
      { id: 'ay-r2', name: 'Lakshmi Narayanan', location: 'Adyar, Chennai', rating: 5, serviceName: 'Navara Kizhi Herbal Rice Poultice', comment: 'Healed severe joint stiffness in my knees. Dr. Nair conducted an in-depth pulse reading and prescribed the exact herbal regimen.', avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80', date: '6 days ago' },
      { id: 'ay-r3', name: 'Madhavan Venkat', location: 'Thiruvanmiyur, Chennai', rating: 5, serviceName: 'Traditional Mukha Lepam Herbal Facial', comment: 'Leaves you completely grounded and peaceful. The teakwood droni and copper vessels show their deep respect for classical tradition.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', date: '2 weeks ago' }
    ],
    totalReviewCount: 810,
    averageRating: 4.98,
    landmark: 'Beach Road, Besant Nagar, Near Elliot’s Beach Promenade',
    parkingInfo: 'Private garden compound with ample car parking space',
    openHourText: '08:30 AM',
    closeHourText: '8:30 PM'
  }
};
