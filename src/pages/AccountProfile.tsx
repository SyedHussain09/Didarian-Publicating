import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { roleHome, roleLabel, roleReturnPath } from '../auth/routes';
import { command } from '../lib/api';
import { Page, Feedback, Loading, errorMessage } from '../components/UI';
import { ACCOUNT_CHOICE_KEY } from './AuthPages';

export default function AccountProfile({ setup = false }: { setup?: boolean }) {
  const auth = useAuth();
  const [search] = useSearchParams();
  if (auth.loading)
    return (
      <Page title="Your account" narrow>
        <Loading>Loading your profile…</Loading>
      </Page>
    );
  if (auth.error)
    return (
      <Page title="Your account" narrow>
        <Feedback error={auth.error} />
        <button className="btn" onClick={() => void auth.refresh()}>
          Retry
        </button>
      </Page>
    );
  if (!auth.user || !auth.profile || !auth.role) return <Navigate replace to="/login" />;
  if (setup && auth.profile.profile_complete)
    return <Navigate replace to={roleReturnPath(search.get('next'), auth.role)} />;
  if (auth.role === 'admin')
    return (
      <Page title="Admin account" narrow>
        <p>{auth.profile.full_name}</p>
        <p>{auth.user.email}</p>
        <Link className="text-link" to="/admin">
          Admin Dashboard
        </Link>
      </Page>
    );
  return <ProfileForm key={auth.user.id} setup={!auth.profile.profile_complete} />;
}

function ProfileForm({ setup }: { setup: boolean }) {
  const { user, profile, role, refresh } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<'author' | 'reviewer'>(() => {
    if (!setup) return role === 'reviewer' ? 'reviewer' : 'author';
    try {
      return sessionStorage.getItem(ACCOUNT_CHOICE_KEY) === 'reviewer' ? 'reviewer' : 'author';
    } catch {
      return 'author';
    }
  });
  const [name, setName] = useState(
    profile!.full_name || `${profile!.first_name} ${profile!.last_name}`.trim(),
  );
  const [institution, setInstitution] = useState(profile!.affiliation || '');
  const [username, setUsername] = useState(profile!.username || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await command('complete_profile', {
        p_role: choice,
        p_full_name: name.trim(),
        p_affiliation: institution.trim(),
        p_username: choice === 'reviewer' ? username.trim().toLowerCase() : null,
      });
      await refresh();
      try {
        sessionStorage.removeItem(ACCOUNT_CHOICE_KEY);
      } catch {
        /* Optional preference. */
      }
      if (setup) navigate(roleReturnPath(search.get('next'), choice), { replace: true });
      else setMessage('Your profile has been updated.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title={setup ? 'Complete your profile' : 'Your profile'}
      narrow
      actions={
        !setup && (
          <Link className="text-link" to={roleHome(role!)}>
            Back to workspace
          </Link>
        )
      }
    >
      <form onSubmit={(e) => void submit(e)} className="card space-y-5">
        <p className="eyebrow">{roleLabel(choice)} account</p>
        {setup && (
          <fieldset disabled={busy}>
            <legend className="mb-2 text-sm font-semibold">
              How would you like to participate?
            </legend>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="profile-role"
                  checked={choice === 'author'}
                  onChange={() => setChoice('author')}
                />
                Admin Author
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="profile-role"
                  checked={choice === 'reviewer'}
                  onChange={() => setChoice('reviewer')}
                />
                Reviewer
              </label>
            </div>
          </fieldset>
        )}
        <label>
          Full name
          <input
            autoComplete="name"
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Institute / Organization Name{' '}
          {choice === 'reviewer' && <span className="font-normal">(optional)</span>}
          <input
            autoComplete="organization"
            required={choice === 'author'}
            minLength={choice === 'author' ? 2 : undefined}
            maxLength={200}
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            aria-label="Email"
            value={user!.email || ''}
            readOnly
            aria-describedby="verified-email-help"
          />
          <span id="verified-email-help" className="mt-2 block text-xs font-normal text-slate-500">
            Verified through your Google account. This address is kept private.
          </span>
        </label>
        {choice === 'reviewer' && (
          <label>
            Username
            <input
              autoComplete="username"
              aria-label="Username"
              required
              pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
              minLength={3}
              maxLength={30}
              value={username}
              readOnly={!!profile!.username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby="username-help"
            />
            <span id="username-help" className="mt-2 block text-xs font-normal text-slate-500">
              Your unique public name on comments. 3–30 letters, numbers or underscores; start with
              a letter. Uppercase and lowercase count as the same username. Your chosen username
              stays with this account.
            </span>
          </label>
        )}
        <Feedback error={error} success={message} />
        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Saving profile…' : setup ? 'Create my workspace' : 'Save profile'}
        </button>
      </form>
    </Page>
  );
}
