import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import {
  articleForSubmission,
  cleanupUploads,
  decide,
  getEvents,
  getFiles,
  getSubmission,
  resolveDownload,
  verifyUpload,
  type DecisionCommand,
} from '../../lib/api';
import { statusLabels, type Submission } from '../../lib/models';
import { errorMessage } from '../../lib/validation';
import {
  Badge,
  ConfirmDialog,
  Feedback,
  PortalHeader,
  button,
  secondary,
  field,
  panel,
  date,
  usePortalRefresh,
} from './shared';
import { SubmissionEditor } from './SubmissionEditor';

export function SubmissionDetail({ admin = false }: { admin?: boolean }) {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [confirmation, setConfirmation] = useState<DecisionCommand | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const blocked = busy || editingBusy;
  usePortalRefresh(id);
  const query = useQuery({
    queryKey: ['private', user?.id, 'submission', id],
    queryFn: () => getSubmission(id),
    refetchInterval: 30_000,
  });
  const files = useQuery({
    queryKey: ['private', user?.id, 'files', id],
    queryFn: () => getFiles(id),
    enabled: !!query.data,
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ['private', user?.id, 'events', id],
    queryFn: () => getEvents(id),
    enabled: !!query.data,
    refetchInterval: 30_000,
  });
  const article = useQuery({
    queryKey: ['private', user?.id, 'published-link', id, query.data?.status],
    queryFn: () => articleForSubmission(id),
    enabled: query.data?.status === 'published',
  });
  async function refresh(result?: Submission) {
    if (result) cache.setQueryData(['private', user?.id, 'submission', id], result);
    await cache.invalidateQueries({ queryKey: ['private'] });
    await cache.invalidateQueries({ queryKey: ['articles'] });
  }
  async function run(command: DecisionCommand) {
    if (!query.data) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await decide(command, query.data, feedback);
      await refresh(result);
      setNotice(statusLabels[result.status]);
      setConfirmation(null);
    } catch (error) {
      setError(errorMessage(error));
      setConfirmation(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function download(fileId: string) {
    setBusy(true);
    setError('');
    try {
      const url = await resolveDownload({ file_id: fileId });
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const current = query.data;
  const selected = files.data?.find((f) => f.id === current?.current_file_id);
  const canEdit = current?.status === 'draft' && current.owner_id === user?.id;
  const reviewable = admin && current && ['submitted', 'under_review'].includes(current.status);
  const stage =
    current?.status === 'draft'
      ? 0
      : current?.status === 'submitted'
        ? 1
        : current?.status === 'under_review'
          ? 2
          : 3;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PortalHeader title={admin ? 'Manuscript Review' : 'Submission Details'} admin={admin} />
      {query.isPending ? (
        <p role="status" className={panel}>
          Loading submission…
        </p>
      ) : query.isError ? (
        <Feedback error>
          {errorMessage(query.error)}{' '}
          <button
            className="underline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </button>
        </Feedback>
      ) : (
        current && (
          <>
            <div className={`${panel} mb-6`}>
              <div className="flex flex-wrap justify-between gap-3">
                <span className="font-mono text-xs text-slate-500">
                  Reference {current.id.slice(0, 8).toUpperCase()}
                </span>
                <Badge status={current.status} />
              </div>
              <h2 className="my-4 break-words font-serif text-2xl font-bold">
                {current.title || 'Untitled draft'}
              </h2>
              <p className="text-sm text-slate-500">
                {current.author_names} · {current.category || 'No category selected'}
              </p>
              {admin && current.submitter && (
                <p className="mt-2 text-xs text-slate-500">
                  Submitted by {current.submitter.first_name} {current.submitter.last_name}
                  {current.submitter.affiliation ? ` · ${current.submitter.affiliation}` : ''}
                </p>
              )}
              <ol
                aria-label="Submission progress"
                className="mt-6 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4"
              >
                {[
                  'Save draft',
                  'Submit for review',
                  'Review',
                  current.status === 'rejected' ? 'Rejected' : 'Publish',
                ].map((text, index) => (
                  <li
                    key={text}
                    className={`flex items-center gap-2 ${stage >= index ? 'font-semibold text-brand-900' : 'text-slate-500'}`}
                    aria-current={stage === index ? 'step' : undefined}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${stage >= index ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
                    >
                      {index + 1}
                    </span>
                    {text}
                  </li>
                ))}
              </ol>
              <dl className="mt-5 grid gap-3 text-xs text-slate-500 sm:grid-cols-2">
                <div>
                  <dt className="font-medium">Saved</dt>
                  <dd>{date(current.created_at)}</dd>
                </div>
                <div>
                  <dt className="font-medium">Submitted</dt>
                  <dd>{date(current.submitted_at)}</dd>
                </div>
              </dl>
            </div>
            {error && <Feedback error>{error}</Feedback>}
            {notice && <Feedback>{notice}</Feedback>}
            {canEdit ? (
              <SubmissionEditor
                key={current.id}
                current={current}
                onBusyChange={setEditingBusy}
                admin={admin}
                onSaved={(result) => {
                  void refresh(result);
                  setNotice(
                    'Draft saved. Review the verified file below, then choose the next action.',
                  );
                }}
              />
            ) : (
              <section className={`${panel} mb-6`}>
                <h3 className="mb-3 text-base font-bold">Abstract</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">
                  {current.abstract}
                </p>
                {current.keywords.length > 0 && (
                  <p className="mt-4 text-xs text-slate-500">
                    Keywords: {current.keywords.join(', ')}
                  </p>
                )}
              </section>
            )}
            <section className={`${panel} my-6`}>
              <h3 className="mb-4 text-base font-bold">Manuscript</h3>
              {files.isPending ? (
                <p role="status">Loading manuscript…</p>
              ) : files.isError ? (
                <Feedback error>Manuscript metadata could not be loaded.</Feedback>
              ) : selected ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium">{selected.original_name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Version {selected.version} · {(selected.byte_size / 1024 / 1024).toFixed(2)}{' '}
                      MB ·{' '}
                      {selected.verification_state === 'verified'
                        ? 'File verified'
                        : 'Verification pending'}
                    </p>
                  </div>
                  <button
                    className={secondary}
                    disabled={blocked || selected.verification_state !== 'verified'}
                    onClick={() => {
                      void download(selected.id);
                    }}
                  >
                    Download manuscript
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No verified manuscript has been attached yet.
                </p>
              )}
              {canEdit &&
                files.data
                  ?.filter((f) => f.verification_state === 'pending')
                  .map((f) => (
                    <div key={f.id} className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                      <p className="break-all">Pending upload: {f.original_name}</p>
                      <button
                        className="mt-2 text-brand-600 underline disabled:opacity-50"
                        disabled={blocked}
                        onClick={() => {
                          setBusy(true);
                          setError('');
                          void verifyUpload(f.id)
                            .then(refresh)
                            .catch((e) => setError(errorMessage(e)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Retry verification
                      </button>
                    </div>
                  ))}
              {canEdit && !!files.data?.some((f) => f.id !== current.current_file_id) && (
                <button
                  className="mt-4 text-xs text-slate-500 underline"
                  disabled={blocked}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void cleanupUploads(id)
                      .then(async (result) => {
                        await refresh();
                        setNotice(
                          result.removed
                            ? `${result.removed} unused draft upload(s) removed. ${result.pending} pending cleanup.`
                            : result.note,
                        );
                      })
                      .catch((e) => setError(errorMessage(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Clean up unused draft uploads
                </button>
              )}
            </section>
            {canEdit && (
              <section className={`${panel} mb-6`}>
                <h3 className="mb-3 font-bold">Ready for the next step?</h3>
                <p className="mb-4 text-sm leading-relaxed text-slate-500">
                  The saved metadata and verified manuscript will be used.{' '}
                  {admin
                    ? 'Publishing makes this work and its selected file public immediately.'
                    : 'After submission, the manuscript and metadata are locked for review.'}
                </p>
                <button
                  className={button}
                  disabled={
                    blocked ||
                    !selected ||
                    selected.verification_state !== 'verified' ||
                    !current.publication_consent
                  }
                  onClick={() =>
                    setConfirmation(admin ? 'publish_admin_article' : 'submit_submission')
                  }
                >
                  {admin ? 'Publish Article' : 'Submit for Review'}
                </button>
              </section>
            )}
            {reviewable && (
              <section className={`${panel} mb-6`}>
                <h3 className="mb-4 text-base font-bold">Editorial decision</h3>
                <label className="block text-sm font-medium">
                  Feedback visible to the author
                  <textarea
                    className={`${field} mt-1`}
                    rows={4}
                    maxLength={4000}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Required for rejection; optional when publishing."
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  {current.status === 'submitted' && (
                    <button
                      disabled={blocked}
                      className={secondary}
                      onClick={() => {
                        void run('start_review');
                      }}
                    >
                      Start Review
                    </button>
                  )}
                  <button
                    disabled={blocked}
                    className={button}
                    onClick={() => setConfirmation('accept_and_publish')}
                  >
                    Accept &amp; Publish
                  </button>
                  <button
                    disabled={blocked || feedback.trim().length < 3}
                    className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => setConfirmation('reject_submission')}
                  >
                    Reject
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Acceptance and publication happen together. Only one final decision can succeed.
                </p>
              </section>
            )}
            {current.status === 'published' &&
              (article.data ? (
                <Feedback>
                  Approved and published.{' '}
                  <Link className="font-medium underline" to={`/articles/${article.data}`}>
                    View the public article
                  </Link>
                </Feedback>
              ) : article.isError ? (
                <Feedback error>
                  The publication link could not be loaded.{' '}
                  <button
                    className="underline"
                    onClick={() => {
                      void article.refetch();
                    }}
                  >
                    Retry
                  </button>
                </Feedback>
              ) : (
                <p role="status">Loading publication link…</p>
              ))}
            <section className={panel}>
              <h3 className="mb-4 text-base font-bold">Status history</h3>
              {events.isPending ? (
                <p role="status">Loading history…</p>
              ) : events.isError ? (
                <Feedback error>History could not be loaded.</Feedback>
              ) : !events.data?.length ? (
                <p className="text-sm text-slate-500">This draft has not been submitted yet.</p>
              ) : (
                <ol className="space-y-5">
                  {events.data.map((event) => (
                    <li key={event.id} className="border-l-2 border-brand-100 pl-4">
                      <p className="text-sm font-semibold">
                        {event.kind === 'accepted'
                          ? 'Accepted for publication'
                          : event.kind === 'review_started'
                            ? 'Review started'
                            : statusLabels[event.to_status]}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                      {event.feedback && (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">
                          {event.feedback}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )
      )}
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation === 'reject_submission'
              ? 'Reject this manuscript?'
              : confirmation === 'submit_submission'
                ? 'Submit for review?'
                : 'Publish this article?'
          }
          busy={busy}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            void run(confirmation);
          }}
        >
          {confirmation === 'reject_submission' ? (
            <>
              <p>The author will see this reason. The manuscript will remain private.</p>
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3">{feedback}</p>
            </>
          ) : confirmation === 'submit_submission' ? (
            'The saved draft and verified file will enter the review queue. You cannot edit them after submission.'
          ) : (
            'The current title, abstract, author names, category, keywords, and selected manuscript will be publicly available immediately. This action also records the approval and notifies the author.'
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
