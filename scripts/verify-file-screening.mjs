import { createClient } from '@supabase/supabase-js';
import { zipSync, unzipSync } from 'fflate';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const file = 'docs/evidence/private/fixtures.json';
const f = JSON.parse(await readFile(file, 'utf8'));
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
const genuine = await readFile('public/resources/Didarian_Research_Template.docx');
const macro = zipSync({ ...unzipSync(genuine), 'word/vbaProject.bin': new Uint8Array(32) });
const report = { projectRef: f.projectRef, checks: [] };
for (const [label, bytes, shouldPass] of [
  ['genuine-docx', genuine, true],
  ['macro-docx', macro, false],
]) {
  const draft = check(
    await c.rpc('save_draft', {
      p_id: null,
      p_expected_version: null,
      p_title: `Integration ${f.runId}: ${label}`,
      p_abstract: 'Controlled structural screening of actual Word document bytes.',
      p_author_names: 'Integration Author',
      p_category: 'Science',
      p_keywords: [],
      p_publication_consent: true,
    }),
  );
  f.submissionIds.push(draft.id);
  await writeFile(file, JSON.stringify(f, null, 2));
  const prepared = check(
    await c.functions.invoke('manuscripts', {
      body: {
        action: 'prepare_upload',
        submission_id: draft.id,
        expected_version: draft.version,
        filename: label + '.docx',
        media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        byte_size: bytes.length,
      },
    }),
  );
  check(
    await c.storage.from('manuscripts').uploadToSignedUrl(prepared.path, prepared.token, bytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  const result = await c.functions.invoke('manuscripts', {
    body: { action: 'verify_upload', file_id: prepared.file_id },
  });
  if (shouldPass) {
    assert.equal(result.error, null);
    assert.equal(result.data.current_file_id, prepared.file_id);
  } else {
    assert.ok(result.error);
    const errorBody = await result.error.context.json();
    assert.match(errorBody.error, /macros|Macro/);
    const saved = check(
      await c.from('submissions').select('current_file_id').eq('id', draft.id).single(),
    );
    assert.equal(saved.current_file_id, null);
    const asset = check(
      await c
        .from('submission_files')
        .select('verification_state')
        .eq('id', prepared.file_id)
        .single(),
    );
    assert.equal(asset.verification_state, 'rejected');
  }
  report.checks.push({ name: label, status: 'passed', submissionId: draft.id });
}
report.executedAt = new Date().toISOString();
await writeFile('docs/evidence/file-screening-live-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
