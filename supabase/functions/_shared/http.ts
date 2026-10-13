import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, `Server setup incomplete: ${name}.`);
  return value;
}

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'http://localhost:5173,http://127.0.0.1:5173,https://didarian-publicating.netlify.app').split(',').map(value => value.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'Origin is not allowed.');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export async function jsonBody(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') throw new HttpError(405, 'Use POST.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > maxBytes) throw new HttpError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing request body.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}

export function textField(body: Record<string, unknown>, field: string, max: number, min = 1): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new HttpError(400, `Invalid ${field}.`);
  return value.trim();
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'Invalid identifier.');
  return value;
}

export function adminClient() {
  // These credentials are provided only to the Edge runtime, never to Vite.
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function userClient(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in again.');
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new HttpError(401, 'Please sign in again.');
  // The RPC verifies auth.sessions too: a JWT from a revoked session is rejected.
  const { error: sessionError } = await client.rpc('assert_active_session');
  if (sessionError) throw new HttpError(401, 'Your session ended. Please sign in again.');
  return { client, user: data.user };
}

export function databaseError(error: { code?: string; message?: string }): never {
  const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === 'PT409' || error.code === '23505' ? 409 : error.code === 'P0001' ? 429 : 400;
  throw new HttpError(status, error.message || 'The request could not be completed.');
}

export function respond(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export function handle(handler: (request: Request, headers: Record<string, string>) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    try {
      headers = cors(request);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      return await handler(request, headers);
    } catch (error) {
      const known = error instanceof HttpError;
      // Never log request bodies, credentials, signed URLs, email addresses or manuscript content.
      if (!known) console.error('Edge request failed', error instanceof Error ? error.name : 'UnknownError');
      return respond({ error: known ? error.message : 'The server could not complete the request. Please retry.' }, headers, known ? error.status : 500);
    }
  };
}
