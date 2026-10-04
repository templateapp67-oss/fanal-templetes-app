import './jsdomSetup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {SalonWebsitePreview} from '../../src/components/SalonWebsitePreview';
import {TEMPLATE_REGISTRY} from '../../src/data/templates';
import {INITIAL_SALON_PROFILE} from '../../src/mockData';

test('the published template matrix contains all 28 distinct designs',()=>{
 assert.equal(TEMPLATE_REGISTRY.length,28);
 assert.equal(new Set(TEMPLATE_REGISTRY.map(t=>t.id)).size,28);
});
for(const template of TEMPLATE_REGISTRY) {
 test(`${template.id}: published design wins over editor default; content, profile and booking remain usable`,async()=>{
  const savedFetch=globalThis.fetch;
  const profile={...INITIAL_SALON_PROFILE,businessName:`Published ${template.id}`,subdomain:`test-${template.id}`,businessType:'hair_salon' as const,coverImageUrl:'',isVerified:false,offers:[],testimonials:[],gallery:template.defaultData.gallery,acceptsOnlineBookings:true,headingFont:'Georgia',bodyFont:'Arial',borderRadius:'none' as const,whiteLabelEnabled:true,publicRating:{average:4.4,count:12},scentProfile:'Cedar',soundscape:'Quiet jazz',consultationStyle:'Personal consultation'};
  const services=template.defaultData.services.map(s=>({...s,name:`Saved ${s.name}`}));
  globalThis.fetch=(async()=>({ok:true,json:async()=>({found:true,salon:{profile,services,stylists:template.defaultData.staff,selectedTemplateId:template.id}})})) as any;
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);let auth=0;
  try {
   await act(async()=>root.render(<SalonWebsitePreview profile={profile} services={[]} stylists={[]} selectedTemplateId="hair_salon" publicView onAddAppointment={()=>{}} onRequireAuth={()=>auth++}/>));
   const text=container.textContent || '';
   assert.ok(container.querySelector('[data-template-customer-home]'), 'shared discovery and quick booking are present on every published template');
   assert.ok(container.querySelector('.template-customer-toolbar'), 'shared customer navigation is present on every published template');
   assert.ok(text.includes(profile.businessName));
   const brand=container.querySelector<HTMLElement>('.template-brand-scope')!;
   assert.match(brand.style.getPropertyValue('--template-heading-font'), /Georgia/);
   assert.match(brand.style.getPropertyValue('--template-body-font'), /Arial/);
   assert.equal(brand.style.getPropertyValue('--brand-radius'), '0px');
   assert.ok(container.querySelector('[data-template-composition]'));
   assert.match(text, /4.4/);
   assert.ok(!text.includes('Powered by Nexora Salon Platform'));
   assert.match(text, /Cedar/); assert.match(text, /Quiet jazz/); assert.match(text, /Personal consultation/);
   assert.ok(text.includes(services[0].name),'published menu, not demo/default menu');
   assert.doesNotMatch(text,/₹\s*Infinity|Verified Indian Salon|980\+/);
   assert.doesNotMatch(text,/Salon Address & Localization Setup|Inline Edit Mode/);
   const hero=container.querySelector<HTMLImageElement>('#home-section img')!;
   assert.ok(hero);assert.equal(hero.getAttribute('src'),template.config.coverImageUrl,'each saved design supplies its own cover');
   assert.ok([...container.querySelectorAll('button')].some(button => /View (Profile|salon)/i.test(button.textContent || '')), 'customer profile action exists inside the template');
   assert.ok(container.querySelector('#location-section'));
   assert.ok(container.querySelector('a[href*="openstreetmap.org"]'));
   assert.ok(!container.querySelector('a[href*="google.com/maps"],iframe[src*="google.com/maps"]'));
   const booking=[...container.querySelectorAll('button')].find(b=>/^(Book Appointment|Request VIP Concierge)$/i.test(b.textContent?.trim() || ''));
   assert.ok(booking);act(()=>booking.click());assert.equal(auth,1,'booking enters customer authentication');
   act(()=>hero.dispatchEvent(new window.Event('error')));
   const fallback=hero.getAttribute('src');
   if (template.isVip) assert.ok(fallback?.includes('luxury_spa_service'), 'VIP uses its local source image');
   else assert.equal(fallback,'/gallery-placeholder.svg');
   act(()=>hero.dispatchEvent(new window.Event('error')));assert.equal(hero.getAttribute('src'),fallback,'terminal fallback never loops back to a broken cover');
  } finally {act(()=>root.unmount());container.remove();globalThis.fetch=savedFetch;}
 });
}

for (const template of TEMPLATE_REGISTRY) {
 test(`${template.id}: an incomplete published site shows real services and owner with honest empty sections`,async()=>{
  const savedFetch=globalThis.fetch;
  const profile={...INITIAL_SALON_PROFILE,businessName:'Real published studio',subdomain:`empty-${template.id}`,ownerName:'Published owner',ownerRole:'Salon owner',ownerPhotoUrl:'',ownerBio:'Saved owner biography',packages:[],gallery:[],lookbookPhotos:[],socialVideos:[],testimonials:[],offers:[],sectionVisibility:undefined};
  const services=template.defaultData.services.slice(0,2).map(service=>({...service,name:`Real ${service.name}`}));
  globalThis.fetch=(async()=>({ok:true,json:async()=>({found:true,salon:{profile,services,stylists:[],selectedTemplateId:template.id}})})) as any;
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  try {
   await act(async()=>root.render(<SalonWebsitePreview profile={profile} services={[]} stylists={[]} selectedTemplateId={template.id} publicView onAddAppointment={()=>{}}/>));
   for (const service of services) assert.ok(container.querySelector('#services-section')?.textContent?.includes(service.name));
   assert.match(container.querySelector('[data-published-owner]')?.textContent || '',/Published owner/);
   assert.ok(container.querySelectorAll('[data-published-empty]').length>=4);
   assert.match(container.textContent || '',/Studio showcases coming soon/);
   assert.match(container.textContent || '',/Short films coming soon/);
   assert.equal(container.querySelectorAll('iframe').length,0);
   assert.ok(!container.textContent?.includes('Signature Duo'));
  } finally {await act(async()=>root.unmount());container.remove();globalThis.fetch=savedFetch;}
 });
}
