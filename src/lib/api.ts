import { getSupabase, storageUploadEndpoint } from './supabase';
import type {
  ContactMessage,
  DraftInput,
  ManuscriptFile,
  Notification,
  Status,
  Submission,
  SubmissionEvent,
} from './models';
import { errorMessage, searchText, validateFile } from './validation';
import type { Database } from '../types/database.generated';

export const PAGE_SIZE = 10;
type Commands = Database['public']['Functions'];
async function command<T>(name: keyof Commands, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args as Commands[typeof name]['Args']);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function edge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body });
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const detail = (await error.context.json().catch(() => null)) as { error?: string } | null;
      if (detail?.error) throw new Error(detail.error);
    }
    throw new Error(errorMessage(error));
  }
  return data as T;
}
export async function listSubmissions(page: number, filter: Status | '', search: string) {
  let query = getSupabase()
    .from('submissions')
    .select('*, submitter:profiles!submissions_owner_id_fkey(first_name,last_name,affiliation)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .order('id');
  if (filter) query = query.eq('status', filter);
  if (searchText(search)) query = query.ilike('title', `%${searchText(search)}%`);
  const { data, count, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data as Submission[], count: count ?? 0 };
}
export async function submissionCounts() {
  const states: Status[] = ['submitted', 'under_review', 'published', 'rejected'];
  const entries = await Promise.all(
    states.map(async (status) => {
      const { count, error } = await getSupabase()
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Exclude<Status, 'draft'>, number>;
}
export async function getSubmission(id: string) {
  const { data, error } = await getSupabase()
    .from('submissions')
    .select('*, submitter:profiles!submissions_owner_id_fkey(first_name,last_name,affiliation)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Submission not found, or you do not have permission to view it.');
  return data as Submission;
}
export async function getFiles(id: string) {
  const { data, error } = await getSupabase()
    .from('submission_files')
    .select('*')
    .eq('submission_id', id)
    .order('version', { ascending: false });
  if (error) throw error;
  return data as ManuscriptFile[];
}
export async function getEvents(id: string) {
  const { data, error } = await getSupabase()
    .from('submission_events')
    .select('*')
    .eq('submission_id', id)
    .order('created_at')
    .limit(100);
  if (error) throw error;
  return data as SubmissionEvent[];
}
export async function getNotifications() {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data as Notification[];
}
export async function articleForSubmission(id: string): Promise<string | null> {
  return command<string | null>('submission_article_slug', { p_submission_id: id });
}
export async function saveDraft(input: DraftInput, current?: Submission): Promise<Submission> {
  return command('save_draft', {
    p_id: current?.id ?? null,
    p_expected_version: current?.version ?? null,
    p_title: input.title.trim(),
    p_abstract: input.abstract.trim(),
    p_author_names: input.author_names.trim(),
    p_category: input.category,
    p_keywords: input.keywords,
    p_publication_consent: input.publication_consent,
  });
}
export type DecisionCommand =
  | 'submit_submission'
  | 'start_review'
  | 'accept_and_publish'
  | 'reject_submission'
  | 'publish_admin_article';
export async function decide(
  name: DecisionCommand,
  current: Submission,
  feedback = '',
): Promise<Submission> {
  const args: Record<string, unknown> = {
    p_submission_id: current.id,
    p_expected_version: current.version,
  };
  if (name === 'accept_and_publish' || name === 'reject_submission')
    args.p_feedback = feedback.trim();
  return command(name, args);
}
export async function resolveDownload(
  input: { file_id: string } | { article_slug: string },
): Promise<string> {
  const data = await edge<{ url: string }>('manuscripts', { action: 'download', ...input });
  const url = new URL(data.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('The download service returned an invalid URL.');
  return data.url;
}
export async function downloadTemplate(format: 'doc' | 'docx' | 'tex' = 'doc') {
  const name = `Didarian_Research_Template.${format}`;
  const { data, error } = await getSupabase().storage.from('resources').download(name);
  if (error)
    throw new Error('The template could not be downloaded. Please retry or contact support.');
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function uploadManuscript(
  current: Submission,
  file: File,
  onProgress: (bytes: number, total: number) => void,
  signal: AbortSignal,
): Promise<Submission> {
  const mediaType = validateFile(file);
  const { Upload, DetailedError } = await import('tus-js-client');
  const prepared = await edge<{ file_id: string; path: string; token: string }>('manuscripts', {
    action: 'prepare_upload',
    submission_id: current.id,
    expected_version: current.version,
    filename: file.name,
    media_type: mediaType,
    byte_size: file.size,
  });
  if (signal.aborted) throw new Error('Upload cancelled. Your saved draft is still available.');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const upload = new Upload(file, {
      endpoint: storageUploadEndpoint(),
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 6 * 1024 * 1024,
      headers: { 'x-signature': prepared.token, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'manuscripts',
        objectName: prepared.path,
        contentType: mediaType,
        cacheControl: '0',
      },
      onProgress,
      onSuccess: () => done(),
      onError: (error) => {
        // DetailedError.message contains the upload URL and may include credentials.
        // Expose only an HTTP status and an actionable, application-owned message.
        const status = error instanceof DetailedError ? error.originalResponse?.getStatus() : null;
        const reason =
          status === 401 || status === 403
            ? 'Upload authorization expired or is no longer permitted. Sign in and retry.'
            : status === 413
              ? 'The upload exceeds the storage size limit. Choose a smaller file.'
              : status === 409
                ? 'This upload conflicts with an existing version. Reload the saved draft and upload a new version.'
                : status
                  ? `Storage rejected the upload (HTTP ${status}). Please retry or contact support.`
                  : 'The upload connection was interrupted. Check your connection and retry.';
        done(new Error(`${reason} Your draft is saved.`));
      },
    });
    const abort = () => {
      void upload
        .abort()
        .finally(() => done(new Error('Upload cancelled. Your saved draft is still available.')));
    };
    signal.addEventListener('abort', abort, { once: true });
    upload.start();
  });
  if (signal.aborted)
    throw new Error('Upload cancelled before verification. Retry verification from your draft.');
  return edge<Submission>('manuscripts', { action: 'verify_upload', file_id: prepared.file_id });
}
export const verifyUpload = (fileId: string) =>
  edge<Submission>('manuscripts', { action: 'verify_upload', file_id: fileId });
export const cleanupUploads = (submissionId: string) =>
  edge<{ removed: number; pending: number; note: string }>('manuscripts', {
    action: 'cleanup',
    submission_id: submissionId,
  });
export const markRead = (id: string) => command('mark_notification_read', { p_id: id });
export const setMessageState = (id: string, state: ContactMessage['state']) =>
  command('handle_contact_message', { p_id: id, p_state: state });
export async function contactMessages(page: number) {
  const { data, count, error } = await getSupabase()
    .from('contact_messages')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data as ContactMessage[], count: count ?? 0 };
}
