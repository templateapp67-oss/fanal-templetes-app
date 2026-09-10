import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRows, createOwnerAppointment, dashboardAppointment, readOwnerDashboard, validateSalonHours, salonHoursHandler } from '../server/ownerDashboard';

const request = { headers: { authorization: 'Bearer token' }, query: { subdomain: 'mine' } };
function database(options: { member?: boolean; bookings?: any[]; error?: boolean; salons?: any[]; catalogMissing?: boolean } = {}) {
  const calls: any[] = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) }, from(table: string) {
    const call: any = { table, filters: {} }; calls.push(call);
    const q: any = {};
    for (const method of ['select','order','range','maybeSingle']) q[method] = (...args: any[]) => { call[method] = args; return q; };
    for (const method of ['eq','in']) q[method] = (key: string,value: any) => { call.filters[key] = value; return q; };
    q.then = (resolve: any) => resolve(options.error && table === 'bookings' ? { error: { code: '42501' } } : { data:
      table === 'organization_members' ? options.member === false ? [] : [{ organization_id: 'org' }] :
      table === 'salons' ? options.salons || [{ id: 'salon', timezone: 'Asia/Kolkata' }] :
      table === 'bookings' ? options.bookings || [] : table === 'services' || table === 'staff' ? call.maybeSingle ? options.catalogMissing ? null : { id: 'catalog' } : [] : [] });
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
  const serviceId='40000000-0000-4000-8000-000000000001', staffId='50000000-0000-4000-8000-000000000001';
  const db=database(); const req={...request,body:{clientName:'Test',clientPhone:'123',clientEmail:'t@example.com',serviceId,stylistId:staffId,date:'2026-10-10',time:'10:00',reference:'stable-reference',paymentStatus:'pay_at_salon'}};
  const result=await createOwnerAppointment(db,req,(() => ({rpc:async(name: string,args:any)=>{rpc={name,args};return {data:'booking'};}})) as any);
  assert.equal(result.id,'booking');assert.equal(rpc.name,'create_owner_booking');assert.equal(rpc.args.p_customer_user_id,null);assert.equal(rpc.args.p_salon_id,'salon');
  // Only persisted catalogue UUIDs are forwarded; the reference is hashed with
  // the caller id so a retried submit is idempotent per owner.
  assert.deepEqual(rpc.args.p_service_ids,[serviceId]);assert.equal(rpc.args.p_staff_id,staffId);
  assert.equal(rpc.args.p_customer_email,'t@example.com');assert.equal(rpc.args.p_customer_note,null);
  assert.match(rpc.args.p_idempotency_key,/^[0-9a-f]{64}$/);assert.notEqual(rpc.args.p_idempotency_key,'stable-reference');
  await assert.rejects(createOwnerAppointment(db,{...req,body:{...req.body,paymentStatus:'paid_full'}}),/payment workflow/);
});
test('manual appointments refuse editor or placeholder catalogue ids and missing records',async () => {
  const serviceId='40000000-0000-4000-8000-000000000001', staffId='50000000-0000-4000-8000-000000000001';
  const db=database(); const base={clientName:'Test',clientPhone:'123',date:'2026-10-10',time:'10:00',reference:'r',paymentStatus:'pay_at_salon'};
  const rpc=() => ({rpc:async()=>({data:'booking'})}) as any;
  await assert.rejects(createOwnerAppointment(db,{...request,body:{...base,serviceId:'srv-1',stylistId:staffId}},rpc),/Choose a service from the saved salon catalogue/);
  await assert.rejects(createOwnerAppointment(db,{...request,body:{...base,serviceId,stylistId:'st-default'}},rpc),/Choose a specialist from the saved salon team/);
  // A saved catalogue record that was deleted or invalidated is reported
  // clearly instead of being silently replaced by another record.
  const missing = database({ catalogMissing: true });
  await assert.rejects(createOwnerAppointment(missing,{...request,body:{...base,serviceId,stylistId:staffId}},rpc),/selected service is no longer available/);
});
test('database rejections of manual appointments map to actionable errors, not a generic mask', async () => {
  const serviceId='40000000-0000-4000-8000-000000000001', staffId='50000000-0000-4000-8000-000000000001';
  const base={clientName:'Test',clientPhone:'123',serviceId,stylistId:staffId,date:'2026-10-10',time:'10:00',reference:'r',paymentStatus:'pay_at_salon'};
  const cases: [any, number, string, RegExp][] = [
    [{ code:'PGRST202', message:'Could not find the function public.create_owner_booking without parameters in the schema cache' }, 503, 'booking_rpc_missing', /create_owner_booking update/],
    [{ code:'42883', message:'function public.create_owner_booking(uuid, ...) does not exist' }, 503, 'booking_rpc_missing', /create_owner_booking update/],
    [{ code:'42501', message:'new row violates row-level security policy' }, 403, 'forbidden', /outside your salon workspace/],
    [{ code:'23503', message:'insert or update on table "bookings" violates foreign key constraint', details:'Key (staff_id)=(...) is not present in table "staff".' }, 409, 'staff_unavailable', /specialist is no longer available/],
    [{ code:'23503', message:'insert or update on table "booking_items" violates foreign key constraint', details:'Key (service_id)=(...) is not present in table "services".' }, 409, 'service_unavailable', /service is no longer available/],
    [{ code:'23P01', message:'The requested time is already booked for this specialist.' }, 409, 'slot_conflict', /already booked/],
    [{ code:'22023', message:'The selected specialist does not offer this service.' }, 409, 'invalid_appointment_input', /does not offer this service/],
  ];
  for (const [error, status, code, message] of cases) {
    let captured: any;
    const rpc=() => ({rpc:async()=>{captured=true; return {data:null,error};}}) as any;
    await assert.rejects(createOwnerAppointment(database(),{...request,body:{...base}},rpc),(err: any) => {
      assert.equal(err.status,status);assert.equal(err.code,code);assert.match(err.message,message);
      assert.ok(captured);
      return true;
    });
  }
});

