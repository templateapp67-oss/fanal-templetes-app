import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSalon, mapProfileRow } from '../server/siteLookup.js';
import { ownerBookingChanges, findAuthorizedBooking, presentBooking, updateNormalizedBooking } from '../server/normalizedBookingAccess.js';
import { createBookingCheckinHandler } from '../server/bookingCheckin.js';
import { normalizedNotifications } from '../server/normalizedNotifications.js';
import { createNormalizedBooking, catalogId, appointmentInstant } from '../server/normalizedBookingCreate.js';

const salonId = '20000000-0000-4000-8000-000000000001';
const bookingId = '30000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000001';
const serviceId = catalogId(salonId, 'service', 'cut');
type Call = { table: string; operation: string; filters: Record<string, any>; fields?: any; payload?: any };
function database(answer: (call: Call) => any) {
  const calls: Call[] = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    from(table: string) {
      const call: Call = { table, operation: 'read', filters: {} }; calls.push(call);
      const q: any = {
        select(fields: any) { call.fields = fields; return q; },
        eq(k: string,v: any) { call.filters[k] = v; return q; },
        in(k: string,v: any) { call.filters[k] = v; return q; },
        is(k: string,v: any) { call.filters[k] = v; return q; },
        order() { return q; }, limit() { return q; }, maybeSingle() { return q; },
        update(payload: any) { call.operation = 'update'; call.payload = payload; return q; },
        then(resolve: any,reject: any) { return Promise.resolve(answer(call)).then(resolve,reject); },
      }; return q;
    },
  };
}
const result = (data: any) => ({ data, error: null });
const row = () => ({ id: bookingId, salon_id: salonId, customer_user_id: actor,
  status: 'confirmed', total_paise: 49900, appointment_start: '2026-10-10T04:30:00Z', appointment_end: '2026-10-10T05:00:00Z',
  customer: { name: 'Customer' }, salon: { timezone: 'Asia/Kolkata' }, items: [],
});

