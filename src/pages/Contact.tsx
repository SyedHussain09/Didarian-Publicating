import { useState, type FormEvent } from 'react';
import { getSupabase } from '../lib/supabase';
import { Feedback, Page, errorMessage } from '../components/UI';
import { Turnstile } from '../components/Turnstile';

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();

export default function Contact() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationReset, setVerificationReset] = useState(0);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const name = String(fields.get('name') || '').trim();
      const message = String(fields.get('message') || '').trim();
      if (name.length < 2 || message.length < 10)
        throw new Error('Enter your name and a message of at least 10 characters.');
      if (turnstileSiteKey && !verificationToken)
        throw new Error('Complete the verification before sending your message.');
      const { data, error: endpointError } = await getSupabase().functions.invoke('contact', {
        body: {
          name,
          email: String(fields.get('email') || '').trim(),
          message,
          website: String(fields.get('website') || ''),
          ...(verificationToken ? { turnstile_token: verificationToken } : {}),
        },
      });
      if (endpointError) {
        const response = 'context' in endpointError ? endpointError.context : null;
        if (response instanceof Response && response.status === 429)
          throw new Error('Too many messages have been sent recently. Please wait and try again.');
        throw new Error('Your message could not be stored. Check your connection and try again.');
      }
      if (!data?.ok)
        throw new Error('The server did not confirm that your message was stored. Please retry.');
      setSuccess('Your message has been saved to the Didarian Publicating admin inbox.');
      form.reset();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setVerificationToken(null);
      setVerificationReset((value) => value + 1);
    }
  };
  return (
    <Page title="Contact Us">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-12">
        <div className="contact-intro">
          <p className="eyebrow mb-4">A conversation starts here</p>
          <h2 className="font-serif text-3xl text-slate-900 mb-3">Get in Touch</h2>
          <p className="text-slate-600 text-sm mb-6">
            Have questions about submissions or the publication process? Send us a message.
          </p>
          <div className="flex items-start gap-3">
            <span className="bg-brand-50 text-brand-600 rounded-lg p-3" aria-hidden="true">
              ✉
            </span>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Email</h3>
              <p className="text-sm text-slate-500">support@didarian.com</p>
              <p className="text-xs text-slate-500 mt-2">
                Supplied address awaiting publisher verification. Use the form to save a message to
                the admin inbox.
              </p>
            </div>
          </div>
        </div>
        <div className="card">
          <Feedback error={error} success={success} />
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <div>
              <label htmlFor="contact-name">Name</label>
              <input
                id="contact-name"
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <div>
              <label htmlFor="contact-email">Email</label>
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
            </div>
            <div className="hidden" aria-hidden="true">
              <label htmlFor="contact-website">Website</label>
              <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="contact-message">Message</label>
              <textarea
                id="contact-message"
                name="message"
                rows={4}
                minLength={10}
                maxLength={5000}
                required
              />
            </div>
            <div>
              {turnstileSiteKey && (
                <Turnstile
                  siteKey={turnstileSiteKey}
                  resetKey={verificationReset}
                  onToken={setVerificationToken}
                />
              )}
            </div>
            <button
              className="btn w-full"
              disabled={busy || (!!turnstileSiteKey && !verificationToken)}
            >
              {busy ? 'Saving message…' : 'Send Message'}
            </button>
            <p className="text-xs text-slate-500">
              Your name, email, and message are visible only to authorized administrators.{' '}
              <a className="text-link" href="/privacy">
                Privacy Policy
              </a>
            </p>
          </form>
        </div>
      </div>
    </Page>
  );
}
