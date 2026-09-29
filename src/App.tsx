import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { legacyPath } from './auth/routes';
import { Layout } from './components/Layout';
import { Loading, Page } from './components/UI';
import Home from './pages/Home';
import About from './pages/About';
import Articles from './pages/Articles';
import ArticleDetail from './pages/ArticleDetail';
import Editorial from './pages/Editorial';
import Privacy from './pages/Privacy';
import Contact from './pages/Contact';
import { AuthCallback, Login, Register } from './pages/AuthPages';

const PortalHome = lazy(() =>
  import('./pages/Portals').then((module) => ({ default: module.PortalHome })),
);
const SubmissionEditor = lazy(() =>
  import('./pages/Portals').then((module) => ({ default: module.SubmissionEditor })),
);
const SubmissionDetail = lazy(() =>
  import('./pages/Portals').then((module) => ({ default: module.SubmissionDetail })),
);
const AdminMessages = lazy(() =>
  import('./pages/Portals').then((module) => ({ default: module.AdminMessages })),
);

function LegacyRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    // Callback credentials and errors take priority over prototype section hashes.
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    if (
      location.pathname !== '/auth/callback' &&
      (query.has('code') || query.has('error') || hash.has('access_token') || hash.has('error'))
    ) {
      navigate(`/auth/callback${location.search}${location.hash}`, { replace: true });
      return;
    }
    const target = legacyPath(location.hash);
    if (location.pathname === '/' && target) navigate(target, { replace: true });
  }, [location, navigate]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LegacyRoutes />
        <Suspense
          fallback={
            <Page title="Loading">
              <Loading />
            </Page>
          }
        >
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="articles" element={<Articles />} />
              <Route path="about" element={<About />} />
              <Route path="articles/:slug" element={<ArticleDetail />} />
              <Route path="editorial" element={<Editorial />} />
              <Route path="privacy" element={<Privacy />} />
              <Route path="contact" element={<Contact />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="forgot-password" element={<Navigate to="/login" replace />} />
              <Route path="resend-confirmation" element={<Navigate to="/login" replace />} />
              <Route path="reset-password" element={<Navigate to="/login" replace />} />
              <Route path="auth/callback" element={<AuthCallback />} />
              <Route element={<ProtectedRoute requiredRole="author" />}>
                <Route path="author" element={<PortalHome />} />
                <Route path="author/submissions/new" element={<SubmissionEditor />} />
                <Route path="author/submissions/:id" element={<SubmissionDetail />} />
              </Route>
              <Route element={<ProtectedRoute requiredRole="admin" />}>
                <Route path="admin" element={<PortalHome admin />} />
                <Route path="admin/submissions/:id" element={<SubmissionDetail admin />} />
                <Route path="admin/articles/new" element={<SubmissionEditor admin />} />
                <Route path="admin/messages" element={<AdminMessages />} />
              </Route>
              <Route path="author-portal" element={<Navigate to="/author" replace />} />
              <Route path="admin-portal" element={<Navigate to="/admin" replace />} />
              <Route
                path="*"
                element={
                  <Page title="Page not found">
                    <p>
                      This page could not be found.{' '}
                      <a className="text-link" href="/">
                        Return home
                      </a>
                      .
                    </p>
                  </Page>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