test('live public lookup propagates catalogue failures and never substitutes demo data', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const db = database(c => c.table === 'salons' ? result({ id: salonId, name: 'Real', slug: 'arts-by-uma' }) : { data: null, error });
  const response = await lookupSalon({ db: db as any, isMockSupabase: false, mockSalons: {} }, 'arts-by-uma');
  assert.equal(response.found, false); assert.equal(response.salon, null); assert.deepEqual(response.error, error);
  assert.ok(db.calls.every(c => ['salons','services','staff','salon_hours'].includes(c.table)));
});
test('live empty catalogue stays empty and public staff query excludes private employment data', async () => {
  const db = database(c => result(c.table === 'salons' ? { id: salonId, name: 'Real', slug: 'arts-by-uma' } : []));
  const response = await lookupSalon({ db: db as any, isMockSupabase: false, mockSalons: {} }, 'arts-by-uma');
  assert.equal(response.found, true); assert.deepEqual(response.salon.services, []);
  const staff = db.calls.find(c=>c.table==='staff')!;
  assert.equal(staff.filters.is_public, true); assert.equal(staff.filters.is_active, true);
  assert.doesNotMatch(staff.fields, /commission|access_role|phone/);
  const service = db.calls.find(c=>c.table==='services')!;
  assert.equal(service.filters.is_active, true); assert.equal(service.filters.salon_id, salonId);
});
test('canonical salon contact overrides stale editor snapshot without supplying invented contact', () => {
  const profile = mapProfileRow({ id: salonId, name: 'Mine', city: 'Jaipur', area: 'Jhotwara', phone: 'new', data: { editor_profile: { city: 'Old', phone: 'old' } } });
  assert.equal(profile.city,'Jaipur'); assert.equal(profile.phone,'new'); assert.equal(profile.areaLocality,'Jhotwara');
  assert.equal(profile.email,''); assert.equal(profile.ownerId,undefined);
});
test('booking lookup requires customer or verified organization membership and rejects cross-tenant ids', async () => {
  const db = database(c => result(c.table==='organization_members' ? [{organization_id:'org-mine'}] : c.table==='salons' ? [{id:salonId}] : null));
  await assert.rejects(findAuthorizedBooking(db,actor,bookingId), /Booking not found/);
  const reads = db.calls.filter(c=>c.table==='bookings');
  assert.equal(reads[0].filters.customer_user_id,actor); assert.deepEqual(reads[1].filters.salon_id,[salonId]);
  assert.equal(db.calls.find(c=>c.table==='organization_members')?.filters.user_id,actor);
});
test('notifications cannot be read or marked as another body/email identity', async () => {
  const db = database(() => result([]));
  const req = { headers:{authorization:'Bearer test'}, query:{email:'victim@example.com'}, body:{recipient_user_id:'victim'} };
  await normalizedNotifications(db, req); await normalizedNotifications(db, req, true);
  assert.ok(db.calls.every(c=>c.filters.recipient_user_id===actor));
  await assert.rejects(normalizedNotifications(db,{headers:{}}),/sign in/i);
  assert.equal(db.calls.length,2);
});
test('reschedule confirmation changes both appointment times, validates dates and ignores money/identity writes', () => {
  const before = { ...row(), status:'reschedule_proposed', proposed_date:'2026-10-12', proposed_time_slot:'11:00' };
  const patch = ownerBookingChanges(before,{status:'confirmed',salon_id:'victim',total_paise:1});
  assert.equal(patch.appointment_start,'2026-10-12T05:30:00.000Z'); assert.equal(patch.appointment_end,'2026-10-12T06:00:00.000Z');
  assert.equal(patch.salon_id,undefined); assert.equal(patch.total_paise,undefined);
  assert.throws(()=>ownerBookingChanges(row(),{status:'reschedule_proposed',proposed_date:'2026-02-30',proposed_time_slot:'11:00'}));
  assert.throws(()=>ownerBookingChanges({...row(),status:'completed'},{status:'confirmed'}));
});
test('appointment conversion handles Indian timezone and rejects invalid or nonexistent local times', () => {
  assert.equal(appointmentInstant('2026-10-10','10:00'),'2026-10-10T04:30:00.000Z');
  assert.throws(()=>appointmentInstant('2026-10-10','29:00'));
  assert.throws(()=>appointmentInstant('2026-03-08','02:30','America/New_York'));
});
test('normalized create uses server catalogue, caller RPC and stable idempotency; ignores forged paid fields', async () => {
  const db = database(c => result(c.table==='salons' ? {id:salonId,timezone:'Asia/Kolkata',accepts_online_bookings:true} : c.table==='services' ? [{id:serviceId,price_paise:49900}] : row()));
  let args: any; let callerToken: any;
  const integrations: any = { gateway:()=>{throw Error('Unverified payment must not invoke gateway');}, userDatabase:(token: string)=>{callerToken=token;return {rpc:(name: string,payload: any)=>{assert.equal(name,'create_customer_booking');args=payload;return Promise.resolve(result(bookingId));}};} };
  const body = { subdomain:'mine',booking:{service_id:'cut',booking_date:'2026-10-10',time_slot:'10:00',payment_id:'reference',total_amount:1,advance_paid_amount:999999,payment_status:'paid'} };
  const saved = await createNormalizedBooking(db,{headers:{authorization:'Bearer customer-token'}},actor,body,null,integrations);
  assert.equal(saved.total_amount,499); assert.equal(saved.advance_paid_amount,0); assert.equal(callerToken,'customer-token');
  assert.deepEqual(args.p_service_ids,[serviceId]); assert.equal(args.p_salon_id,salonId); assert.equal(args.p_customer_user_id,undefined);
  const key = args.p_idempotency_key;
  await createNormalizedBooking(db,{headers:{authorization:'Bearer customer-token'}},actor,body,null,integrations);
  assert.equal(args.p_idempotency_key,key);
});
test('customer booking projection removes internal notes and retains saved review', () => {
  const value = presentBooking({...row(),internal_note:'private',created_by:'employee',idempotency_key:'secret',review:{rating:4,review_text:'Good',updated_at:'2026-10-10'}});
  assert.equal(value.internal_note,undefined); assert.equal(value.created_by,undefined); assert.equal(value.idempotency_key,undefined);
  assert.equal(value.metadata.review_rating,4);
});
test('customer can accept only the salon proposal, with a scoped compare-and-set write', async () => {
  let saved = {...row(), status:'reschedule_proposed', proposed_date:'2026-10-12', proposed_time_slot:'11:00'};
  const db = database(c => {
    if (c.operation==='update') saved = {...saved,...c.payload};
    return result(saved);
  });
  const response = await updateNormalizedBooking(db,{headers:{authorization:'Bearer test'},body:{id:bookingId,status:'confirmed',total_paise:1}});
  assert.equal(response.data.status,'confirmed');
  const write = db.calls.find(c=>c.operation==='update')!;
  assert.equal(write.filters.customer_user_id,actor); assert.equal(write.filters.status,'reschedule_proposed');
  assert.equal(write.payload.appointment_start,'2026-10-12T05:30:00.000Z'); assert.equal(write.payload.total_paise,undefined);
});
test('normalized check-in verifies salon membership and persists today’s arrival without fabricating credits', async () => {
  const db = database(c => result(c.table==='organization_members' ? [{organization_id:'org'}] : c.table==='salons' ? [{id:salonId}] : c.operation==='update' ? {id:bookingId} : row()));
  const handler = createBookingCheckinHandler({db,isMock:false,normalizedBookings:true,now:()=>Date.parse('2026-10-10T05:00:00Z')} as any);
  const response: any = {locals:{},statusCode:200,status(code: number){this.statusCode=code;return this;},json(body: any){this.body=body;return this;}};
  await handler({headers:{authorization:'Bearer test'},body:{booking_id:bookingId},query:{owner_id:'victim'}},response);
  assert.equal(response.statusCode,200); assert.equal(response.body.data.booking.status,'checked_in');
  assert.deepEqual(response.body.data.credits,[]);
  const write = db.calls.find(c=>c.operation==='update')!;
  assert.equal(write.filters.salon_id,salonId); assert.equal(write.filters.status,'confirmed');
  assert.equal(db.calls.find(c=>c.table==='organization_members')?.filters.user_id,actor);
});
