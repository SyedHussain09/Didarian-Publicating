import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { roleHome } from '../auth/routes';
import { getSupabase } from '../lib/supabase';
import { markRead } from '../lib/api';
import { Page, Loading, Feedback, Pagination, formatDate, errorMessage } from '../components/UI';

export default function Notifications() {
  const { user, role, profile, loading, error: accountError } = useAuth();
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cache = useQueryClient();
  const result = useQuery({
    queryKey: ['private', user?.id, 'notification-inbox', page],
    enabled: !!user && !!profile?.profile_complete,
    queryFn: async () => {
      const { data, count, error } = await getSupabase()
        .from('notifications')
        .select('*, article:articles(slug)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id')
        .range(page * 5, page * 5 + 4);
      if (error) throw error;
      return { rows: data || [], count: count || 0 };
    },
    refetchInterval: 15_000,
  });
  if (loading)
    return (
      <Page title="Notifications">
        <Loading>Checking your account…</Loading>
      </Page>
    );
  if (accountError)
    return (
      <Page title="Notifications">
        <Feedback error={accountError} />
      </Page>
    );
  if (!user || !role) return <Navigate replace to="/login?next=/notifications" />;
  if (!profile?.profile_complete)
    return <Navigate replace to="/account/setup?next=/notifications" />;
  async function read(id: string) {
    setBusy(id);
    setError(null);
    try {
      await markRead(id);
      await cache.invalidateQueries({ queryKey: ['private'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Page
      title="Notifications"
      narrow
      actions={
        <Link className="text-link" to={roleHome(role)}>
          Your workspace
        </Link>
      }
    >
      <p className="mb-5 text-sm text-slate-600">
        Publication updates and research activity, delivered here. No notification emails are sent.
      </p>
      <Feedback error={error} />
      {result.isPending ? (
        <Loading>Loading notifications…</Loading>
      ) : result.isError ? (
        <>
          <Feedback error={errorMessage(result.error)} />
          <button className="btn-secondary" onClick={() => void result.refetch()}>
            Retry
          </button>
        </>
      ) : (
        <>
          {!result.data.rows.length ? (
            <div className="card">
              <h2 className="font-serif text-xl mb-2">You’re all caught up</h2>
              <p className="text-sm text-slate-500">New activity will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {result.data.rows.map((item) => (
                <li key={item.id} className={`card ${item.read_at ? '' : 'notification-unread'}`}>
                  <p className="text-sm leading-relaxed">{item.message}</p>
                  <div className="flex flex-wrap gap-4 items-center text-xs mt-3">
                    <time className="text-slate-500" dateTime={item.created_at}>
                      {formatDate(item.created_at)}
                    </time>
                    {item.article?.slug ? (
                      <Link className="text-link" to={`/articles/${item.article.slug}#discussion`}>
                        Open article
                      </Link>
                    ) : (
                      role !== 'reviewer' && (
                        <Link
                          className="text-link"
                          to={`${roleHome(role)}/submissions/${item.submission_id}`}
                        >
                          Open manuscript
                        </Link>
                      )
                    )}
                    {!item.read_at ? (
                      <button
                        disabled={!!busy}
                        className="text-link"
                        onClick={() => void read(item.id)}
                      >
                        {busy === item.id ? 'Updating…' : 'Mark read'}
                      </button>
                    ) : (
                      <span className="text-slate-500">Read</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(result.data.count > 5 || page > 0) && (
            <Pagination page={page} total={result.data.count} pageSize={5} onChange={setPage} />
          )}
        </>
      )}
    </Page>
  );
}
