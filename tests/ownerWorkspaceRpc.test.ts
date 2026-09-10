import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveOwnerEditorState } from '../src/lib/ownerEditorState.js';
import { runSalonSavePipeline } from '../src/lib/autoSave.js';

const payload: any = { ownerId:'owner',profile:{businessName:'Mine',phone:'123'},services:[],stylists:[],loyaltyConfig:{},appointments:[],clients:[],selectedTemplateId:2 };
test('owner save uses only the canonical transaction and preserves optional workspace fields', async () => {
  let write: any;
  const db: any = { from(){throw Error('Legacy table write is forbidden');}, async rpc(name: string,args: any){write={name,args};return {error:null};} };
  const saved = await saveOwnerEditorState(db,payload);
  assert.equal(saved.ok,true); assert.equal(write.name,'save_owner_editor_state');
  assert.deepEqual(write.args.p_state.profile,payload.profile);
  assert.deepEqual(write.args.p_state.appointments,[]); assert.deepEqual(write.args.p_state.clients,[]);
  assert.equal(write.args.p_state.selectedTemplateId,2);
});
test('Supabase error results cannot become save success, and a rejected write does not poison the queue', async () => {
  let count=0;
  const db: any = { async rpc(){count++;return count===1 ? {error:{code:'42501',message:'permission denied'}} : {error:null};} };
  const failed=await saveOwnerEditorState(db,payload);
  assert.equal(failed.ok,false); assert.match(failed.errors.join(' '),/permission denied/);
  assert.equal((await saveOwnerEditorState(db,payload)).ok,true);
});
test('queued saves cannot let an older request finish after a newer one', async () => {
  const seen: string[]=[];let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const db:any={async rpc(_name:string,args:any){const name=args.p_state.profile.businessName;seen.push('start '+name);if(name==='first')await waiting;seen.push('end '+name);return {error:null};}};
  const first=saveOwnerEditorState(db,{...payload,profile:{businessName:'first'}});
  const second=saveOwnerEditorState(db,{...payload,profile:{businessName:'second'}});
  await Promise.resolve(); release(); await Promise.all([first,second]);
  assert.deepEqual(seen,['start first','end first','start second','end second']);
});
test('a failed or incomplete hydration cannot replace the saved cloud catalogue through either write path', async () => {
  let writes=0;let local:any;
  const result=await runSalonSavePipeline({
    payload,authenticated:true,isMockMode:false,workspaceReady:false,
    sync:async()=>{writes++;return {ok:true,errors:[]};},
    saveViaApi:async()=>{writes++;return {ok:true};},
    writeDraft:(draft:any)=>{local=draft;return {ok:true};},
  });
  assert.equal(result.target,'local_draft'); assert.equal(writes,0);
  assert.equal(local.ownerId,payload.ownerId); assert.deepEqual(local.profile,payload.profile);
  assert.match(result.summary,/workspace loads/);
});
