import type { LayoutStyle } from '../types';

type Composition = 'split-left' | 'split-right' | 'centered' | 'editorial' | 'panorama' | 'signature';
type Layout = { composition: Composition; width: number; columns: number; gap: number; galleryRatio: string };
const layout = (composition: Composition, width: number, columns: number, gap: number, galleryRatio: string): Layout => ({ composition, width, columns, gap, galleryRatio });

/** Explicit composition recipes; customer functionality stays in one renderer. */
export const TEMPLATE_LAYOUTS: Record<LayoutStyle, Layout> = {
  modern_minimalist: layout('split-left', 58, 2, 24, '4 / 3'),
  vintage_industrial: layout('editorial', 68, 2, 20, '3 / 4'),
  contemporary_balanced: layout('split-right', 60, 2, 28, '1 / 1'),
  curved_elegant: layout('centered', 80, 3, 24, '4 / 5'),
  bento_grid: layout('editorial', 72, 3, 16, '1 / 1'),
  zen_emerald: layout('centered', 76, 2, 32, '4 / 3'),
  clinical_clean: layout('split-left', 55, 2, 20, '3 / 2'),
  dark_glam: layout('split-right', 64, 2, 24, '3 / 4'),
  earth_bamboo: layout('panorama', 82, 2, 32, '16 / 9'),
  creative_gallery: layout('editorial', 74, 3, 20, '4 / 5'),
  royal_crimson: layout('centered', 78, 2, 28, '3 / 4'),
  urban_monochrome: layout('split-left', 62, 2, 16, '1 / 1'),
  chic_nude: layout('split-right', 56, 3, 24, '4 / 5'),
  ayurvedic_terracotta: layout('panorama', 86, 2, 28, '4 / 3'),
  botanical_wellness: layout('centered', 84, 2, 30, '3 / 2'),
  haute_luxe: layout('editorial', 66, 2, 32, '3 / 4'),
  black_gold_signature: layout('signature', 100, 2, 28, '4 / 3'),
  ivory_pearl_bridal: layout('split-right', 70, 2, 30, '4 / 5'),
  family_fresh: layout('split-left', 65, 3, 20, '4 / 3'),
  gents_club: layout('editorial', 60, 2, 22, '3 / 2'),
  berry_pearl_bar: layout('centered', 72, 3, 18, '1 / 1'),
  medispa_porcelain: layout('split-left', 57, 2, 26, '4 / 3'),
  organic_meadow: layout('panorama', 88, 3, 28, '3 / 2'),
  express_pop: layout('split-right', 58, 3, 16, '1 / 1'),
  oriental_silk: layout('centered', 86, 2, 34, '16 / 9'),
  candy_playroom: layout('editorial', 76, 3, 22, '4 / 3'),
  resort_luxe: layout('panorama', 90, 2, 36, '16 / 9'),
  vedic_marigold: layout('centered', 82, 2, 26, '3 / 2'),
};
