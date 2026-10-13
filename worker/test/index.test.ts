import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const DEV_ID = 'obkgbdhgmlhjlkldcdhcmmdgbpapmpdk';
const STORE_IDS = ['elhhacijlpipdbfbmfigbenoepbbdhed', 'hgbfldlknjjdamhfomehnaipjcdohafp'];
const ALLOWED_IDS = [DEV_ID, ...STORE_IDS];
const EXTENSION_ID = DEV_ID;
const BASE = 'https://auth-research.splitwise-extensions.workers.dev';
const EXTENSION_ORIGIN = { Origin: `chrome-extension://${EXTENSION_ID}` };
const CLIENT_KEY = 'rJQon4vPIwRjg8ZEtbIdHMmmUcyRd50FlnkuamBV';
const STATE = '0123456789abcdef-state';
const env: Env = { SplitwiseConsumerKey: CLIENT_KEY, SplitwiseConsumerSecret: 'client-secret', EXTENSION_IDS: ALLOWED_IDS.join(',') as Env['EXTENSION_IDS'] };

type IncomingRequest = Parameters<typeof worker.fetch>[0];

const call = async (path: string, init?: RequestInit): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init) as IncomingRequest, env);

afterEach(() => vi.unstubAllGlobals());

describe('auth worker', () => {
  it('redirects /auth/start to Splitwise with the worker callback and the extension id in the state', async () => {
    const response = await call(`/auth/start?state=${STATE}&ext=${STORE_IDS[0]}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://secure.splitwise.com/oauth/authorize');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_KEY,
      redirect_uri: `${BASE}/auth/callback`,
      state: `${STORE_IDS[0]}.${STATE}`,
    });
  });

  it('rejects a missing or malformed state and a missing or unknown extension', async () => {
    expect((await call(`/auth/start?ext=${DEV_ID}`)).status).toBe(400);
    expect((await call(`/auth/start?state=%3Cscript%3E&ext=${DEV_ID}`)).status).toBe(400);
    expect((await call(`/auth/start?state=${STATE}`)).status).toBe(400);
    const unknown = await call(`/auth/start?state=${STATE}&ext=${'a'.repeat(32)}`);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'invalid_extension' });
  });

  it.each(ALLOWED_IDS)('forwards the code only to the initiating extension %s', async (id) => {
    const response = await call(`/auth/callback?code=abc&state=${id}.${STATE}&evil=1`);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://${id}.chromiumapp.org/?state=${STATE}&code=abc`);
  });

  it('forwards OAuth errors with the original state', async () => {
    const response = await call(`/auth/callback?error=access_denied&state=${DEV_ID}.${STATE}`);
    expect(response.headers.get('Location')).toBe(`https://${DEV_ID}.chromiumapp.org/?state=${STATE}&error=access_denied`);
  });

  it('never redirects the callback to an unknown or missing extension', async () => {
    for (const state of [`${'a'.repeat(32)}.${STATE}`, STATE, `.${STATE}`, `${DEV_ID}.`, '']) {
      const response = await call(`/auth/callback?code=abc&state=${state}`);
      expect(response.status).toBe(400);
      expect(response.headers.get('Location')).toBeNull();
    }
    expect((await call('/auth/callback?code=abc')).status).toBe(400);
  });

  it.each(ALLOWED_IDS)('exchanges the code with the secret added server-side for %s', async (id) => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'token-1', token_type: 'bearer' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call('/auth/token', { method: 'POST', headers: { Origin: `chrome-extension://${id}` }, body: JSON.stringify({ code: 'abc' }) });
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
    expect((await call('/auth/token', { method: 'POST', headers: { Origin: `chrome-extension://${'a'.repeat(32)}` }, body: '{"code":"a"}' })).status).toBe(403);
    expect((await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: 'not json' })).status).toBe(400);
    expect((await call('/auth/token', { method: 'POST', headers: EXTENSION_ORIGIN, body: '{"code":"a b"}' })).status).toBe(400);
    expect((await call('/')).status).toBe(404);
    expect((await call('/auth/token')).status).toBe(404);
  });
});
