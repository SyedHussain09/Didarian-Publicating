import { adminClient, handle, HttpError, jsonBody, respond, userClient } from '../_shared/http.ts';
import { resources } from './assets.ts';

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Operator-only endpoint: JWT identity and a live database role are required.
// The request cannot specify bytes, buckets, paths, public URLs, or metadata.
Deno.serve(handle(async (request, headers) => {
  const body = await jsonBody(request, 128);
  if (body.action !== 'provision' || Object.keys(body).length !== 1) throw new HttpError(400, 'Use only the provision action.');
  const { client } = await userClient(request);
  const assertAdmin = async () => {
    const { data: role, error } = await client.rpc('my_role');
    if (error || role !== 'admin') throw new HttpError(403, 'Current administrator access is required.');
  };
  await assertAdmin();
  const admin = adminClient();
  const { data: bucket, error: bucketError } = await admin.storage.getBucket('resources');
  if (bucketError || !bucket?.public) throw new HttpError(503, 'Apply the resources bucket migration before provisioning.');
  const results = [];
  for (const resource of resources) {
    const bytes = Uint8Array.from(atob(resource.base64), character => character.charCodeAt(0));
    if (bytes.byteLength !== resource.byteSize || await hash(bytes) !== resource.sha256) throw new HttpError(500, 'The compiled resource failed its integrity check.');
    const storage = admin.storage.from('resources');
    let { data: existing } = await storage.download(resource.filename);
    let created = false;
    if (!existing) {
      // Recheck the live role immediately before each privileged mutation.
      await assertAdmin();
      const { error: uploadError } = await storage.upload(resource.filename, bytes, { contentType: resource.contentType, cacheControl: '3600', upsert: false });
      created = !uploadError;
      // Retries/concurrent invocations may already have uploaded the same asset.
      const { data, error } = await storage.download(resource.filename);
      if (error || !data) throw new HttpError(503, 'A resource could not be stored. Retry safely; already completed resources are retained.');
      existing = data;
    }
    if (existing.size !== resource.byteSize || await hash(new Uint8Array(await existing.arrayBuffer())) !== resource.sha256) throw new HttpError(409, 'An existing resource differs from this verified release. An operator must review it; no file was overwritten.');
    results.push({ filename: resource.filename, bytes: resource.byteSize, sha256: resource.sha256, contentType: resource.contentType, created });
  }
  return respond({ resources: results, note: 'Stored bytes verified. Verify public response headers independently before release.' }, headers);
}));
