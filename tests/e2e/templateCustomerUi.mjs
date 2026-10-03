import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const server = await createServer({ server: { host: '127.0.0.1', port: 4192 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH, args: ['--no-sandbox', '--no-zygote', '--single-process', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
const output = process.env.TEMPLATE_UI_SCREENSHOTS || '/tmp/template-customer-ui';
await mkdir(output, { recursive: true });
try {
  await page.goto('http://127.0.0.1:4192/templates/barber/preview');
  await page.locator('[data-salon-canvas]').waitFor();
  const ids = await page.evaluate(async () => (await import('/src/data/templates.ts')).TEMPLATE_REGISTRY.map(t => t.id));
  for (const id of ids) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:4192/templates/${id}/preview`);
    await page.locator('[data-salon-canvas]').waitFor();
    await page.getByRole('button', { name: 'Packages', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Signature Duo', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Book package', exact: true }).count(), 2);
    const size = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(size.scroll <= size.width + 1, `${id}: package dialog has no horizontal overflow`);
    await dialog.getByRole('button', { name: 'Rewards', exact: true }).click();
    await dialog.getByText('Current points', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log(`PASS ${id}: packages, rewards, Escape close and mobile width`);
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4192/templates/luxury_hair_salon/preview');
    await page.getByRole('button', { name: 'Search salons & services', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Make time for yourself').waitFor();
    const size = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(size.scroll <= size.width + 1, `discovery at ${width}: no horizontal overflow`);
    await page.screenshot({ path: `${output}/vip-discovery-${width}.png` });
    await dialog.getByRole('button', { name: 'Profile', exact: true }).click();
    await dialog.getByText('Your profile', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/vip-profile-${width}.png` });
    await page.keyboard.press('Escape');
    console.log(`PASS VIP discovery/profile at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4192/templates/hair_salon/preview');
  await page.getByRole('button', { name: 'Packages', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Book package', exact: true }).first().click();
  assert.equal(await dialog.locator('input[type=checkbox]:checked').count(), 2);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: '10:00', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('Phone', { exact: true }).fill('9876543210');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('Coupon', { exact: true }).fill('PREVIEW10');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.screenshot({ path: `${output}/booking-summary-390.png` });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: /^Simulate payment/ }).click();
  await dialog.getByText('Sample booking confirmed', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/booking-confirmed-390.png` });
  assert.deepEqual(errors, []);
  console.log('PASS booking preview and no browser page errors');
} finally {
  await browser.close();
  await server.close();
}
