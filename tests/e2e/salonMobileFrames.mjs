import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const server=await createServer({server:{host:'127.0.0.1',port:4187},logLevel:'error'});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH || undefined,args:['--no-sandbox','--no-zygote','--single-process']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
const out=process.env.SALON_SCREENSHOT_DIR || '/tmp/nexora-mobile';await mkdir(out,{recursive:true});
try {
 await page.goto('http://127.0.0.1:4187/templates/barber/preview');
 await page.locator('[data-salon-canvas]').waitFor();
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 // Read the authoritative registry inside the served application.
 const ids=await page.evaluate(async()=>{const {TEMPLATE_REGISTRY}=await import('/src/data/templates.ts');return TEMPLATE_REGISTRY.map(t=>t.id);});
 assert.equal(ids.length,27);
 for(const id of ids){
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`http://127.0.0.1:4187/templates/${id}/preview`);
  await page.locator('[data-salon-canvas]').waitFor();
  await page.getByRole('button',{name:/^mobile$/i}).first().click();
  await page.locator('[data-salon-canvas][data-device-mode="mobile"]').waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('[data-salon-canvas]');return el?.clientWidth<=390 && el?.clientWidth>=300;});
  await page.locator('[data-salon-canvas]').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  const metrics=await page.locator('[data-salon-canvas] header').evaluate(el=>{
   const brand=el.firstElementChild;const name=brand.querySelector('.leading-snug');
   return {width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,brandWidth:brand.clientWidth,nameWidth:name.clientWidth,nameHeight:name.clientHeight,flexWrap:getComputedStyle(el).flexWrap};
  });
  assert.ok(metrics.width<=390 && metrics.width>=300,`${id}: frame width`);
  assert.equal(metrics.flexWrap,'wrap',`${id}: container responsive header`);
  assert.ok(metrics.nameWidth>=200 && metrics.nameHeight<120,`${id}: readable salon name ${JSON.stringify(metrics)}`);
  assert.ok(metrics.height<260 && metrics.scroll<=metrics.width+1,`${id}: compact header without overflow`);
  assert.equal(await page.locator('nav[aria-label="Salon quick actions mobile preview"]').count(),1);
  assert.equal(await page.locator('nav[aria-label="Salon quick actions"]').count(),0,'preview has a single in-frame dock');
  console.log('PASS',id,JSON.stringify(metrics));
  if(id==='barber'){
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   const visible=await page.evaluate(()=>({header:document.querySelector('[data-salon-canvas] header').getBoundingClientRect().top,toolbar:document.querySelector('[data-template-preview-toolbar]').getBoundingClientRect().bottom}));
   assert.ok(visible.header>=visible.toolbar,`preview toolbar must not cover the salon name ${JSON.stringify(visible)}`);
   await page.screenshot({path:`${out}/barber-mobile-preview.png`});
  }
 }
 // The reported published payload, rendered with this build on real phone widths.
 const fixture=process.env.SALON_SITE_FIXTURE;
 if (!fixture) throw new Error('Set SALON_SITE_FIXTURE to a captured public /api/site JSON response.');
 const payload=JSON.parse(await readFile(fixture,'utf8'));
 const salonName=payload.salon.profile.businessName;
 await page.route('**/api/site?*',route=>route.fulfill({json:payload}));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4187/?site=nexora-salon');
  await page.locator('[data-salon-canvas]').waitFor();
  assert.ok((await page.locator('body').innerText()).includes(salonName));
  const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width+1,`public ${width}: no document overflow`);
  const title=await page.locator('[data-salon-canvas] header .leading-snug').evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
  assert.ok(title.width>120 && title.height<120,`public ${width}: readable name`);
  console.log('PASS published',width,JSON.stringify(size));
  if(width===390)await page.screenshot({path:`${out}/nexora-salon-mobile.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS 27 mobile preview frames and 4 published viewport widths');
}finally{await browser.close();await server.close();}
