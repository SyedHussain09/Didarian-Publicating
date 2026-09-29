import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('Netlify production serves secure deep links, exact resources and responsive pages', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.E2E_BASE_URL !== 'https://didarian-publicating.netlify.app',
    'This acceptance check targets the explicitly deployed Netlify site.',
  );
  const checks: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of [
    '/',
    '/register',
    '/admin',
    '/articles/not-a-real-article',
    '/auth/callback',
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
  }
  checks.push('HTTPS root and four deep links serve the SPA with HTTP 200');
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain('https://ygcporcsudpjfltanqpj.supabase.co');
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
  checks.push('Netlify applies the intended CSP, nosniff, frame and HTTPS headers');
  const document = await response.text();
  const entry = document.match(/<script[^>]+src="([^"]+)"/)?.[1];
  expect(entry).toBeTruthy();
  const script = await request.get(entry!);
  expect(script.status()).toBe(200);
  expect(script.headers()['cache-control']).toContain('immutable');
  expect(await script.text()).toContain('https://didarian-publicating.netlify.app');
  checks.push('Production JavaScript exists, caches immutably and uses the canonical site URL');
  const template = await request.get('/resources/Didarian_Research_Template.doc');
  expect(template.status()).toBe(200);
  expect(template.headers()['content-type']).toContain('application/msword');
  const downloaded = await template.body();
  const local = await readFile('public/resources/Didarian_Research_Template.doc');
  expect(downloaded.equals(local)).toBe(true);
  checks.push('Netlify serves exact genuine Word bytes without the SPA rewrite replacing the file');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Research, open to everyone.' })).toBeVisible();
  await expect(page.getByText('Loading published articles…')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: `docs/evidence/netlify-home-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
  checks.push('Live desktop/mobile layouts fit, with no JavaScript page errors');
  await writeFile(
    'docs/evidence/netlify-verification.json',
    JSON.stringify(
      {
        url: process.env.E2E_BASE_URL,
        verifiedAt: new Date().toISOString(),
        checks,
        templateSha256: createHash('sha256').update(downloaded).digest('hex'),
        securityHeaders: {
          csp: headers['content-security-policy'],
          contentTypeOptions: headers['x-content-type-options'],
          frameOptions: headers['x-frame-options'],
          hsts: headers['strict-transport-security'],
        },
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
});
