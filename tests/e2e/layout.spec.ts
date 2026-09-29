import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { signInFixture } from './fixture-auth';

// Real sessions are used when controlled fixture credentials are supplied.
// Never record traces/HARs containing Auth response tokens or private credentials.
test.use({ trace: 'off' });
const widths = [360, 390, 768, 1024, 1440];
const publicRoutes = [
  ['/', 'home', 'Research,'],
  ['/articles', 'articles', 'Articles'],
  ['/about', 'about', 'Publish with Didarian'],
  ['/editorial', 'editorial', 'Editorial Board'],
  ['/privacy', 'privacy', 'Privacy Policy'],
  ['/contact', 'contact', 'Contact Us'],
  ['/login', 'login', 'Welcome Back'],
  ['/register', 'register', 'Create Account'],
  ['/forgot-password', 'forgot-password', 'Welcome Back'],
] as const;

async function captureLayout(page: Page, label: string, width: number, testInfo: TestInfo) {
  await expect(page.getByRole('main')).toBeVisible();
  // A full-page screenshot taken while scrolled places fixed/sticky UI midway
  // through the output. Return to the top for faithful document captures.
  if (!label.includes('dialog')) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      contentWidth: document.getElementById('main-content')?.scrollWidth,
      nativeCursor: getComputedStyle(document.body).cursor,
      domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
      loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
    };
  });
  expect(
    metrics.documentWidth,
    `${label} at ${width}px has page-level overflow`,
  ).toBeLessThanOrEqual(width + 1);
  expect(
    metrics.contentWidth,
    `${label} must capture loaded content, not a hidden suspense tree`,
  ).toBeGreaterThan(0);
  const directory = path.resolve('docs/evidence/layout');
  await mkdir(directory, { recursive: true });
  const screenshot = path.join(directory, `${label}-${width}.png`);
  // Keep orbit animations active: disabling infinite CSS animations collapses
  // the three pills onto their shared origin and misrepresents the live design.
  await page.screenshot({ path: screenshot, fullPage: !label.includes('dialog') });
  await testInfo.attach(`${label}-${width}`, { path: screenshot, contentType: 'image/png' });
  return { label, width, ...metrics };
}

for (const width of widths) {
  test(`public pages fit ${width}px without horizontal overflow`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const browserErrors: string[] = [];
    const failedRequests: { origin: string; failure: string | null }[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED')
        failedRequests.push({
          origin: new URL(request.url()).origin,
          failure: request.failure()?.errorText || null,
        });
    });
    const measurements = [];
    for (const [route, label, title] of publicRoutes) {
      await page.goto(route);
      await expect(
        page.getByRole('heading', { name: new RegExp(`^${title}`) }).first(),
      ).toBeVisible();
      if (route === '/articles') {
        await expect(page.getByText('Loading published articles…')).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      }
      measurements.push(await captureLayout(page, label, width, testInfo));
      const menu = page.getByRole('button', { name: 'Open menu' });
      if (width < 1280) await expect(menu).toBeVisible();
      else await expect(menu).toBeHidden();
    }
    await writeFile(
      path.resolve(`docs/evidence/layout/public-${width}.json`),
      JSON.stringify(
        { measuredAt: new Date().toISOString(), measurements, browserErrors, failedRequests },
        null,
        2,
      ),
    );
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}

interface FixtureAccount {
  email: string;
  password: string;
}
interface LayoutFixtures {
  author: FixtureAccount;
  admin: FixtureAccount;
  authorSubmissionId?: string;
  adminSubmissionId?: string;
}

async function fixtures(): Promise<LayoutFixtures | null> {
  if (!process.env.DIDARIAN_E2E_USERS_FILE) return null;
  const input = JSON.parse(
    await readFile(process.env.DIDARIAN_E2E_USERS_FILE, 'utf8'),
  ) as LayoutFixtures & {
    users?: (FixtureAccount & { label: string })[];
    submissionIds?: string[];
  };
  if (input.users)
    return {
      author: input.users.find((user) => user.label === 'authorA')!,
      admin: input.users.find((user) => user.label === 'admin')!,
      authorSubmissionId: input.authorSubmissionId,
      adminSubmissionId: input.adminSubmissionId,
    };
  return input;
}

