export function safeReturnPath(value: string | null, fallback = '/author'): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    return fallback;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (
      url.origin !== 'https://local.invalid' ||
      /^\/(?:login|register|account\/setup|auth\/callback|forgot-password|reset-password|resend-confirmation)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export const roleHome = (role: 'author' | 'admin' | 'reviewer') => `/${role}`;
export const roleLabel = (role: 'author' | 'admin' | 'reviewer') =>
  role === 'author' ? 'Admin Author' : role === 'admin' ? 'Admin' : 'Reviewer';

export function roleReturnPath(
  value: string | null,
  role: 'author' | 'admin' | 'reviewer',
): string {
  const home = roleHome(role);
  const path = safeReturnPath(value, home);
  const portal = /^\/(author|admin|reviewer)(?:\/|$)/.exec(path.split(/[?#]/)[0]);
  return portal && portal[1] !== role ? home : path;
}

export function legacyPath(hash: string): string | null {
  const routes: Record<string, string> = {
    '#home': '/',
    '#articles': '/articles',
    '#editorial': '/editorial',
    '#privacy': '/privacy',
    '#contact': '/contact',
    '#login': '/login',
    '#register': '/register',
    '#author-portal': '/author',
    '#admin-portal': '/admin',
  };
  return routes[hash] || null;
}
