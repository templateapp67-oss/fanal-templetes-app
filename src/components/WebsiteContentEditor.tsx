import React, { useMemo, useState } from 'react';
import { TestimonialModal } from './ClientTestimonials';
import type { Testimonial } from '../data/templates';
import type { SalonProfile, SalonService, BusinessTypeId } from '../types';
import { getTemplateById } from '../data/templates';
import { addMissingStarterServices } from '../data/categoryStarterServices';
import { ContentImageField } from './ContentImageField';
import { YouTubeVideoEditor } from './YouTubeVideoEditor';
import { AIBioModal } from './AIBioModal';
import { DEFAULT_GALLERY_IMAGE_URL, WEBSITE_LIMITS } from '../lib/websiteValidation';
import { CharCounter, FieldError, ItemIssues, useFieldIssueProps, useIssuesUnder, useOpenWhenInvalid } from './WebsiteIssues';

const OWNER_ROLE_SUGGESTIONS = [
  'Founder & Creative Director',
  'Salon Owner & Master Stylist',
  'Senior Hair Stylist',
  'Beauty & Skin Specialist',
  'Bridal Makeup Artist',
  'Spa & Wellness Therapist',
  'Barber & Grooming Expert',
  'Nail & Lash Artist',
];

function profileHints(businessType: string) {
  const label = businessType.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  return {
    role: businessType.includes('barber') ? 'Barber & Grooming Expert' : businessType.includes('spa') || businessType.includes('massage') ? 'Spa & Wellness Therapist' : businessType.includes('nail') || businessType.includes('lash') ? 'Nail & Lash Artist' : businessType.includes('bridal') || businessType.includes('makeup') ? 'Bridal Makeup Artist' : 'Founder & Creative Director',
    experience: '7+ years of professional experience',
    qualifications: `${label} specialist · Personal consultation · Premium client care`,
  };
}

type GalleryPhoto = NonNullable<SalonProfile['gallery']>[number];

/** One gallery row. Opens itself when the save found a problem inside it. */
const GalleryRow: React.FC<{
  photo: GalleryPhoto; index: number; field: string;
  updateGallery: (update: (photos: NonNullable<SalonProfile['gallery']>) => NonNullable<SalonProfile['gallery']>) => void;
}> = ({ photo, index, field, updateGallery }) => {
  const path = `profile.gallery[${index}]`;
  const hasIssue = useIssuesUnder(path).length > 0;
  const detailsRef = useOpenWhenInvalid(hasIssue);
  return <details ref={detailsRef} data-field-path={path} className={`rounded-xl border p-3 ${hasIssue ? 'border-red-400 bg-red-50/40' : 'border-slate-200'}`}>
    <summary className="cursor-pointer text-sm font-bold">{photo.title || 'Untitled image'}{hasIssue && <span className="ml-2 text-xs font-semibold text-red-700">Needs attention</span>}</summary>
    <div className="mt-3 space-y-3">
      <ContentImageField label="Gallery image" value={photo.url} fieldPath={`${path}.url`} placeholderUrl={DEFAULT_GALLERY_IMAGE_URL}
        emptyHint="No photo yet. A default image is shown on your website until you add one."
        onChange={url => updateGallery(photos => photos.map(p => p.id === photo.id ? { ...p, url } : p))} />
      {(['title', 'tag'] as const).map(key => <label key={key} className="block text-xs capitalize">{key}<input className={field} value={photo[key]} onChange={e => updateGallery(photos => photos.map(p => p.id === photo.id ? { ...p, [key]: e.target.value } : p))} /></label>)}
      <button type="button" className="text-xs text-rose-700" onClick={() => updateGallery(photos => photos.filter(p => p.id !== photo.id))}>Delete gallery image</button>
    </div>
  </details>;
};

