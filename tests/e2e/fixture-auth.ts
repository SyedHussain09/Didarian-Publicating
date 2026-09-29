import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

// Controlled password fixtures exercise portal workflows, not Google OAuth.
// No service-role key, browser account, or production user credential is used.
export async function signInFixture(
  page: Page,
  account: { email: string; password: string },
  role: 'author' | 'admin',
) {
  if (!process.env.DIDARIAN_E2E_USERS_FILE)
    throw new Error('Controlled fixture credentials must be explicitly supplied.');
  const publicEnv = await readFile('.env.local', 'utf8').catch(() => '');
  const value = (name: string) =>
    process.env[name] || publicEnv.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
  const url = value('VITE_SUPABASE_URL');
  const key = value('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key || key.startsWith('sb_secret_'))
    throw new Error('Public Supabase configuration is required for controlled fixtures.');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(account);
  if (error || !data.session) throw new Error('The controlled fixture could not sign in.');
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  await page.addInitScript(
    ({ origin, storageKey, session }) => {
      if (location.origin !== origin || sessionStorage.getItem('fixture-installed')) return;
      localStorage.setItem(storageKey, JSON.stringify(session));
      sessionStorage.setItem('fixture-installed', 'true');
    },
    {
      origin,
      storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
      session: data.session,
    },
  );
  await page.goto('/login');
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
}
