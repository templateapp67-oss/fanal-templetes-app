import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { observeAuthSession } from '../src/lib/restoreAuthSession';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeAuth(getSession:()=>Promise<any>) {
 let callback:any;let stopped=false;
 return {getSession,onAuthStateChange(cb:any){callback=cb;return {data:{subscription:{unsubscribe(){stopped=true}}}}},emit:(event:string,session:any)=>callback(event,session),get stopped(){return stopped}};
}
test('startup waits for the persisted session, never reports a temporary sign-out',async()=>{
 let resolve:any;const auth=fakeAuth(()=>new Promise(r=>resolve=r));const states:any[]=[];
 const controller=observeAuthSession(auth,s=>states.push(s));auth.emit('INITIAL_SESSION',null);
 assert.deepEqual(states.map(s=>s.status),['restoring']);resolve({data:{session:{user:{id:'owner'}}}});await tick();assert.equal(states.at(-1).user.id,'owner');controller.dispose();
});
test('a late startup result cannot overwrite a newer login',async()=>{
 let resolve:any;const auth=fakeAuth(()=>new Promise(r=>resolve=r));const states:any[]=[];const controller=observeAuthSession(auth,s=>states.push(s));auth.emit('SIGNED_IN',{user:{id:'owner'}});resolve({data:{session:null}});await tick();assert.equal(states.at(-1).user.id,'owner');controller.dispose();
});
test('explicit sign out cannot be undone by an old session read',async()=>{
 let resolve:any;const auth=fakeAuth(()=>new Promise(r=>resolve=r));const states:any[]=[];const controller=observeAuthSession(auth,s=>states.push(s));auth.emit('SIGNED_OUT',null);resolve({data:{session:{user:{id:'old'}}}});await tick();assert.equal(states.at(-1).user,null);assert.equal(states.at(-1).status,'ready');controller.dispose();
});
test('network failure preserves an established user and retry restores readiness',async()=>{
 let fail=false;const auth=fakeAuth(async()=>fail?{error:new Error('offline')}:{data:{session:{user:{id:'owner'}}}});const states:any[]=[];const controller=observeAuthSession(auth,s=>states.push(s));await tick();fail=true;controller.retry();await tick();assert.equal(states.at(-1).status,'error');assert.equal(states.at(-1).user.id,'owner');fail=false;controller.retry();await tick();assert.equal(states.at(-1).status,'ready');controller.dispose();
});
test('unmount ignores pending restoration and unsubscribes',async()=>{
 let resolve:any;const auth=fakeAuth(()=>new Promise(r=>resolve=r));const states:any[]=[];const controller=observeAuthSession(auth,s=>states.push(s));controller.dispose();resolve({data:{session:{user:{id:'owner'}}}});await tick();assert.equal(states.length,1);assert.equal(auth.stopped,true);
});
function token(exp:number) {const enc=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');return `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:'owner',exp,role:'authenticated'})}.test-signature`;}
for (const expired of [false,true]) test(`real Supabase SDK restores ${expired?'expired':'valid'} persisted login in a new client`,async()=>{
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}};
 const calls:string[]=[];const expires=Math.floor(Date.now()/1000)+3600;
 const user={id:'owner',aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const fetcher:typeof fetch=async(input)=>{calls.push(String(input));return new Response(JSON.stringify({access_token:token(expires),refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user}),{status:200,headers:{'Content-Type':'application/json'}})};
 const make=()=>createClient('https://session-test.supabase.co','test-public-key',{auth:{storage,storageKey:`reload-${expired}`,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});
 const first=make();const login=await first.auth.signInWithPassword({email:user.email,password:'test-only'});assert.equal(login.error,null);
 if(expired){const saved=JSON.parse(map.get(`reload-${expired}`)!);saved.expires_at=1;saved.access_token=token(1);storage.setItem(`reload-${expired}`,JSON.stringify(saved));}
 const reloaded=make();const restored=await reloaded.auth.getSession();assert.equal(restored.error,null);assert.equal(restored.data.session?.user.id,'owner');
 assert.equal(calls.filter(c=>c.includes('grant_type=password')).length,1,'no second login is needed');assert.equal(calls.filter(c=>c.includes('grant_type=refresh_token')).length,expired?1:0);
 assert.ok(map.get(`reload-${expired}`),'session stays persisted');
});
