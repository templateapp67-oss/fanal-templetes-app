import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const server = await createServer({ server: { host:'127.0.0.1',port:4194 },logLevel:'error' }); await server.listen();
const browser = await chromium.launch({ executablePath:process.env.CHROME_EXECUTABLE_PATH,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage'] });
const output='/tmp/responsive-customer-ui'; await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:4194/templates/barber/preview');
 const ids=await page.evaluate(async()=> (await import('/src/data/templates.ts')).TEMPLATE_REGISTRY.map(t=>t.id)); assert.equal(ids.length,28);
 const links=['My appointments','Packages','Favorites','My profile','Rewards','All services'];
 for(const id of ids) {
  await page.setViewportSize({width:1440,height:1000}); await page.goto(`http://127.0.0.1:4194/templates/${id}/preview`);
  await page.locator('.template-customer-toolbar').getByRole('button',{name:'Packages',exact:true}).click();
  const area=page.locator('[data-template-customer-page]'); await area.waitFor();
  for(const name of links){ await area.locator('aside').getByRole('button',{name,exact:true}).click(); await area.locator('.template-customer-main').waitFor(); assert.equal(await page.locator('dialog[open]').count(),0); assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden'); }
  assert.equal(await area.locator('.customer-demo-nav').isVisible(),false);
  assert.ok(await page.locator('[data-salon-canvas] > header').count()); assert.ok(await page.locator('[data-salon-canvas] footer').count());
  const dimensions=await area.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth})); assert.ok(dimensions.scroll<=dimensions.width+1,`${id}: desktop overflow`);
  await area.getByRole('button',{name:'Back to salon website'}).click(); await area.waitFor({state:'hidden'});
  await page.setViewportSize({width:390,height:844}); await page.locator('.template-customer-toolbar').getByRole('button',{name:'Packages',exact:true}).click(); await page.locator('dialog[open]').waitFor(); await page.keyboard.press('Escape'); await page.locator('dialog[open]').waitFor({state:'hidden'});
  console.log(`PASS ${id}: all six desktop pages and mobile drawer`);
 }
 // Deep-link, browser history, and resize at the exact desktop breakpoint.
 await page.setViewportSize({width:1440,height:1000}); await page.goto('http://127.0.0.1:4194/templates/hair_salon/preview?customer=wallet');
 const area=page.locator('[data-template-customer-page]'); await area.getByText('Current points',{exact:true}).waitFor();
 await area.locator('aside').getByRole('button',{name:'Packages',exact:true}).click(); await area.getByText('Signature Duo',{exact:true}).waitFor();
 await page.goBack(); await area.getByText('Current points',{exact:true}).waitFor(); await page.goForward(); await area.getByText('Signature Duo',{exact:true}).waitFor();
 await page.screenshot({path:`${output}/desktop-packages.png`});
 await page.setViewportSize({width:1023,height:1000}); await page.locator('dialog[open]').waitFor(); await page.setViewportSize({width:1024,height:1000}); await area.waitFor(); assert.equal(await page.locator('dialog[open]').count(),0);
 if(process.env.LIVE_SITE_FIXTURE) {
  const live=JSON.parse(await readFile(process.env.LIVE_SITE_FIXTURE,'utf8')); await page.route('**/api/site?*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(live)}));
  await page.setViewportSize({width:1440,height:1000}); await page.goto('http://127.0.0.1:4194/?site=gelexy-salon');
  await page.getByText('GELEXY SALON',{exact:true}).first().waitFor(); await page.locator('#services-section').waitFor();
  for (const service of live.salon.services) await page.locator('#services-section').getByText(service.name,{exact:true}).first().waitFor();
  await page.locator('[data-published-owner]').getByText(live.salon.profile.ownerName,{exact:true}).waitFor();
  assert.ok(await page.locator('[data-published-empty]').count()>=4);
  await page.locator('[data-template-customer-home]').getByRole('button',{name:/View all .*services/}).click(); await page.locator('[data-live-customer-catalogue]').waitFor();
  assert.equal(await page.locator('[data-live-customer-catalogue] article').count(),live.salon.services.length); assert.equal(await page.locator('dialog[open]').count(),0);
  assert.ok(new URL(page.url()).searchParams.get('site')==='gelexy-salon');
  await page.screenshot({path:`${output}/gelexy-desktop-services.png`});
  await page.setViewportSize({width:390,height:844}); await page.locator('dialog[open]').waitFor(); await page.screenshot({path:`${output}/gelexy-mobile-services.png`});
  console.log('PASS Gelexy actual API snapshot: five services, saved owner, truthful empty sections, desktop catalogue and mobile sheet');
 }
 assert.deepEqual(errors,[]); console.log('PASS deep links, back/forward, 1024px breakpoint and no page errors');
} finally { await browser.close(); await server.close(); }
