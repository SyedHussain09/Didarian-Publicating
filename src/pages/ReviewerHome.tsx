import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { readingList, writeActivity, type ReadingKind, type ReadingItem } from '../lib/community';
import { Page, Loading, Feedback, Pagination, formatDate, errorMessage } from '../components/UI';
import { ConfirmDialog } from '../features/portal/shared';
import { CommentText } from '../components/CommentText';

export default function ReviewerHome() {
  const { user, profile } = useAuth();
  const cache = useQueryClient();
  const [kind, setKind] = useState<ReadingKind>('saved');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReadingItem | null>(null);
  const [editing, setEditing] = useState<ReadingItem | null>(null);
  const [body, setBody] = useState('');
  const result = useQuery({
    queryKey: ['reading-list', user?.id, kind, page],
    queryFn: () => readingList(kind, page),
    refetchInterval: 30_000,
  });
  async function change(
    item: ReadingItem,
    action: 'like' | 'save' | 'delete_comment' | 'edit_comment',
  ) {
    setBusy(true);
    setError(null);
    try {
      await writeActivity(item.id, action, {
        enabled: false,
        comment: item.comment_id ? { id: item.comment_id, version: item.version! } : undefined,
        body,
      });
      setDeleting(null);
      setEditing(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['reading-list'] }),
        cache.invalidateQueries({ queryKey: ['community', item.id] }),
      ]);
      if (action !== 'edit_comment' && result.data?.rows.length === 1 && page > 0)
        setPage(page - 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Reviewer workspace"
      actions={
        <Link className="btn-secondary" to="/articles">
          Explore research ↗
        </Link>
      }
    >
      <p className="mb-5 text-sm text-slate-600">
        Welcome, @{profile?.username}. Keep your reading list and research conversations in one
        place.
      </p>
      <div className="workspace-tabs" role="group" aria-label="Reading list filter">
        {(['saved', 'liked', 'comments'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setPage(0);
              setEditing(null);
            }}
            disabled={busy}
          >
            {value === 'saved'
              ? 'Saved articles'
              : value === 'liked'
                ? 'Liked articles'
                : 'My comments'}
          </button>
        ))}
      </div>
      <Feedback error={deleting ? null : error} />
      {result.isPending ? (
        <Loading>Loading your library…</Loading>
      ) : result.isError ? (
        <>
          <Feedback error={errorMessage(result.error)} />
          <button className="btn-secondary" onClick={() => void result.refetch()}>
            Retry
          </button>
        </>
      ) : (
        <>
          {!result.data.rows.length && (
            <div className="card py-10">
              <h2 className="font-serif text-xl mb-2">
                {page > 0 ? 'No more items on this page' : 'Your collection starts here'}
              </h2>
              <p className="text-sm text-slate-600">
                {kind === 'comments'
                  ? 'Your comments will appear here after you join a discussion.'
                  : `Articles you ${kind === 'saved' ? 'save' : 'like'} will appear here.`}
              </p>
              <Link className="text-link mt-4 inline-block" to="/articles">
                Find a paper to read →
              </Link>
            </div>
          )}
          <div className="space-y-4">
            {result.data.rows.map((item) => (
              <article className="card" key={item.comment_id || item.id}>
                <p className="eyebrow mb-2">{item.category}</p>
                <h2 className="font-serif text-xl text-slate-900">
                  {item.deleted_at ? (
                    item.title
                  ) : (
                    <Link to={`/articles/${item.slug}#discussion`}>{item.title}</Link>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-2">
                  {item.author_names} · {formatDate(item.created_at)}
                </p>
                {item.deleted_at && (
                  <p className="text-sm text-amber-800 mt-3">
                    This publication has been removed from the public library.
                  </p>
                )}
                {item.body && <CommentText body={item.body} />}
                {editing?.comment_id === item.comment_id && editing && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void change(item, 'edit_comment');
                    }}
                    className="mt-4"
                  >
                    <label>
                      Edit comment
                      <textarea
                        required
                        maxLength={4000}
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        rows={4}
                        disabled={busy}
                      />
                    </label>
                    <div className="flex gap-3 mt-3">
                      <button className="btn" disabled={busy || !body.trim()}>
                        Save changes
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <div className="flex flex-wrap gap-4 mt-4 text-sm">
                  {!item.deleted_at && (
                    <Link className="text-link" to={`/articles/${item.slug}#discussion`}>
                      Open article →
                    </Link>
                  )}
                  {kind === 'comments' ? (
                    <>
                      {!item.deleted_at && (
                        <button
                          disabled={busy}
                          className="text-link"
                          onClick={() => {
                            setEditing(item);
                            setBody(item.body || '');
                          }}
                        >
                          Edit comment
                        </button>
                      )}
                      <button
                        disabled={busy}
                        className="text-red-700"
                        onClick={() => {
                          setDeleting(item);
                          setError(null);
                        }}
                      >
                        Delete comment
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      className="text-link"
                      onClick={() => void change(item, kind === 'saved' ? 'save' : 'like')}
                    >
                      {kind === 'saved' ? 'Remove from saved' : 'Unlike'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {(result.data.count > 5 || page > 0) && (
            <Pagination page={page} total={result.data.count} pageSize={5} onChange={setPage} />
          )}
        </>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete your comment?"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={() => void change(deleting, 'delete_comment')}
        >
          <p>This removes your comment from the article and your activity. It cannot be undone.</p>
          <Feedback error={error} />
        </ConfirmDialog>
      )}
    </Page>
  );
}
