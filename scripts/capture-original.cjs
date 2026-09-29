// Evidence capture only. The supplied HTML remains untouched.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const packageRoot = process.env.CODEX_BUNDLED_NODE_MODULES;
if (!packageRoot)
  throw new Error('Set CODEX_BUNDLED_NODE_MODULES to the dependency-loader Node packages path.');
const { chromium } = createRequire(path.join(packageRoot, 'playwright', 'package.json'))(
  'playwright',
);

(async () => {
  const out = path.resolve('docs/evidence/original');
  fs.mkdirSync(out, { recursive: true });
  const source = path.resolve('didarian_publicating (1).html');
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const report = { capturedAt: new Date().toISOString(), source, pages: [] };
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        deviceScaleFactor: 1,
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push({ type: 'pageerror', text: e.message }));
      page.on('console', (e) => {
        if (['error', 'warning'].includes(e.type()))
          errors.push({ type: e.type(), text: e.text() });
      });
      page.on('requestfailed', (request) =>
        errors.push({
          type: 'requestfailed',
          url: request.url(),
          text: request.failure()?.errorText,
        }),
      );
      await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      for (const section of [
        'home',
        'articles',
        'author-portal',
        'admin-portal',
        'register',
        'contact',
      ]) {
        await page.evaluate((id) => window.navigateTo(id), section);
        await page.waitForTimeout(450);
        await page.screenshot({ path: path.join(out, `${section}-${width}.png`), fullPage: true });
        report.pages.push({
          width,
          section,
          path: `docs/evidence/original/${section}-${width}.png`,
          metrics: await page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            activeSection: document.querySelector('.page-section.active')?.id,
            nativeCursor: getComputedStyle(document.body).cursor,
          })),
        });
      }
      report.pages.push({ width, errors });
      await page.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'capture-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(`Captured ${report.pages.filter((x) => x.section).length} original screenshots.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
