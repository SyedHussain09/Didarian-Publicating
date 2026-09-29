import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env.local');
const f = JSON.parse(await readFile('docs/evidence/private/fixtures.json', 'utf8'));
const adminUser = f.users.find((user) => user.label === 'admin');
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const origin = 'http://127.0.0.1:5173';
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = await admin.auth.signInWithPassword({
  email: adminUser.email,
  password: adminUser.password,
});
if (auth.error) throw new Error(auth.error.message);
const report = { projectRef: f.projectRef, runId: f.runId, checks: [], responses: [] };
const token = randomUUID().slice(0, 8);
let firstAcceptedId;
for (let i = 0; i < 8; i++) {
  const response = await fetch(url + '/functions/v1/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      apikey: key,
      'X-Forwarded-For': `192.0.2.${i + 1}`,
      ...(i >= 6 ? { 'CF-Connecting-IP': `198.51.100.${i + 1}` } : {}),
    },
    body: JSON.stringify({
      name: 'Integration Contact Security',
      email: `contact-${f.runId}-${token}-${i}@example.test`,
      message: 'Controlled spoofed forwarding-header rate-limit regression.',
      website: '',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : { error: 'Gateway rejected the forged header before the function' };
  report.responses.push({
    request: i + 1,
    status: response.status,
    ok: data.ok === true,
    error: data.error || null,
  });
  if (response.ok) {
    assert.equal(data.ok, true);
    firstAcceptedId ||= data.id;
  } else
    assert.ok(
      response.status === 429 || (i >= 6 && response.status === 403),
      `Unexpected response ${response.status}`,
    );
}
// Each request varied email, XFF, and forged CF headers. A blocked request proves
// the actual gateway IP (not a forged header/email) still shares its quota.
assert.ok(
  report.responses.some((item) => item.status === 429),
  'Forged forwarding headers must not bypass the real client-IP quota',
);
assert.ok(
  report.responses.filter((item) => item.ok).length <= 5,
  'At most five requests may be accepted per actual client IP',
);
report.checks.push({
  name: 'Forged X-Forwarded-For and CF-Connecting-IP cannot bypass source quota with changing emails',
  status: 'passed',
});
const inbox = await admin
  .from('contact_messages')
  .select('id,state')
  .eq('email', `contact-${f.runId}@example.test`);
if (inbox.error) throw new Error(inbox.error.message);
assert.equal(inbox.data.length, 5);
report.checks.push({
  name: 'Original contact submissions are persisted and visible to current admin',
  status: 'passed',
});
const targetId = firstAcceptedId || inbox.data[0].id;
const handled = await admin.rpc('handle_contact_message', { p_id: targetId, p_state: 'handled' });
assert.equal(handled.error, null);
const row = await admin.from('contact_messages').select('state').eq('id', targetId).single();
assert.equal(row.data.state, 'handled');
report.checks.push({ name: 'Admin handling state is persisted', status: 'passed' });
const anon = createClient(url, key, { auth: { persistSession: false } });
assert.ok((await anon.from('contact_messages').select('*')).error);
report.checks.push({ name: 'Anonymous caller cannot read contact messages', status: 'passed' });
report.finishedAt = new Date().toISOString();
await writeFile('docs/evidence/contact-security-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
