import { createClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';
import { readFile, writeFile } from 'node:fs/promises';
process.loadEnvFile('.env.local');
const f = JSON.parse(await readFile('docs/evidence/private/fixtures.json', 'utf8'));
const u = f.users.find((user) => user.label === 'authorA');
const c = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Origin: 'http://127.0.0.1:5173' } },
});
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
check(await c.auth.signInWithPassword({ email: u.email, password: u.password }));
const draft = check(
  await c.rpc('save_draft', {
    p_id: null,
    p_expected_version: null,
    p_title: `Integration ${f.runId}: TUS transport`,
    p_abstract: 'A genuine Word manuscript used for a transport verification test.',
    p_author_names: 'Integration Author',
    p_category: 'Science',
    p_keywords: [],
    p_publication_consent: true,
  }),
);
f.submissionIds.push(draft.id);
await writeFile('docs/evidence/private/fixtures.json', JSON.stringify(f, null, 2));
const bytes = await readFile('public/resources/Didarian_Research_Template.doc');
const prepared = check(
  await c.functions.invoke('manuscripts', {
    body: {
      action: 'prepare_upload',
      submission_id: draft.id,
      expected_version: draft.version,
      filename: 'transport.doc',
      media_type: 'application/msword',
      byte_size: bytes.length,
    },
  }),
);
let lastBytes = 0;
await new Promise((resolve, reject) => {
  const upload = new Upload(bytes, {
    endpoint: `https://${f.projectRef}.storage.supabase.co/storage/v1/upload/resumable/sign`,
    retryDelays: [],
    chunkSize: 6 * 1024 * 1024,
    headers: { 'x-signature': prepared.token, 'x-upsert': 'false' },
    uploadDataDuringCreation: true,
    storeFingerprintForResuming: false,
    metadata: {
      bucketName: 'manuscripts',
      objectName: prepared.path,
      contentType: 'application/msword',
      cacheControl: '0',
    },
    onProgress: (completed) => {
      lastBytes = completed;
    },
    onSuccess: resolve,
    onError: (error) =>
      reject(
        new Error(
          `TUS status ${error.originalResponse?.getStatus()}: ${error.originalResponse?.getBody() || 'transport error'}`,
        ),
      ),
  });
  upload.start();
});
const result = check(
  await c.functions.invoke('manuscripts', {
    body: { action: 'verify_upload', file_id: prepared.file_id },
  }),
);
await writeFile(
  'docs/evidence/upload-transport-results.json',
  JSON.stringify(
    {
      passed: true,
      submissionId: result.id,
      byteSize: bytes.length,
      progressBytes: lastBytes,
      transport: 'Supabase TUS signed upload, no upsert',
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    submissionId: result.id,
    byteSize: bytes.length,
    progressBytes: lastBytes,
  }),
);
