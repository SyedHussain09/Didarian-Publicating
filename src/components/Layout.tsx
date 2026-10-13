import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Feedback, errorMessage } from './UI';
import { Cursor } from './Cursor';
import { roleHome, roleLabel } from '../auth/routes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '../lib/supabase';

const navigation = [
  ['/', 'Home'],
  ['/articles', 'Articles'],
  ['/about', 'For Authors'],
  ['/editorial', 'Editorial Board'],
  ['/contact', 'Contact Us'],
];
export function Layout() {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const { user, role, profile, loading, signOut } = useAuth();
  const cache = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const client = getSupabase();
    const channel = client
      .channel(`notification-badge:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        () => {
          void cache.invalidateQueries({ queryKey: ['private', user.id] });
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [user, cache]);
  const unread = useQuery({
    queryKey: ['private', user?.id, 'unread-notifications'],
    enabled: !!user && !!profile?.profile_complete,
    queryFn: async () => {
      const { count, error } = await getSupabase()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30_000,
  });
  const location = useLocation();
  const navigate = useNavigate();
  const toggle = useRef<HTMLButtonElement>(null);
  const open = menuFor === location.key;
  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.pathname !== '/')
      document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setMenuFor(null);
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open]);
  const logout = async () => {
    setSigningOut(true);
    setLogoutError(null);
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setLogoutError(errorMessage(error));
    } finally {
      setSigningOut(false);
    }
  };
  const account =
    !loading && user && role ? (
      <details
        key={location.key}
        className="account-menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary className="btn py-1.5">
          {roleLabel(role)} <span aria-hidden="true">⌄</span>
          {!!unread.data && <span className="notification-dot" aria-label="Unread notifications" />}
        </summary>
        <div className="account-menu-panel">
          <Link
            className="btn py-1.5"
            to={profile?.profile_complete ? roleHome(role) : '/account/setup'}
          >
            {profile?.profile_complete ? roleLabel(role) : 'Complete profile'}
          </Link>
          <Link className="text-sm text-slate-600 hover:text-brand-600" to="/notifications">
            Notifications{unread.data ? ` (${unread.data > 99 ? '99+' : unread.data})` : ''}
          </Link>
          <Link className="text-sm text-slate-600 hover:text-brand-600" to="/account/profile">
            Profile
          </Link>
          <button
            className="text-sm text-slate-600 hover:text-brand-600"
            onClick={() => void logout()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Log Out'}
          </button>
        </div>
      </details>
    ) : (
      <Link className="btn py-1.5" to="/login">
        Sign In
      </Link>
    );
  return (
    <>
      <Cursor />
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <nav
        aria-label="Main navigation"
        className="site-navigation bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50"
      >
        <div className="site-container">
          <div className="flex justify-between items-center h-18 gap-4">
            <Link to="/" className="brand-lockup">
              <span className="brand-symbol" aria-hidden="true">
                g<span>.</span>
              </span>
              <span>
                GGC Research Publishing
                <span className="brand-caption" aria-hidden="true">
                  Research without boundaries
                </span>
              </span>
            </Link>
            <div className="hidden xl:flex items-center gap-5">
              {navigation.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                >
                  {label}
                </NavLink>
              ))}
              {account}
            </div>
            <button
              ref={toggle}
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="xl:hidden p-2 text-slate-600"
              onClick={() => setMenuFor(open ? null : location.key)}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d={open ? 'M6 6l12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'}
                />
              </svg>
            </button>
          </div>
        </div>
        <div
          id="mobile-menu"
          hidden={!open}
          className="xl:hidden bg-white border-t border-slate-100 absolute w-full shadow-lg"
        >
          <div className="px-4 pt-2 pb-4 space-y-1">
            {navigation.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMenuFor(null)}
                className={({ isActive }) =>
                  `block px-3 py-2 text-base font-medium rounded-md ${isActive ? 'text-brand-600 bg-brand-50' : 'text-slate-700 hover:bg-slate-50'}`
                }
              >
                {label}
              </NavLink>
            ))}
            <div className="flex items-center gap-4 px-3 pt-3">{account}</div>
          </div>
        </div>
      </nav>
      {logoutError && (
        <div className="max-w-7xl mx-auto w-full px-4 pt-4">
          <Feedback error={logoutError} />
        </div>
      )}
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-container flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-serif text-slate-900">GGC Research Publishing</span>
            <span className="block text-xs text-slate-500 mt-1">
              A home for ideas across disciplines.
            </span>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600"
          >
            <Link to="/articles">Browse research</Link>
            <Link to="/about">For authors</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
