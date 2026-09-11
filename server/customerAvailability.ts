import { createHash } from 'node:crypto';
import { BackendError, readDatabase, verifyBackendUser } from './backendContext.js';
import { catalogId } from './normalizedBookingCreate.js';
import { appointmentInstant } from './appointmentTime.js';
import { handleCreateRazorpayOrder } from './razorpay.js';

export async function customerAvailability(db: any, input: any) {
  const slug = String(input.subdomain || '').trim().toLowerCase();
  if (!slug) throw new BackendError(400, 'Choose a salon.');
  const salon = await readDatabase(() => db.from('salons').select('id,timezone,verified,accepts_online_bookings').eq('slug',slug).eq('is_active',true).is('deleted_at',null).maybeSingle());
  if (!salon || !salon.verified || !salon.accepts_online_bookings) throw new BackendError(409,'This salon is not accepting online bookings. Contact the salon to book.','online_booking_disabled');
  const requested = Array.isArray(input.service_ids) ? input.service_ids : String(input.service_ids || '').split(',').filter(Boolean);
  if (!requested.length || requested.length > 20) throw new BackendError(400,'Choose between 1 and 20 services.');
  const ids = [...new Set<string>(requested.map((id: any)=>catalogId(salon.id,'service',String(id))))];
  const staff = input.staff_id && !['any','any_available'].includes(input.staff_id) ? catalogId(salon.id,'staff',String(input.staff_id)) : null;
  appointmentInstant(input.date, '12:00',salon.timezone);
  const rows = await readDatabase(() => db.rpc('nexora_customer_booking_options',{p_salon_id:salon.id,p_service_ids:ids,p_staff_id:staff,p_date:input.date}));
  const formatter = new Intl.DateTimeFormat('en-GB',{timeZone:salon.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return {success:true,salonId:salon.id,serviceIds:ids,timezone:salon.timezone,slots:(rows || []).map((row: any)=>({time:formatter.format(new Date(row.slot_start)),start:row.slot_start,end:row.slot_end,staffId:row.staff_id,totalPaise:Number(row.total_paise)}))};
}
export function availabilityHandler(db: any) {
  return async (req:any,res:any) => {
    try { res.set('Cache-Control','no-store');res.json(await customerAvailability(db,req.query)); }
    catch (e:any) {res.status(e instanceof BackendError?e.status:503).json({success:false,error:e instanceof BackendError?e.message:'Availability could not be loaded. Please retry.',code:e.code});}
  };
}

/** Validate identity, actual capacity and the current quote before opening checkout. */
export function customerPaymentOrderHandler(db:any,isMock:boolean) {
  return async (req:any,res:any) => {
    if (isMock) return handleCreateRazorpayOrder(req,res);
    try {
      const {user}=await verifyBackendUser(db,req);
      const input=req.body || {};
      const availability=await customerAvailability(db,input);
      const option=availability.slots.find((slot:any)=>slot.time===input.time && slot.staffId===input.staff_id);
      if (!option) throw new BackendError(409,'This slot is no longer available. Choose another time.','slot_unavailable');
      if (Math.round(Number(input.totalAmount)*100)!==option.totalPaise) throw new BackendError(409,'The service price changed. Reload the salon menu before paying.','price_changed');
      req.body={...input,totalAmount:option.totalPaise/100,receipt:createHash('sha256').update(user.id+':'+String(input.receipt||'')).digest('hex').slice(0,40),notes:{...input.notes,nexora_actor:user.id,nexora_salon:availability.salonId,nexora_reference:String(input.receipt||''),nexora_start:new Date(option.start).toISOString(),nexora_services:createHash('sha256').update(availability.serviceIds.slice().sort().join(',')).digest('hex')}};
      return handleCreateRazorpayOrder(req,res);
    }catch(e:any){res.status(e instanceof BackendError?e.status:503).json({success:false,error:e instanceof BackendError?e.message:'Checkout could not be prepared.',code:e.code});}
  };
}
