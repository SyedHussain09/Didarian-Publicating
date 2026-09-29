/** Live development-project tests. Ordinary clients exercise all user permissions.
 * Bootstrap credentials are generated locally and kept ONLY in ignored private evidence.
 * Never run against production. Database transaction tests are a separate SQL suite.
 */
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

for (const filename of ['.env.local', '.env.integration']) {
  try {
    process.loadEnvFile(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    'Configure the real development Supabase URL and publishable key. No mock fallback is provided.',
  );
const expectedRef = process.env.INTEGRATION_PROJECT_REF || 'ygcporcsudpjfltanqpj';
if (
  new URL(url).hostname !== `${expectedRef}.supabase.co` &&
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error(
    'Development project guard failed. Set INTEGRATION_PROJECT_REF explicitly for a designated test project.',
  );
const privateDir = path.resolve('docs/evidence/private');
const fixturePath = path.join(privateDir, 'fixtures.json');
const origin = process.env.INTEGRATION_ORIGIN || 'http://127.0.0.1:5173';
const timedFetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)])
      : AbortSignal.timeout(45_000),
  });
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Origin: origin }, fetch: timedFetch },
  });
const check = (result, context) => {
  if (result.error)
    throw new Error(
      `${context}: ${result.error.code || result.error.name} ${result.error.message}`,
    );
  return result.data;
};

if (process.argv.includes('--bootstrap')) {
  await mkdir(privateDir, { recursive: true });
  let existing;
  try {
    existing = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch {
    /* first run */
  }
  if (existing) {
    console.log(
      JSON.stringify({
        existing: true,
        runId: existing.runId,
        users: existing.users.map(({ label, id, email }) => ({ label, id, email })),
      }),
    );
    process.exit(0);
  }
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const fixtures = {
    projectRef: expectedRef,
    url,
    runId,
    createdAt: new Date().toISOString(),
    users: [],
    submissionIds: [],
    articleSlugs: [],
  };
  await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
  for (const label of ['authorA', 'authorB', 'admin']) {
    const email = `didarian-${runId}-${label.toLowerCase()}@example.test`;
    const password = `${randomBytes(24).toString('base64url')}aA1!`;
    const entry = { label, email, password, id: null };
    fixtures.users.push(entry);
    await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
    const registration = await client().auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: 'Integration',
          last_name: label,
          affiliation: 'Controlled development test',
          role: 'admin',
        },
      },
    });
    entry.id = registration.data.user?.id || null;
    entry.registrationError = registration.error?.message || null;
    await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
    console.log(
      JSON.stringify({ label, id: entry.id, email, registrationError: entry.registrationError }),
    );
  }
  console.log(
    'Credentials are stored only in docs/evidence/private/fixtures.json. Confirm controlled test users and grant the admin fixture through trusted SQL before running tests. Email delivery remains a separate unverified acceptance criterion.',
  );
  process.exit(0);
}

