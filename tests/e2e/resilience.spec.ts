import { expect, test } from '@playwright/test';
import { signInFixture as login } from './fixture-auth';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off' });
type Account = { label: string; email: string; password: string };
async function accounts() {
  const filename = process.env.DIDARIAN_E2E_USERS_FILE;
  test.skip(!filename, 'Requires explicitly supplied controlled development fixture accounts.');
  return (JSON.parse(await readFile(filename!, 'utf8')) as { users: Account[] }).users;
}

test('cancelled upload retains a real private draft and retry verifies stored bytes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const users = await accounts();
  await login(
    page,
    users.find((user) => user.label === 'authorA')!,
    'author',
  );
  const title = `E2E Cancel and retry ${randomUUID().slice(0, 8)}`;
  await page.goto('/author/submissions/new');
  await page.getByLabel('Paper title', { exact: true }).fill(title);
  await page
    .getByLabel('Abstract', { exact: true })
    .fill(
      'Controlled development manuscript for verifying cancellation and retry. No manuscript should be marked ready until the real bytes have been uploaded and verified.',
    );
  await page.getByRole('combobox', { name: /Category/ }).selectOption('Engineering');
  await page
    .getByLabel(/Manuscript \(PDF, DOC, DOCX\)/)
    .setInputFiles('public/resources/Didarian_Research_Template.docx');
  await page.getByRole('checkbox').check();
  let releaseRequest: () => void = () => undefined;
  let markIntercepted: () => void = () => undefined;
  const uploadIntercepted = new Promise<void>((resolve) => {
    markIntercepted = resolve;
  });
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  // Real Auth, metadata RPCs and upload preparation remain live. Only the file
  // transport is held to deterministically exercise the user's Cancel action.
  await page.route('**/storage/v1/upload/resumable/sign', async (route) => {
    markIntercepted();
    await heldRequest;
    await route.abort('aborted').catch(() => undefined);
  });
  const draftResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/rest/v1/rpc/save_draft') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Upload Paper / Save Draft', exact: true }).click();
  const draft = (await (await draftResponse).json()) as { id: string };
  await writeFile(
    path.resolve('docs/evidence/browser-retry.json'),
    JSON.stringify({ title, submissionId: draft.id, verified: false }, null, 2),
  );
  await uploadIntercepted;
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  releaseRequest();
  await expect(page.getByRole('alert')).toContainText('Upload cancelled');
  await expect(page.getByLabel('Paper title', { exact: true })).toHaveValue(title);
  await expect(page.getByText(/File verified/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/author\/submissions\/new$/);
  await page.unroute('**/storage/v1/upload/resumable/sign');
  await page.getByRole('button', { name: 'Upload Paper / Save Draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/author/submissions/${draft.id}$`), { timeout: 45_000 });
  await expect(page.getByText(/File verified/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/File verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for Review', exact: true })).toBeEnabled();
  await writeFile(
    path.resolve('docs/evidence/browser-retry.json'),
    JSON.stringify(
      {
        title,
        submissionId: draft.id,
        verified: true,
        checks: [
          'User cancellation retains typed metadata and real private draft',
          'No false file-ready status after cancellation',
          'Retry stores and verifies a real DOCX file',
          'Saved verified state survives refresh',
        ],
      },
      null,
      2,
    ),
  );
});

test('public contact persists to the real protected admin inbox', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const users = await accounts();
  const name = `E2E Contact ${randomUUID().slice(0, 8)}`;
  await page.goto('/contact');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill('browser-contact@example.invalid');
  await page
    .getByLabel('Message', { exact: true })
    .fill(
      'Controlled development browser contact message. Confirm persistence and admin handling, then remove this test fixture.',
    );
  const response = page.waitForResponse(
    (result) =>
      result.url().includes('/functions/v1/contact') && result.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send Message', exact: true }).click();
  const result = await response;
  expect(
    result.status(),
    'The real endpoint must accept and store this controlled contact message',
  ).toBe(201);
  const data = (await result.json()) as { ok: boolean; id: string };
  expect(data.ok).toBe(true);
  await writeFile(
    path.resolve('docs/evidence/browser-contact.json'),
    JSON.stringify({ name, contactId: data.id, handled: false }, null, 2),
  );
  await expect(page.getByRole('status')).toContainText(
    'saved to the Didarian Publicating admin inbox',
  );
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
  });
  try {
    const admin = await context.newPage();
    admin.setDefaultTimeout(15_000);
    await login(
      admin,
      users.find((user) => user.label === 'admin')!,
      'admin',
    );
    await admin.goto('/admin/messages');
    const message = admin.getByRole('article').filter({ hasText: name });
    await expect(message).toBeVisible();
    await message.locator('summary').click();
    await message.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(message.getByText('read', { exact: true })).toBeVisible();
    await message.getByRole('button', { name: 'Mark handled', exact: true }).click();
    await expect(message.getByText('handled', { exact: true })).toBeVisible();
    await admin.reload();
    await expect(
      admin.getByRole('article').filter({ hasText: name }).getByText('handled', { exact: true }),
    ).toBeVisible();
    await writeFile(
      path.resolve('docs/evidence/browser-contact.json'),
      JSON.stringify(
        {
          name,
          contactId: data.id,
          handled: true,
          checks: [
            'Anonymous contact persisted through rate-limited endpoint',
            'Verified administrator reads message and updates handling state',
            'Handled state survives refresh',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
