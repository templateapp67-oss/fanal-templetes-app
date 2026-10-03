import { readDatabase } from './backendContext.js';
import { mapProfileRow, mapServiceRow, mapStylistRow } from './siteLookup.js';
import { applyPublicWebsiteContent, mergeServicePresentation } from './websiteContent.js';
import { toCustomerSalon, toCustomerService, toCustomerReview, toCustomerStaff, openNowFrom } from '../src/lib/customer/mappers.js';
import type { CustomerSalon } from '../src/lib/customer/types.js';

const missingSchema = (error: any) => ['42P01','42703','PGRST204','PGRST205'].includes(error?.code);
const optionalRows = async (run: () => any, deadline?: number): Promise<any[] | null> => {
  try { return await readDatabase(run, deadline) || []; }
  catch (error) { if (missingSchema(error)) return null; throw error; }
};

/** Public directory shares the published normalized salon catalogue. No identity
 * profiles, private owner snapshots or customer contact fields reach the response. */
export async function readNormalizedSalonDirectory(db: any, query: any = {}, handle?: string, deadline?: number): Promise<CustomerSalon[] | null> {
  let rows: any[];
  try {
    let builder = db.from('salons').select('*').eq('is_active', true).is('deleted_at', null);
    if (handle) builder = /^[0-9a-f-]{36}$/i.test(handle) ? builder.eq('id', handle) : builder.eq('slug', handle.toLowerCase());
    const data = await readDatabase(() => builder.limit(handle ? 1 : 300), deadline);
    if (!Array.isArray(data) || !data.length) return null;
    rows = data.filter(row => row.slug && row.name && row.is_listed !== false);
  } catch (error) {
    // Compatibility for older deployments without the normalized catalogue.
    if (missingSchema(error)) return null;
    throw error;
  }
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [services, staff, bookings, hours] = await Promise.all([
    optionalRows(() => db.from('services').select('*').in('salon_id', ids).eq('is_active', true), deadline),
    handle ? optionalRows(() => db.from('staff').select('*').in('salon_id', ids).eq('is_active', true).eq('is_public', true), deadline) : Promise.resolve([]),
    optionalRows(() => db.from('bookings').select('id,salon_id,status,metadata,created_at,booking_date,service_name').in('salon_id', ids), deadline),
    optionalRows(() => db.from('salon_hours').select('salon_id,day_of_week,opens_at,closes_at,is_closed').in('salon_id', ids), deadline),
  ]);
  const now = new Date();
  const coordinate = (value: unknown) => value === undefined || value === null || value === '' ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;
  const salons = rows.map(row => {
    const profile = applyPublicWebsiteContent(mapProfileRow(row), row.data?.editor_profile);
    const menuRows = (services || []).filter(s => s.salon_id === row.id && s.is_bookable_online !== false);
    const menu = mergeServicePresentation(menuRows.map(mapServiceRow), row.data?.editor_services, row.id);
    const completed = (bookings || []).filter(b => b.salon_id === row.id && ['completed','checked_out'].includes(b.status));
    const reviews = completed.flatMap(b => { const review = toCustomerReview({ ...b, owner_id: row.id, salon_name: row.name }); return review ? [review] : []; });
    const clockParts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:row.timezone || 'Asia/Kolkata',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    const localNow = new Date(Number(clockParts.year),Number(clockParts.month)-1,Number(clockParts.day),Number(clockParts.hour),Number(clockParts.minute));
    const ownHours = (hours || []).filter(h => h.salon_id === row.id);
    const dayHours = (day: number) => { const h = ownHours.find(h => Number(h.day_of_week) === day); return h ? (h.is_closed ? 'Closed' : `${String(h.opens_at).slice(0,5)}–${String(h.closes_at).slice(0,5)}`) : ''; };
    const mapped = toCustomerSalon({
      id: row.id, salon_name: row.name, subdomain: row.slug, business_type: profile.businessType,
      tagline: profile.tagline, about: profile.about, logo_url: profile.logoUrl, cover_image_url: profile.coverImageUrl || profile.socialShareImageUrl,
      city: profile.city, state: profile.state, full_address: profile.address, postal_code: profile.postalCode,
      latitude: profile.latitude, longitude: profile.longitude, phone_number: profile.phone, whatsapp: profile.whatsapp,
      instagram_handle: profile.instagramHandle, currency: profile.currency === 'INR' ? '₹' : profile.currency,
      working_hours: { monFri: dayHours(1) || profile.workingHoursMonFri, saturday: dayHours(6) || profile.workingHoursSat, sunday: dayHours(0) || profile.workingHoursSun },
      home_service: profile.homeService, require_deposit: profile.requireDeposit, deposit_percentage: 25,
    }, { from: { latitude: coordinate(query.latitude ?? query.lat), longitude: coordinate(query.longitude ?? query.lng) },
      serviceCount: menu.length, minServicePrice: menu.length ? Math.min(...menu.map(s => s.price)) : null,
      categories: [...new Set(menu.map(s => s.category))], rating: { count: reviews.length, average: reviews.length ? reviews.reduce((sum,r) => sum + r.rating,0)/reviews.length : 0 },
      recentBookings: (bookings || []).filter(b => b.salon_id === row.id && !['cancelled','rejected'].includes(b.status) && new Date(b.created_at).getTime() >= now.getTime() - 30*86400000).length,
      gallery: (profile.gallery || []).map(p => ({ id: p.id, title: p.title || '', url: p.url, thumbnailUrl: p.url, kind: 'image' as const })),
    });
    const todayHours = dayHours(localNow.getDay());
    const openNow = todayHours === 'Closed' ? false : openNowFrom(todayHours ? {monFri:todayHours,saturday:todayHours,sunday:todayHours} : mapped.workingHours, localNow);
    return { ...mapped, openNow, verified: row.is_verified === true || row.verified === true, area: row.area || profile.areaLocality || '',
      bookingServiceId: menu[0]?.id || null, normalizedCatalogue: true,
      publishedServices: handle ? menu.map(s => toCustomerService({ id:s.id, owner_id:row.id, name:s.name,category:s.category,description:s.description,icon:s.icon,price:s.price,duration_minutes:s.durationMinutes,show_duration:s.showDuration })) : undefined,
      publishedStaff: handle ? (staff || []).filter(s => s.salon_id === row.id).map(s => { const p=mapStylistRow({...s,hide_phone:true}); return toCustomerStaff({ id:p.id,owner_id:row.id,name:p.name,role:p.role,avatar_url:p.avatarUrl,bio:p.bio,hide_phone:true }); }) : undefined,
      publishedReviews: handle ? reviews : undefined,
      packages: [],
    };
  });
  if (handle) return salons;
  const term = String(query.q || '').trim().toLowerCase();
  const filtered = salons.filter(s => (!query.city || s.city.toLowerCase().includes(String(query.city).toLowerCase())) &&
    (!term || [s.name,s.city,s.area,...s.categories].some(v => String(v).toLowerCase().includes(term))) &&
    (!query.businessType || s.businessType === query.businessType) && (!query.category || s.categories.includes(query.category)) &&
    (!(query.openNow === 'true' || query.openNow === '1') || s.openNow === true) &&
    (!(query.offersOnly === 'true' || query.offersOnly === '1') || s.hasActiveOffers) &&
    (!query.minRating || s.rating.count > 0 && s.rating.average >= Number(query.minRating)) &&
    (!query.maxPrice || s.minServicePrice !== null && s.minServicePrice <= Number(query.maxPrice)));
  filtered.sort((a,b) => query.sort === 'rating' ? b.rating.average-a.rating.average : query.sort === 'trending' ? b.recentBookings-a.recentBookings : query.sort === 'price' ? (a.minServicePrice ?? Infinity)-(b.minServicePrice ?? Infinity) : query.sort === 'nearby' ? (a.distanceKm ?? Infinity)-(b.distanceKm ?? Infinity) : a.name.localeCompare(b.name));
  return filtered.slice(0,Math.min(60,Math.max(1,Number(query.limit)||24)));
}
