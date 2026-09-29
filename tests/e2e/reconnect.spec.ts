import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signInFixture } from './fixture-auth';

test.use({ trace: 'off' });
test('author recovers a changed review status after offline, reconnect and focus', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const filename = process.env.DIDARIAN_E2E_USERS_FILE;
  const submissionId = process.env.DIDARIAN_RECONNECT_SUBMISSION_ID;
  test.skip(
    !filename || !submissionId,
    'Supply controlled accounts and an explicitly identified authorA reviewable fixture.',
  );
  const fixture = JSON.parse(await readFile(filename!, 'utf8')) as {
    users: { label: string; email: string; password: string }[];
  };
  const options = {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
  };
  const authorContext = await browser.newContext(options);
  const adminContext = await browser.newContext(options);
  const author = await authorContext.newPage();
  const admin = await adminContext.newPage();
  for (const page of [author, admin]) page.setDefaultTimeout(15_000);
  try {
    for (const [page, label, portal] of [
      [author, 'authorA', 'author'],
      [admin, 'admin', 'admin'],
    ] as const) {
      const account = fixture.users.find((user) => user.label === label)!;
      await signInFixture(page, account, portal);
      await expect(page).toHaveURL(new RegExp(`/${portal}$`));
      await page.goto(`/${portal}/submissions/${submissionId}`);
      await expect(
        page.getByRole('heading', {
          name: portal === 'author' ? 'Submission Details' : 'Manuscript Review',
        }),
      ).toBeVisible();
    }
    await expect(admin.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(
      admin.getByText(/^(Submitted \/ In process|Under review)$/, { exact: true }).first(),
    ).toBeVisible();
    const canStartReview = await admin
      .getByRole('button', { name: 'Start Review', exact: true })
      .isVisible();
    await expect(
      author
        .getByText(canStartReview ? 'Submitted / In process' : 'Under review', { exact: true })
        .first(),
    ).toBeVisible();
    await authorContext.setOffline(true);
    expect(await author.evaluate(() => navigator.onLine)).toBe(false);
    let expectedStatus: 'under_review' | 'rejected';
    let expectedLabel: string;
    if (canStartReview) {
      expectedStatus = 'under_review';
      expectedLabel = 'Under review';
      await admin.getByRole('button', { name: 'Start Review', exact: true }).click();
    } else {
      expectedStatus = 'rejected';
      expectedLabel = 'Rejected';
      await admin
        .getByLabel('Feedback visible to the author')
        .fill('Controlled development decision for offline reconnect verification.');
      await admin.getByRole('button', { name: 'Reject', exact: true }).click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: 'Confirm decision', exact: true })
        .click();
      await expect(admin.getByRole('dialog')).not.toBeVisible();
    }
    await expect(admin.getByText(expectedLabel, { exact: true }).first()).toBeVisible();
    const authoritativeRefresh = author.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.pathname === '/rest/v1/submissions' &&
          url.searchParams.get('id') === `eq.${submissionId}` &&
          response.request().method() === 'GET' &&
          response.status() === 200
        );
      },
      { timeout: 45_000 },
    );
    await authorContext.setOffline(false);
    await author.bringToFront();
    expect(await author.evaluate(() => navigator.onLine)).toBe(true);
    const data = (await (await authoritativeRefresh).json()) as
      { id: string; status: string }[] | { id: string; status: string };
    const current = Array.isArray(data) ? data[0] : data;
    expect(current.id).toBe(submissionId);
    expect(current.status).toBe(expectedStatus);
    await expect(author.getByText(expectedLabel, { exact: true }).first()).toBeVisible({
      timeout: 45_000,
    });
    await author.reload();
    await expect(author.getByText(expectedLabel, { exact: true }).first()).toBeVisible();
    await writeFile(
      path.resolve('docs/evidence/browser-reconnect.json'),
      JSON.stringify(
        {
          submissionId,
          verifiedStatus: expectedStatus,
          checks: [
            'Author browser went offline',
            'Separate current administrator changed server review state',
            'Reconnect and focus triggered an authoritative authenticated data read',
            'Author UI converged and fresh page load retained the updated state',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await authorContext.setOffline(false);
    await Promise.all([authorContext.close(), adminContext.close()]);
  }
});
