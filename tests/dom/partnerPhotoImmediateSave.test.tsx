import './jsdomSetup';import {dom} from './jsdomSetup';import {test,after} from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {GrowthPartnerProfilePage} from '../../src/components/GrowthPartnerProfilePage';
after(()=>dom.window.close());
test('selecting photo saves without form submit and survives remount',async()=>{
 const id='00000000-0000-0000-0000-000000000001';let profile:any={partner_id:id,full_name:'Saved Name',phone:null,photo_path:null};let uploads=0;let saves=0;
 const client:any={rpc:async(name:string,args:any)=>{if(name==='save_my_growth_partner_profile'){saves++;profile={...profile,...args.p_patch};}return {data:name.includes('account_settings')?{}:{...profile},error:null};},auth:{getUser:async()=>({data:{user:{id}},error:null})},storage:{from:()=>({upload:async()=>{uploads++;return {error:null}},remove:async()=>({error:null}),getPublicUrl:(p:string)=>({data:{publicUrl:'https://example.test/'+p}})})}};
 Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({width:100,height:100,close(){}})});
 const proto=dom.window.HTMLCanvasElement.prototype;proto.getContext=(()=>({drawImage(){}})) as any;proto.toBlob=((cb:any)=>cb(new Blob(['photo'],{type:'image/webp'}))) as any;
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
 await act(async()=>{root.render(<GrowthPartnerProfilePage client={client}/>);});
 const input=host.querySelector('input[type=file]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['photo'],'photo.png',{type:'image/png'})]});
 await act(async()=>{input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(uploads,1);assert.equal(saves,1);assert.ok(profile.photo_path);
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>{root.render(<GrowthPartnerProfilePage client={client}/>);});
 assert.ok([...host.querySelectorAll('img')].some(img=>img.src.includes(profile.photo_path)));
 await act(async()=>root.unmount());host.remove();
});
