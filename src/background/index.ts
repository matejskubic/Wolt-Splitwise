import { getSettings, saveAuth } from '../shared/settings';
import type { OAuthRequest, OAuthResponse } from '../shared/types';

async function authorizeWithSplitwise(): Promise<void> {
  const settings = await getSettings();
  if (!settings.consumerKey || !settings.consumerSecret) throw new Error('Enter the Splitwise consumer key and secret first.');

  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const authorizeUrl = new URL(settings.authorizeUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', settings.consumerKey);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl.href, interactive: true });
  if (!responseUrl) throw new Error('Authorization was cancelled.');
  const callback = new URL(responseUrl);
  if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch.');
  const oauthError = callback.searchParams.get('error');
  if (oauthError) throw new Error(`Splitwise authorization failed: ${callback.searchParams.get('error_description') ?? oauthError}`);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Splitwise did not return an authorization code.');

  const response = await fetch(settings.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: settings.consumerKey,
      client_secret: settings.consumerSecret,
    }),
  });
  const token = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !token.access_token) {
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${token.error_description ?? token.error ?? 'no access token'}`);
  }
  await saveAuth({ accessToken: token.access_token, method: 'oauth' });
}

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
