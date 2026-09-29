import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.SUPABASE_URL;
if (!origin) throw new Error('SUPABASE_URL is required.');
const endpoint = new URL('/functions/v1/provision-resources', origin);
const cases = [
  { name: 'Anonymous cannot provision assets', expected: 401, body: { action: 'provision' } },
  {
    name: 'Invalid JWT cannot provision assets',
    expected: 401,
    body: { action: 'provision' },
    authorization: 'Bearer not-a-valid-user-session',
  },
  {
    name: 'Caller cannot supply a storage path',
    expected: 400,
    body: { action: 'provision', path: 'unexpected.doc' },
  },
  {
    name: 'Unapproved browser origin denied',
    expected: 403,
    body: { action: 'provision' },
    requestOrigin: 'https://unapproved.invalid',
  },
  {
    name: 'Oversized provisioning request denied',
    expected: 413,
    body: { action: 'provision', value: 'x'.repeat(256) },
  },
];
const results = [];
for (const test of cases) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: test.requestOrigin || 'http://localhost:5173',
  };
  if (test.authorization) headers.Authorization = test.authorization;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(test.body),
    signal: AbortSignal.timeout(20_000),
  });
  results.push({
    name: test.name,
    expected: test.expected,
    received: response.status,
    passed: response.status === test.expected,
  });
  console.log(
    `${response.status === test.expected ? 'PASS' : 'FAIL'} ${test.name}: HTTP ${response.status}`,
  );
  await response.arrayBuffer();
}
const directory = fileURLToPath(new URL('../docs/evidence/template/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('../docs/evidence/template/provision-boundary.json', import.meta.url),
  `${JSON.stringify({ testedAt: new Date().toISOString(), endpoint: endpoint.href, results }, null, 2)}\n`,
);
if (results.some((test) => !test.passed)) process.exitCode = 1;
