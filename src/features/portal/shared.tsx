import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { getSupabase } from '../../lib/supabase';
import { PAGE_SIZE } from '../../lib/api';
import { statusLabels, type Status } from '../../lib/models';
export const button = 'btn disabled:opacity-50 disabled:cursor-not-allowed';
export const secondary = 'btn-secondary disabled:opacity-50';
export const field =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
export const panel = 'card';
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Not submitted';
export function Badge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'published' ? 'bg-brand-50 text-brand-900' : status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-700'}`}
    >
      {statusLabels[status]}
    </span>
  );
}
export function Feedback({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`my-3 rounded-lg border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-brand-100 bg-brand-50 text-brand-900'}`}
    >
      {children}
    </div>
  );
}
export function Pagination({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>
        {count
          ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} of ${count}`
          : '0 results'}
      </span>
      <div className="flex gap-2">
        <button className={secondary} disabled={page === 0} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button
          className={secondary}
          disabled={(page + 1) * PAGE_SIZE >= count}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function PortalHeader({ title, admin = false }: { title: string; admin?: boolean }) {
  const { signOut } = useAuth();
  const [error, setError] = useState('');
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <h1 className="font-serif text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        <div className="flex flex-wrap gap-3">
          <Link className={secondary} to={admin ? '/admin' : '/author'}>
            Dashboard
          </Link>
          <button
            className={secondary}
            onClick={() => {
              void signOut().catch(() => setError('Could not end the session. Please retry.'));
            }}
          >
            Log Out
          </button>
        </div>
      </div>
      {error && <Feedback error>{error}</Feedback>}
    </>
  );
}
export function ConfirmDialog({
  title,
  children,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="decision-title"
      aria-describedby="decision-description"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled, [aria-disabled="true"], [hidden]') &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-900/40"
    >
      <h2 id="decision-title" className="mb-3 font-serif text-2xl font-bold">
        {title}
      </h2>
      <div id="decision-description" className="text-sm leading-relaxed text-slate-600">
        {children}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button autoFocus disabled={busy} className={secondary} onClick={onClose}>
          Cancel
        </button>
        <button disabled={busy} className={button} onClick={onConfirm}>
          {busy ? 'Saving decision…' : 'Confirm decision'}
        </button>
      </div>
    </dialog>
  );
}
export function usePortalRefresh(id?: string) {
  const { user } = useAuth();
  const cache = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const client = getSupabase();
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: ['private'] });
      void cache.invalidateQueries({ queryKey: ['articles'] });
    };
    const channel = client
      .channel(`portal:${user.id}:${id ?? 'list'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          ...(id ? { filter: `id=eq.${id}` } : {}),
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [user, id, cache]);
}
