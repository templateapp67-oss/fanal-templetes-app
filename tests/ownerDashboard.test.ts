import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRows, createOwnerAppointment, dashboardAppointment, readOwnerDashboard } from '../server/ownerDashboard';

const request = { headers: { authorization: 'Bearer token' }, query: { subdomain: 'mine' } };
function database(options: { member?: boolean; bookings?: any[]; error?: boolean } = {}) {
  const calls: any[] = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) }, from(table: string) {
    const call: any = { table, filters: {} }; calls.push(call);
    const q: any = {};
    for (const method of ['select','order','range','maybeSingle']) q[method] = (...args: any[]) => { call[method] = args; return q; };
    for (const method of ['eq','in']) q[method] = (key: string,value: any) => { call.filters[key] = value; return q; };
    q.then = (resolve: any) => resolve(options.error && table === 'bookings' ? { error: { code: '42501' } } : { data:
      table === 'organization_members' ? options.member === false ? [] : [{ organization_id: 'org' }] :
      table === 'salons' ? [{ id: 'salon', timezone: 'Asia/Kolkata' }] :
      table === 'bookings' ? options.bookings || [] : table === 'services' || table === 'staff' ? call.maybeSingle ? { id: 'catalog' } : [] : [] });
    return q;
  } };
}
test('dashboard refuses anonymous and inactive accounts before booking reads', async () => {
  const db = database({ member: false });
  await assert.rejects(readOwnerDashboard(db,{ headers: {} }), /sign in/i);
  await assert.rejects(readOwnerDashboard(db,request), /membership/i);
  assert.ok(!db.calls.some(c => c.table === 'bookings'));
});
test('empty dashboard is empty and scopes both bookings and clients to the salon', async () => {
  const db = database(); const result = await readOwnerDashboard(db,request);
  assert.deepEqual(result.appointments,[]); assert.deepEqual(result.clients,[]);
  for (const table of ['bookings','salon_customers']) assert.equal(db.calls.find(c => c.table === table).filters.salon_id, 'salon');
  assert.equal(db.calls.find(c => c.table === 'organization_members').filters.user_id,'actor');
});
test('database failure does not become a successful empty dashboard', async () => {
  await assert.rejects(readOwnerDashboard(database({ error: true }),request));
});
test('pagination includes rows beyond the default API limit', async () => {
  const values = Array.from({length:1201},(_,id) => ({id}));
  const result = await allRows(() => ({ range: (start: number,end: number) => Promise.resolve({data:values.slice(start,end+1)}) }));
  assert.equal(result.length,1201); assert.equal(result.at(-1).id,1200);
});
test('calendar uses canonical price, customer, staff and salon-local appointment date', () => {
  const result = dashboardAppointment({ id:'booking', total_paise:12345, paid_amount:20, appointment_start:'2026-09-09T20:00:00Z',
    customer:{name:'Real',phone:'123'},staff_id:'staff',staff_name_snapshot:'Stylist',salon:{timezone:'Asia/Kolkata'},items:[{service_id:'service',service_name_snapshot:'Cut'}],status:'confirmed' });
  assert.equal(result.date,'2026-09-10');assert.equal(result.time,'01:30');assert.equal(result.servicePrice,123.45);assert.equal(result.clientName,'Real');assert.equal(result.paymentStatus,'paid_deposit');
});
test('manual appointment delegates atomic insertion and rejects invented payment status',async () => {
  let rpc: any;
  const db=database(); const req={...request,body:{clientName:'Test',clientPhone:'123',serviceId:'cut',stylistId:'staff',date:'2026-10-10',time:'10:00',reference:'stable-reference',paymentStatus:'pay_at_salon'}};
  const result=await createOwnerAppointment(db,req,(() => ({rpc:async(name: string,args:any)=>{rpc={name,args};return {data:'booking'};}})) as any);
  assert.equal(result.id,'booking');assert.equal(rpc.name,'create_owner_booking');assert.equal(rpc.args.p_idempotency_key,'stable-reference');assert.equal(rpc.args.p_customer_user_id,null);assert.equal(rpc.args.p_salon_id,'salon');
  await assert.rejects(createOwnerAppointment(db,{...req,body:{...req.body,paymentStatus:'paid_full'}}),/payment workflow/);
});
