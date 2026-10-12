const SPLITWISE_AUTHORIZE_URL = 'https://secure.splitwise.com/oauth/authorize';
const SPLITWISE_TOKEN_URL = 'https://secure.splitwise.com/oauth/token';
const STATE_RE = /^[\w-]{16,128}$/;
const CODE_RE = /^[\w.~+/=-]{1,512}$/;
const EXTENSION_ID_RE = /^[a-p]{32}$/;
const MAX_BODY_BYTES = 4096;
const FORWARDED_PARAMS = ['code', 'state', 'error', 'error_description'] as const;

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: location } });
}

const callbackUrl = (url: URL): string => `${url.origin}/auth/callback`;

/** Sends the browser to Splitwise; the extension only knows the worker, never the client credentials. */
function start(url: URL, env: Env): Response {
  const state = url.searchParams.get('state');
  if (!state || !STATE_RE.test(state)) return json({ error: 'invalid_state' }, 400);
  const authorize = new URL(SPLITWISE_AUTHORIZE_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.SplitwiseConsumerKey);
  authorize.searchParams.set('redirect_uri', callbackUrl(url));
  authorize.searchParams.set('state', state);
  return redirect(authorize.href);
}

/** Hands the authorization code to the fixed extension id only, so codes cannot be redirected elsewhere. */
function callback(url: URL, env: Env): Response {
  const target = new URL(`https://${env.EXTENSION_ID}.chromiumapp.org/`);
  for (const name of FORWARDED_PARAMS) {
    const value = url.searchParams.get(name);
    if (value) target.searchParams.set(name, value.slice(0, 1024));
  }
  return redirect(target.href);
}

/** Exchanges the code for an access token, adding the consumer secret server-side. */
async function token(request: Request, url: URL, env: Env): Promise<Response> {
  // Browsers always send Origin on POST, so a missing header means a non-extension caller.
  if (request.headers.get('Origin') !== `chrome-extension://${env.EXTENSION_ID}`) return json({ error: 'forbidden_origin' }, 403);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'body_too_large' }, 413);

  let code: unknown;
  try {
    ({ code } = await request.json<{ code?: unknown }>());
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (typeof code !== 'string' || !CODE_RE.test(code)) return json({ error: 'invalid_code' }, 400);

  const response = await fetch(SPLITWISE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(url),
      client_id: env.SplitwiseConsumerKey,
      client_secret: env.SplitwiseConsumerSecret,
    }),
  });
  const data: { access_token?: string; token_type?: string; error?: string; error_description?: string } = await response
    .json<{ access_token?: string; token_type?: string; error?: string; error_description?: string }>()
    .catch(() => ({}));

  if (!response.ok || !data.access_token) {
    console.warn(JSON.stringify({ message: 'Splitwise token exchange failed', status: response.status, error: data.error }));
    return json({ error: data.error ?? 'token_exchange_failed', error_description: data.error_description }, 502);
  }
  return json({ access_token: data.access_token, token_type: data.token_type ?? 'bearer' });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (!EXTENSION_ID_RE.test(env.EXTENSION_ID) || !env.SplitwiseConsumerKey || !env.SplitwiseConsumerSecret) {
      console.error(JSON.stringify({ message: 'Worker is misconfigured' }));
      return json({ error: 'misconfigured' }, 500);
    }
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /auth/start':
          return start(url, env);
        case 'GET /auth/callback':
          return callback(url, env);
        case 'POST /auth/token':
          return await token(request, url, env);
        default:
          return json({ error: 'not_found' }, 404);
      }
    } catch (error) {
      console.error(JSON.stringify({ message: 'Unhandled error', route, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: 'internal_error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
