import { centsToDecimal, decimalToCents, formatMoney } from '../shared/money';
import { matchMember, memberDisplayName, normalizeName, type SplitwiseMember } from '../shared/names';
import { extraOrigins, getAuth, getSettings, saveSettings, type AuthState, type Settings } from '../shared/settings';
import { buildExpensePayload, computeShares, distribute } from '../shared/split';
import { SplitwiseClient, type SplitwiseGroup } from '../shared/splitwise';
import type { CaptureRequest, CaptureResponse, WoltOrder, WoltParticipant } from '../shared/types';

interface Row {
  participant: WoltParticipant;
  userId?: number;
  feeCell: HTMLTableCellElement;
  owesCell: HTMLTableCellElement;
  element: HTMLTableRowElement;
}

interface FeeRow {
  label: HTMLInputElement;
  amount: HTMLInputElement;
  element: HTMLTableRowElement;
}

interface State {
  settings: Settings;
  auth: AuthState;
  order: WoltOrder;
  group: SplitwiseGroup;
  me: SplitwiseMember;
  rows: Row[];
  fees: FeeRow[];
  payerTouched: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function showStatus(message: string, kind: 'ok' | 'error' | 'warn' | '' = ''): void {
  const status = $('status');
  status.textContent = message;
  status.className = `status ${kind}`.trim();
  status.classList.remove('hidden');
}

function cell(text = '', className = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function memberSelect(members: SplitwiseMember[], selected: number | undefined, placeholder: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'wide';
  select.append(new Option(placeholder, ''));
  for (const member of members) select.append(new Option(memberDisplayName(member), String(member.id)));
  select.value = selected === undefined ? '' : String(selected);
  return select;
}

async function captureOrder(tabId: number): Promise<WoltOrder> {
  const request: CaptureRequest = { type: 'wolt-capture' };
  let response: CaptureResponse | undefined;
  try {
    response = await chrome.tabs.sendMessage<CaptureRequest, CaptureResponse>(tabId, request);
  } catch {
    // The tab was opened before the extension was installed or reloaded.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    response = await chrome.tabs.sendMessage<CaptureRequest, CaptureResponse>(tabId, request);
  }
  if (!response) throw new Error('The Wolt page did not respond. Reload the page and try again.');
  if (!response.ok) throw new Error(response.error);
  return response.order;
}

function readFees(state: State): { total: number; valid: boolean } {
  let total = 0;
  let valid = true;
  for (const fee of state.fees) {
    const cents = decimalToCents(fee.amount.value);
    fee.amount.setCustomValidity(cents === null || cents < 0 ? 'Enter an amount like 1.99' : '');
    if (cents === null || cents < 0) valid = false;
    else total += cents;
  }
  return { total, valid };
}

function update(state: State): void {
  const { currency } = state.order;
  const fees = readFees(state);
  const feeShares = distribute(fees.valid ? fees.total : 0, state.rows.length);
  let itemsTotal = 0;
  state.rows.forEach((row, index) => {
    const feeShare = feeShares[index] ?? 0;
    itemsTotal += row.participant.cents;
    row.feeCell.textContent = centsToDecimal(feeShare);
    row.owesCell.textContent = centsToDecimal(row.participant.cents + feeShare);
    row.element.classList.toggle('unmatched', row.userId === undefined);
  });

  const unmatched = state.rows.filter((row) => row.userId === undefined).length;
  const grandTotal = itemsTotal + (fees.valid ? fees.total : 0);
  const lines = [`Items ${formatMoney(itemsTotal, currency)} + fees ${formatMoney(fees.valid ? fees.total : 0, currency)} = ${formatMoney(grandTotal, currency)}`];
  let kind: 'ok' | 'warn' | 'error' = 'ok';
  if (state.order.totalCents !== undefined && state.order.totalCents !== grandTotal) {
    lines.push(`Wolt shows a total of ${formatMoney(state.order.totalCents, currency)} – check the fees.`);
    kind = 'warn';
  }
  if (unmatched) {
    lines.push(`Pick a Splitwise member for ${unmatched} unmatched Wolt name(s).`);
    kind = 'error';
  }
  if (!fees.valid) {
    lines.push('Fix the invalid fee amounts.');
    kind = 'error';
  }
  const summary = $('summary');
  summary.textContent = lines.join('\n');
  summary.className = `status ${kind}`;

  const payer = $<HTMLSelectElement>('payer').value;
  const description = $<HTMLInputElement>('description').value.trim();
  $<HTMLButtonElement>('send').disabled = kind === 'error' || !payer || !description;
}

function addFeeRow(state: State, label: string, cents: number): void {
  const tr = document.createElement('tr');
  const labelInput = Object.assign(document.createElement('input'), { className: 'wide', value: label, placeholder: 'Fee' });
  const amountInput = Object.assign(document.createElement('input'), { className: 'amount', value: centsToDecimal(cents), inputMode: 'decimal' });
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: '✕', title: 'Remove fee' });
  const fee: FeeRow = { label: labelInput, amount: amountInput, element: tr };

  const labelCell = cell();
  labelCell.append(labelInput);
  const amountCell = cell('', 'num');
  amountCell.append(amountInput, ` ${state.order.currency}`);
  const removeCell = cell();
  removeCell.append(remove);
  tr.append(labelCell, amountCell, removeCell);

  amountInput.addEventListener('input', () => update(state));
  remove.addEventListener('click', () => {
    state.fees = state.fees.filter((item) => item !== fee);
    tr.remove();
    update(state);
  });
  state.fees.push(fee);
  $('fees').append(tr);
}

function hostUserId(state: State): number | undefined {
  return state.rows.find((row) => row.participant.isHost)?.userId;
}

