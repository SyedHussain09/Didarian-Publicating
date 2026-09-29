import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.generated';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const siteUrl = (import.meta.env.VITE_SITE_URL?.trim() || window.location.origin).replace(
  /\/$/,
  '',
);
let client: SupabaseClient<Database> | undefined;
export function getSupabaseError(): string | null {
  if (!url || !key)
    return 'Backend setup is incomplete. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rebuild the application.';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))
      return 'The Supabase URL must use HTTPS.';
    if (key.startsWith('sb_secret_'))
      return 'A backend secret was supplied as a public key. Remove it and use a Supabase publishable key.';
    if (key.startsWith('eyJ')) {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
        role?: string;
      };
      if (payload.role !== 'anon')
        return 'Only a publishable key or legacy anonymous key may be used in this browser application.';
    }
    return null;
  } catch {
    return 'Invalid Supabase environment configuration. Check the project URL and publishable key.';
  }
}
export function getSupabase(): SupabaseClient<Database> {
  const error = getSupabaseError();
  if (error) throw new Error(error);
  client ??= createClient<Database>(url!, key!, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}
export async function isGoogleSignInEnabled(): Promise<boolean> {
  const error = getSupabaseError();
  if (error) throw new Error(error);
  try {
    const response = await fetch(url!.replace(/\/$/, '') + '/auth/v1/settings', {
      headers: { apikey: key! },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Auth is unavailable');
    const settings: { external?: { google?: boolean } } = await response.json();
    return settings.external?.google === true;
  } catch {
    throw new Error('We could not connect to sign-in. Check your connection and try again.');
  }
}
export function storageUploadEndpoint(): string {
  const parsed = new URL(url!);
  if (parsed.hostname.endsWith('.supabase.co'))
    parsed.hostname = parsed.hostname.replace('.supabase.co', '.storage.supabase.co');
  // Signed upload reservations use the signed TUS endpoint, not the JWT/RLS endpoint.
  return `${parsed.origin}/storage/v1/upload/resumable/sign`;
}
