import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { adminPublications, moderateArticle, type ManagedArticle } from '../lib/community';
import { Page, Loading, Feedback, Pagination, formatDate, errorMessage } from '../components/UI';
import { ConfirmDialog } from '../features/portal/shared';

export default function AdminPublications() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [removed, setRemoved] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ManagedArticle | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ['private', user?.id, 'publications', page, removed],
    queryFn: () => adminPublications(page, removed),
  });
  async function confirm() {
    if (!selected || busy) return;
    if (reason.trim().length < 3) {
      setError('Enter a reason of at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await moderateArticle(selected.id, !selected.deleted_at, reason.trim());
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['private'] }),
        cache.invalidateQueries({ queryKey: ['articles'] }),
        cache.invalidateQueries({ queryKey: ['article'] }),
        cache.invalidateQueries({ queryKey: ['community'] }),
      ]);
      setSelected(null);
      if (result.data?.rows.length === 1 && page > 0) setPage(page - 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Publication moderation"
      actions={
        <Link className="text-link" to="/admin">
          Admin Dashboard
        </Link>
      }
    >
      <p className="mb-5 text-sm text-slate-600">
        Manage public availability. Open an article to moderate its comments. Article removals can
        be restored; every decision records your reason.
      </p>
      <div className="workspace-tabs" role="group" aria-label="Publication status">
        <button
          aria-pressed={!removed}
          onClick={() => {
            setRemoved(false);
            setPage(0);
          }}
        >
          Published
        </button>
        <button
          aria-pressed={removed}
          onClick={() => {
            setRemoved(true);
            setPage(0);
          }}
        >
          Removed
        </button>
      </div>
      {result.isPending ? (
        <Loading>Loading publications…</Loading>
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
            <p className="card text-sm text-slate-600">
              No {removed ? 'removed' : 'published'} articles on this page.
            </p>
          )}
          <div className="space-y-4">
            {result.data.rows.map((article) => (
              <article className="card" key={article.id}>
                <p className="eyebrow mb-2">{article.category}</p>
                <h2 className="font-serif text-xl">{article.title}</h2>
                <p className="text-xs text-slate-500 mt-2">
                  {article.author_names} · {formatDate(article.published_at)}
                </p>
                <div className="flex flex-wrap gap-4 mt-4 text-sm">
                  {!removed && (
                    <Link className="text-link" to={`/articles/${article.slug}#discussion`}>
                      Read article & moderate comments
                    </Link>
                  )}
                  <button
                    className={removed ? 'text-link' : 'text-red-700'}
                    onClick={() => {
                      setSelected(article);
                      setReason('');
                      setError(null);
                    }}
                  >
                    {removed ? 'Restore article' : 'Remove article'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {(result.data.count > 5 || page > 0) && (
            <Pagination page={page} total={result.data.count} pageSize={5} onChange={setPage} />
          )}
        </>
      )}
      {selected && (
        <ConfirmDialog
          title={selected.deleted_at ? 'Restore this article?' : 'Remove this article?'}
          busy={busy}
          onClose={() => setSelected(null)}
          onConfirm={() => void confirm()}
        >
          <p>
            {selected.deleted_at
              ? 'The article will return to the public library.'
              : 'The article, discussion and new downloads will no longer be publicly accessible. The manuscript record is preserved.'}
          </p>
          <label className="mt-4">
            Reason
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
          <p className="mt-2 text-xs">
            The submitting author receives this reason as a website notification.
          </p>
          <Feedback error={error} />
        </ConfirmDialog>
      )}
    </Page>
  );
}
