// Operator-only resource publishing. Never import this module into browser code.
// SUPABASE_URL and a backend secret are read only from the process environment.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const bucket = 'resources';
const resources = [
  { filename: 'Didarian_Research_Template.doc', type: 'application/msword' },
  {
    filename: 'Didarian_Research_Template.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { filename: 'Didarian_Research_Template.tex', type: 'application/x-tex' },
];
const verifyOnly = process.argv.includes('--verify-only');
const replace = process.argv.includes('--replace');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function configuredUrl() {
  if (!process.env.SUPABASE_URL)
    throw new Error('SUPABASE_URL is required. Use the intended project URL.');
  const url = new URL(process.env.SUPABASE_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('SUPABASE_URL must be a plain project origin.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, except for local Supabase.');
  return url.origin;
}

function backendSecret() {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret)
    throw new Error(
      'Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY only in this trusted operator process, or use --verify-only.',
    );
  if (secret.startsWith('sb_publishable_'))
    throw new Error('A publishable key cannot publish resources.');
  if (!secret.startsWith('sb_secret_')) {
    try {
      const claims = JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role !== 'service_role') throw new Error('Invalid role');
    } catch {
      throw new Error(
        'Expected a backend secret or legacy service-role key; no key value is logged.',
      );
    }
  }
  return secret;
}

function publicUrl(origin, filename) {
  const url = new URL(`/storage/v1/object/public/${bucket}/${filename}`, origin);
  url.searchParams.set('download', filename);
  return url;
}

async function inspectPublic(origin, resource, expected) {
  const url = publicUrl(origin, resource.filename);
  // A cache-busting verification query avoids observing a stale response after an intentional replace.
  url.searchParams.set('verification', sha256(expected));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return { ok: false, status: response.status };
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  const disposition = response.headers.get('content-disposition') || '';
  return {
    ok:
      sha256(bytes) === sha256(expected) &&
      type === resource.type &&
      /^attachment\b/i.test(disposition) &&
      disposition.includes(resource.filename),
    status: response.status,
    filename: resource.filename,
    contentType: type,
    contentDisposition: disposition,
    bytes: bytes.length,
    sha256: sha256(bytes),
    expectedSha256: sha256(expected),
    url: publicUrl(origin, resource.filename).href,
  };
}

async function main() {
  const origin = configuredUrl();
  const client = verifyOnly
    ? null
    : createClient(origin, backendSecret(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  if (client) {
    const { data, error } = await client.storage.getBucket(bucket);
    if (error || !data)
      throw new Error(
        'Cannot read resources bucket. Apply the version-controlled migrations first and check the backend credential.',
      );
    if (!data.public)
      throw new Error(
        'The resources bucket is not public. Refusing to change bucket policy from this script.',
      );
  }
  const report = {
    verifiedAt: new Date().toISOString(),
    origin,
    bucket,
    mode: verifyOnly ? 'verify-only' : 'publish-and-verify',
    resources: [],
  };
  for (const resource of resources) {
    const bytes = await readFile(resolve(root, 'public/resources', resource.filename));
    if (
      resource.filename.endsWith('.doc') &&
      bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1'
    )
      throw new Error(
        'DOC is not a genuine Compound File Binary document. Regenerate and verify it in Word.',
      );
    let result = await inspectPublic(origin, resource, bytes);
    if (!result.ok && client) {
      if (result.status === 200 && !replace)
        throw new Error(
          `${resource.filename} already exists but differs or has incorrect headers. Inspect it first; use --replace only for an intentional template replacement.`,
        );
      const { error } = await client.storage.from(bucket).upload(resource.filename, bytes, {
        contentType: resource.type,
        cacheControl: '3600',
        upsert: replace,
      });
      if (error)
        throw new Error(
          `Resource upload failed for ${resource.filename}; status ${error.statusCode || 'unknown'}. Existing objects are preserved unless --replace was supplied.`,
        );
      for (let attempt = 0; attempt < 4; attempt++) {
        result = await inspectPublic(origin, resource, bytes);
        if (result.ok) break;
        await delay(1000 * (attempt + 1));
      }
    }
    report.resources.push(result);
    if (!result.ok)
      throw new Error(
        `Public download verification failed for ${resource.filename}; check file bytes, Content-Type and attachment filename. HTTP ${result.status}.`,
      );
    console.log(
      `Verified ${resource.filename}: ${result.bytes} bytes, expected media type, attachment filename and SHA-256.`,
    );
  }
  const evidence = resolve(root, 'docs/evidence/template');
  await mkdir(evidence, { recursive: true });
  await writeFile(
    resolve(evidence, 'storage-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Resource operation failed.');
  process.exitCode = 1;
});
