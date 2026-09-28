import { addMissingStarterServices } from '../data/categoryStarterServices';
import React, { useState } from 'react';
import { TestimonialModal } from './ClientTestimonials';
import type { Testimonial } from '../data/templates';
import type { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { getTemplateById } from '../data/templates';
import { ContentImageField } from './ContentImageField';
import { YouTubeVideoEditor } from './YouTubeVideoEditor';

export function WebsiteContentEditor({ profile, setProfile, services, setServices, templateId }: {
  profile: SalonProfile; setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services?: SalonService[]; setServices?: React.Dispatch<React.SetStateAction<SalonService[]>>; templateId?: BusinessTypeId;
}) {
  const template = getTemplateById(templateId || profile.businessType);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<Testimonial | null>(null);
  const updateGallery = (update: (photos: NonNullable<SalonProfile['gallery']>) => NonNullable<SalonProfile['gallery']>) => setProfile(p => ({ ...p, gallery: update(p.gallery ?? template?.defaultData.gallery ?? []) }));
  const upd = (patch: Partial<SalonProfile>) => setProfile(p => ({ ...p, ...patch }));
  const field = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
  return <div className="space-y-5 text-slate-900">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <h2 className="font-bold">Website content & template starter kit</h2>
      <p className="text-xs text-slate-500">All content here appears on your website preview and is included when you save. Demo content is editable; replace sample details before publishing.</p>
      {template && <button type="button" className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-bold text-white" onClick={() => {
        // Explicit import only: never overwrite an owner's identity or edited menu.
        setServices?.(current => addMissingStarterServices(current, template.id));
        setProfile(p => ({ ...p,
          socialVideos: p.socialVideos ?? template.defaultData.videos.map(v => ({ ...v })),
          gallery: p.gallery ?? template.defaultData.gallery.map(photo => ({ ...photo })),
          ownerRole: p.ownerRole || template.config.ownerRole,
        }));
      }}>Add missing starter content{!services?.length ? ' + 5 template services' : ''}</button>}
      <p className="text-xs text-slate-500">Existing edits and intentionally emptied video or gallery lists are kept.</p>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Owner / Founder profile</h3>
      <p className="text-xs text-slate-500">Public professional details only. Personal account details such as date of birth are never shown here.</p>
      <ContentImageField label="Owner portrait" value={profile.ownerPhotoUrl} onChange={ownerPhotoUrl => upd({ ownerPhotoUrl })} />
      <div className="grid gap-3 sm:grid-cols-2">{([
        ['Owner name', 'ownerName'], ['Role / title', 'ownerRole'], ['Experience', 'ownerExperience'], ['Qualifications & specialties', 'ownerQualifications'],
      ] as const).map(([label, key]) => <label key={key} className="text-xs font-bold">{label}<input className={field} value={profile[key] || ''} onChange={e => upd({ [key]: e.target.value })} /></label>)}</div>
      <label className="block text-xs font-bold">Professional biography<textarea rows={3} className={field} value={profile.ownerBio || ''} onChange={e => upd({ ownerBio: e.target.value })} /></label>
    </section>
    <YouTubeVideoEditor profile={profile} setProfile={setProfile} templateId={templateId} />
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Studio Lookbook / Gallery</h3>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-xs font-bold text-blue-700" onClick={() => updateGallery(photos => photos.length < 100 ? [...photos, { id: `gallery-${crypto.randomUUID()}`, title: 'New showcase', url: '', tag: 'Studio' }] : photos)}>+ Add gallery image</button>
        {!profile.gallery?.length && <button type="button" className="text-xs text-rose-700" onClick={() => upd({ gallery: template?.defaultData.gallery.map(p => ({ ...p })) || [] })}>Use template gallery</button>}
      </div>
      {(profile.gallery ?? template?.defaultData.gallery ?? []).map(photo => <details key={photo.id} className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-bold">{photo.title || 'Untitled image'}</summary>
        <div className="mt-3 space-y-3">
          <ContentImageField label="Gallery image" value={photo.url} onChange={url => updateGallery(photos => photos.map(p => p.id === photo.id ? { ...p, url } : p))} />
          {(['title', 'tag'] as const).map(key => <label key={key} className="block text-xs capitalize">{key}<input className={field} value={photo[key]} onChange={e => updateGallery(photos => photos.map(p => p.id === photo.id ? { ...p, [key]: e.target.value } : p))} /></label>)}
          <button type="button" className="text-xs text-rose-700" onClick={() => updateGallery(photos => photos.filter(p => p.id !== photo.id))}>Delete gallery image</button>
        </div>
      </details>)}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Client testimonials</h3>
      <p className="text-xs text-slate-500">Replace sample testimonials with genuine client feedback before publishing.</p>
      <button type="button" className="text-xs font-bold text-blue-700" onClick={() => { setEditingReview(null); setReviewOpen(true); }}>+ Add testimonial</button>
      {(profile.testimonials ?? template?.defaultData.testimonials ?? []).map(review => <div key={review.id} className="rounded-lg border p-3 text-sm">
        <strong>{review.name}</strong><p>{review.comment}</p><div className="mt-2 flex gap-4">
          <button type="button" aria-label={`Edit testimonial by ${review.name}`} className="text-xs text-blue-700" onClick={() => { setEditingReview(review); setReviewOpen(true); }}>Edit</button>
          <button type="button" aria-label={`Delete testimonial by ${review.name}`} className="text-xs text-rose-700" onClick={() => setProfile(p => ({ ...p, testimonials: (p.testimonials ?? template?.defaultData.testimonials ?? []).filter(r => r.id !== review.id) }))}>Delete</button>
        </div>
      </div>)}
      <TestimonialModal isOpen={reviewOpen} onClose={() => setReviewOpen(false)} editingTestimonial={editingReview} defaultCity={profile.city} availableServices={services?.map(s => s.name)} onSave={review => {
        setProfile(p => { const reviews = p.testimonials ?? template?.defaultData.testimonials ?? []; return { ...p, testimonials: editingReview ? reviews.map(r => r.id === review.id ? review : r) : [...reviews, review] }; });
        setReviewOpen(false);
      }} />
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Visible website sections</h3>
      <div className="grid grid-cols-2 gap-3">{(['header', 'hero', 'metrics', 'about', 'services', 'offers', 'promoPopup', 'stylists', 'testimonials', 'gallery', 'location', 'whatsappFloat'] as const).map(key => <label key={key} className="flex gap-2 text-xs"><input type="checkbox" checked={profile.sectionVisibility?.[key] !== false} onChange={e => upd({ sectionVisibility: { ...profile.sectionVisibility, [key]: e.target.checked } })} />{key.replace(/([A-Z])/g, ' $1')}</label>)}</div>
      <h3 className="font-bold">Section headings</h3>
      {['servicesTitle', 'servicesSubtitle', 'stylistsTitle', 'stylistsSubtitle', 'testimonialsTitle', 'galleryTitle', 'locationTitle'].map(key => <label key={key} className="block text-xs capitalize">{key.replace(/([A-Z])/g, ' $1')}<input className={field} placeholder="Use template heading" value={profile.sectionHeadings?.[key] || ''} onChange={e => upd({ sectionHeadings: { ...profile.sectionHeadings, [key]: e.target.value } })} /></label>)}
    </section>
  </div>;
}