export function WebsiteContentEditor({ profile, setProfile, services, setServices, templateId }: {
  profile: SalonProfile; setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  services?: SalonService[]; setServices?: React.Dispatch<React.SetStateAction<SalonService[]>>; templateId?: BusinessTypeId;
}) {
  const starterTemplateId = templateId || profile.businessType;
  const template = getTemplateById(starterTemplateId);
  const starterServiceCount = useMemo(
    () => addMissingStarterServices(undefined, starterTemplateId).length,
    [starterTemplateId]
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<Testimonial | null>(null);
  const [bioGeneratorOpen, setBioGeneratorOpen] = useState(false);
  const updateGallery = (update: (photos: NonNullable<SalonProfile['gallery']>) => NonNullable<SalonProfile['gallery']>) => setProfile(p => ({ ...p, gallery: update(p.gallery ?? template?.defaultData.gallery ?? []) }));
  const upd = (patch: Partial<SalonProfile>) => setProfile(p => ({ ...p, ...patch }));
  const field = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
  const hints = profileHints(profile.businessType);
  const bioField = useFieldIssueProps('profile.ownerBio');
  return <div className="space-y-5 text-slate-900">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Starter website content</h3>
      <p className="text-xs text-slate-500">Add template services to an empty menu. Existing services, owner details and media are never changed.</p>
      <button type="button" disabled={!setServices || starterServiceCount === 0}
        onClick={() => setServices?.(current => addMissingStarterServices(current, starterTemplateId))}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
        Add missing starter content ({starterServiceCount} template services)
      </button>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Owner / Founder profile</h3>
      <p className="text-xs text-slate-500">Public professional details only. Personal account details such as date of birth are never shown here.</p>
      <ContentImageField label="Owner portrait" value={profile.ownerPhotoUrl} fieldPath="profile.ownerPhotoUrl" onChange={ownerPhotoUrl => upd({ ownerPhotoUrl })} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-600">Quick setup: suggested details are based on your selected salon template.</p>
        <button type="button" onClick={() => upd({ ownerRole: profile.ownerRole || hints.role, ownerExperience: profile.ownerExperience || hints.experience, ownerQualifications: profile.ownerQualifications || hints.qualifications })} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Use suggested details</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold">Owner name<input className={field} value={profile.ownerName || ''} onChange={e => upd({ ownerName: e.target.value })} /></label>
        <label className="text-xs font-bold">Role / title<input list="owner-role-options" className={field} placeholder={hints.role} value={profile.ownerRole || ''} onChange={e => upd({ ownerRole: e.target.value })} /><datalist id="owner-role-options">{OWNER_ROLE_SUGGESTIONS.map(role => <option key={role} value={role} />)}</datalist></label>
        <label className="text-xs font-bold">Experience<input className={field} placeholder={hints.experience} value={profile.ownerExperience || ''} onChange={e => upd({ ownerExperience: e.target.value })} /></label>
        <label className="text-xs font-bold">Qualifications & specialties<input className={field} placeholder={hints.qualifications} value={profile.ownerQualifications || ''} onChange={e => upd({ ownerQualifications: e.target.value })} /></label>
      </div>
      <label className="block text-xs font-bold">Professional biography<textarea rows={4} {...bioField.attrs} className={bioField.className(field)} placeholder="Use AI to write a ready professional biography based on your salon." value={profile.ownerBio || ''} onChange={e => upd({ ownerBio: e.target.value })} /></label>
      <FieldError path="profile.ownerBio" />
      <CharCounter value={profile.ownerBio} limit={WEBSITE_LIMITS.ownerBio} />
      <button type="button" onClick={() => setBioGeneratorOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white">✨ Generate professional biography with AI</button>
    </section>
    <YouTubeVideoEditor profile={profile} setProfile={setProfile} templateId={templateId} />
    <section data-field-path="profile.gallery" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Studio Lookbook / Gallery</h3>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-xs font-bold text-blue-700" onClick={() => updateGallery(photos => photos.length < 100 ? [...photos, { id: `gallery-${crypto.randomUUID()}`, title: 'New showcase', url: '', tag: 'Studio' }] : photos)}>+ Add gallery image</button>
        {!profile.gallery?.length && <button type="button" className="text-xs text-rose-700" onClick={() => upd({ gallery: template?.defaultData.gallery.map(p => ({ ...p })) || [] })}>Use template gallery</button>}
      </div>
      {(profile.gallery ?? template?.defaultData.gallery ?? []).map((photo, index) => <GalleryRow key={photo.id} photo={photo} index={index} field={field} updateGallery={updateGallery} />)}
    </section>
    <section data-field-path="profile.testimonials" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
      <h3 className="font-bold">Client testimonials</h3>
      <p className="text-xs text-slate-500">Replace sample testimonials with genuine client feedback before publishing.</p>
      <button type="button" className="text-xs font-bold text-blue-700" onClick={() => { setEditingReview(null); setReviewOpen(true); }}>+ Add testimonial</button>
      {(profile.testimonials ?? template?.defaultData.testimonials ?? []).map((review, index) => <div key={review.id} data-field-path={`profile.testimonials[${index}]`} className="rounded-lg border p-3 text-sm">
        <strong>{review.name}</strong><p>{review.comment}</p><ItemIssues prefix={`profile.testimonials[${index}]`} /><div className="mt-2 flex gap-4">
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
    <AIBioModal
      isOpen={bioGeneratorOpen}
      onClose={() => setBioGeneratorOpen(false)}
      businessName={profile.businessName}
      businessType={profile.businessType}
      ownerName={profile.ownerName}
      templateId={templateId || profile.businessType}
      templateVibe={template?.config.themePreset}
      city={profile.city}
      onApply={(bio, tagline) => {
        upd({ ownerBio: bio, tagline: profile.tagline || tagline });
        setBioGeneratorOpen(false);
      }}
    />
  </div>;
}
