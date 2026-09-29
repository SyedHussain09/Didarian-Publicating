import { expect, test } from '@playwright/test';

test('anonymous direct links cannot open either private portal', async ({ page }) => {
  for (const path of ['/author', '/author/submissions/new', '/admin', '/admin/messages']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Author Portal', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard', exact: true })).toHaveCount(
      0,
    );
  }
});

test('registration and sign in provide no public role selector', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(
    page.getByText('New accounts receive author access.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.goto('/login');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('old email-auth routes use the Google sign-in screen', async ({ page }) => {
  for (const route of ['/forgot-password', '/resend-confirmation', '/reset-password']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
});

test('navigation preserves browser back and forward history', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'Articles', exact: true })
    .click();
  await expect(page).toHaveURL(/\/articles$/);
  await page.getByRole('link', { name: 'Contact Us', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/articles$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/articles$/);
});

test('legacy protected hashes enter the auth guard and callback errors take priority', async ({
  page,
}) => {
  await page.goto('/#admin-portal');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto('/auth/callback?error=access_denied#error=expired_token');
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled');
  await expect(page.getByRole('link', { name: 'Back to Sign In' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/callback$/);
});

test('mobile navigation works by keyboard and Escape restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.getByRole('link', { name: 'Contact Us', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contact Us' })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('form fields retain a native cursor and visible labels', async ({ page }) => {
  await page.goto('/contact');
  const field = page.getByLabel('Name', { exact: true });
  await field.hover();
  expect(await field.evaluate((element) => getComputedStyle(element).cursor)).not.toBe('none');
  await field.fill('Visitor');
  await expect(field).toHaveValue('Visitor');
});
