import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { contactMessages, setMessageState } from '../../lib/api';
import { errorMessage } from '../../lib/validation';
import { Feedback, Pagination, PortalHeader, panel, secondary, date } from './shared';
export function AdminMessages() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['private', user?.id, 'messages', page],
    queryFn: () => contactMessages(page),
    refetchInterval: 30_000,
  });
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PortalHeader admin title="Contact Messages" />
      <p className="mb-5 text-sm text-slate-500">
        Messages submitted through the contact form. Changing their state does not send an email.
      </p>
      {error && <Feedback error>{error}</Feedback>}
      {query.isPending ? (
        <p role="status">Loading messages…</p>
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
        <>
          <div className="space-y-5">
            {query.data.rows.length ? (
              query.data.rows.map((message) => (
                <article key={message.id} className="message-card">
                  <details name="inbox-message">
                    <summary className="message-summary">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">{message.name}</h2>
                          <p className="break-all text-sm text-slate-500">{message.email}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">
                          {message.state}
                        </span>
                      </div>
                      <span className="block mt-2 text-xs text-brand-700">
                        Read message <span aria-hidden="true">↓</span>
                      </span>
                    </summary>
                    <div className="message-body">
                      <p className="my-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.message}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <time className="text-xs text-slate-500">{date(message.created_at)}</time>
                        <div className="flex gap-2">
                          {(['read', 'handled'] as const)
                            .filter((state) => state !== message.state)
                            .map((state) => (
                              <button
                                className={secondary}
                                key={state}
                                disabled={busy === message.id}
                                onClick={() => {
                                  setBusy(message.id);
                                  setError('');
                                  void setMessageState(message.id, state)
                                    .then(() => cache.invalidateQueries({ queryKey: ['private'] }))
                                    .catch((e) => setError(errorMessage(e)))
                                    .finally(() => setBusy(null));
                                }}
                              >
                                Mark {state}
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  </details>
                </article>
              ))
            ) : (
              <p className={panel}>No contact messages yet.</p>
            )}
          </div>
          <Pagination page={page} count={query.data.count} onChange={setPage} />
        </>
      )}
    </section>
  );
}