for (const role of ['author', 'admin'] as const) {
  test(`${role} portal, form and details fit all required widths with a real session`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const users = await fixtures();
    test.skip(
      !users,
      'Requires controlled real fixture account JSON in DIDARIAN_E2E_USERS_FILE; no mocked authorization.',
    );
    const account = users![role];
    if (!account?.email || !account.password)
      throw new Error(`Missing controlled ${role} fixture credentials.`);
    await signInFixture(page, account, role);
    await expect(page).toHaveURL(new RegExp(`/${role}$`));
    const routes =
      role === 'author'
        ? [
            [`/author`, 'author-portal', 'Author Portal'],
            ['/author/submissions/new', 'author-new', 'New Submission'],
          ]
        : [
            [`/admin`, 'admin-portal', 'Admin Dashboard'],
            ['/admin/articles/new', 'admin-new', 'Create Article'],
            ['/admin/messages', 'admin-messages', 'Contact Messages'],
          ];
    await expect(
      page
        .getByRole('main')
        .getByRole('status')
        .filter({ hasText: /loading|checking/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        name: role === 'author' ? 'Author Portal' : 'Admin Dashboard',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('main')
        .getByRole('status')
        .filter({ hasText: /loading|checking/i }),
    ).toHaveCount(0);
    const reviewLink = page
      .getByRole('main')
      .getByRole('link', { name: 'Review', exact: true })
      .first();
    const firstDetail =
      role === 'admin' && (await reviewLink.count())
        ? reviewLink
        : page
            .getByRole('main')
            .locator(`a[href^="/${role}/submissions/"]:not([href$="/new"])`)
            .first();
    const discoveredPath = (await firstDetail.count())
      ? await firstDetail.getAttribute('href')
      : null;
    const submissionId =
      (role === 'author' ? users!.authorSubmissionId : users!.adminSubmissionId) ||
      discoveredPath?.split('/').pop();
    if (submissionId)
      routes.push([
        `/${role}/submissions/${submissionId}`,
        `${role}-detail`,
        role === 'admin' ? 'Manuscript Review' : 'Submission Details',
      ]);
    const measurements = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const [route, label, title] of routes) {
        await page.goto(route);
        await expect(
          page.getByRole('main').getByRole('heading', { name: title, exact: true }),
        ).toBeVisible();
        await expect(page).not.toHaveURL(/\/login/);
        await expect(
          page
            .getByRole('main')
            .getByRole('status')
            .filter({ hasText: /loading|checking/i }),
        ).toHaveCount(0);
        await expect(page.getByRole('main').getByText('…', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
        measurements.push(await captureLayout(page, label, width, testInfo));
        if (label.endsWith('-detail')) {
          const action = page.getByRole('button', {
            name: role === 'admin' ? 'Accept & Publish' : 'Submit for Review',
            exact: true,
          });
          if ((await action.count()) && (await action.isEnabled())) {
            await action.click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            const bounds = await dialog.boundingBox();
            expect(bounds?.x).toBeGreaterThanOrEqual(0);
            expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(width + 1);
            measurements.push(
              await captureLayout(page, `${role}-decision-dialog`, width, testInfo),
            );
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(action).toBeFocused();
          }
        }
      }
    }
    await writeFile(
      path.resolve(`docs/evidence/layout/${role}.json`),
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          measurements,
          detailFixtureSupplied: Boolean(submissionId),
        },
        null,
        2,
      ),
    );
  });
}

test('author resource buttons download the actual verified Word and LaTeX files', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const users = await fixtures();
  test.skip(!users, 'Requires the real controlled author fixture.');
  await signInFixture(page, users!.author, 'author');
  await expect(page).toHaveURL(/\/author$/);
  const results = [];
  for (const [label, extension] of [
    ['Word', 'doc'],
    ['LaTeX', 'tex'],
  ]) {
    const filename = `Didarian_Research_Template.${extension}`;
    const downloading = page.waitForEvent('download');
    await page
      .getByRole('button', { name: new RegExp(`Download Template \\(${label}\\)`) })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
    const downloaded = path.resolve('docs/evidence/template', `downloaded-${filename}`);
    await download.saveAs(downloaded);
    const expectedBytes = await readFile(path.resolve('public/resources', filename));
    const actualBytes = await readFile(downloaded);
    expect(actualBytes.equals(expectedBytes)).toBe(true);
    if (extension === 'doc')
      expect(actualBytes.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    else expect(actualBytes.toString('utf8')).toContain('Template design in processing');
    results.push({
      filename,
      bytes: actualBytes.length,
      sha256: createHash('sha256').update(actualBytes).digest('hex'),
      matchesVerifiedOriginal: true,
    });
  }
  await writeFile(
    path.resolve('docs/evidence/template/browser-downloads.json'),
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
  );
});

test('real admin decision dialog fits every width and keeps keyboard focus safely', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const users = await fixtures();
  test.skip(
    !users?.adminSubmissionId,
    'Requires a retained submitted manuscript owned by the controlled author fixture.',
  );
  await signInFixture(page, users!.admin, 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/submissions/${users!.adminSubmissionId}`);
  await expect(page.getByRole('heading', { name: 'Manuscript Review', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByRole('status')
      .filter({ hasText: /loading|checking/i }),
  ).toHaveCount(0);
  const action = page.getByRole('button', { name: 'Accept & Publish', exact: true });
  await expect(action).toBeEnabled();
  const measurements = [];
  for (const width of widths) {
    const height = width < 768 ? 844 : 1000;
    await page.setViewportSize({ width, height });
    measurements.push(await captureLayout(page, 'admin-review-detail', width, testInfo));
    await action.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Confirm decision' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Confirm decision' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(width + 1);
    expect((bounds?.y || 0) + (bounds?.height || 0)).toBeLessThanOrEqual(height + 1);
    measurements.push(await captureLayout(page, 'admin-decision-dialog', width, testInfo));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(action).toBeFocused();
  }
  await writeFile(
    path.resolve('docs/evidence/layout/decision-dialog.json'),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        measurements,
        keyboardFocusCycle: 'Cancel → Confirm decision → Cancel',
        escapeRestoresFocus: true,
        mutationPerformed: false,
      },
      null,
      2,
    ),
  );
});
