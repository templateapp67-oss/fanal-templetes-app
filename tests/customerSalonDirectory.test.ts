import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNormalizedSalonDirectory} from '../server/customerSalonDirectory';
function database(tables:Record<string,any[]>) {
 return {from(table:string){let rows=tables[table] || []; const q:any={select(){return q;},eq(key:string,value:any){rows=rows.filter(r=>r[key]===value);return q;},is(key:string,value:any){rows=rows.filter(r=>(r[key]??null)===value);return q;},in(key:string,values:any[]){rows=rows.filter(r=>values.includes(r[key]));return q;},limit(n:number){rows=rows.slice(0,n);return q;},then(resolve:any){return Promise.resolve({data:rows}).then(resolve);}};return q;}};
}
const salon={id:'10000000-0000-4000-8000-000000000001',slug:'new-salon',name:'New Salon',is_active:true,is_listed:true,business_type:'hair_salon',city:'Jaipur',area:'Niwaru Road',is_verified:false,data:{editor_profile:{about:'Published introduction',coverImageUrl:'https://example.test/cover.jpg'}}};
const service={id:'20000000-0000-4000-8000-000000000001',salon_id:salon.id,name:'Haircut',price_paise:35000,duration_minutes:30,is_active:true,is_bookable_online:true};
test('normalized directory exposes the published catalogue and real prices without inventing reviews or verification',async()=>{
 const result=await readNormalizedSalonDirectory(database({salons:[salon],services:[service]}),{},salon.slug);
 assert.equal(result?.[0].name,'New Salon');assert.equal(result?.[0].area,'Niwaru Road');assert.equal(result?.[0].verified,false);assert.equal(result?.[0].rating.count,0);assert.equal(result?.[0].minServicePrice,350);assert.equal(result?.[0].publishedServices?.[0].id,service.id);assert.equal(result?.[0].publishedServices?.[0].price,350);assert.equal(result?.[0].bookingServiceId,service.id);assert.deepEqual(result?.[0].packages,[]);
});
test('unlisted salons stay absent and offer filters do not fabricate promotions',async()=>{
 assert.deepEqual(await readNormalizedSalonDirectory(database({salons:[{...salon,is_listed:false}]}),{},salon.slug),[]);
 assert.deepEqual(await readNormalizedSalonDirectory(database({salons:[salon],services:[service]}),{offersOnly:'true'}),[]);
});
