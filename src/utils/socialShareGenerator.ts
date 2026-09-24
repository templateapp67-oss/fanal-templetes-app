import { SalonProfile } from '../types';
import { getContrastTextColor } from '../themeAccents';

/**
 * Generates a high-fidelity, premium salon-branded Social Share Image (1200x630px)
 * using HTML5 Canvas.
 */
export function generateSocialSharePlaceholder(profile: SalonProfile): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const brandColor = profile.faviconColor || profile.customAccentColor || '#C20E5A';
  const contrastColor = getContrastTextColor(brandColor);
  const isDarkBg = contrastColor === '#ffffff';

  // 1. Draw Background (Sophisticated Gradient Mesh)
  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  if (isDarkBg) {
    // Elegant deep color blend from brandColor to dark charcoal
    grad.addColorStop(0, brandColor);
    grad.addColorStop(0.5, mixColors(brandColor, '#0f172a', 0.6));
    grad.addColorStop(1, '#0b0f19');
  } else {
    // Elegant light cream / pastel blend from brandColor to pure warm white
    grad.addColorStop(0, brandColor);
    grad.addColorStop(0.4, mixColors(brandColor, '#fcf8f2', 0.7));
    grad.addColorStop(1, '#fafaf9');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  // 2. Decorative Premium Line Accents / Luxury Borders
  ctx.strokeStyle = isDarkBg ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
  ctx.lineWidth = 1;
  // Draw subtle elegant orbital circle on the right
  ctx.beginPath();
  ctx.arc(950, 315, 280, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(950, 315, 200, 0, Math.PI * 2);
  ctx.stroke();

  // Draw refined framing lines
  ctx.strokeStyle = isDarkBg ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, 1120, 550);

  // 3. Top-Left Salon Logo Icon (Favicon-style)
  const iconSize = 80;
  const iconX = 90;
  const iconY = 100;
  const radius = 24;

  // Draw icon background
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)';
  ctx.beginPath();
  ctx.moveTo(iconX + radius, iconY);
  ctx.lineTo(iconX + iconSize - radius, iconY);
  ctx.quadraticCurveTo(iconX + iconSize, iconY, iconX + iconSize, iconY + radius);
  ctx.lineTo(iconX + iconSize, iconY + iconSize - radius);
  ctx.quadraticCurveTo(iconX + iconSize, iconY + iconSize, iconX + iconSize - radius, iconY + iconSize);
  ctx.lineTo(iconX + radius, iconY + iconSize);
  ctx.quadraticCurveTo(iconX, iconY + iconSize, iconX, iconY + iconSize - radius);
  ctx.lineTo(iconX, iconY + radius);
  ctx.quadraticCurveTo(iconX, iconY, iconX + radius, iconY);
  ctx.closePath();
  ctx.fill();

  // Draw icon letter
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#1e293b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px Georgia, "Playfair Display", serif';
  const initial = (profile.faviconLetter || profile.businessName || 'N').trim().substring(0, 1).toUpperCase();
  ctx.fillText(initial, iconX + iconSize / 2, iconY + iconSize / 2 + 3);

  // 4. Draw Brand Title (Top-Left, beside logo)
  ctx.textAlign = 'left';
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#1e293b';
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('NEXORA PREMIUM PLATFORM', iconX + iconSize + 25, iconY + iconSize / 2 + 5);

  // 5. Main Content: Business Name & Tagline (Center-Left)
  const mainX = 90;
  const mainY = 270;

  // Business Name
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#0f172a';
  ctx.font = 'bold 72px Georgia, "Playfair Display", serif';
  const businessName = (profile.businessName || 'My Premium Salon').trim();
  // Truncate if too long to prevent overflow
  const maxTitleWidth = 720;
  let displayTitle = businessName;
  if (ctx.measureText(displayTitle).width > maxTitleWidth) {
    while (ctx.measureText(displayTitle + '...').width > maxTitleWidth && displayTitle.length > 0) {
      displayTitle = displayTitle.slice(0, -1);
    }
    displayTitle += '...';
  }
  ctx.fillText(displayTitle, mainX, mainY);

  // Tagline
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.75)' : '#475569';
  ctx.font = 'italic 28px Georgia, "Playfair Display", serif';
  const tagline = (profile.tagline || 'Experience Refined Luxury & Care').trim();
  ctx.fillText(tagline, mainX, mainY + 52);

  // 6. Draw "BOOK APPOINTMENT" Button / Badge (Center-Right)
  const badgeX = 860;
  const badgeY = 240;
  const badgeWidth = 240;
  const badgeHeight = 110;
  
  // Outer glowing frame
  ctx.strokeStyle = isDarkBg ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(badgeX - 10, badgeY - 10, badgeWidth + 20, badgeHeight + 20);

  // Filled badge container
  ctx.fillStyle = isDarkBg ? '#ffffff' : brandColor;
  ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);

  // Text inside badge
  ctx.fillStyle = isDarkBg ? brandColor : contrastColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
  ctx.fillText('BOOK ONLINE', badgeX + badgeWidth / 2, badgeY + 40);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Nexora Verified Business', badgeX + badgeWidth / 2, badgeY + 72);

  // 7. Footer Contact Bar
  const footerY = 510;
  ctx.strokeStyle = isDarkBg ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(90, footerY);
  ctx.lineTo(1110, footerY);
  ctx.stroke();

  // Contact labels & details
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  
  // Service Highlights (e.g. "Hair Cut · Styling · Skincare · Wellness")
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.6)' : '#64748b';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillText('EXPERTISE', 90, footerY + 30);
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#334155';
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  const categoryLabel = (profile.businessType || 'salon').toUpperCase().replace('_', ' ');
  ctx.fillText(categoryLabel || 'HAIR & BEAUTY SERVICES', 90, footerY + 54);

  // Location Details
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.6)' : '#64748b';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillText('LOCATION', 420, footerY + 30);
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#334155';
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  const location = `${profile.areaLocality || ''}${profile.areaLocality && profile.city ? ', ' : ''}${profile.city || 'India'}`;
  ctx.fillText(location, 420, footerY + 54);

  // Contact Phone / Domain
  ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.6)' : '#64748b';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillText('CONTACT', 800, footerY + 30);
  ctx.fillStyle = isDarkBg ? '#ffffff' : '#334155';
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  const phoneVal = profile.phone || (profile as any).phone_number || 'Book Online';
  ctx.fillText(phoneVal, 800, footerY + 54);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Mixes two hex colors with a weight.
 */
function mixColors(color1: string, color2: string, weight: number): string {
  const getRGB = (hex: string) => {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return { r, g, b };
  };

  const rgb1 = getRGB(color1);
  const rgb2 = getRGB(color2);

  const r = Math.round(rgb1.r * (1 - weight) + rgb2.r * weight);
  const g = Math.round(rgb1.g * (1 - weight) + rgb2.g * weight);
  const b = Math.round(rgb1.b * (1 - weight) + rgb2.b * weight);

  return `rgb(${r}, ${g}, ${b})`;
}