function render(state: State): void {
  const { order, group, settings, me } = state;
  const members = group.members;

  $<HTMLInputElement>('description').value = `Wolt${order.venue ? ` – ${order.venue}` : ''}`;
  $('group-info').textContent = `Group: ${group.name} · ${order.participants.length} ready participant(s)`;
  $('mode').textContent = settings.testEndpoint ? `Test mode → ${new URL(settings.testEndpoint).host}` : '';

  const payer = $<HTMLSelectElement>('payer');
  const syncPayer = (): void => {
    if (state.payerTouched) return;
    const id = hostUserId(state) ?? me.id;
    payer.value = members.some((member) => member.id === id) ? String(id) : '';
  };

  const tbody = $('participants');
  for (const participant of order.participants) {
    const tr = document.createElement('tr');
    const userId = matchMember(participant.name, members, settings.nameMappings);
    const nameCell = cell(participant.name);
    if (participant.isHost) nameCell.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'HOST' }));
    const select = memberSelect(members, userId, '— pick member —');
    const selectCell = cell();
    selectCell.append(select);
    const row: Row = { participant, userId, feeCell: cell('', 'num'), owesCell: cell('', 'num'), element: tr };
    tr.append(nameCell, selectCell, cell(centsToDecimal(participant.cents), 'num'), row.feeCell, row.owesCell);
    select.addEventListener('change', () => {
      row.userId = select.value ? Number(select.value) : undefined;
      syncPayer();
      update(state);
    });
    state.rows.push(row);
    tbody.append(tr);
  }

  for (const fee of order.fees) addFeeRow(state, fee.label, fee.cents);

  payer.replaceChildren(...memberSelect(members, undefined, '— payer —').options);
  syncPayer();
  payer.addEventListener('change', () => {
    state.payerTouched = true;
    update(state);
  });
  $('add-fee').addEventListener('click', () => {
    addFeeRow(state, 'Fee', 0);
    update(state);
  });
  $('description').addEventListener('input', () => update(state));

  $('review').classList.remove('hidden');
  const unmatched = state.rows.filter((row) => row.userId === undefined).length;
  showStatus(unmatched ? `Match ${unmatched} Wolt name(s) to Splitwise members, review, then send.` : 'Review the split, then send.', unmatched ? 'warn' : '');
  update(state);
}

async function send(state: State, permission: Promise<boolean>): Promise<void> {
  const button = $<HTMLButtonElement>('send');
  button.disabled = true;
  try {
    if (!(await permission)) throw new Error('Host permission for the test endpoint was denied.');
    const { order, settings, group } = state;
    const fees = readFees(state);
    const payerId = Number($<HTMLSelectElement>('payer').value);
    const items = state.rows.map((row) => ({ userId: row.userId!, itemCents: row.participant.cents }));
    const result = computeShares(items, fees.total, payerId);
    const feeLines = state.fees.map((fee) => `${fee.label.value.trim() || 'Fee'}: ${fee.amount.value}`);
    const details = [
      ...state.rows.map((row, index) => `${row.participant.name}: ${centsToDecimal(row.participant.cents)} + ${centsToDecimal(result.feeShares[index] ?? 0)} fees`),
      ...(feeLines.length ? ['', ...feeLines] : []),
      ...(order.url ? ['', order.url] : []),
    ].join('\n');
    const payload = buildExpensePayload(result, {
      description: $<HTMLInputElement>('description').value.trim(),
      details,
      currencyCode: order.currency,
      groupId: group.id,
    });

    const client = new SplitwiseClient(settings.apiBaseUrl, state.auth.accessToken);
    const created = await client.createExpense(payload, settings.testEndpoint || undefined);

    const nameMappings = { ...settings.nameMappings };
    for (const row of state.rows) nameMappings[normalizeName(row.participant.name)] = row.userId!;
    await saveSettings({ nameMappings });

    showStatus(
      created.testMode
        ? `Test mode: expense of ${formatMoney(result.totalCents, order.currency)} posted to ${settings.testEndpoint}.`
        : `Expense of ${formatMoney(result.totalCents, order.currency)} added to ${group.name}${created.expenseId ? ` (#${created.expenseId})` : ''}.`,
      'ok',
    );
    $('review').classList.add('hidden');
  } catch (error) {
    showStatus(errorText(error), 'error');
    button.disabled = false;
  }
}

async function main(): Promise<void> {
  $('open-options').addEventListener('click', () => void chrome.runtime.openOptionsPage());

  const [settings, auth] = await Promise.all([getSettings(), getAuth()]);
  if (!auth) return showStatus('Connect your Splitwise account in Settings first.', 'warn');
  if (!settings.groupId) return showStatus('Pick a Splitwise group in Settings first.', 'warn');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/wolt\.com\//.test(tab.url)) {
    return showStatus('Open the Wolt group order checkout page and click the extension again.', 'warn');
  }

  showStatus('Reading the Wolt group order…');
  const client = new SplitwiseClient(settings.apiBaseUrl, auth.accessToken);
  const [order, group, me] = await Promise.all([captureOrder(tab.id), client.getGroup(settings.groupId), client.getCurrentUser()]);
  if (!order.participants.length) return showStatus('No ready participants were found on this page.', 'warn');

  const state: State = { settings, auth, order, group, me, rows: [], fees: [], payerTouched: false };
  render(state);

  $('review').addEventListener('submit', (event) => {
    event.preventDefault();
    // Start the permission request synchronously so it keeps the user gesture.
    const origins = settings.testEndpoint ? extraOrigins([settings.testEndpoint]) : [];
    const permission = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
    void send(state, permission);
  });
}

main().catch((error: unknown) => showStatus(errorText(error), 'error'));
