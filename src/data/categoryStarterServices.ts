import type { BusinessTypeId, SalonService } from '../types';
import { getTemplateById, type TemplateCategory } from './templates';

const photo = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=85`;
const images: Record<TemplateCategory, string> = {
  hair: photo('photo-1562322140-8baeececf3df'), barber: photo('photo-1503951914875-452162b0f3f1'),
  beauty: photo('photo-1516975080664-ed2fc6a32937'), spa: photo('photo-1544161515-4ab6ce6db874'),
  ayurvedic: photo('photo-1540555700478-4be289fbecef'), nails: photo('photo-1604654894610-df63bc536371'),
  skin: photo('photo-1570172619644-dfd03ed5d881'), tattoo: photo('photo-1565058379802-bbe93b2f703a'),
  kids: photo('photo-1519699047748-de8e457a634e'),
};
type Starter = [name: string, minutes: number, price: number, description: string];
const starters: Partial<Record<TemplateCategory, Starter[]>> = {
  hair: [
    ['Precision Cut & Blowdry', 60, 1200, 'A tailored haircut, refreshing wash and polished blowdry, with a personal consultation and easy styling advice for home.'],
    ['Balayage Color', 150, 5500, 'Hand-painted highlights create soft dimension, with a colour consultation, nourishing wash and professional styling finish.'],
    ['Keratin Treatment', 120, 4500, 'A smoothing treatment selected for your hair, with a consultation, careful application and guidance on aftercare at home.'],
    ['Scalp Detox Spa', 60, 1800, 'Refresh your scalp with a gentle cleanse, relaxing massage and conditioning mask, tailored to your hair and comfort.'],
    ['Beard Sculpting', 30, 500, 'A shape consultation, precise beard trim and clean edging, finished with conditioning care and daily grooming advice.'],
  ],
  spa: [
    ['Deep Tissue Massage', 90, 3200, 'A focused full-body massage with pressure tailored to your comfort, a personal consultation and a quiet relaxation finish.'],
    ['Aromatherapy', 60, 2500, 'Unwind with a gentle massage using selected aromatic oils, a sensitivity consultation and a calm, unhurried relaxation finish.'],
    ['Swedish Therapy', 60, 2400, 'Relax with flowing massage strokes and gentle kneading, with pressure adjusted to your preferences in a peaceful setting.'],
    ['Herbal Scrub', 45, 1800, 'A gentle herbal body exfoliation followed by a warm rinse and hydrating finish, selected after a skin-sensitivity consultation.'],
    ['Hot Stone Therapy', 90, 3500, 'Enjoy a warming massage with smooth heated stones, careful temperature checks and pressure adapted to your comfort.'],
  ],
  beauty: [
    ['HydraFacial', 60, 3500, 'A refreshing facial with cleansing, gentle exfoliation and hydration, tailored after a consultation about your skin needs.'],
    ['Bridal Makeover', 120, 12000, 'A personalised bridal look with skin preparation, coordinated makeup and hair styling, plus a consultation on your occasion.'],
    ['Threading & Waxing', 45, 900, 'Precision brow shaping and selected-area waxing, with a comfort consultation, gentle preparation and soothing aftercare.'],
    ['Nail Extensions', 90, 2200, 'Custom-shaped nail extensions with careful preparation and a polished finish, plus advice to keep your set looking fresh.'],
    ['Pedicure Deluxe', 60, 1400, 'A refreshing foot soak, nail shaping and gentle exfoliation, completed with a relaxing massage and your choice of polish.'],
  ],
};

export function serviceImageFallback(templateId?: BusinessTypeId): string {
  return images[getTemplateById(templateId)?.category || 'hair'];
}

/** Explicit actions only. Never called during hydration, so intentional deletions survive reload. */
export function addMissingStarterServices(current: SalonService[] | undefined, templateId: BusinessTypeId): SalonService[] {
  if (current?.length) return current;
  const template = getTemplateById(templateId);
  if (!template) return current || [];
  const rows = starters[template.category];
  if (rows) return rows.map(([name, durationMinutes, price, description], index) => ({
    id: `${templateId}-starter-${index + 1}`, name, category: template.config.subCategories[0] || template.name,
    durationMinutes, price, description, imageUrl: images[template.category], icon: 'Sparkles', showDuration: true,
  }));
  return template.defaultData.services.slice(0, 5).map(service => {
    const description = service.description.length < 100
      ? `${service.description} Includes a personal consultation, attentive care and practical aftercare guidance.` : service.description;
    const image = new URL(service.imageUrl?.startsWith('https://images.unsplash.com/') ? service.imageUrl : images[template.category]);
    if (image.hostname === 'images.unsplash.com') { image.searchParams.set('w', '1400'); image.searchParams.set('q', '85'); }
    return { ...service, description: description.length > 150 ? `${description.slice(0, 147).trimEnd()}…` : description,
      imageUrl: image.href, showDuration: true };
  });
}
