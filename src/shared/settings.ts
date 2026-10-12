export interface Settings {
  groupId?: number;
  groupName?: string;
  categoryId: number;
  /** Normalized Wolt name -> Splitwise user id. */
  nameMappings: Record<string, number>;
}

export interface AuthState {
  accessToken: string;
  method: 'oauth' | 'apikey';
}

declare const __BUILD_DEFAULTS__: Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  // Food and drink
  categoryId: 25,
  nameMappings: {},
  ...(typeof __BUILD_DEFAULTS__ === 'undefined' ? {} : __BUILD_DEFAULTS__),
};

const SETTINGS_KEY = 'settings';
const AUTH_KEY = 'auth';
// Settings of earlier versions; the consumer secret in particular must not linger in storage.
const LEGACY_KEYS = ['authorizeUrl', 'tokenUrl', 'consumerKey', 'consumerSecret', 'testEndpoint', 'apiBaseUrl', 'authWorkerUrl'];

function withoutLegacy(stored: Record<string, unknown>): Partial<Settings> {
  return Object.fromEntries(Object.entries(stored).filter(([key]) => !LEGACY_KEYS.includes(key))) as Partial<Settings>;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...withoutLegacy((stored[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}) };
}

export async function removeLegacySettings(): Promise<void> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Record<string, unknown> | undefined;
  if (stored && LEGACY_KEYS.some((key) => key in stored)) await chrome.storage.local.set({ [SETTINGS_KEY]: withoutLegacy(stored) });
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
