import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geocodeOpenStreetMap} from '../src/utils/openStreetMapGeocoding';
test('address lookup uses only Nominatim and keeps valid zero coordinates',async()=>{
 const saved=globalThis.fetch;let url='';
 globalThis.fetch=(async(input:any)=>{url=String(input);return {ok:true,json:async()=>[{lat:'0',lon:'0'}]};}) as any;
 try {assert.deepEqual(await geocodeOpenStreetMap(' Studio Road '),{lat:0,lng:0,source:'nominatim'});assert.ok(url.startsWith('https://nominatim.openstreetmap.org/search?'));assert.ok(url.includes('q=Studio%20Road'));}
 finally {globalThis.fetch=saved;}
});
test('missing or malformed geocoding results never produce an invented pin',async()=>{
 const saved=globalThis.fetch;
 try {
  for(const rows of [[],[{}],[{lat:null,lon:null}],[{lat:'',lon:''}],[{lat:'bad',lon:'2'}],[{lat:'91',lon:'2'}]]) {
   globalThis.fetch=(async()=>({ok:true,json:async()=>rows})) as any;
   assert.equal(await geocodeOpenStreetMap('Studio Road'),null);
  }
 } finally {globalThis.fetch=saved;}
});