const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const quotaWindow = new Date().toISOString().slice(0, 13);
if (fixtures.contactQuotaWindow === quotaWindow) {
  throw new Error(
    'This fixture set already exercised contact limits in the current UTC hour. Wait for the next hourly window or have a trusted operator clear only the recorded DEV fixture rate-counter keys after preserving the test evidence. Do not raise the limit or delete unrelated counters.',
  );
}
const report = {
  startedAt: new Date().toISOString(),
  projectRef: expectedRef,
  runId: fixtures.runId,
  checks: [],
  submissions: [],
  articles: [],
};
async function test(name, run) {
  try {
    await run();
    report.checks.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, status: 'failed', error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await writeFile('docs/evidence/integration-results.json', JSON.stringify(report, null, 2));
}
const clients = {};
for (const user of fixtures.users) {
  const instance = client();
  check(
    await instance.auth.signInWithPassword({ email: user.email, password: user.password }),
    `Sign in ${user.label}`,
  );
  clients[user.label] = instance;
}
const { authorA, authorB, admin } = clients;
const anon = client();
const actorA = fixtures.users.find((user) => user.label === 'authorA');
const actorB = fixtures.users.find((user) => user.label === 'authorB');
const edge = async (instance, body) => {
  const result = await instance.functions.invoke('manuscripts', { body });
  if (result.error) {
    let detail = result.error.message;
    try {
      detail = (await result.error.context.json()).error || detail;
    } catch {
      /* no JSON */
    }
    throw new Error(detail);
  }
  return result.data;
};
const metadata = (title) => ({
  p_id: null,
  p_expected_version: null,
  p_title: title,
  p_abstract:
    'This is a controlled development integration manuscript used to verify publication transactions and permissions.',
  p_author_names: 'Development Test Author',
  p_category: 'Science',
  p_keywords: ['integration-test'],
  p_publication_consent: true,
});
const pdf = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
async function createReady(instance, suffix) {
  const draft = check(
    await instance.rpc('save_draft', metadata(`Integration ${fixtures.runId}: ${suffix}`)),
    'Save draft',
  );
  fixtures.submissionIds.push(draft.id);
  await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
  const prepared = await edge(instance, {
    action: 'prepare_upload',
    submission_id: draft.id,
    expected_version: draft.version,
    filename: `integration-${suffix}.pdf`,
    media_type: 'application/pdf',
    byte_size: pdf.byteLength,
  });
  check(
    await instance.storage
      .from('manuscripts')
      .uploadToSignedUrl(prepared.path, prepared.token, pdf, {
        contentType: 'application/pdf',
        upsert: false,
      }),
    'Upload bytes',
  );
  const ready = await edge(instance, { action: 'verify_upload', file_id: prepared.file_id });
  return {
    draft: ready,
    fileId: prepared.file_id,
    path: prepared.path,
    uploadToken: prepared.token,
  };
}
let paper, published, rejectedPaper;
await test('Invalid password is rejected', async () => {
  const result = await anon.auth.signInWithPassword({
    email: actorA.email,
    password: 'not-the-password-1A!',
  });
  assert.ok(result.error);
});
await test('User-editable role metadata cannot grant admin', async () => {
  assert.equal(check(await authorA.rpc('my_role'), 'Role'), 'author');
  assert.equal(check(await authorB.rpc('my_role'), 'Role'), 'author');
});
await test('Profile exists and role cannot be changed directly', async () => {
  const profile = check(
    await authorA.from('profiles').select('*').eq('id', actorA.id).single(),
    'Profile',
  );
  assert.equal(profile.first_name, 'Integration');
  assert.ok(
    (await authorA.from('user_roles').update({ role: 'admin' }).eq('user_id', actorA.id)).error,
  );
});
await test('Draft persists with real verified bytes', async () => {
  paper = await createReady(authorA, 'publish');
  assert.equal(paper.draft.status, 'draft');
  assert.equal(paper.draft.current_file_id, paper.fileId);
  const otherSession = client();
  check(
    await otherSession.auth.signInWithPassword({ email: actorA.email, password: actorA.password }),
    'Second session',
  );
  assert.equal(
    check(
      await otherSession.from('submissions').select('id').eq('id', paper.draft.id).single(),
      'Persisted draft',
    ).id,
    paper.draft.id,
  );
  await otherSession.auth.signOut({ scope: 'local' });
});
await test('Another author and admin cannot read an author draft', async () => {
  for (const instance of [authorB, admin]) {
    assert.deepEqual(
      check(
        await instance.from('submissions').select('*').eq('id', paper.draft.id),
        'Draft isolation',
      ),
      [],
    );
    assert.deepEqual(
      check(
        await instance.from('submission_files').select('*').eq('id', paper.fileId),
        'File isolation',
      ),
      [],
    );
    assert.ok((await instance.rpc('get_submission', { p_submission_id: paper.draft.id })).error);
  }
});
await test('Anonymous private tables and workflow calls are denied', async () => {
  assert.ok((await anon.from('submissions').select('*')).error);
  assert.ok(
    (
      await anon.rpc('submit_submission', {
        p_submission_id: paper.draft.id,
        p_expected_version: paper.draft.version,
      })
    ).error,
  );
});
await test('Authors cannot update protected columns or publish/reject', async () => {
  assert.ok(
    (
      await authorA
        .from('submissions')
        .update({ owner_id: actorB.id, status: 'published' })
        .eq('id', paper.draft.id)
    ).error,
  );
  assert.ok(
    (
      await authorA.rpc('accept_and_publish', {
        p_submission_id: paper.draft.id,
        p_expected_version: paper.draft.version,
      })
    ).error,
  );
  assert.ok(
    (
      await authorA.rpc('reject_submission', {
        p_submission_id: paper.draft.id,
        p_expected_version: paper.draft.version,
        p_feedback: 'Not authorized',
      })
    ).error,
  );
  assert.ok(
    (
      await authorA.rpc('finalize_file', {
        p_file_id: paper.fileId,
        p_sha256: 'a'.repeat(64),
        p_byte_size: pdf.length,
        p_media_type: 'application/pdf',
      })
    ).error,
  );
});
await test('Submit requires a verified linked file', async () => {
  const draft = check(
    await authorA.rpc('save_draft', metadata(`Integration ${fixtures.runId}: missing-file`)),
    'Empty draft',
  );
  fixtures.submissionIds.push(draft.id);
  assert.ok(
    (
      await authorA.rpc('submit_submission', {
        p_submission_id: draft.id,
        p_expected_version: draft.version,
      })
    ).error,
  );
});
await test('Submission retries are idempotent and admin queue is real', async () => {
  const request = { p_submission_id: paper.draft.id, p_expected_version: paper.draft.version };
  const a = check(await authorA.rpc('submit_submission', request), 'Submit');
  const b = check(await authorA.rpc('submit_submission', request), 'Repeat submit');
  assert.equal(a.version, b.version);
  assert.equal(a.status, 'submitted');
  assert.equal(
    check(await admin.from('submissions').select('id').eq('id', a.id).single(), 'Admin queue').id,
    a.id,
  );
  paper.draft = a;
});
await test('Submitted bytes cannot be overwritten or deleted by author', async () => {
  assert.ok(
    (
      await authorA.storage
        .from('manuscripts')
        .upload(paper.path, pdf, { upsert: true, contentType: 'application/pdf' })
    ).error,
  );
  assert.ok(
    (
      await authorA.storage
        .from('manuscripts')
        .uploadToSignedUrl(paper.path, paper.uploadToken, pdf, {
          upsert: true,
          contentType: 'application/pdf',
        })
    ).error,
  );
  const deletion = await authorA.storage.from('manuscripts').remove([paper.path]);
  assert.ok(deletion.error || !deletion.data?.length);
  const download = await edge(authorA, { action: 'download', file_id: paper.fileId });
  assert.equal((await fetch(download.url)).status, 200);
});
await test('Accept & Publish is atomic, public, and idempotent', async () => {
  const request = {
    p_submission_id: paper.draft.id,
    p_expected_version: paper.draft.version,
    p_feedback: 'Approved by integration test.',
  };
  published = check(await admin.rpc('accept_and_publish', request), 'Publish');
  const retry = check(await admin.rpc('accept_and_publish', request), 'Publish retry');
  assert.equal(retry.article_slug, published.article_slug);
  assert.equal(published.status, 'published');
  assert.equal(
    check(
      await anon.from('articles').select('*').eq('slug', published.article_slug).single(),
      'Public article',
    ).title,
    paper.draft.title,
  );
  const history = check(
    await authorA.from('submission_events').select('kind').eq('submission_id', paper.draft.id),
    'History',
  );
  assert.equal(history.filter((event) => event.kind === 'accepted').length, 1);
  assert.equal(history.filter((event) => event.kind === 'published').length, 1);
  fixtures.articleSlugs.push(published.article_slug);
});
await test('Public download returns only selected committed asset', async () => {
  const download = await edge(anon, { action: 'download', article_slug: published.article_slug });
  const response = await fetch(download.url);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
  assert.match(response.headers.get('content-disposition') || '', /attachment/i);
  assert.ok((await anon.storage.from('manuscripts').list(actorA.id)).data?.length === 0);
  await assert.rejects(() => edge(anon, { action: 'download', file_id: paper.fileId }));
});
await test('Other author cannot read events, notifications, or download bytes', async () => {
  assert.deepEqual(
    check(
      await authorB.from('submission_events').select('*').eq('submission_id', paper.draft.id),
      'Events',
    ),
    [],
  );
  assert.deepEqual(
    check(
      await authorB.from('notifications').select('*').eq('submission_id', paper.draft.id),
      'Notifications',
    ),
    [],
  );
  await assert.rejects(() => edge(authorB, { action: 'download', file_id: paper.fileId }));
});
await test('Reject persists feedback and remains private', async () => {
  rejectedPaper = await createReady(authorA, 'reject');
  const submitted = check(
    await authorA.rpc('submit_submission', {
      p_submission_id: rejectedPaper.draft.id,
      p_expected_version: rejectedPaper.draft.version,
    }),
    'Submit rejected fixture',
  );
  assert.ok(
    (
      await admin.rpc('reject_submission', {
        p_submission_id: submitted.id,
        p_expected_version: submitted.version,
        p_feedback: '',
      })
    ).error,
  );
  const result = check(
    await admin.rpc('reject_submission', {
      p_submission_id: submitted.id,
      p_expected_version: submitted.version,
      p_feedback: 'The test manuscript needs further evidence.',
    }),
    'Reject',
  );
  assert.equal(result.status, 'rejected');
  assert.equal(result.article_slug, null);
  const history = check(
    await authorA
      .from('submission_events')
      .select('*')
      .eq('submission_id', submitted.id)
      .eq('kind', 'rejected')
      .single(),
    'Rejection feedback',
  );
  assert.match(history.feedback, /further evidence/);
});
await test('Concurrent Accept and Reject result in exactly one decision', async () => {
  const race = await createReady(authorA, 'race');
  const submitted = check(
    await authorA.rpc('submit_submission', {
      p_submission_id: race.draft.id,
      p_expected_version: race.draft.version,
    }),
    'Submit race',
  );
  const args = {
    p_submission_id: submitted.id,
    p_expected_version: submitted.version,
    p_feedback: 'Concurrent decision test.',
  };
  const results = await Promise.all([
    admin.rpc('accept_and_publish', args),
    admin.rpc('reject_submission', args),
  ]);
  assert.equal(results.filter((result) => !result.error).length, 1);
  assert.equal(results.find((result) => result.error).error.code, 'PT409');
  const result = check(
    await authorA.rpc('get_submission', { p_submission_id: submitted.id }),
    'Race result',
  );
  assert.ok(['published', 'rejected'].includes(result.status));
  if (result.article_slug) fixtures.articleSlugs.push(result.article_slug);
});
await test('Admin publishes a named-author article without new Auth identity', async () => {
  const direct = await createReady(admin, 'admin-direct');
  const result = check(
    await admin.rpc('publish_admin_article', {
      p_submission_id: direct.draft.id,
      p_expected_version: direct.draft.version,
    }),
    'Admin direct publish',
  );
  assert.equal(result.status, 'published');
  assert.equal(result.author_names, 'Development Test Author');
  fixtures.articleSlugs.push(result.article_slug);
});
await test('Invalid file signatures fail verification', async () => {
  const draft = check(
    await authorA.rpc('save_draft', metadata(`Integration ${fixtures.runId}: invalid-file`)),
    'Invalid draft',
  );
  fixtures.submissionIds.push(draft.id);
  const fake = new TextEncoder().encode(
    'This is not a PDF but it has enough bytes to attempt an upload.',
  );
  const prepared = await edge(authorA, {
    action: 'prepare_upload',
    submission_id: draft.id,
    expected_version: draft.version,
    filename: 'fake.pdf',
    media_type: 'application/pdf',
    byte_size: fake.length,
  });
  check(
    await authorA.storage
      .from('manuscripts')
      .uploadToSignedUrl(prepared.path, prepared.token, fake, { contentType: 'application/pdf' }),
    'Invalid upload transport',
  );
  await assert.rejects(
    () => edge(authorA, { action: 'verify_upload', file_id: prepared.file_id }),
    /structure|extension/,
  );
  assert.equal(
    check(
      await authorA.from('submissions').select('current_file_id').eq('id', draft.id).single(),
      'Failed file state',
    ).current_file_id,
    null,
  );
});
await test('Oversize files are refused before upload', async () => {
  await assert.rejects(
    () =>
      edge(authorA, {
        action: 'prepare_upload',
        submission_id: paper.draft.id,
        expected_version: 1,
        filename: 'huge.pdf',
        media_type: 'application/pdf',
        byte_size: 20 * 1024 * 1024 + 1,
      }),
    /20 MB/,
  );
});
await test('Genuine DOC and DOCX bytes pass server structural verification', async () => {
  for (const [extension, mediaType] of [
    ['doc', 'application/msword'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ]) {
    const bytes = await readFile(`public/resources/Didarian_Research_Template.${extension}`);
    const draft = check(
      await authorA.rpc(
        'save_draft',
        metadata(`Integration ${fixtures.runId}: ${extension}-verification`),
      ),
      'Word draft',
    );
    fixtures.submissionIds.push(draft.id);
    const prepared = await edge(authorA, {
      action: 'prepare_upload',
      submission_id: draft.id,
      expected_version: draft.version,
      filename: `paper.${extension}`,
      media_type: mediaType,
      byte_size: bytes.length,
    });
    check(
      await authorA.storage
        .from('manuscripts')
        .uploadToSignedUrl(prepared.path, prepared.token, bytes, { contentType: mediaType }),
      'Word upload',
    );
    const result = await edge(authorA, { action: 'verify_upload', file_id: prepared.file_id });
    assert.equal(result.current_file_id, prepared.file_id);
  }
});
await test('Contact is stored, private, and rate limited', async () => {
  const email = `contact-${fixtures.runId}-${randomUUID().slice(0, 8)}@example.test`;
  fixtures.contactQuotaWindow = quotaWindow;
  fixtures.contactEmails ||= [];
  fixtures.contactEmails.push(email);
  await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
  const results = [];
  for (let i = 0; i < 6; i++)
    results.push(
      await anon.functions.invoke('contact', {
        body: {
          name: 'Integration Contact',
          email,
          message: `Controlled integration message ${fixtures.runId}.`,
          website: '',
        },
      }),
    );
  assert.ok(results.slice(0, 5).every((result) => !result.error && result.data.ok));
  assert.ok(results[5].error);
  assert.ok((await anon.from('contact_messages').select('*')).error);
  const inbox = check(
    await admin.from('contact_messages').select('id').eq('email', email),
    'Admin inbox',
  );
  assert.equal(inbox.length, 5);
  check(
    await admin.rpc('handle_contact_message', { p_id: inbox[0].id, p_state: 'handled' }),
    'Handle contact',
  );
});
await test('Logout revokes sensitive commands for captured JWT', async () => {
  const isolated = client();
  check(
    await isolated.auth.signInWithPassword({ email: actorB.email, password: actorB.password }),
    'Logout fixture',
  );
  const session = (await isolated.auth.getSession()).data.session;
  check(await isolated.auth.signOut({ scope: 'local' }), 'Logout');
  const captured = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  assert.ok((await captured.rpc('save_draft', metadata('Revoked token must not save'))).error);
});
await test('Retain a reviewable fixture for browser acceptance checks', async () => {
  const reviewable = await createReady(authorA, 'browser-review');
  const result = check(
    await authorA.rpc('submit_submission', {
      p_submission_id: reviewable.draft.id,
      p_expected_version: reviewable.draft.version,
    }),
    'Reviewable fixture',
  );
  fixtures.authorSubmissionId = result.id;
  fixtures.adminSubmissionId = result.id;
});

await writeFile(fixturePath, JSON.stringify(fixtures, null, 2));
report.finishedAt = new Date().toISOString();
report.submissions = fixtures.submissionIds;
report.articles = fixtures.articleSlugs;
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/integration-results.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.checks.filter((item) => item.status === 'passed').length,
    failed: report.checks.filter((item) => item.status === 'failed').length,
    report: 'docs/evidence/integration-results.json',
  }),
);
if (report.checks.some((item) => item.status === 'failed')) process.exitCode = 1;