test('legacy slug resolves only an unambiguous authorized salon', async () => {
  const db = database({ salons: [{id:'one',slug:'saved-slug',timezone:'Asia/Kolkata'}] });
  await readOwnerDashboard(db, request);
  assert.equal(db.calls.find(c=>c.table==='bookings').filters.salon_id,'one');
  const multiple = database({ salons: [{id:'one',slug:'other'},{id:'two',slug:'another'}] });
  await assert.rejects(readOwnerDashboard(multiple,request), /Select one salon/);
  assert.ok(!multiple.calls.some(c=>c.table==='bookings'));
  const matched = database({ salons: [{id:'one',slug:'mine'},{id:'two',slug:'another'}] });
  await readOwnerDashboard(matched,request);
  assert.equal(matched.calls.find(c=>c.table==='bookings').filters.salon_id,'one');
});

test('hours reject missing days, duplicates, invalid times and reversed intervals',()=>{
  const hours=Array.from({length:7},(_,day_of_week)=>({day_of_week,is_closed:day_of_week===2,opens_at:'08:00',closes_at:'21:00'}));
  const rows=validateSalonHours(hours,'salon');assert.equal(rows[2].opens_at,null);assert.equal(rows[1].opens_at,'08:00');assert.ok(rows.every(r=>r.salon_id==='salon'));
  assert.throws(()=>validateSalonHours(hours.slice(0,6),'salon'));
  assert.throws(()=>validateSalonHours(hours.map(h=>({...h,day_of_week:1})),'salon'));
  assert.throws(()=>validateSalonHours(hours.map(h=>({...h,closes_at:'06:00'})),'salon'));
  assert.throws(()=>validateSalonHours(hours.map(h=>({...h,opens_at:'25:00'})),'salon'));
});

test('hours save requires manager membership and never overwrites configured staff schedules',async()=>{
  const writes:any[]=[];let manager=false;
  const db:any={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from(table:string){
    let single=false,payload:any=null;const q:any={};
    for(const name of ['select','eq','in','order'])q[name]=()=>q;
    q.single=q.maybeSingle=()=>{single=true;return q;};
    q.upsert=(rows:any,options:any)=>{payload=rows;writes.push({table,rows,options});return q;};
    q.then=(resolve:any)=>resolve({data:payload||(table==='organization_members'?(single?(manager?{id:'member'}:null):[{organization_id:'org'}]):table==='salons'?(single?{organization_id:'org'}:[{id:'salon',slug:'mine'}]):table==='staff'?[{id:'configured'},{id:'missing'}]:table==='staff_schedules'?[{staff_id:'configured'}]:[])});return q;
  }};
  const hours=Array.from({length:7},(_,day_of_week)=>({day_of_week,is_closed:day_of_week===2,opens_at:'08:00',closes_at:'21:00'}));
  const req={...request,body:{salon_id:'foreign',hours}};let status=200;let body:any;
  const res:any={status(n:number){status=n;return res;},json(value:any){body=value;return res;}};
  await salonHoursHandler(db)(req,res);assert.equal(status,403);assert.equal(writes.length,0);
  manager=true;status=200;await salonHoursHandler(db)(req,res);assert.equal(status,200);assert.equal(body.success,true);
  assert.ok(writes[0].rows.every((row:any)=>row.salon_id==='salon'));
  const staffWrite=writes.find(w=>w.table==='staff_schedules');assert.equal(staffWrite.rows.length,7);assert.ok(staffWrite.rows.every((r:any)=>r.staff_id==='missing'));assert.equal(staffWrite.options.ignoreDuplicates,true);
});
