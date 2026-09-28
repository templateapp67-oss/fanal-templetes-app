import React from 'react';
import type { SalonProfile } from '../types';

export function websiteLocation(profile: Partial<SalonProfile>) {
  const parts: string[] = [];
  for (const part of [profile.shopFlatNo, profile.address, profile.areaLocality, profile.city, profile.state, profile.postalCode]) {
    if (typeof part === 'string' && part.trim() && !parts.join(', ').toLowerCase().includes(part.trim().toLowerCase())) parts.push(part.trim());
  }
  const address = parts.join(', ');
  const lat = profile.latitude, lng = profile.longitude;
  const coordinates = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
  const query = coordinates ? `${lat},${lng}` : address;
  return { address, query, directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}` };
}

export function WebsiteLocationMap({ profile }: { profile: Partial<SalonProfile> }) {
  const { address, query, directions } = websiteLocation(profile);
  if (!query) return <div className="flex min-h-[300px] items-center justify-center rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">Address not yet provided. Contact the studio for directions.</div>;
  return <div className="overflow-hidden rounded-xl">
    <iframe title={`Map: ${profile.businessName || 'Salon'}`} src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`} className="h-[360px] w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 text-xs text-slate-700"><span>{address}</span><a href={directions} target="_blank" rel="noopener noreferrer" className="font-bold underline">Get Directions</a></div>
  </div>;
}
