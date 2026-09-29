import { adminClient, databaseError, handle, HttpError, jsonBody, respond, textField, userClient, uuid } from '../_shared/http.ts';
import { validateFileBytes, validateFileMetadata } from '../_shared/file-validation.ts';

Deno.serve(handle(async (request, headers) => {
  const body = await jsonBody(request);
  const action = textField(body, 'action', 40);
  const admin = adminClient();

  if (action === 'download' && typeof body.article_slug === 'string') {
    const slug = textField(body, 'article_slug', 180);
    const { data: asset, error } = await admin.rpc('resolve_public_asset', { p_slug: slug });
    if (error) databaseError(error);
    if (!asset) throw new HttpError(404, 'Published article not found.');
    const { data, error: downloadError } = await admin.storage.from('manuscripts').createSignedUrl(asset.storage_path, 60, { download: asset.original_name });
    if (downloadError || !data) throw new HttpError(503, 'The published document is temporarily unavailable.');
    return respond({ url: data.signedUrl, expires_in: 60 }, headers);
  }

  const { client, user } = await userClient(request);
  if (action === 'prepare_upload') {
    const filename = textField(body, 'filename', 180);
    const mediaType = textField(body, 'media_type', 100);
    validateFileMetadata(filename, mediaType, Number(body.byte_size));
    if (!Number.isSafeInteger(body.expected_version)) throw new HttpError(400, 'Reload the draft before uploading.');
    const { data: file, error } = await client.rpc('prepare_file', {
      p_submission_id: uuid(body.submission_id), p_expected_version: body.expected_version,
      p_original_name: filename, p_media_type: mediaType, p_byte_size: body.byte_size,
    });
    if (error) databaseError(error);
    const { data: upload, error: uploadError } = await admin.storage.from('manuscripts').createSignedUploadUrl(file.storage_path, { upsert: false });
    if (uploadError || !upload) throw new HttpError(503, 'Could not prepare the upload. Please retry.');
    return respond({ file_id: file.id, path: file.storage_path, token: upload.token, upload_url: upload.signedUrl, expected_version: body.expected_version }, headers);
  }

  if (action === 'verify_upload' || action === 'download') {
    const fileId = uuid(body.file_id);
    const { data: file, error } = await client.from('submission_files').select('*').eq('id', fileId).maybeSingle();
    if (error) databaseError(error);
    if (!file) throw new HttpError(404, 'Document not found or access denied.');

    if (action === 'download') {
      if (file.verification_state !== 'verified') throw new HttpError(409, 'This upload has not passed verification.');
      const { data, error: downloadError } = await admin.storage.from('manuscripts').createSignedUrl(file.storage_path, 60, { download: file.original_name });
      if (downloadError || !data) throw new HttpError(503, 'The document is temporarily unavailable.');
      return respond({ url: data.signedUrl, expires_in: 60 }, headers);
    }

    const { data: submission, error: submissionError } = await client.from('submissions').select('id,owner_id,status').eq('id', file.submission_id).single();
    if (submissionError) databaseError(submissionError);
    if (submission.owner_id !== user.id) throw new HttpError(403, 'Only the owner may verify an upload.');
    if (file.verification_state === 'verified') {
      const { data, error: resultError } = await client.rpc('get_submission', { p_submission_id: file.submission_id });
      if (resultError) databaseError(resultError);
      return respond(data, headers);
    }
    if (submission.status !== 'draft' || file.verification_state !== 'pending') throw new HttpError(409, 'This file is no longer awaiting verification.');
    const { data: blob, error: storageError } = await admin.storage.from('manuscripts').download(file.storage_path);
    if (storageError || !blob) throw new HttpError(409, 'Upload is incomplete. Finish or retry the upload before verification.');
    try {
      if (blob.size !== file.byte_size) throw new HttpError(400, 'Uploaded size does not match the selected file.');
      const extension = validateFileMetadata(file.original_name, file.media_type, blob.size);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      validateFileBytes(bytes, extension);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const { data, error: verifyError } = await admin.rpc('finalize_file', {
        p_file_id: fileId, p_sha256: sha256, p_byte_size: blob.size, p_media_type: file.media_type,
      });
      if (verifyError) databaseError(verifyError);
      return respond(data, headers);
    } catch (verificationError) {
      if (verificationError instanceof HttpError && verificationError.status === 400) {
        await admin.from('submission_files').update({ verification_state: 'rejected' }).eq('id', fileId).eq('verification_state', 'pending');
      }
      throw verificationError;
    }
  }

  if (action === 'cleanup') {
    const { data: files, error } = await client.rpc('claim_cleanup', { p_submission_id: uuid(body.submission_id) });
    if (error) databaseError(error);
    let removed = 0;
    for (const file of files as { id: string; storage_path: string }[]) {
      const { error: removalError } = await admin.storage.from('manuscripts').remove([file.storage_path]);
      if (removalError) continue; // Keep the deleting row so a retry can finish safely.
      const { error: rowError } = await admin.from('submission_files').delete().eq('id', file.id).eq('verification_state', 'deleting');
      if (!rowError) removed++;
    }
    return respond({ removed, pending: files.length - removed, note: 'Only unused draft uploads older than three hours are eligible.' }, headers);
  }
  throw new HttpError(400, 'Unknown manuscript action.');
}));
