import type { SalonService } from '../types';

// Fifth signature treatment for categories whose original catalogue had four.
const details: Record<string, [string, string, number, number, string]> = {
  tattoo_studio: ['Tattoo Design Consultation & Stencil Fitting', 'Design Consultation', 45, 800, 'Discuss placement, scale and style with an artist. Includes a custom sketch consultation, stencil fitting and aftercare planning. Tattooing is quoted separately.'],
  ayurvedic_spa: ['Herbal Foot & Lower Leg Ritual', 'Ayurvedic Care', 40, 1400, 'A warm herbal foot soak followed by gentle lower-leg massage and a nourishing oil finish. Includes a comfort and sensitivity consultation.'],
  ayurvedic_wellness_spa: ['Abhyanga Warm Oil Massage', 'Ayurvedic Care', 60, 2200, 'A personalized warm-oil body massage with gentle pressure, a relaxing rest period and guidance on post-treatment care.'],
  luxury_hair_salon: ['Signature Gloss & Blowout', 'Hair Styling', 60, 2800, 'Consultation, gloss refresh, conditioning wash and a polished blowout. Includes styling advice for maintaining your finish at home.'],
  bridal_makeover_studio: ['Bridal Makeup Trial & Look Planning', 'Bridal Trials', 90, 4500, 'Create your wedding-day look with a skin-prep consultation, trial makeup, colour matching and a personalized product and timing plan.'],
  family_salon: ['Family Occasion Styling', 'Occasion Styling', 45, 1200, 'Consultation, gentle wash and occasion-ready hair styling for one guest. Choose a smooth blowout or soft waves suited to your hair.'],
  barber_grooming_club: ['Executive Scalp Refresh & Styling', 'Grooming Rituals', 35, 950, 'A cleansing shampoo, relaxing scalp massage and precision styling finish. Includes a consultation on products and daily grooming.'],
  nails_lash_brow_bar: ['Classic Brow Shape & Tint', 'Brow Design', 40, 1100, 'Brow mapping, precision shaping and a custom tint. Includes a consultation and aftercare advice; a patch test may be required in advance.'],
  medispa_aesthetics: ['Skin Consultation & Care Plan', 'Consultations', 40, 1500, 'A practitioner-led consultation covering skin concerns, product history and suitable care options. Includes a personalized plan; procedures are priced separately.'],
  organic_bio_salon: ['Botanical Hair Mask & Blowdry', 'Botanical Hair Care', 60, 1800, 'A gentle cleanse, botanical conditioning mask, scalp massage and blowdry. Products are selected after a hair and sensitivity consultation.'],
  express_beauty_bar: ['Express Manicure & Polish', 'Express Nails', 30, 650, 'Nail shaping, gentle cuticle care, hand hydration and a classic polish finish. Ideal for a quick refresh between appointments.'],
  thai_massage_center: ['Thai Foot Reflexology Ritual', 'Foot Therapy', 45, 1700, 'A warm foot cleanse, pressure-based foot and lower-leg massage and a calming finish. Pressure is adjusted to your comfort.'],
  kids_teens_studio: ['Teen Wash, Cut & Style', 'Teen Styling', 40, 700, 'A style consultation, gentle wash, personalized haircut and easy-care styling tips. Parents are welcome during the appointment.'],
  resort_spa: ['Coastal Coconut Body Polish', 'Body Rituals', 60, 3200, 'A gentle coconut-based exfoliation, warm rinse and hydrating body finish in a private treatment suite. Includes a skin-sensitivity consultation.'],
};
export const ADDITIONAL_TEMPLATE_SERVICES: Record<string, SalonService> = Object.fromEntries(
  Object.entries(details).map(([id, [name, category, durationMinutes, price, description]]) => [id, {
    id: `${id}-signature-5`, name, category, durationMinutes, price, description, icon: 'Sparkles', popular: true,
  }])
);
