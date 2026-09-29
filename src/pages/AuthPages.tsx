import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { roleReturnPath, safeReturnPath } from '../auth/routes';
import { getSupabase, getSupabaseError, isGoogleSignInEnabled, siteUrl } from '../lib/supabase';
import { Feedback, Loading } from '../components/UI';

const RETURN_PATH_KEY = 'didarian:google-return-path';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page-section">
      <div className="max-w-md mx-auto px-4 sm:px-6">
        <div className="card sm:p-8 mt-4">
          <h1 className="text-2xl font-serif font-bold text-slate-900 text-center mb-6">{title}</h1>
          {children}
        </div>
      </div>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20" className="shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.02 46.98 31.88 46.98 24.55Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}

function GoogleAccess({ register = false }: { register?: boolean }) {
  const { user, role, loading, error: accountError, refresh, signOut } = useAuth();
  const [search] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const configurationError = getSupabaseError();

  useEffect(() => {
    const returned = () => {
      inFlight.current = false;
      setBusy(false);
    };
    window.addEventListener('pageshow', returned);
    return () => window.removeEventListener('pageshow', returned);
  }, []);

  if (!loading && user && role)
    return <Navigate replace to={roleReturnPath(search.get('next'), role)} />;

  const continueWithGoogle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await isGoogleSignInEnabled()))
        throw new Error(
          'Google sign-in is temporarily unavailable. Please try again later or contact us.',
        );
      // Store only an internal navigation path, never OAuth tokens or role claims.
      try {
        const next = search.get('next');
        if (next) sessionStorage.setItem(RETURN_PATH_KEY, safeReturnPath(next));
        else sessionStorage.removeItem(RETURN_PATH_KEY);
      } catch {
        // Sign-in still works if this optional navigation preference cannot be stored.
      }
      const result = await getSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: siteUrl + '/auth/callback',
          scopes: 'openid email profile',
          queryParams: { prompt: 'select_account' },
        },
      });
      if (result.error || !result.data.url)
        throw new Error('Google sign-in could not be started. Please try again.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Google sign-in could not be started. Please try again.',
      );
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell title={register ? 'Create Account' : 'Welcome Back'}>
      <p className="text-sm text-slate-600 text-center mb-6">
        {register
          ? 'Use your Google account to join Didarian Publicating and submit your research.'
          : 'Continue with your Google account to access your publications and submissions.'}
      </p>
      <Feedback error={configurationError || error || accountError} />
      {loading ? (
        <Loading>Checking your session…</Loading>
      ) : (
        <button
          type="button"
          className="w-full min-h-11 flex items-center justify-center gap-3 rounded-full border border-slate-400 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          onClick={() => void continueWithGoogle()}
          disabled={busy || !!configurationError}
          aria-busy={busy}
        >
          <GoogleMark />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
      )}
      <p className="text-sm text-slate-600 text-center mt-5">
        One Google account for sign-up and sign-in. New accounts receive author access.
      </p>
      <p className="text-xs text-slate-500 text-center mt-4">
        We use your Google name and email to create your profile. Read our{' '}
        <Link to="/privacy" className="text-link">
          Privacy Policy
        </Link>
        .
      </p>
      {accountError && (
        <div className="flex justify-center gap-4 mt-4 text-sm">
          <button type="button" className="text-link" onClick={() => void refresh()}>
            Retry account access
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              void signOut().catch(() => setError('Please refresh and try again.'));
            }}
          >
            Sign out
          </button>
        </div>
      )}
      {error && (
        <p className="text-center mt-4 text-sm">
          <Link to="/contact" className="text-link">
            Contact us for help
          </Link>
        </p>
      )}
    </Shell>
  );
}

export function Login() {
  return <GoogleAccess />;
}
export function Register() {
  return <GoogleAccess register />;
}

export function AuthCallback() {
  const { loading, user, role, error } = useAuth();
  const [initialLocation] = useState(() => ({
    search: window.location.search,
    hash: window.location.hash,
  }));
  const [callback, setCallback] = useState<{
    checking: boolean;
    error: string | null;
    next: string | null;
  }>({ checking: true, error: null, next: null });
  useEffect(() => {
    let active = true;
    const process = async () => {
      let next: string | null = null;
      try {
        const query = new URLSearchParams(initialLocation.search);
        const hash = new URLSearchParams(initialLocation.hash.slice(1));
        const providerError = query.get('error') || hash.get('error');
        if (providerError)
          throw new Error(
            providerError === 'access_denied'
              ? 'Google sign-in was cancelled. You can try again when you are ready.'
              : 'Google sign-in could not be completed. Please start again.',
          );
        // The SDK processes the PKCE code once and verifies the stored challenge.
        const initialized = await getSupabase().auth.initialize();
        if (initialized.error)
          throw new Error(
            'This sign-in attempt expired or could not be verified. Please start again in this browser.',
          );
        try {
          next = sessionStorage.getItem(RETURN_PATH_KEY);
        } catch {
          /* Optional preference. */
        }
        if (active) setCallback({ checking: false, error: null, next });
      } catch (caught) {
        if (active)
          setCallback({
            checking: false,
            error:
              caught instanceof Error
                ? caught.message
                : 'Google sign-in could not be completed. Please try again.',
            next: null,
          });
      } finally {
        // Do not leave authorization codes or provider error details in browser history.
        window.history.replaceState(window.history.state, '', '/auth/callback');
      }
    };
    void process();
    return () => {
      active = false;
    };
  }, [initialLocation]);

  useEffect(() => {
    if (!callback.checking) {
      try {
        sessionStorage.removeItem(RETURN_PATH_KEY);
      } catch {
        /* Optional preference. */
      }
    }
  }, [callback.checking]);

  if (callback.checking || loading)
    return (
      <Shell title="Signing You In">
        <Loading>Completing Google sign-in…</Loading>
      </Shell>
    );
  if (!callback.error && user && role)
    return <Navigate replace to={roleReturnPath(callback.next, role)} />;
  return (
    <Shell title="Sign-in Help">
      <Feedback
        error={
          callback.error ||
          error ||
          'No sign-in session was established. Please continue with Google again.'
        }
      />
      <Link className="btn w-full text-center" to="/login">
        Back to Sign In
      </Link>
    </Shell>
  );
}
