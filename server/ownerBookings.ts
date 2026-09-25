import { runDb, DEFAULT_DB_TIMEOUT_MS } from './dbGuard.js';

export function mapOwnerBooking(row: any) {
  const customer = row.customer || {};
  const parts = row.appointment_start ? new Intl.DateTimeFormat('en-CA', {
    timeZone: row.salon?.timezone || 'Asia/Kolkata', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(row.appointment_start)) : [];
  const part = (name: string) => parts.find(p => p.type === name)?.value || '';
  return { ...row, customer: undefined, salon: undefined, items: undefined,
    customer_name: customer.name || '', customer_phone: customer.phone || '',
    service_name: (row.items || []).map((item: any) => item.service_name_snapshot).filter(Boolean).join(', '),
    total_amount: Number(row.total_paise) / 100,
    booking_date: parts.length ? `${part('year')}-${part('month')}-${part('day')}` : row.booking_date,
    time_slot: parts.length ? `${part('hour')}:${part('minute')}` : row.booking_time,
  };
}

/** Identity and organization membership are verified before any customer rows are read. */
export async function loadOwnerBookings(db: any, req: any, deadlineAt?: number) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { status: 401, error: 'Please sign in to load your bookings.' };
  const read = async (query: () => any) => {
    const result = await runDb(query, { label: 'owner bookings', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt });
    if (result.error) throw result.error;
    return result.data as any;
  };
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data?.user) return { status: 401, error: 'Your session has expired. Please sign in again.' };
  const userId = auth.data.user.id;
  if (req.query?.owner_id && req.query.owner_id !== userId) return { status: 403, error: 'This account cannot read the requested bookings.' };
  const memberships = await read(() => db.from('organization_members').select('organization_id')
    .eq('user_id', userId).eq('status', 'active').in('role', ['owner', 'manager', 'receptionist']));
  if (!memberships?.length) return { status: 403, error: 'No active salon membership was found for this account.' };
  let salonQuery = db.from('salons').select('id').in('organization_id', memberships.map((m: any) => m.organization_id));
  if (req.query?.subdomain) salonQuery = salonQuery.eq('slug', req.query.subdomain);
  const salons = await read(() => salonQuery);
  if (!salons?.length) return { status: 403, error: 'No accessible salon was found for this account.' };
  const rows = await read(() => db.from('bookings').select('*,customer:salon_customers!bookings_salon_customer_id_fkey(name,phone),salon:salons!bookings_salon_id_fkey(timezone),items:booking_items(service_name_snapshot)')
    .in('salon_id', salons.map((s: any) => s.id)).order('created_at', { ascending: false }).limit(500));
  return { status: 200, data: (rows || []).map(mapOwnerBooking) };
}
