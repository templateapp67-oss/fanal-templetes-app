import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const env = parse(readFileSync(process.argv[2], 'utf8'));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
assert.equal(new URL(url).hostname,'qwaehqsmodekbgvnaavz.supabase.co');
const admin = createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const client = createClient(url,env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const id = randomUUID();
const email = `codex-profile-test-${id}@example.com`;
const password = randomUUID()+randomUUID();
let userId; let path;
const ok = result => { if(result.error) throw new Error(result.error.message); return result.data; };
try {
  userId = ok(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Temporary profile verification'}})).user.id;
  ok(await client.auth.signInWithPassword({email,password}));
  path = `${userId}/${id}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0XcAAAAASUVORK5CYII=','base64');
  ok(await client.storage.from('partner-avatars').upload(path,png,{contentType:'image/png'}));
  const avatar = client.storage.from('partner-avatars').getPublicUrl(path).data.publicUrl;
  const payload={p_name:'Temporary profile verification',p_whatsapp:'+919845077654',p_postal:'560038',p_city:'Bengaluru',p_avatar:avatar,p_dob:'1992-06-15',p_area:'Test locality',p_notifications:false};
  ok(await client.rpc('save_partner_profile',payload));
  const saved = ok(await client.rpc('get_partner_profile'));
  assert.equal(saved.name,payload.p_name); assert.equal(saved.postal,'560038'); assert.equal(saved.avatar,avatar); assert.equal(saved.notifications,false);
  const bad = await client.rpc('save_partner_profile',{...payload,p_postal:'000000'});
  assert.ok(bad.error); assert.equal(ok(await client.rpc('get_partner_profile')).postal,'560038');
  const denied = await client.storage.from('partner-avatars').upload(`${randomUUID()}/wrong.png`,png,{contentType:'image/png'});
  assert.ok(denied.error);
  ok(await client.auth.signOut());
  assert.ok((await client.rpc('get_partner_profile')).error);
  console.log('PASS: authenticated avatar upload, RPC save/reload, invalid PIN rejection, foreign upload rejection, anonymous rejection.');
} finally {
  if(path) ok(await admin.storage.from('partner-avatars').remove([path]));
  if(userId) ok(await admin.auth.admin.deleteUser(userId));
  console.log('Temporary verification user and avatar cleaned up.');
}
