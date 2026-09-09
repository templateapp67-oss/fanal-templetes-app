import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedBookingRead, BookingSessionError } from '../src/lib/authenticatedBookingRead';
const session=(token='old',id='owner')=>({access_token:token,user:{id}});
function authWith(current:any, refreshed:any=session('new')) {return { getSession:async()=>({data:{session:current}}),refreshSession:async()=>({data:{session:refreshed}}) };}
test('missing session never sends a private anonymous request',async()=>{
 let calls=0;await assert.rejects(authenticatedBookingRead(authWith(null),'/api/bookings','owner',async()=>{calls++;return new Response();}),BookingSessionError);assert.equal(calls,0);
});
test('expired token refreshes once and retries with the new bearer token',async()=>{
 const headers:string[]=[];const res=await authenticatedBookingRead(authWith(session()),'/api/bookings','owner',async(_url,init)=>{headers.push((init!.headers as any).Authorization);return new Response('{}',{status:headers.length===1?401:200});});assert.equal(res.status,200);assert.deepEqual(headers,['Bearer old','Bearer new']);
});
test('rejected refreshed token stops after two requests',async()=>{
 let count=0;await assert.rejects(authenticatedBookingRead(authWith(session()),'/api/bookings','owner',async()=>{count++;return new Response('{}',{status:401});}),BookingSessionError);assert.equal(count,2);
});
test('account switch during refresh cannot fetch the previous owner',async()=>{
 let count=0;await assert.rejects(authenticatedBookingRead(authWith(session(),session('new','other')),'/api/bookings','owner',async()=>{count++;return new Response('{}',{status:401});}),BookingSessionError);assert.equal(count,1);
});
test('database errors remain database errors and do not refresh auth',async()=>{
 const auth=authWith(session());auth.refreshSession=async()=>{throw new Error('must not refresh')};const r=await authenticatedBookingRead(auth,'/api/bookings','owner',async()=>new Response('{}',{status:503}));assert.equal(r.status,503);
});
