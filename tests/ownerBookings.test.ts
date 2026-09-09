import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadOwnerBookings, mapOwnerBooking } from '../server/ownerBookings';
function dbFor(members: any[] = [{organization_id:'org'}]) {
 const seen:any[]=[];
 const db:any={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table:string){
 const q:any={};for(const key of ['select','eq','in','order','limit'])q[key]=(...args:any[])=>{seen.push([table,key,...args]);return q};
 q.then=(resolve:any)=>resolve({data:table==='organization_members'?members:table==='salons'?[{id:'salon'}]:[],error:null});return q;
 }};return {db,seen};
}
test('owner list requires login before reading any table',async()=>{
 const {db,seen}=dbFor();assert.equal((await loadOwnerBookings(db,{headers:{}})).status,401);assert.equal(seen.length,0);
});
test('owner list rejects another account and disabled membership',async()=>{
 const {db,seen}=dbFor([]);assert.equal((await loadOwnerBookings(db,{headers:{authorization:'Bearer token'},query:{owner_id:'other'}})).status,403);assert.equal(seen.length,0);
 assert.equal((await loadOwnerBookings(db,{headers:{authorization:'Bearer token'},query:{}})).status,403);assert.ok(!seen.some(x=>x[0]==='bookings'));
});
test('normalized list filters bookings by authorized salon ids',async()=>{
 const {db,seen}=dbFor();assert.equal((await loadOwnerBookings(db,{headers:{authorization:'Bearer token'},query:{owner_id:'owner'}})).status,200);
 assert.ok(seen.some(x=>x[0]==='bookings'&&x[1]==='in'&&x[2]==='salon_id'&&x[3][0]==='salon'));
 assert.ok(!seen.some(x=>x[0]==='bookings'&&x[2]==='owner_id'));
});
test('appointment is displayed in salon timezone and paise converted to rupees',()=>{
 const row=mapOwnerBooking({appointment_start:'2026-09-09T20:00:00Z',total_paise:12345,customer:{name:'Customer',phone:'123'},items:[{service_name_snapshot:'Cut'}],salon:{timezone:'Asia/Kolkata'}});
 assert.equal(row.booking_date,'2026-09-10');assert.equal(row.time_slot,'01:30');assert.equal(row.total_amount,123.45);assert.equal(row.customer_name,'Customer');assert.equal(row.service_name,'Cut');
});
