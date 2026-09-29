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
      /^\/(?:login|register|auth\/callback|forgot-password|reset-password|resend-confirmation)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function roleReturnPath(value: string | null, role: 'author' | 'admin'): string {
  const home = role === 'admin' ? '/admin' : '/author';
  const path = safeReturnPath(value, home);
  const otherPortal = role === 'admin' ? /^\/author(?:\/|$)/ : /^\/admin(?:\/|$)/;
  return otherPortal.test(path.split(/[?#]/)[0]) ? home : path;
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
