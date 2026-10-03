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
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const query = coordinates ? `${lat},${lng}` : address;
  const mapUrl = coordinates ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
  const embedUrl = coordinates ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng!-0.01}%2C${lat!-0.01}%2C${lng!+0.01}%2C${lat!+0.01}&layer=mapnik&marker=${lat}%2C${lng}` : null;
  return { address, query, mapUrl, embedUrl, directions: mapUrl };
}

export function WebsiteLocationMap({ profile }: { profile: Partial<SalonProfile> }) {
  const { address, query, directions, embedUrl } = websiteLocation(profile);
  if (!query) return <div className="flex min-h-[300px] items-center justify-center rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">Address not yet provided. Contact the studio for directions.</div>;
  return <div className="overflow-hidden rounded-xl">
    {embedUrl ? <iframe title={`Map: ${profile.businessName || 'Salon'}`} src={embedUrl} className="h-[360px] w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /> : <div className="min-h-[200px] grid place-items-center bg-slate-50 p-6 text-center"><a href={directions} target="_blank" rel="noopener noreferrer" className="underline">Find this salon on OpenStreetMap</a></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 text-xs text-slate-700"><span>{address}</span><a href={directions} target="_blank" rel="noopener noreferrer" className="font-bold underline">Get Directions</a></div>
  </div>;
}
