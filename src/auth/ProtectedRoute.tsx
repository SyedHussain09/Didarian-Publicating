import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type AppRole } from './AuthProvider';
import { Feedback, Page, Loading } from '../components/UI';

export function ProtectedRoute({ requiredRole }: { requiredRole: AppRole }) {
  const { user, role, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <Page title="Verifying your account">
        <Loading>Checking session and access…</Loading>
      </Page>
    );
  if (error)
    return (
      <Page title="Account access unavailable">
        <Feedback error={error} />
        <button className="btn mt-4" onClick={() => void refresh()}>
          Retry access check
        </button>
      </Page>
    );
  if (!user)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (role !== requiredRole)
    return (
      <Page title="Access restricted">
        <p>You do not have permission to open this portal.</p>
        <a className="text-link" href={role === 'admin' ? '/admin' : '/author'}>
          Open your portal
        </a>
      </Page>
    );
  return <Outlet />;
}
