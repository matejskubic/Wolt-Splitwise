import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const EXTENSION_ID = 'obkgbdhgmlhjlkldcdhcmmdgbpapmpdk';
const BASE = 'https://auth-research.splitwise-extensions.workers.dev';
const EXTENSION_ORIGIN = { Origin: `chrome-extension://${EXTENSION_ID}` };
const CLIENT_KEY = 'rJQon4vPIwRjg8ZEtbIdHMmmUcyRd50FlnkuamBV';
const env: Env = { SplitwiseConsumerKey: CLIENT_KEY, SplitwiseConsumerSecret: 'client-secret', EXTENSION_ID };

type IncomingRequest = Parameters<typeof worker.fetch>[0];

const call = async (path: string, init?: RequestInit): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init) as IncomingRequest, env);

afterEach(() => vi.unstubAllGlobals());

describe('auth worker', () => {
  it('redirects /auth/start to Splitwise with the worker callback', async () => {
    const response = await call('/auth/start?state=0123456789abcdef-state');
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://secure.splitwise.com/oauth/authorize');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_KEY,
      redirect_uri: `${BASE}/auth/callback`,
      state: '0123456789abcdef-state',
    });
  });

  it('rejects a missing or malformed state', async () => {
    expect((await call('/auth/start')).status).toBe(400);
    expect((await call('/auth/start?state=%3Cscript%3E')).status).toBe(400);
  });

  it('forwards only the OAuth parameters to the fixed extension id', async () => {
    const response = await call('/auth/callback?code=abc&state=s1&evil=1');
    expect(response.headers.get('Location')).toBe(`https://${EXTENSION_ID}.chromiumapp.org/?code=abc&state=s1`);
  });

  it('exchanges the code with the secret added server-side', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'token-1', token_type: 'bearer' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: JSON.stringify({ code: 'abc' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: 'token-1', token_type: 'bearer' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://secure.splitwise.com/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: `${BASE}/auth/callback`,
      client_id: CLIENT_KEY,
      client_secret: 'client-secret',
    });
  });

  it('does not leak the secret when Splitwise rejects the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })));
    const response = await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: JSON.stringify({ code: 'expired' }) });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('client-secret');
  });

  it('rejects missing or other origins, bad bodies and unknown routes', async () => {
    expect((await call('/auth/token', { method: 'POST', body: '{"code":"a"}' })).status).toBe(403);
    expect((await call('/auth/token', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{"code":"a"}' })).status).toBe(403);
    expect((await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: 'not json' })).status).toBe(400);
    expect((await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: '{"code":"a b"}' })).status).toBe(400);
    expect((await call('/')).status).toBe(404);
    expect((await call('/auth/token')).status).toBe(404);
  });
});
