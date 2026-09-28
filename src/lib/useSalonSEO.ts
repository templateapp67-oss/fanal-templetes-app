import { socialMetadata } from './socialMetadata';
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

    // Share the same title, description and tenant URL with server HTML and
    // the live preview, so hydration cannot replace correct crawler metadata.
    const metadata = socialMetadata(profile || {}, window.location.href);
    const titleText = metadata.title;
    const descText = metadata.description;
    const canonicalUrl = metadata.url;

    // Social image mapping
    const ogImage = metadata.image;

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

    setMetaTag('keywords', metadata.keywords);

    // 3. Set OpenGraph tags
    setMetaTag('og:title', titleText, true);
    setMetaTag('og:description', descText, true);
    setMetaTag('og:image', ogImage, true);
    if (metadata.sizedImage) {
      setMetaTag('og:image:width', '1200', true);
      setMetaTag('og:image:height', '630', true);
    } else {
      document.querySelector('meta[property="og:image:width"]')?.remove();
      document.querySelector('meta[property="og:image:height"]')?.remove();
    }
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
