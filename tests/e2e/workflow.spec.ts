import { expect, test } from '@playwright/test';
import { signInFixture as signIn } from './fixture-auth';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off' });
type Account = { label: string; email: string; password: string };

test('real author upload → review → atomic publication → anonymous download', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const filename = process.env.DIDARIAN_E2E_USERS_FILE;
  test.skip(
    !filename,
    'Set DIDARIAN_E2E_USERS_FILE to explicitly authorize use of controlled development accounts.',
  );
  const fixture = JSON.parse(await readFile(filename!, 'utf8')) as { users: Account[] };
  const authorAccount = fixture.users.find((user) => user.label === 'authorA');
  const adminAccount = fixture.users.find((user) => user.label === 'admin');
  if (!authorAccount || !adminAccount)
    throw new Error('The controlled authorA and admin fixtures are required.');
  const options = {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
  };
  const authorContext = await browser.newContext(options);
  const adminContext = await browser.newContext(options);
  const publicContext = await browser.newContext(options);
  const author = await authorContext.newPage();
  const admin = await adminContext.newPage();
  const visitor = await publicContext.newPage();
  for (const page of [author, admin, visitor]) page.setDefaultTimeout(15_000);
  const title = `E2E Browser publication ${randomUUID().slice(0, 8)}`;
  const record: {
    title: string;
    submissionId?: string;
    articleSlug?: string;
    checks: string[];
    completedAt?: string;
  } = { title, checks: [] };
  const evidencePath = path.resolve('docs/evidence/browser-workflow.json');
  const persist = async () => {
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(record, null, 2));
  };
  await persist();
  try {
    await signIn(author, authorAccount, 'author');
    const templatePromise = author.waitForEvent('download');
    await author.getByRole('button', { name: 'Download Template (Word)' }).click();
    const template = await templatePromise;
    expect(template.suggestedFilename()).toBe('Didarian_Research_Template.doc');
    const templateFile = testInfo.outputPath('downloaded-template.doc');
    await template.saveAs(templateFile);
    const templateBytes = await readFile(templateFile);
    expect(templateBytes.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    // Binary Word documents can store compressed single-byte or UTF-16 text runs.
    const sentence = 'Template design in processing';
    expect(
      templateBytes.includes(Buffer.from(sentence, 'latin1')) ||
        templateBytes.includes(Buffer.from(sentence, 'utf16le')),
      'The downloaded Word template must contain the exact required sentence',
    ).toBe(true);
    record.checks.push(
      'Authenticated Word template download: real DOC bytes and required sentence',
    );
    await persist();

    await author.getByRole('link', { name: 'New Submission', exact: true }).click();
    await author.getByLabel('Paper title', { exact: true }).fill(title);
    await author
      .getByLabel('Abstract', { exact: true })
      .fill(
        'This controlled development manuscript verifies the complete browser submission, protected review, atomic publication, and public download workflow. It is test content for removal after verification.',
      );
    await author.getByLabel('Author names for publication').fill('Development Test Author');
    await author.getByRole('combobox', { name: /Category/ }).selectOption('Engineering');
    await author.getByLabel(/Keywords/).fill('verification, browser');
    await author.getByLabel(/Manuscript \(PDF, DOC, DOCX\)/).setInputFiles(templateFile);
    await author.getByRole('checkbox').check();
    const draftResponse = author.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/rpc/save_draft') &&
        response.request().method() === 'POST',
    );
    await author.getByRole('button', { name: 'Upload Paper / Save Draft', exact: true }).click();
    const draft = (await (await draftResponse).json()) as { id?: string };
    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    record.submissionId = draft.id;
    await persist();
    await expect(author).toHaveURL(new RegExp(`/author/submissions/${draft.id}$`), {
      timeout: 45_000,
    });
    await expect(author.getByText(/File verified/)).toBeVisible();
    await expect(author.getByRole('main').getByRole('alert')).toHaveCount(0);
    record.checks.push(
      'Real immutable file uploaded, server verified, and draft metadata persisted',
    );
    await author.reload();
    await expect(author.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(author.getByText(/File verified/)).toBeVisible();
    await author.getByRole('button', { name: 'Submit for Review', exact: true }).click();
    const submitDialog = author.getByRole('dialog', { name: 'Submit for review?' });
    await expect(submitDialog).toBeVisible();
    await submitDialog.getByRole('button', { name: 'Confirm decision' }).click();
    await expect(submitDialog).not.toBeVisible();
    await expect(author.getByText('Submitted / In process', { exact: true }).first()).toBeVisible();
    await expect(author.getByLabel('Paper title', { exact: true })).toHaveCount(0);
    record.checks.push('Submission survives refresh and locks editing after review submission');
    await persist();

    await signIn(admin, adminAccount, 'admin');
    await admin.getByLabel('Search titles', { exact: true }).fill(title);
    await admin.getByRole('button', { name: 'Search', exact: true }).click();
    const row = admin.getByRole('row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Review' }).click();
    await expect(admin.getByRole('heading', { name: title })).toBeVisible();
    await admin.getByRole('button', { name: 'Start Review', exact: true }).click();
    await expect(admin.getByText('Under review', { exact: true }).first()).toBeVisible();
    await admin
      .getByLabel('Feedback visible to the author')
      .fill('Controlled development acceptance: browser workflow verified.');
    await admin.getByRole('button', { name: 'Accept & Publish', exact: true }).click();
    const publishDialog = admin.getByRole('dialog', { name: 'Publish this article?' });
    await expect(publishDialog).toBeVisible();
    await publishDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(publishDialog).not.toBeVisible();
    await expect(
      admin.getByRole('button', { name: 'Accept & Publish', exact: true }),
    ).toBeFocused();
    await admin.getByRole('button', { name: 'Accept & Publish', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Confirm decision' }).click();
    await expect(admin.getByRole('dialog')).not.toBeVisible();
    const publicLink = admin.getByRole('link', { name: 'View the public article' });
    await expect(publicLink).toBeVisible();
    const href = await publicLink.getAttribute('href');
    expect(href).toMatch(/^\/articles\/[a-z0-9-]+$/);
    record.articleSlug = href!.split('/').at(-1);
    record.checks.push(
      'Separate verified admin sees queue, starts review, confirms Accept & Publish',
    );
    await persist();

    // Author remains open; Realtime or the bounded polling fallback must converge.
    await expect(author.getByRole('link', { name: 'View the public article' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      author.getByText('Controlled development acceptance: browser workflow verified.').first(),
    ).toBeVisible();
    await author.reload();
    await expect(author.getByRole('link', { name: 'View the public article' })).toBeVisible();
    record.checks.push('Open author dashboard updates and published status persists after refresh');

    await visitor.goto(`/articles?q=${encodeURIComponent(title)}`);
    await expect(visitor.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await visitor.getByRole('heading', { name: title, exact: true }).click();
    await expect(visitor).toHaveURL(new RegExp(`/articles/${record.articleSlug}$`));
    await expect(visitor.getByText('Development Test Author', { exact: true })).toBeVisible();
    const publicationPromise = visitor.waitForEvent('download');
    await visitor.getByRole('button', { name: 'Download Article', exact: true }).click();
    const publication = await publicationPromise;
    const publishedFile = testInfo.outputPath('published-manuscript.doc');
    await publication.saveAs(publishedFile);
    expect(
      (await readFile(publishedFile)).equals(templateBytes),
      'Public download must match the exact verified manuscript bytes',
    ).toBe(true);
    record.checks.push(
      'Anonymous publication appears without rebuilding and downloads exact selected bytes',
    );
    await visitor.screenshot({ path: testInfo.outputPath('public-article.png'), fullPage: true });
    record.completedAt = new Date().toISOString();
    await persist();
  } finally {
    // Do not global-signout shared test identities while backend tests use them.
    await Promise.all([authorContext.close(), adminContext.close(), publicContext.close()]);
  }
});

test('real logout clears private pages across back navigation and refresh', async ({ page }) => {
  const filename = process.env.DIDARIAN_E2E_USERS_FILE;
  test.skip(!filename, 'Requires explicitly supplied controlled development fixture accounts.');
  const fixture = JSON.parse(await readFile(filename!, 'utf8')) as { users: Account[] };
  const author = fixture.users.find((user) => user.label === 'authorB');
  if (!author) throw new Error('Controlled authorB fixture is required.');
  await signIn(page, author, 'author');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Admin Dashboard', exact: true })).toHaveCount(0);
  await page.goto('/author/submissions/new');
  await expect(page.getByRole('heading', { name: 'New Submission' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Log Out', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Submission', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log Out', exact: true })).toHaveCount(0);
});
