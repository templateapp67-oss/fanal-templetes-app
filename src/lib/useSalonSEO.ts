import { useEffect } from 'react';
import type { SalonProfile } from '../types';
import { applyGoogleFonts } from '../utils/fontHelper';

/**
 * Custom hook to dynamically generate and update canonical URLs, structured data (JSON-LD),
 * and SEO meta-tags (title, description, og:image, twitter:image) for the salon.
 */
export function useSalonSEO(profile: SalonProfile | undefined, isActive: boolean = true) {
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return;

    // Apply custom typography fonts dynamically
    applyGoogleFonts(profile?.headingFont, profile?.bodyFont);

    // Default values if profile is not fully loaded/defined
    const businessName = profile?.businessName?.trim() || 'Nexora';
    const tagline = profile?.tagline?.trim() || 'Salon Website Builder & Platform';
    const about = profile?.about?.trim() || 'AI-powered salon website builder and all-in-one management platform for beauty businesses.';
    const city = profile?.city?.trim() || '';
    const address = profile?.address?.trim() || '';
    const postalCode = profile?.postalCode?.trim() || '';
    const phone = profile?.phone?.trim() || (profile as any)?.phone_number?.trim() || '';

    // Title mapping: e.g. "Bella Hair Salon – Luxury Styling in New Delhi"
    const titleText = profile?.businessName 
      ? `${businessName} – ${tagline || 'Professional Salon Services'}`
      : 'Nexora - Salon Website Builder & Platform';

    // Description mapping (keep within search engine optimization length guidelines 120-160 characters)
    let descText = about;
    if (profile?.businessName) {
      descText = about.length > 5 
        ? about 
        : `Book appointments, view services and check stylist availability at ${businessName}${city ? ` in ${city}` : ''}.`;
    }
    if (descText.length > 160) {
      descText = descText.substring(0, 157) + '...';
    }

    // Dynamic URL Resolution (client-side origin + path)
    const canonicalUrl = window.location.origin + window.location.pathname;

    // Social image mapping
    const ogImage = profile?.socialShareImageUrl || profile?.coverImageUrl || profile?.ownerPhotoUrl || `${window.location.origin}/src/assets/images/main_salon_hero_1788433653488.jpg`;

    // 1. Update Page Title
    document.title = titleText;

    // Helper functions for meta elements
    const setMetaTag = (nameOrProperty: string, value: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${nameOrProperty}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, nameOrProperty);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };

    // 2. Set Standard Meta tags
    setMetaTag('description', descText);

    // Set keywords meta tag if specified or use salon-relevant fallback
    const keywordsVal = profile?.seoKeywords?.trim() || [
      'Nexora SalonOS',
      'Nexora',
      'salon management system',
      'white label salon software',
      'salon website builder',
      'online salon booking app',
      'beauty parlor management system',
      'barber shop software',
      'hair studio booking app',
      'spa booking software',
      'ayurvedic wellness center website',
      'luxury hair salon management',
      'salon billing software',
      'salon appointment scheduling',
      'automated whatsapp booking notifications',
      'salon loyalty program software',
      'best salon software in india',
      'salon booking app india',
      'salon billing and inventory software',
      'unisex salon management software',
      'beauty parlor billing software',
      'top salon website template'
    ].join(', ');
    setMetaTag('keywords', keywordsVal);

    // 3. Set OpenGraph tags
    setMetaTag('og:title', titleText, true);
    setMetaTag('og:description', descText, true);
    setMetaTag('og:image', ogImage, true);
    setMetaTag('og:url', canonicalUrl, true);
    setMetaTag('og:type', 'website', true);
    setMetaTag('og:site_name', businessName, true);

    // 4. Set Twitter Card tags
    setMetaTag('twitter:card', 'summary_large_image');
    setMetaTag('twitter:title', titleText);
    setMetaTag('twitter:description', descText);
    setMetaTag('twitter:image', ogImage);

    // 5. Update Canonical Link
    let canonicalEl = document.querySelector('link[rel="canonical"]');
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonicalUrl);

    // 6. Schema.org JSON-LD Structured Data
    if (profile?.businessName) {
      const schema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'BeautySalon',
        'name': businessName,
        'description': descText,
        'url': canonicalUrl,
        'image': ogImage,
      };

      if (phone) {
        schema.telephone = phone;
      }

      if (address || city || postalCode) {
        schema.address = {
          '@type': 'PostalAddress',
          'streetAddress': address || undefined,
          'addressLocality': city || undefined,
          'postalCode': postalCode || undefined,
          'addressCountry': 'IN',
        };
      }

      let jsonLdEl = document.getElementById('salon-json-ld');
      if (!jsonLdEl) {
        jsonLdEl = document.createElement('script');
        jsonLdEl.id = 'salon-json-ld';
        jsonLdEl.setAttribute('type', 'application/ld+json');
        document.head.appendChild(jsonLdEl);
      }
      jsonLdEl.textContent = JSON.stringify(schema, null, 2);
    } else {
      // Remove any leftover JSON-LD on other pages
      const jsonLdEl = document.getElementById('salon-json-ld');
      if (jsonLdEl) {
        jsonLdEl.remove();
      }
    }
  }, [profile, isActive]);
}
