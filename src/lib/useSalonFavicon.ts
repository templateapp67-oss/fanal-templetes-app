import { useEffect } from 'react';
import { getContrastTextColor } from '../themeAccents';
import type { SalonProfile } from '../types';

/**
 * Generates PNG favicon assets using Canvas based on a background color and single letter.
 */
export function generateFaviconDataUrls(color: string, letter: string): { fav16: string; fav32: string; apple180: string } {
  const sizes = {
    fav16: 16,
    fav32: 32,
    apple180: 180,
  };

  const results = {
    fav16: '',
    fav32: '',
    apple180: '',
  };

  if (typeof document === 'undefined') return results;

  const contrastColor = getContrastTextColor(color);
  const cleanLetter = (letter || 'N').trim().substring(0, 1).toUpperCase();

  for (const [key, size] of Object.entries(sizes)) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Draw background (rounded rectangle)
    const radius = size * 0.22; // 22% of size is standard for high-fidelity app icons
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();

    // Draw initial letter
    ctx.fillStyle = contrastColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Choose font size based on dimensions
    const fontSize = Math.floor(size * 0.6);
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    
    // Slight offset to center the letter visually (letters are taller/displaced in standard baselines)
    ctx.fillText(cleanLetter, size / 2, size / 2 + (size * 0.04));

    results[key as keyof typeof results] = canvas.toDataURL('image/png');
  }

  return results;
}

/**
 * Injects favicon link elements into the HTML document <head>.
 */
export function injectFaviconLinks(fav16: string, fav32: string, apple180: string) {
  if (typeof document === 'undefined') return;

  const setFaviconEl = (rel: string, size: string | null, href: string) => {
    const selector = size 
      ? `link[rel="${rel}"][sizes="${size}"]` 
      : `link[rel="${rel}"]:not([sizes])`;
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      if (size) el.setAttribute('sizes', size);
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  };

  if (fav16) setFaviconEl('icon', '16x16', fav16);
  if (fav32) setFaviconEl('icon', '32x32', fav32);
  if (apple180) setFaviconEl('apple-touch-icon', null, apple180);
}

/**
 * Custom React hook to automatically generate and apply the brand-colored favicon for each salon.
 */
export function useSalonFavicon(profile: SalonProfile | undefined, activeColorHex: string, isActive: boolean = true) {
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return;

    if (profile?.customFaviconUrl) {
      injectFaviconLinks(profile.customFaviconUrl, profile.customFaviconUrl, profile.customFaviconUrl);
      return;
    }

    const brandColor = profile?.faviconColor || activeColorHex || '#0f172a';
    const firstLetter = profile?.faviconLetter || profile?.businessName?.trim().substring(0, 1) || 'N';

    const favicons = generateFaviconDataUrls(brandColor, firstLetter);
    injectFaviconLinks(favicons.fav16, favicons.fav32, favicons.apple180);
  }, [profile?.businessName, profile?.faviconLetter, profile?.faviconColor, profile?.customFaviconUrl, activeColorHex, isActive]);
}
