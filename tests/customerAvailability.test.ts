import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerAvailability,customerPaymentOrderHandler} from '../server/customerAvailability';
import {readFileSync} from 'node:fs';
const salon='10000000-0000-4000-8000-000000000001',staff='20000000-0000-4000-8000-000000000001';
function database({enabled=true,slots=[{slot_start:'2026-10-10T02:30:00Z',slot_end:'2026-10-10T03:05:00Z',staff_id:staff,total_paise:45000}],failure=false}:any={}){
 const calls:any[]=[];const db:any={calls,auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table:string){const q:any={};for(const name of ['select','eq','is','maybeSingle'])q[name]=(...args:any[])=>{calls.push([table,name,...args]);return q;};q.then=(resolve:any)=>resolve({data:{id:salon,timezone:'Asia/Kolkata',verified:true,accepts_online_bookings:enabled}});return q;},rpc(name:string,args:any){calls.push([name,args]);return Promise.resolve(failure?{error:{code:'42501'}}:{data:slots});}};return db;
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
 const db=database({enabled:false});await assert.rejects(customerAvailability(db,input),/not accepting/);assert.ok(!db.calls.some((c:any)=>c[0]==='nexora_customer_booking_options'));
 await assert.rejects(customerAvailability(database(),{...input,date:'2026-02-30'}));
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
});
