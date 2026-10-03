# All 27 templates: public rendering verification

The fix uses the common renderer for all 27 registered designs. Each test deliberately supplies an editor default of hair_salon and hydrates a published template from /api/site. Each published choice supplies its own cover and saved services, keeps owner editing controls absent, opens its own customer profile route, and enters authentication when booking as a signed-out visitor. Image failures stop at the local placeholder instead of looping. Public maps use OpenStreetMap; editor address confirmation uses Nominatim without Google fallback or guessed pins.

Validation: DOM suite 257/257; focused template/map checks 70/70; typecheck and production build pass. This verifies component behavior in jsdom, not a deployed browser/payment transaction. The previously documented live availability schema mismatch and deployment remain outstanding; no production E2E completion is claimed.

| Template ID | Design | Public matrix |
|---|---|---|
| hair_salon | Hair & Styling Studio | PASS |
| barber | The Royal Blade Barber & Men's Club | PASS |
| unisex_salon | Aura Unisex Salon & Wellness Lounge | PASS |
| beauty_parlour | Roop Mahal Beauty Parlour & Makeover Space | PASS |
| nail_studio | Pinky Nails Studio | PASS |
| hair_spa | Kesh Prakriti Hair Spa & Scalp Sanctuary | PASS |
| skincare_clinic | Dermacure Aesthetic Dermatology & Laser Clinic | PASS |
| makeup_studio | Vogue Noir Makeup Studio & Academy | PASS |
| massage_wellness | Bodhi Tree Massage & Wellness Sanctuary | PASS |
| hair_coloring | Prism & Chroma Hair Color Atelier | PASS |
| bridal_lounge | Shringaar Royal Indian Bridal Lounge | PASS |
| tattoo_studio | Iron & Ink Urban Tattoo & Body Art Studio | PASS |
| lash_brow | Arch & Flutter Lash & Brow Bar | PASS |
| ayurvedic_spa | Veda Sanjeevani Ayurvedic Wellness & Spa | PASS |
| ayurvedic_wellness_spa | Sattva Ayurvedic & Wellness Spa | PASS |
| luxury_hair_salon | VIP Black & Gold — All-Purpose Signature | PASS |
| bridal_makeover_studio | Rose & Ivory Bridal Atelier | PASS |
| family_salon | Cedar & Bloom Family Salon | PASS |
| barber_grooming_club | The Iron Standard Barber & Grooming Club | PASS |
| nails_lash_brow_bar | Peony & Lacquer Lash, Brow & Nail Bar | PASS |
| medispa_aesthetics | Porcelain Skin Lab Medi-Spa & Aesthetics Clinic | PASS |
| organic_bio_salon | Terra Botanica Organic & Bio-Salon | PASS |
| express_beauty_bar | Blink Express Beauty Bar | PASS |
| thai_massage_center | Baan Sen Thai & Oriental Massage Center | PASS |
| kids_teens_studio | Scissors & Sprinkles Kids & Teens Fun Hair Studio | PASS |
| resort_spa | Azure Palms Luxury Hotel & Resort Spa | PASS |
| vedic_ayurveda_studio | Vedvriksha Vedic Ayurveda Wellness Studio | PASS |
