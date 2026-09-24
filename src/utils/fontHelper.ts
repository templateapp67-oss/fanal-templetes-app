/**
 * Curated, high-fidelity Google Fonts for premium salon branding and SaaS typography
 */
export interface GoogleFont {
  name: string;
  family: string;
  category: 'Serif' | 'Sans-Serif' | 'Display' | 'Script';
  description: string;
}

export const CURATED_GOOGLE_FONTS: GoogleFont[] = [
  // Elegant Serifs
  { name: 'Playfair Display', family: 'Playfair Display', category: 'Serif', description: 'Luxurious, editorial headings' },
  { name: 'Lora', family: 'Lora', category: 'Serif', description: 'Contemporary, warm, and highly readable' },
  { name: 'Cormorant Garamond', family: 'Cormorant Garamond', category: 'Serif', description: 'Sophisticated traditional classic serif' },
  { name: 'Cinzel', family: 'Cinzel', category: 'Serif', description: 'Cinematic, classical Roman proportions' },
  { name: 'Merriweather', family: 'Merriweather', category: 'Serif', description: 'Rich, reader-friendly, and editorial' },

  // Clean Modern Sans-Serifs
  { name: 'Inter', family: 'Inter', category: 'Sans-Serif', description: 'Clean, Swiss, premium UI body text' },
  { name: 'Montserrat', family: 'Montserrat', category: 'Sans-Serif', description: 'Urban, geometric, confident headings' },
  { name: 'Poppins', family: 'Poppins', category: 'Sans-Serif', description: 'Polished, friendly, modern geometric' },
  { name: 'Lato', family: 'Lato', category: 'Sans-Serif', description: 'Warm, corporate, approachable modern sans' },
  { name: 'DM Sans', family: 'DM Sans', category: 'Sans-Serif', description: 'Clean, minimalist, high-end tech/beauty' },
  { name: 'Quicksand', family: 'Quicksand', category: 'Sans-Serif', description: 'Rounded, gentle, friendly aesthetic' },

  // Distinctive Display
  { name: 'Oswald', family: 'Oswald', category: 'Display', description: 'Bold, condensed, high-impact branding' },
  { name: 'Syne', family: 'Syne', category: 'Display', description: 'Avant-garde, creative, expressive styling' },
  { name: 'Fraunces', family: 'Fraunces', category: 'Display', description: 'Vibrant, chunky, retro-chic branding' },

  // Elegant Scripts / Accent
  { name: 'Dancing Script', family: 'Dancing Script', category: 'Script', description: 'Fluid, casual creative handwriting' },
  { name: 'Sacramento', family: 'Sacramento', category: 'Script', description: 'Commanding, exquisite monoline handwriting' },
  { name: 'Great Vibes', family: 'Great Vibes', category: 'Script', description: 'Elegant, high-end luxury calligraphy' }
];

/**
 * Dynamically injects Google Fonts link and configures CSS variables
 * to apply chosen fonts to headings and body text throughout the document.
 */
export function applyGoogleFonts(headingFont?: string, bodyFont?: string) {
  if (typeof window === 'undefined') return;

  const families: string[] = [];
  if (headingFont) {
    families.push(`family=${headingFont.replace(/ /g, '+')}:wght@400;500;600;700;800`);
  }
  if (bodyFont) {
    families.push(`family=${bodyFont.replace(/ /g, '+')}:wght@300;400;500;600;700`);
  }

  const id = 'google-fonts-custom-injector';
  let linkEl = document.getElementById(id) as HTMLLinkElement;

  if (families.length > 0) {
    const href = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.id = id;
      linkEl.rel = 'stylesheet';
      document.head.appendChild(linkEl);
    }
    if (linkEl.href !== href) {
      linkEl.href = href;
    }
  } else {
    // If no fonts specified, remove custom link to clean up DOM
    if (linkEl) {
      linkEl.remove();
    }
  }

  // Update dynamic CSS variables mapping directly on the html document root element
  const root = document.documentElement;
  
  if (headingFont) {
    root.style.setProperty('--font-display', `"${headingFont}", sans-serif`);
    root.style.setProperty('--font-display-lg-mobile', `"${headingFont}", sans-serif`);
    root.style.setProperty('--font-headline-lg', `"${headingFont}", sans-serif`);
    root.style.setProperty('--font-headline-md', `"${headingFont}", sans-serif`);
  } else {
    root.style.removeProperty('--font-display');
    root.style.removeProperty('--font-display-lg-mobile');
    root.style.removeProperty('--font-headline-lg');
    root.style.removeProperty('--font-headline-md');
  }

  if (bodyFont) {
    root.style.setProperty('--font-body', `"${bodyFont}", sans-serif`);
    root.style.setProperty('--font-body-sm', `"${bodyFont}", sans-serif`);
    root.style.setProperty('--font-body-md', `"${bodyFont}", sans-serif`);
    root.style.setProperty('--font-body-lg', `"${bodyFont}", sans-serif`);
  } else {
    root.style.removeProperty('--font-body');
    root.style.removeProperty('--font-body-sm');
    root.style.removeProperty('--font-body-md');
    root.style.removeProperty('--font-body-lg');
  }
}
