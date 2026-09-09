import { readDatabase, verifyBackendUser } from './backendContext.js';

export async function normalizedNotifications(db: any, req: any, markRead = false) {
  const { user } = await verifyBackendUser(db, req);
  if (markRead) {
    // recipient_user_id is always verified server-side; email/body identity is ignored.
    await readDatabase(() => db.from('notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('recipient_user_id', user.id).is('read_at', null));
    return { success: true };
  }
  const data = await readDatabase(() => db.from('notifications')
    .select('id,title,message,read_at,is_read,created_at,notification_type,data')
    .eq('recipient_user_id', user.id).order('created_at', { ascending: false }).limit(100));
  return { success: true, data: (data || []).map((n: any) => ({ ...n, is_read: !!n.read_at || n.is_read === true })) };
}
