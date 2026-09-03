import { BusinessTypeId } from './types';

export type AccentPaletteKey = 
  | 'crimson'
  | 'mahogany'
  | 'emerald'
  | 'slate'
  | 'purple'
  | 'rose'
  | 'ocean'
  | 'obsidian';

export interface ThemeAccentConfig {
  key: AccentPaletteKey;
  name: string;
  categoryHint: string;
  primaryHex: string;
  secondaryHex: string;
  badgeBg: string;
  badgeText: string;
  buttonBg: string;
  buttonHoverBg: string;
  buttonText: string;
  textAccent: string;
  borderAccent: string;
  lightBg: string;
  ringColor: string;
}

export const ACCENT_PALETTES: Record<AccentPaletteKey, ThemeAccentConfig> = {
  crimson: {
    key: 'crimson',
    name: 'Royal Crimson',
    categoryHint: 'Bridal & Makeover',
    primaryHex: '#9f1239',
    secondaryHex: '#e11d48',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-900',
    buttonBg: 'bg-rose-800',
    buttonHoverBg: 'hover:bg-rose-900',
    buttonText: 'text-white',
    textAccent: 'text-rose-800',
    borderAccent: 'border-rose-300',
    lightBg: 'bg-rose-50',
    ringColor: 'focus:ring-rose-800'
  },
  mahogany: {
    key: 'mahogany',
    name: 'Vintage Mahogany',
    categoryHint: "Barber & Men's Grooming",
    primaryHex: '#78350f',
    secondaryHex: '#b45309',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-950',
    buttonBg: 'bg-amber-900',
    buttonHoverBg: 'hover:bg-amber-950',
    buttonText: 'text-amber-50',
    textAccent: 'text-amber-900',
    borderAccent: 'border-amber-300',
    lightBg: 'bg-amber-50',
    ringColor: 'focus:ring-amber-900'
  },
  emerald: {
    key: 'emerald',
    name: 'Botanical Emerald',
    categoryHint: 'Spa, Wellness & Ayurvedic',
    primaryHex: '#065f46',
    secondaryHex: '#059669',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-950',
    buttonBg: 'bg-emerald-800',
    buttonHoverBg: 'hover:bg-emerald-900',
    buttonText: 'text-white',
    textAccent: 'text-emerald-800',
    borderAccent: 'border-emerald-300',
    lightBg: 'bg-emerald-50',
    ringColor: 'focus:ring-emerald-800'
  },
  slate: {
    key: 'slate',
    name: 'Minimalist Slate',
    categoryHint: 'Hair Studio & Modern Unisex',
    primaryHex: '#0f172a',
    secondaryHex: '#334155',
    badgeBg: 'bg-slate-200',
    badgeText: 'text-slate-900',
    buttonBg: 'bg-slate-900',
    buttonHoverBg: 'hover:bg-slate-800',
    buttonText: 'text-white',
    textAccent: 'text-slate-900',
    borderAccent: 'border-slate-300',
    lightBg: 'bg-slate-100',
    ringColor: 'focus:ring-slate-900'
  },
  purple: {
    key: 'purple',
    name: 'Glamour Orchid',
    categoryHint: 'Nail Studio & Lash Bar',
    primaryHex: '#7e22ce',
    secondaryHex: '#a855f7',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-950',
    buttonBg: 'bg-purple-700',
    buttonHoverBg: 'hover:bg-purple-800',
    buttonText: 'text-white',
    textAccent: 'text-purple-700',
    borderAccent: 'border-purple-300',
    lightBg: 'bg-purple-50',
    ringColor: 'focus:ring-purple-700'
  },
  rose: {
    key: 'rose',
    name: 'Rose Gold & Blush',
    categoryHint: 'Beauty Parlour & Glow',
    primaryHex: '#be185d',
    secondaryHex: '#f43f5e',
    badgeBg: 'bg-pink-100',
    badgeText: 'text-pink-950',
    buttonBg: 'bg-pink-700',
    buttonHoverBg: 'hover:bg-pink-800',
    buttonText: 'text-white',
    textAccent: 'text-pink-700',
    borderAccent: 'border-pink-300',
    lightBg: 'bg-pink-50',
    ringColor: 'focus:ring-pink-700'
  },
  ocean: {
    key: 'ocean',
    name: 'Clinical Ocean',
    categoryHint: 'Skincare & Dermatology',
    primaryHex: '#0369a1',
    secondaryHex: '#0284c7',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-950',
    buttonBg: 'bg-sky-700',
    buttonHoverBg: 'hover:bg-sky-800',
    buttonText: 'text-white',
    textAccent: 'text-sky-700',
    borderAccent: 'border-sky-300',
    lightBg: 'bg-sky-50',
    ringColor: 'focus:ring-sky-700'
  },
  obsidian: {
    key: 'obsidian',
    name: 'Obsidian & Gold',
    categoryHint: 'Tattoo Studio & Dark Luxury',
    primaryHex: '#18181b',
    secondaryHex: '#f59e0b',
    badgeBg: 'bg-amber-400/20',
    badgeText: 'text-amber-300',
    buttonBg: 'bg-amber-400',
    buttonHoverBg: 'hover:bg-amber-300',
    buttonText: 'text-zinc-950',
    textAccent: 'text-amber-400',
    borderAccent: 'border-amber-400/40',
    lightBg: 'bg-zinc-900',
    ringColor: 'focus:ring-amber-400'
  }
};

export const DEFAULT_CATEGORY_ACCENTS: Record<BusinessTypeId, AccentPaletteKey> = {
  hair_salon: 'slate',
  barber: 'mahogany',
  unisex_salon: 'slate',
  beauty_parlour: 'rose',
  nail_studio: 'purple',
  hair_spa: 'emerald',
  skincare_clinic: 'ocean',
  makeup_studio: 'crimson',
  massage_wellness: 'emerald',
  hair_coloring: 'purple',
  bridal_lounge: 'crimson',
  tattoo_studio: 'obsidian',
  lash_brow: 'purple',
  ayurvedic_spa: 'emerald'
};

/**
 * Updates the primary accent CSS variable across the document root
 * and all templates using var(--primary-accent) or var(--theme-primary).
 */
export function applyPrimaryAccentCssVar(primaryHex: string, secondaryHex?: string) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--primary-accent', primaryHex);
    document.documentElement.style.setProperty('--theme-primary', primaryHex);
    document.documentElement.style.setProperty('--color-primary', primaryHex);
    if (secondaryHex) {
      document.documentElement.style.setProperty('--theme-secondary', secondaryHex);
    }
  }
}

