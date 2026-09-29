// Trusted operator command using an existing real admin session, never a browser feature.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = process.env.SUPABASE_ADMIN_ACCESS_TOKEN;
  const origin = process.env.SUPABASE_OPERATOR_ORIGIN || 'http://localhost:5173';
  if (!url || !key || !token)
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and the existing admin session SUPABASE_ADMIN_ACCESS_TOKEN in this trusted terminal. No credential values are logged.',
    );
  const target = new URL(url);
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname))
    throw new Error('Use HTTPS outside local development.');
  if (target.username || target.password || target.search || target.hash || target.pathname !== '/')
    throw new Error('SUPABASE_URL must be a plain project origin.');
  const response = await fetch(new URL('/functions/v1/provision-resources', target.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${token}`,
      Origin: origin,
    },
    body: JSON.stringify({ action: 'provision' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Resource provisioning failed with HTTP ${response.status}. Verify a current admin role, active session, allowed operator origin and deployed function.`,
    );
  const result = await response.json();
  if (!Array.isArray(result.resources) || result.resources.length !== 3)
    throw new Error('Resource provisioning returned an unexpected result.');
  console.log('The three known resources are stored. Verifying unauthenticated downloads next.');
  // The child verifier needs only the project URL, never a privileged key or JWT.
  const childEnvironment = { ...process.env };
  delete childEnvironment.SUPABASE_ADMIN_ACCESS_TOKEN;
  delete childEnvironment.SUPABASE_SECRET_KEY;
  delete childEnvironment.SUPABASE_SERVICE_ROLE_KEY;
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./upload-resources.mjs', import.meta.url)), '--verify-only'],
      { env: childEnvironment, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) => resolveExit(code ?? 1));
  });
  process.exitCode = Number(exitCode);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Resource provisioning failed.');
  process.exitCode = 1;
});
