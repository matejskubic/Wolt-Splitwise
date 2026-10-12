export interface Settings {
  apiBaseUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  consumerKey: string;
  consumerSecret: string;
  groupId?: number;
  groupName?: string;
  categoryId: number;
  /** When set, create_expense is POSTed here (without the access token) instead of the Splitwise API. */
  testEndpoint: string;
  /** Normalized Wolt name -> Splitwise user id. */
  nameMappings: Record<string, number>;
}

export interface AuthState {
  accessToken: string;
  method: 'oauth' | 'apikey';
}

declare const __BUILD_DEFAULTS__: Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: 'https://secure.splitwise.com/api/v3.0',
  authorizeUrl: 'https://secure.splitwise.com/oauth/authorize',
  tokenUrl: 'https://secure.splitwise.com/oauth/token',
  consumerKey: '',
  consumerSecret: '',
  
  // Food and drink
  categoryId: 25,
  testEndpoint: '',
  nameMappings: {},
  ...(typeof __BUILD_DEFAULTS__ === 'undefined' ? {} : __BUILD_DEFAULTS__),
};

const SETTINGS_KEY = 'settings';
const AUTH_KEY = 'auth';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getAuth(): Promise<AuthState | undefined> {
  const stored = await chrome.storage.local.get(AUTH_KEY);
  return stored[AUTH_KEY] as AuthState | undefined;
}

export async function saveAuth(auth: AuthState): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

/** Returns the https origin patterns that are not covered by the manifest's required host permissions. */
export function extraOrigins(urls: string[]): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error(`Only https URLs are allowed: ${url}`);
    if (parsed.hostname !== 'secure.splitwise.com') origins.add(`${parsed.origin}/*`);
  }
  return [...origins];
}
