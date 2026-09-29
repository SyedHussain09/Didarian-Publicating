import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Pagination as NotificationPagination } from '../../components/UI';
import {
  downloadTemplate,
  getNotifications,
  listSubmissions,
  markRead,
  submissionCounts,
} from '../../lib/api';
import { errorMessage } from '../../lib/validation';
import { statusLabels, statuses, type Status } from '../../lib/models';
import {
  Badge,
  Feedback,
  Pagination,
  PortalHeader,
  button,
  secondary,
  field,
  panel,
  date,
  usePortalRefresh,
} from './shared';

export function Resources() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async (format: 'doc' | 'tex') => {
    setBusy(true);
    setError('');
    try {
      await downloadTemplate(format);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={panel}>
      <h2 className="mb-4 text-base font-bold">Resources</h2>
      <div className="flex flex-col items-start gap-3">
        <button
          disabled={busy}
          className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50"
          onClick={() => {
            void download('doc');
          }}
        >
          ↓ Download Template (Word)
        </button>
        <button
          disabled={busy}
          className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50"
          onClick={() => {
            void download('tex');
          }}
        >
          ↓ Download Template (LaTeX)
        </button>
      </div>
      {busy && (
        <p role="status" className="mt-3 text-sm">
          Downloading template…
        </p>
      )}
      {error && <Feedback error>{error}</Feedback>}
    </section>
  );
}
export function PortalHome({ admin = false }: { admin?: boolean }) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [notificationPage, setNotificationPage] = useState(0);
  const [filter, setFilter] = useState<Status | ''>('');
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  usePortalRefresh();
  const list = useQuery({
    queryKey: ['private', user?.id, 'submissions', page, filter, search],
    queryFn: () => listSubmissions(page, filter, search),
    refetchInterval: 30_000,
  });
  const counts = useQuery({
    queryKey: ['private', user?.id, 'counts'],
    queryFn: submissionCounts,
    enabled: admin,
    refetchInterval: 30_000,
  });
  const notifications = useQuery({
    queryKey: ['private', user?.id, 'notifications'],
    queryFn: getNotifications,
    enabled: !admin,
    refetchInterval: 30_000,
  });
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setSearch(input);
  };
  const currentNotificationPage = Math.min(
    notificationPage,
    Math.max(0, Math.ceil((notifications.data?.length || 0) / 4) - 1),
  );
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PortalHeader title={admin ? 'Admin Dashboard' : 'Author Portal'} admin={admin} />
      {admin && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(['submitted', 'under_review', 'published', 'rejected'] as const).map((status) => (
            <div key={status} className={panel}>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {status === 'published' ? 'Published' : statusLabels[status]}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {counts.isPending ? '…' : counts.isError ? '—' : counts.data?.[status]}
              </p>
            </div>
          ))}
        </div>
      )}
      {counts.isError && (
        <Feedback error>
          Counts could not be loaded.{' '}
          <button
            className="underline"
            onClick={() => {
              void counts.refetch();
            }}
          >
            Retry
          </button>
        </Feedback>
      )}
      <div className="mb-5 flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">{admin ? 'Manuscripts' : 'My submissions'}</h2>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Link className={secondary} to="/admin/messages">
              Contact messages
            </Link>
          )}
          <Link className={button} to={admin ? '/admin/articles/new' : '/author/submissions/new'}>
            {admin ? 'Create Article' : 'New Submission'}
          </Link>
        </div>
      </div>
      <form onSubmit={submitSearch} className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="text-xs font-medium">
          Search titles
          <input
            className={`${field} mt-1`}
            value={input}
            maxLength={120}
            onChange={(e) => setInput(e.target.value)}
            type="search"
            placeholder="Search manuscript titles"
          />
        </label>
        <label className="text-xs font-medium">
          Status
          <select
            className={`${field} mt-1`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Status | '');
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <button className={`${secondary} self-end`} type="submit">
          Search
        </button>
      </form>
      {list.isPending ? (
        <p role="status" className={panel}>
          Loading submissions…
        </p>
      ) : list.isError ? (
        <Feedback error>
          {errorMessage(list.error)}{' '}
          <button
            onClick={() => {
              void list.refetch();
            }}
            className="underline"
          >
            Retry
          </button>
        </Feedback>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                {admin ? 'Review queue and publications' : 'Your saved submissions'}
              </caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reference / Title</th>
                  {admin && <th className="px-4 py-3">Submitting author</th>}
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="min-w-52 max-w-sm px-4 py-4">
                      <span className="mb-1 block font-mono text-xs text-slate-400">
                        {row.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="font-medium text-slate-900">
                        {row.title || 'Untitled draft'}
                      </span>
                    </td>
                    {admin && (
                      <td className="max-w-56 px-4 py-4">
                        {row.submitter
                          ? [row.submitter.first_name, row.submitter.last_name].join(' ')
                          : 'Author details unavailable'}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-4 text-slate-500">
                      {date(row.submitted_at)}
                    </td>
                    <td className="px-4 py-4">
                      <Badge status={row.status} />
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        className="font-medium text-brand-600 hover:underline"
                        to={`${admin ? '/admin' : '/author'}/submissions/${row.id}`}
                      >
                        {admin && ['submitted', 'under_review'].includes(row.status)
                          ? 'Review'
                          : 'Details'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.data.rows.length && (
              <p className="p-8 text-center text-sm text-slate-500">
                {filter || search
                  ? 'No submissions match your search.'
                  : admin
                    ? 'No manuscripts are available yet.'
                    : 'You have no submissions yet. Start with New Submission.'}
              </p>
            )}
          </div>
          <Pagination page={page} count={list.data.count} onChange={setPage} />
        </>
      )}
      {!admin && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Resources />
          <section className={panel}>
            <h2 className="mb-4 text-base font-bold">Notifications</h2>
            {notifications.isPending ? (
              <p role="status">Loading notifications…</p>
            ) : notifications.isError ? (
              <Feedback error>Notifications could not be loaded.</Feedback>
            ) : !notifications.data?.length ? (
              <p className="text-sm text-slate-500">
                Decisions and status changes will appear here.
              </p>
            ) : (
              <ul className="space-y-4">
                {notifications.data
                  .slice(currentNotificationPage * 4, (currentNotificationPage + 1) * 4)
                  .map((n) => (
                    <li key={n.id} className="border-b border-slate-100 pb-3 text-sm">
                      <Link
                        className="text-brand-600 hover:underline"
                        to={`/author/submissions/${n.submission_id}`}
                      >
                        {n.message}
                      </Link>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                        <span>{date(n.created_at)}</span>
                        {n.read_at ? (
                          <span>Read</span>
                        ) : (
                          <button
                            className="underline"
                            onClick={() => {
                              void markRead(n.id)
                                .then(() => cache.invalidateQueries({ queryKey: ['private'] }))
                                .catch((e) => setError(errorMessage(e)));
                            }}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            {notifications.data && notifications.data.length > 4 && (
              <NotificationPagination
                page={currentNotificationPage}
                total={notifications.data.length}
                pageSize={4}
                onChange={setNotificationPage}
              />
            )}
            {error && <Feedback error>{error}</Feedback>}
          </section>
        </div>
      )}
    </section>
  );
}
