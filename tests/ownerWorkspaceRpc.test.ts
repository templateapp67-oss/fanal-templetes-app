import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingOwnerWorkspaceError, saveOwnerEditorState } from '../src/lib/ownerEditorState.js';
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

// ---------------------------------------------------------------------------
// Owner/salon workspace resolution on the save path.
//
// nexora_save_owner_workspace() raises 'Select a salon owned by this account'
// for an owner who has no salon — the state every freshly onboarded user is
// in. The save must resolve a workspace and retry ONCE, and only for that
// failure: an ordinary rejection must not trigger a second write.
// ---------------------------------------------------------------------------

test('a save that fails for want of a salon resolves a workspace and retries once', async () => {
  const calls: string[] = [];
  const db: any = {
    async rpc(name: string) {
      calls.push(name);
      if (name === 'ensure_owner_workspace') {
        return { error: null, data: { provisioned: true, reason: 'created', organization_id: 'o', salon_id: 's', slug: 'mine', name: 'Mine' } };
      }
      // First save attempt fails for want of a salon; after provisioning it succeeds.
      return calls.filter((c) => c === 'save_owner_editor_state').length === 1
        ? { error: { code: '42501', message: 'Select a salon owned by this account' } }
        : { error: null };
    },
  };
  const result = await saveOwnerEditorState(db, payload);
  assert.equal(result.ok, true, 'the save recovers once a workspace exists');
  assert.deepEqual(calls, ['save_owner_editor_state', 'ensure_owner_workspace', 'save_owner_editor_state']);
});

test('a save is not retried for failures that provisioning cannot fix', async () => {
  for (const message of ['permission denied for table salons', 'Invalid service price or duration', 'Sign in required']) {
    const calls: string[] = [];
    const db: any = { async rpc(name: string) { calls.push(name); return { error: { code: '42501', message } }; } };
    const result = await saveOwnerEditorState(db, payload);
    assert.equal(result.ok, false);
    assert.deepEqual(calls, ['save_owner_editor_state'], `"${message}" is surfaced, not retried`);
    assert.match(result.errors.join(' '), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('an unresolvable workspace returns the original failure instead of masking it', async () => {
  const calls: string[] = [];
  const db: any = {
    async rpc(name: string) {
      calls.push(name);
      if (name === 'ensure_owner_workspace') return { error: { message: 'legacy schema' }, data: null };
      return { error: { code: '42501', message: 'Select a salon owned by this account' } };
    },
  };
  const result = await saveOwnerEditorState(db, payload);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Select a salon owned by this account/);
  assert.deepEqual(calls, ['save_owner_editor_state', 'ensure_owner_workspace'], 'no pointless second write');
});

test('only the missing-salon failure is treated as a workspace problem', () => {
  assert.equal(isMissingOwnerWorkspaceError(['Select a salon owned by this account']), true);
  assert.equal(isMissingOwnerWorkspaceError(['function public.nexora_owner_salon_ids() does not exist']), true);
  assert.equal(isMissingOwnerWorkspaceError(['permission denied for function save_owner_editor_state']), false);
  assert.equal(isMissingOwnerWorkspaceError([]), false);
  assert.equal(isMissingOwnerWorkspaceError(undefined), false);
});

test('an ambiguous workspace explains itself instead of returning the raw SQL error', async () => {
  const db: any = {
    async rpc(name: string) {
      if (name === 'ensure_owner_workspace') {
        return {
          error: null,
          data: {
            provisioned: false, reason: 'existing', organization_id: 'o', salon_id: 's1',
            slug: 'glow-studio', name: 'Glow Studio', salon_count: 2, ambiguous: true,
            salons: [
              { salon_id: 's1', slug: 'glow-studio', name: 'Glow Studio' },
              { salon_id: 's2', slug: 'glow-studio-annexe', name: 'Glow Studio Annexe' },
            ],
          },
        };
      }
      return { error: { code: '42501', message: 'Select a salon owned by this account' } };
    },
  };
  const result = await saveOwnerEditorState(db, payload);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /more than one salon/);
  assert.match(result.errors.join(' '), /glow-studio, glow-studio-annexe/);
  assert.doesNotMatch(result.errors.join(' '), /Select a salon owned by this account/, 'raw SQL text is not shown to the owner');
});
