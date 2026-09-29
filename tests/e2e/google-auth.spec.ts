import { expect, test, type Page } from '@playwright/test';

test.use({ trace: 'off' });
const auth = '**/auth/v1/';

async function googleEnabled(page: Page) {
  await page.route(auth + 'settings', (route) =>
    route.fulfill({ json: { external: { google: true } } }),
  );
}

test('Google sign-in starts with PKCE and the exact application callback', async ({ page }) => {
  await googleEnabled(page);
  let authorization: URL | undefined;
  await page.route(auth + 'authorize?**', async (route) => {
    authorization = new URL(route.request().url());
    await route.fulfill({
      contentType: 'text/html',
      body: '<h1>Controlled Google authorization boundary</h1>',
    });
  });
  await page.goto('/register');
  const expectedOrigin = process.env.E2E_EXPECTED_SITE_URL || new URL(page.url()).origin;
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(
    page.getByRole('heading', { name: 'Controlled Google authorization boundary' }),
  ).toBeVisible();
  expect(authorization?.searchParams.get('provider')).toBe('google');
  expect(authorization?.searchParams.get('redirect_to')).toBe(expectedOrigin + '/auth/callback');
  expect(authorization?.searchParams.get('code_challenge_method')).toBe('s256');
  expect(authorization?.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  expect(authorization?.searchParams.get('prompt')).toBe('select_account');
  expect(authorization?.searchParams.get('scopes')).toBe('openid email profile');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test('an unconfigured provider stays on a usable sign-in page', async ({ page }) => {
  let attempts = 0;
  await page.route(auth + 'settings', (route) =>
    route.fulfill({ json: { external: { google: false } } }),
  );
  await page.route(auth + 'authorize?**', (route) => {
    attempts++;
    return route.abort();
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toContainText('Google sign-in is temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(attempts).toBe(0);
});

test('network failure can be retried without a duplicate request', async ({ page }) => {
  let attempts = 0;
  await page.route(auth + 'settings', async (route) => {
    attempts++;
    await route.abort('internetdisconnected');
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(attempts).toBe(1);
});

test('cancelled and invalid callbacks expose no private page or provider details', async ({
  page,
}) => {
  await page.goto('/auth/callback?error=access_denied&error_description=private-provider-detail');
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled');
  await expect(page.getByText('private-provider-detail')).toHaveCount(0);
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await page.goto('/auth/callback?error=server_error&error_description=private-provider-detail');
  await expect(page.getByRole('alert')).toContainText('Google sign-in could not be completed');
  await expect(page.getByRole('link', { name: 'Back to Sign In' })).toBeVisible();
});

test('a callback with no valid session offers a fresh Google sign-in', async ({ page }) => {
  await page.goto('/auth/callback');
  await expect(page.getByRole('alert')).toContainText('No sign-in session');
  await expect(page.getByRole('link', { name: 'Back to Sign In' })).toBeVisible();
});

for (const role of ['author', 'admin'] as const) {
  test(
    'controlled OAuth callback verifies the stored ' + role + ' role and restores navigation',
    async ({ page }) => {
      await googleEnabled(page);
      const id = '11111111-1111-4111-8111-111111111111';
      const user = {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'controlled-oauth@example.invalid',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'google', providers: ['google'] },
        user_metadata: { name: 'Test Reader', role: 'admin' },
        created_at: new Date().toISOString(),
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      // This deliberately invalid signature is used only in intercepted browser responses.
      const token =
        encode({ alg: 'HS256', typ: 'JWT' }) +
        '.' +
        encode({
          sub: id,
          role: 'authenticated',
          aud: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }) +
        '.controlled-test-signature';
      let exchanges = 0;
      let origin = '';
      await page.route(auth + 'authorize?**', (route) =>
        route.fulfill({
          status: 302,
          headers: { location: origin + '/auth/callback?code=controlled-test-code' },
          body: '',
        }),
      );
      await page.route(auth + 'token?**', async (route) => {
        exchanges++;
        expect(route.request().postDataJSON().auth_code).toBe('controlled-test-code');
        expect(route.request().postDataJSON().code_verifier).toBeTruthy();
        await route.fulfill({
          json: {
            access_token: token,
            refresh_token: 'controlled-test-refresh',
            token_type: 'bearer',
            expires_in: 3600,
            user,
          },
        });
      });
      await page.route(auth + 'user', (route) => route.fulfill({ json: user }));
      await page.route('**/rest/v1/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        let data: unknown = path.endsWith('/rpc/my_role')
          ? role
          : path.endsWith('/profiles')
            ? { id, first_name: 'Test', last_name: 'Reader', affiliation: null }
            : [];
        if (path.endsWith('/notifications'))
          data = Array.from({ length: 5 }, (_, index) => ({
            id: `note-${index}`,
            submission_id: id,
            message: `Sample notification ${index + 1}`,
            read_at: null,
            created_at: user.created_at,
          }));
        if (path.endsWith('/contact_messages'))
          data = [1, 2].map((index) => ({
            id: `message-${index}`,
            name: `Example Sender ${index}`,
            email: 'sample@example.invalid',
            message: `Browser-only sample message ${index}.`,
            state: 'new',
            created_at: user.created_at,
          }));
        return route.fulfill({
          json: data,
          headers: {
            'access-control-expose-headers': 'content-range',
            'content-range': path.endsWith('/contact_messages') ? '0-1/2' : '0-0/0',
          },
        });
      });
      await page.route('**/functions/v1/**', (route) => route.abort());
      await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
      await page.goto('/login?next=%2Fadmin%2Fmessages');
      origin = new URL(page.url()).origin;
      await page.getByRole('button', { name: 'Continue with Google' }).click();
      await expect(page).toHaveURL(role === 'author' ? /\/author$/ : /\/admin\/messages$/);
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      expect(exchanges).toBe(1);
      expect(
        await page.evaluate(() => sessionStorage.getItem('didarian:google-return-path')),
      ).toBeNull();
      if (role === 'author') {
        await expect(page.getByText('Sample notification 1', { exact: true })).toBeVisible();
        const pagination = page.getByRole('navigation', { name: 'Pagination', exact: true });
        await pagination.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(page.getByText('Sample notification 5', { exact: true })).toBeVisible();
        await expect(page.getByText('Sample notification 1', { exact: true })).toHaveCount(0);
      } else {
        const first = page.getByRole('article').filter({ hasText: 'Example Sender 1' });
        const second = page.getByRole('article').filter({ hasText: 'Example Sender 2' });
        await expect(first.getByText('Browser-only sample message 1.')).toBeHidden();
        await first.locator('summary').click();
        await expect(first.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
        await second.locator('summary').click();
        await expect(second.getByText('Browser-only sample message 2.')).toBeVisible();
        await expect(first.getByText('Browser-only sample message 1.')).toBeHidden();
      }
    },
  );
}

test('Google entry fits mobile and desktop without layout overflow', async ({ page }) => {
  await page.goto('/register');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: 'docs/evidence/google-sign-in-' + width + '.png',
      fullPage: true,
    });
  }
});
