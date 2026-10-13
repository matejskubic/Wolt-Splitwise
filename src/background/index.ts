import { AUTH_WORKER_URL } from '../shared/constants';
import { removeLegacySettings, saveAuth } from '../shared/settings';
import type { OAuthRequest, OAuthResponse } from '../shared/types';

const AUTH_WINDOW_SIZE = { width: 560, height: 820 };

/** launchWebAuthFlow has no size option; resize the popup window it opens so the consent page fits without scrolling. */
function enlargeAuthWindow(): () => void {
  const listener = (window: chrome.windows.Window): void => {
    if (window.id === undefined || window.type !== 'popup') return;
    chrome.windows.update(window.id, AUTH_WINDOW_SIZE).catch((error: unknown) => console.warn('Wolt to Splitwise: could not resize the sign-in window', error));
  };
  chrome.windows.onCreated.addListener(listener, { windowTypes: ['popup'] });
  return () => chrome.windows.onCreated.removeListener(listener);
}

/** The auth worker adds the consumer secret; it redirects back to https://<extension-id>.chromiumapp.org/ for the id sent in `ext`. */
async function authorizeWithSplitwise(): Promise<void> {
  const state = crypto.randomUUID();
  const startUrl = new URL('/auth/start', AUTH_WORKER_URL);
  startUrl.searchParams.set('state', state);
  startUrl.searchParams.set('ext', chrome.runtime.id);

  const stopResizing = enlargeAuthWindow();
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: startUrl.href, interactive: true });
  } finally {
    stopResizing();
  }
  if (!responseUrl) throw new Error('Authorization was cancelled.');
  const callback = new URL(responseUrl);
  if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch.');
  const oauthError = callback.searchParams.get('error');
  if (oauthError) throw new Error(`Splitwise authorization failed: ${callback.searchParams.get('error_description') ?? oauthError}`);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Splitwise did not return an authorization code.');

  const response = await fetch(new URL('/auth/token', AUTH_WORKER_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  });
  const token = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !token.access_token) {
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${token.error_description ?? token.error ?? 'no access token'}`);
  }
  await saveAuth({ accessToken: token.access_token, method: 'oauth' });
}

chrome.runtime.onInstalled.addListener(() => {
  removeLegacySettings().catch((error: unknown) => console.warn('Wolt to Splitwise: could not clean up old settings', error));
});

chrome.runtime.onMessage.addListener((message: OAuthRequest, sender, sendResponse: (response: OAuthResponse) => void) => {
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage || message?.type !== 'splitwise-oauth') return false;
  void (async () => {
    try {
      await authorizeWithSplitwise();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});
