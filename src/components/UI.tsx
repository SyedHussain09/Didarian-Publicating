import type { ReactNode } from 'react';

export function Page({
  title,
  children,
  narrow = false,
  actions,
}: {
  title: string;
  children: ReactNode;
  narrow?: boolean;
  actions?: ReactNode;
}) {
  return (
    <section className="page-section">
      <div className={narrow ? 'site-container narrow-container' : 'site-container'}>
        <div className="page-heading">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900">{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <p role="status" className="text-sm text-slate-600 py-6 flex items-center gap-3">
      <span className="loading-dot" aria-hidden="true" />
      {children}
    </p>
  );
}
export function Feedback({ error, success }: { error?: string | null; success?: string | null }) {
  return (
    <>
      {error && (
        <div role="alert" className="feedback error">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="feedback success">
          {success}
        </div>
      )}
    </>
  );
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card text-center py-12">
      <h2 className="font-serif text-xl font-bold text-slate-900 mb-2">{title}</h2>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="pagination-bar">
      <button className="btn-secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="text-sm text-slate-600">
        Page {page + 1} of {pages}
      </span>
      <button
        className="btn-secondary"
        disabled={page + 1 >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Please retry.';
}
export function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value))
    : '—';
}
