import { useEffect, useRef, useState } from 'react';

interface TurnstileApi {
  ready: (callback: () => void) => void;
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light';
      size: 'flexible';
      action: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  remove: (widget: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile)
    return new Promise((resolve) => window.turnstile!.ready(() => resolve(window.turnstile!)));
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timeout = window.setTimeout(() => failed(), 20_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      loader = null;
      reject(
        new Error('The verification service could not be loaded. Check your connection and retry.'),
      );
    };
    const loaded = () => {
      if (!window.turnstile) {
        failed();
        return;
      }
      window.turnstile.ready(() => {
        cleanup();
        resolve(window.turnstile!);
      });
    };
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    document.head.appendChild(script);
  });
  return loader;
}

export function Turnstile({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    onToken(null);
    void loadTurnstile()
      .then((loaded) => {
        if (!active || !container.current) return;
        api = loaded;
        widget = api.render(container.current, {
          sitekey: siteKey,
          theme: 'light',
          size: 'flexible',
          action: 'contact',
          callback: (token) => {
            if (active) {
              setError(null);
              onToken(token);
            }
          },
          'expired-callback': () => {
            if (active) onToken(null);
          },
          'error-callback': () => {
            if (active) {
              onToken(null);
              setError('Verification could not be completed. Please retry.');
            }
          },
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : 'Verification is unavailable. Please retry.',
          );
      });
    return () => {
      active = false;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [siteKey, resetKey, onToken, retry]);
  return (
    <div>
      <div ref={container} className="min-h-16" aria-label="Contact form verification" />
      {error && (
        <div className="text-sm text-red-800" role="alert">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setError(null);
              setRetry((value) => value + 1);
            }}
          >
            Retry verification
          </button>
        </div>
      )}
    </div>
  );
}
