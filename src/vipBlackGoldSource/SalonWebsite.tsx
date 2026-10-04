import React from 'react';
import { ArrowRight, Clock, Crown, MapPin, Sparkles, Star } from 'lucide-react';
import type { SalonProfile, SalonService } from '../types';
import { InlineEditable } from '../components/InlineEditable';
import { getLuminance } from '../themeAccents';
import vipStudioImage from './assets/images/luxury_spa_service_1780900684934.png';
import './salonWebsite.css';

/** Customer-facing source design connected to the common editor, without showcase/admin demos. */
export function VipSalonWebsite({ profile, services, onBook, onViewSalon, editing = false, onChange }: {
  profile: SalonProfile;
  services: SalonService[];
  onBook: (service?: SalonService) => void;
  onViewSalon: () => void;
  editing?: boolean;
  onChange?: (changes: Partial<SalonProfile>) => void;
}) {
  const accent = profile.primaryColor || profile.customAccentColor || profile.secondaryColor || '#D4AF37';
  const prices = services.map(service => service.price).filter(price => Number.isFinite(price) && price >= 0);
  const price = prices.length ? Math.min(...prices) : null;
  return <section id="home-section" data-vip-source-website className="vip-source-website @container/vip-source" style={{ '--vip-gold': accent, '--vip-on-gold': getLuminance(accent) > 0.179 ? '#09090b' : '#fff' } as React.CSSProperties}>
    <div id="book" className="scroll-mt-20" />
    <div className="vip-source-glow" aria-hidden="true" />
    <div className="vip-source-grid">
      <div className="vip-source-copy">
        <p className="vip-source-eyebrow"><Crown size={17} />{profile.vipExperience?.conciergeLabel || 'Black & Gold Signature'}</p>
        <h1><InlineEditable value={profile.businessName || 'Your Signature Studio'} onSave={value => onChange?.({ businessName: String(value) })} isEditingActive={editing} label="Salon name" /></h1>
        <p className="vip-source-tagline"><InlineEditable value={profile.tagline || 'A personal experience. An exceptional result.'} onSave={value => onChange?.({ tagline: String(value) })} isEditingActive={editing} label="Tagline" /></p>
        {profile.about ? <p className="vip-source-description">{profile.about}</p> : null}
        <div className="vip-source-actions">
          <button type="button" onClick={() => onBook()} className="vip-source-primary">Book appointment <ArrowRight size={16} /></button>
          <button type="button" onClick={onViewSalon} className="vip-source-secondary">View salon</button>
        </div>
        <div className="vip-source-details">
          <div><Star size={17} /><span>{profile.publicRating?.count ? `${profile.publicRating.average.toFixed(1)} (${profile.publicRating.count} reviews)` : 'No reviews yet'}</span></div>
          <div><Sparkles size={17} /><span>{services.length} {services.length === 1 ? 'signature service' : 'signature services'}</span></div>
          <div><Clock size={17} /><span>{price !== null ? `Services from ₹${price.toLocaleString('en-IN')}` : 'Services coming soon'}</span></div>
          {[profile.areaLocality, profile.city].some(Boolean) ? <div><MapPin size={17} /><span>{[profile.areaLocality, profile.city].filter(Boolean).join(', ')}</span></div> : null}
        </div>
      </div>
      <div className="vip-source-frame">
        <div className="vip-source-photo">
          <img src={profile.coverImageUrl || vipStudioImage} alt={profile.businessName || 'Signature studio'} onError={event => { if (event.currentTarget.getAttribute('src') !== vipStudioImage) event.currentTarget.src = vipStudioImage; }} />
          <div className="vip-source-vignette" aria-hidden="true" />
          <span className="vip-source-photo-label"><Crown size={14} />Private care. Signature style.</span>
          <div className="vip-source-photo-caption"><p>{profile.businessName || 'Your Signature Studio'}</p><span>{profile.tagline || 'Designed around you'}</span></div>
        </div>
      </div>
    </div>
  </section>;
}
