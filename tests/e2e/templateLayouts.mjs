import assert from 'node:assert/strict';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const server = await createServer({ server: { host: '127.0.0.1', port: 4193 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH, args: ['--no-sandbox', '--no-zygote', '--single-process', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4193/templates/barber/preview');
  const ids = await page.evaluate(async () => (await import('/src/data/templates.ts')).TEMPLATE_REGISTRY.map(t => t.id));
  assert.equal(ids.length, 28);
  for (const id of ids) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:4193/templates/${id}/preview`);
    await page.locator('.template-gallery-grid > div').first().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-salon-canvas]').clientWidth >= 768);
    const gallery = page.locator('.template-gallery-grid > div').first();
    await page.waitForFunction(() => { const el = document.querySelector('.template-gallery-grid > div'); const style = getComputedStyle(el); return style.aspectRatio === style.getPropertyValue('--template-gallery-ratio').trim(); });
    const desktop = await gallery.evaluate(el => {
      const box = el.getBoundingClientRect(), photo = el.querySelector('img').getBoundingClientRect();
      return { expected: getComputedStyle(el).getPropertyValue('--template-gallery-ratio').trim(), actual: getComputedStyle(el).aspectRatio, height: box.height, imageHeight: photo.height };
    });
    assert.equal(desktop.actual, desktop.expected, `${id}: gallery tile uses design ratio`);
    assert.ok(Math.abs(desktop.height - desktop.imageHeight) <= 2, `${id}: photo fills tile without a blank strip`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.template-gallery-grid > div')).aspectRatio === '4 / 3');
    assert.equal(await gallery.evaluate(el => getComputedStyle(el).aspectRatio), '4 / 3', `${id}: mobile gallery keeps readable tiles`);
    console.log(`PASS ${id}: desktop gallery ratio, full image coverage and mobile tiles`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
