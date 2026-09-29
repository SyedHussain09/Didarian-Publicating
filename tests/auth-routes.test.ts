import { describe, expect, it } from 'vitest';
import { legacyPath, roleReturnPath, safeReturnPath } from '../src/auth/routes';

describe('post-authentication destinations', () => {
  it.each([
    'https://attacker.example',
    '//attacker.example',
    '/\\attacker.example',
    '/\n/attacker.example',
    'javascript:alert(1)',
    '',
    '/login?next=/login',
    '/auth/callback?code=old',
    '/reset-password',
    '/resend-confirmation',
  ])('rejects unsafe or looping destination %s', (candidate) => {
    expect(safeReturnPath(candidate)).toBe('/author');
  });
  it('retains an internal draft destination and query', () => {
    expect(safeReturnPath('/author/submissions/new?source=home')).toBe(
      '/author/submissions/new?source=home',
    );
  });
  it('uses the verified role fallback supplied by the caller', () => {
    expect(safeReturnPath(null, '/admin')).toBe('/admin');
  });
  it('returns each verified role to its own portal', () => {
    expect(roleReturnPath(null, 'admin')).toBe('/admin');
    expect(roleReturnPath('/admin/messages', 'author')).toBe('/author');
    expect(roleReturnPath('/author/submissions/new', 'admin')).toBe('/admin');
    expect(roleReturnPath('/author/submissions/new?source=home', 'author')).toBe(
      '/author/submissions/new?source=home',
    );
    expect(roleReturnPath('https://attacker.example', 'author')).toBe('/author');
  });
});

describe('prototype navigation compatibility', () => {
  it('maps public and protected section links to real routes', () => {
    expect(legacyPath('#articles')).toBe('/articles');
    expect(legacyPath('#author-portal')).toBe('/author');
    expect(legacyPath('#admin-portal')).toBe('/admin');
  });
  it.each(['#access_token=redacted&type=recovery', '#error=access_denied', '#unknown', '#/admin'])(
    'does not treat callback payloads or unknown values as section links: %s',
    (hash) => {
      expect(legacyPath(hash)).toBeNull();
    },
  );
});
