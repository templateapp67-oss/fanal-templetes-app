import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerAvailability,customerPaymentOrderHandler} from '../server/customerAvailability';
import {readFileSync} from 'node:fs';
const salon='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001';
function database({enabled=true,verified=true,missing=false,slots=[{slot_start:'2026-10-10T02:30:00Z',slot_end:'2026-10-10T03:05:00Z',staff_id:staff,total_paise:45000}],failure=false}:any={}){
 const calls:any[]=[];const db:any={calls,auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table:string){const q:any={};for(const name of ['select','eq','is','maybeSingle'])q[name]=(...args:any[])=>{calls.push([table,name,...args]);return q;};q.then=(resolve:any)=>resolve(missing?{data:null}:{data:{id:salon,timezone:'Asia/Kolkata',verified,accepts_online_bookings:enabled}});return q;},rpc(name:string,args:any){calls.push([name,args]);return Promise.resolve(failure?{error:{code:'42501'}}:{data:slots});}};return db;
}
const input={subdomain:'mine',service_ids:['cut'],staff_id:staff,date:'2026-10-10'};
test('availability resolves normalized IDs and returns only slot and quote information',async()=>{
 const db=database();const result=await customerAvailability(db,input);
 assert.equal(result.slots[0].time,'08:00');assert.equal(result.slots[0].totalPaise,45000);assert.equal(result.slots[0].staffId,staff);
 const rpc=db.calls.find((c:any)=>c[0]==='nexora_customer_booking_options');assert.equal(rpc[1].p_salon_id,salon);assert.equal(rpc[1].p_service_ids.length,1);assert.notEqual(rpc[1].p_service_ids[0],'cut');
 assert.ok(!db.calls.some((c:any)=>c[0]==='bookings'||c[0]==='salon_customers'));
});
test('empty availability stays empty; permission failure is not reported as sold out',async()=>{
 assert.deepEqual((await customerAvailability(database({slots:[]}),input)).slots,[]);
 await assert.rejects(customerAvailability(database({failure:true}),input));
});
test('disabled salons and invalid dates never call the slot RPC',async()=>{
  const db=database({enabled:false});await assert.rejects(customerAvailability(db,input),(e:any)=>{assert.equal(e.status,409);assert.equal(e.code,'online_booking_disabled');return true;});assert.ok(!db.calls.some((c:any)=>c[0]==='nexora_customer_booking_options'));
  await assert.rejects(customerAvailability(database(),{...input,date:'2026-02-30'}));
});

test('an unverified salon still exposes availability — only accepts_online_bookings gates it',async()=>{
  // complete_shop_onboarding writes verified=false and nothing ever flips it to
  // true, yet the booking path (create_customer_booking / createNormalizedBooking)
  // only checks accepts_online_bookings. Availability must not be stricter than
  // booking, or every onboarded salon is trapped behind a permanent error.
  const db=database({verified:false});
  const result=await customerAvailability(db,input);
  assert.equal(result.success,true);
  assert.ok(db.calls.some((c:any)=>c[0]==='nexora_customer_booking_options'));
});

test('a missing or inactive salon is reported as not found, distinct from booking-disabled',async()=>{
  await assert.rejects(customerAvailability(database({missing:true}),input),(e:any)=>{assert.equal(e.status,404);assert.equal(e.code,'salon_not_found');return true;});
  assert.ok(!database({missing:true}).calls.some((c:any)=>c[0]==='nexora_customer_booking_options'));
});
test('legacy salons with no online-booking value remain bookable',async()=>{
 const db=database({enabled:null});
 const result=await customerAvailability(db,input);
 assert.equal(result.success,true);
 assert.ok(db.calls.some((c:any)=>c[0]==='nexora_customer_booking_options'));
});
test('checkout rejects anonymous callers, stale slots and changed prices before gateway',async()=>{
 const run=async(headers:any,body:any)=>{let status=200,result:any;const res:any={status(n:number){status=n;return res;},json(v:any){result=v;return res;}};await customerPaymentOrderHandler(database(),false)({headers,body},res);return {status,result};};
 assert.equal((await run({},input)).status,401);
 assert.equal((await run({authorization:'Bearer token'},{...input,time:'10:00',totalAmount:450})).result.code,'slot_unavailable');
 assert.equal((await run({authorization:'Bearer token'},{...input,time:'08:00',totalAmount:1})).result.code,'price_changed');
});
test('UI does not advertise invented held slots or fixed scarcity',()=>{
 const source=readFileSync('src/components/BookingModal.tsx','utf8');assert.doesNotMatch(source,/const TIME_SLOTS|Temporary reservation slot held|2 slots left/);assert.match(source,/extraOrderBody/);assert.match(source,/getBookingAccessToken\(user\)/);
});
test('bridge preserves canonical booking validation and restricts public write access',()=>{
  const sql=readFileSync('supabase/migrations/20260911110000_customer_availability_bridge.sql','utf8');assert.match(sql,/private.booking_slot_validation_error/);assert.match(sql,/saved:=public.create_customer_booking/);assert.match(sql,/p_customer_user_id is distinct from actor/);assert.match(sql,/from public,anon/);
  assert.match(sql,/coalesce\(accepts_online_bookings,true\)/);
  const defaults=readFileSync('supabase/migrations/20261013_online_booking_defaults.sql','utf8');
  assert.match(defaults,/set default true/);assert.match(defaults,/set accepts_online_bookings = true/);assert.match(defaults,/set not null/);
});
test('availability RPC no longer gates on salons.verified, matching the booking contract',()=>{
  const aligned=readFileSync('supabase/migrations/20261016_customer_availability_align_verified.sql','utf8');
  assert.match(aligned,/create or replace function public\.nexora_customer_booking_options/);
  // The salon guard drops `verified` and keeps the accepts_online_bookings default.
  assert.match(aligned,/is_active and coalesce\(accepts_online_bookings,true\) and deleted_at is null/);
  assert.doesNotMatch(aligned,/and verified and coalesce/);
  // Still restricted to the service role.
  assert.match(aligned,/grant execute on function public\.nexora_customer_booking_options\(uuid,uuid\[\],uuid,date\) to service_role/);
});
