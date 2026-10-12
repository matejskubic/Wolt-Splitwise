import { clearAuth, getAuth, getSettings, saveAuth, saveSettings, type Settings } from '../shared/settings';
import { SplitwiseClient, type SplitwiseGroup } from '../shared/splitwise';
import type { OAuthRequest, OAuthResponse } from '../shared/types';
import { memberDisplayName } from '../shared/names';
import splitSchema from '../split.schema.json';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function showStatus(id: string, message: string, kind: 'ok' | 'error' | 'warn' | '' = ''): void {
  const element = $(id);
  element.textContent = message;
  element.className = `status ${kind}`.trim();
}

async function refreshAuthStatus(): Promise<void> {
  const auth = await getAuth();
  if (!auth) {
    showStatus('auth-status', 'Not connected to Splitwise.', 'warn');
    return;
  }
  try {
    const me = await new SplitwiseClient(auth.accessToken).getCurrentUser();
    showStatus('auth-status', `Connected as ${memberDisplayName(me)} (${auth.method === 'oauth' ? 'OAuth' : 'API key'}).`, 'ok');
  } catch (error) {
    showStatus('auth-status', `Stored credentials could not be verified: ${errorText(error)}`, 'error');
  }
}

function renderGroups(groups: SplitwiseGroup[], settings: Settings): void {
  const select = $<HTMLSelectElement>('group-select');
  select.replaceChildren();
  const placeholder = new Option(groups.length ? '— pick a group —' : '— groups unavailable, enter ID below —', '');
  select.append(placeholder);
  for (const group of groups) {
    select.append(new Option(`${group.name} (${group.members.length} members)`, String(group.id)));
  }
  if (settings.groupId && !groups.some((group) => group.id === settings.groupId)) {
    select.append(new Option(`${settings.groupName ?? 'Saved group'} (#${settings.groupId})`, String(settings.groupId)));
  }
  select.value = settings.groupId ? String(settings.groupId) : '';
  input('group-id').value = settings.groupId ? String(settings.groupId) : '';
}

let loadedGroups: SplitwiseGroup[] = [];

async function loadGroups(): Promise<void> {
  const [settings, auth] = await Promise.all([getSettings(), getAuth()]);
  loadedGroups = [];
  if (auth) {
    try {
      loadedGroups = await new SplitwiseClient(auth.accessToken).getGroups();
      $('group-status').classList.add('hidden');
    } catch (error) {
      showStatus('group-status', `Could not load groups: ${errorText(error)}`, 'error');
    }
  } else {
    showStatus('group-status', 'Connect to Splitwise to list your groups.', 'warn');
  }
  renderGroups(loadedGroups, settings);
}

async function loadForm(): Promise<void> {
  const settings = await getSettings();
  $('mapping-count').textContent = String(Object.keys(settings.nameMappings).length);
}

function bind(id: string, handler: () => Promise<void>): void {
  $(id).addEventListener('click', () => {
    const button = $<HTMLButtonElement>(id);
    button.disabled = true;
    void handler().finally(() => {
      button.disabled = false;
    });
  });
}

bind('oauth-connect', async () => {
  try {
    showStatus('auth-status', 'Waiting for Splitwise authorization…');
    const response = (await chrome.runtime.sendMessage<OAuthRequest, OAuthResponse>({ type: 'splitwise-oauth' })) ?? { ok: false, error: 'No response from background worker.' };
    if (!response.ok) throw new Error(response.error);
    await refreshAuthStatus();
    await loadGroups();
  } catch (error) {
    showStatus('auth-status', errorText(error), 'error');
  }
});

bind('apikey-connect', async () => {
  const apiKey = input('api-key').value.trim();
  if (!apiKey) {
    showStatus('auth-status', 'Enter an API key first.', 'error');
    return;
  }
  await saveAuth({ accessToken: apiKey, method: 'apikey' });
  input('api-key').value = '';
  await refreshAuthStatus();
  await loadGroups();
});

bind('disconnect', async () => {
  await clearAuth();
  await refreshAuthStatus();
  await loadGroups();
});

$<HTMLSelectElement>('group-select').addEventListener('change', (event) => {
  input('group-id').value = (event.target as HTMLSelectElement).value;
});

bind('reload-groups', loadGroups);

bind('save-group', async () => {
  const groupId = Number(input('group-id').value);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    showStatus('group-status', 'Pick a group or enter a valid group ID.', 'error');
    return;
  }
  const groupName = loadedGroups.find((group) => group.id === groupId)?.name;
  await saveSettings({ groupId, groupName });
  showStatus('group-status', `Saved group ${groupName ?? `#${groupId}`}.`, 'ok');
});

bind('clear-mappings', async () => {
  await saveSettings({ nameMappings: {} });
  $('mapping-count').textContent = '0';
});

const aiPrompt = [
  'The attached screenshot shows the "Participants" list of a Wolt group order checkout page.',
  'For every participant, return the amount they pay after item discounts and before service or delivery fees.',
  'Use the highlighted (current) price of each participant, not the struck-through original price.',
  'Copy the names exactly as written. Use a dot as the decimal separator and no currency symbol.',
  'Answer with JSON only, no explanation, matching this JSON schema:',
  '',
  JSON.stringify(splitSchema, null, 2),
].join('\n');
$('ai-prompt').textContent = aiPrompt;

$('copy-prompt').addEventListener('click', () => {
  void (async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      $('copy-status').textContent = 'Prompt copied.';
    } catch (error) {
      $('copy-status').textContent = `Copy failed: ${errorText(error)}`;
    }
  })();
});

void (async () => {
  await loadForm();
  await refreshAuthStatus();
  await loadGroups();
})();
