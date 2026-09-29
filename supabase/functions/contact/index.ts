import { adminClient, databaseError, env, handle, HttpError, jsonBody, respond, textField } from '../_shared/http.ts';

async function hashIdentity(value: string): Promise<string> {
  const secret = Deno.env.get('CONTACT_RATE_LIMIT_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`didarian-contact-v1:${value}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(handle(async (request, headers) => {
  const body = await jsonBody(request, 12_288);
  const name = textField(body, 'name', 100, 2);
  const email = textField(body, 'email', 254).toLowerCase();
  const message = textField(body, 'message', 5000, 10);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (body.website) throw new HttpError(400, 'Contact submission could not be accepted.');
  // Hosted Supabase runs behind Cloudflare, which overwrites this with the actual
  // visitor address. X-Forwarded-For's last hop is a rotating internal proxy and
  // its first hop may be supplied by a caller; neither is an authorization input.
  // Self-hosted gateways must supply an equivalent trusted header before use.
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || ip.length > 80 || !/^[0-9a-f:.]+$/i.test(ip)) throw new HttpError(503, 'Contact rate limiting is not configured for this gateway.');

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (turnstileSecret) {
    const token = textField(body, 'turnstile_token', 2048);
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await verification.json();
    const intendedHostname = new URL(request.headers.get('origin')!).hostname;
    if (!result.success || result.hostname !== intendedHostname) throw new HttpError(400, 'Please complete the contact verification and retry.');
  }
  const { data, error } = await adminClient().rpc('receive_contact', {
    p_name: name, p_email: email, p_message: message,
    p_ip_hash: await hashIdentity(`ip:${ip}`), p_email_hash: await hashIdentity(`email:${email}`),
  });
  if (error) databaseError(error);
  return respond({ ok: true, id: data, message: 'Your message was saved to the editorial inbox.' }, headers, 201);
}));
