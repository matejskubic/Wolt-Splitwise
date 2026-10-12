import { centsToDecimal, decimalToCents, formatMoney } from '../shared/money';
import { matchMember, memberDisplayName, normalizeName, type SplitwiseMember } from '../shared/names';
import { applyCheckoutDiscounts, listCheckoutSnapshots, rankSnapshots, saveCheckoutSnapshot, snapshotFromAmounts, type CheckoutSnapshot } from '../shared/orders';
import { getAuth, getSettings, saveSettings, type AuthState, type Settings } from '../shared/settings';
import { buildExpensePayload, computeShares, distribute } from '../shared/split';
import { parseSplitInput } from '../shared/splitInput';
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
  /** Order as read from the page. */
  capturedOrder: WoltOrder;
  /** Order after applying discounts from the selected checkout snapshot. */
  order: WoltOrder;
  snapshots: CheckoutSnapshot[];
  client: SplitwiseClient;
  groups: SplitwiseGroup[];
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

function syncPayer(state: State): void {
  if (state.payerTouched) return;
  const payer = $<HTMLSelectElement>('payer');
  const id = state.rows.find((row) => row.participant.isHost)?.userId ?? state.me.id;
  payer.value = state.group.members.some((member) => member.id === id) ? String(id) : '';
}

/** (Re)builds the participant and fee tables from `state.order`, keeping member picks made so far. */
function renderOrder(state: State): void {
  const { order, group, settings } = state;
  const members = group.members;
  const picked = new Map(state.rows.map((row) => [normalizeName(row.participant.name), row.userId]));

  const tbody = $('participants');
  tbody.replaceChildren();
  state.rows = [];
  for (const participant of order.participants) {
    const key = normalizeName(participant.name);
    const previous = picked.get(key);
    const userId = previous !== undefined && members.some((member) => member.id === previous) ? previous : matchMember(participant.name, members, settings.nameMappings);
    const tr = document.createElement('tr');
    const nameCell = cell(participant.name);
    if (participant.isHost) nameCell.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'HOST' }));
    const select = memberSelect(members, userId, '— pick member —');
    const selectCell = cell();
    selectCell.append(select);
    const discount = participant.originalCents - participant.cents;
    const row: Row = { participant, userId, feeCell: cell('', 'num'), owesCell: cell('', 'num'), element: tr };
    tr.append(
      nameCell,
      selectCell,
      cell(centsToDecimal(participant.originalCents), 'num'),
      cell(discount ? `−${centsToDecimal(discount)}` : '', 'num'),
      row.feeCell,
      row.owesCell,
    );
    select.addEventListener('change', () => {
      row.userId = select.value ? Number(select.value) : undefined;
      syncPayer(state);
      update(state);
    });
    state.rows.push(row);
    tbody.append(tr);
  }

  $('fees').replaceChildren();
  state.fees = [];
  for (const fee of order.fees) addFeeRow(state, fee.label, fee.cents);

  syncPayer(state);
  update(state);
}

function snapshotLabel(snapshot: CheckoutSnapshot): string {
  const when = new Date(snapshot.capturedAt).toLocaleString();
  return `${snapshot.venue ?? 'Wolt'} · ${when} · ${snapshot.participants.length} people`;
}

function applySnapshot(state: State, snapshot: CheckoutSnapshot | undefined): void {
  const result = applyCheckoutDiscounts(state.capturedOrder, snapshot);
  state.order = result.order;
  const { currency } = state.order;
  const notes: string[] = [];
  if (snapshot) notes.push(`${formatMoney(result.snapshotCents, currency)} discount assigned per person from the checkout saved ${new Date(snapshot.capturedAt).toLocaleString()}.`);
  if (result.proportionalCents) notes.push(`${formatMoney(result.proportionalCents, currency)} split proportionally to item prices (not explained by a saved checkout).`);
  if (result.unmatchedNames.length) notes.push(`Not in the saved checkout: ${result.unmatchedNames.join(', ')}.`);
  if (!notes.length) notes.push('No discounts on this order.');
  $('discount-info').textContent = notes.join(' ');
  renderOrder(state);
}

/** Fills the snapshot dropdown, best match first; selects `selectedId`, or the best match when omitted. */
function fillSnapshotSelect(state: State, selectedId?: string): CheckoutSnapshot[] {
  const ranked = rankSnapshots(state.capturedOrder, state.snapshots);
  const select = $<HTMLSelectElement>('snapshot');
  select.replaceChildren(new Option('None – split the order discount proportionally', ''));
  for (const snapshot of ranked) select.append(new Option(snapshotLabel(snapshot), snapshot.id));
  const id = selectedId ?? ranked[0]?.id;
  select.value = ranked.some((snapshot) => snapshot.id === id) ? id! : '';
  return ranked;
}

async function applyPastedAmounts(state: State): Promise<void> {
  const status = $('paste-status');
  try {
    const amounts = parseSplitInput($<HTMLTextAreaElement>('paste-input').value);
    const snapshot = snapshotFromAmounts(state.capturedOrder, amounts);
    await saveCheckoutSnapshot(snapshot);
    state.snapshots = [snapshot, ...state.snapshots.filter((item) => item.id !== snapshot.id)];
    fillSnapshotSelect(state, snapshot.id);
    applySnapshot(state, snapshot);
    const known = new Set(state.capturedOrder.participants.map((participant) => normalizeName(participant.name)));
    const unknown = amounts.filter((amount) => !known.has(normalizeName(amount.name))).map((amount) => amount.name);
    status.textContent = unknown.length ? `Applied, but not on this order: ${unknown.join(', ')}.` : `Applied ${amounts.length} amount(s) and saved them for this order.`;
    status.className = `status ${unknown.length ? 'warn' : 'ok'}`;
  } catch (error) {
    status.textContent = errorText(error);
    status.className = 'status error';
  }
}

function setupHistoryDiscounts(state: State): void {
  const ranked = fillSnapshotSelect(state);
  const select = $<HTMLSelectElement>('snapshot');
  select.addEventListener('change', () => applySnapshot(state, state.snapshots.find((snapshot) => snapshot.id === select.value)));
  $('paste-apply').addEventListener('click', () => void applyPastedAmounts(state));
  $('discount-box').classList.remove('hidden');
  applySnapshot(state, ranked[0]);
}

function fillPayer(state: State): void {
  const payer = $<HTMLSelectElement>('payer');
  const previous = payer.value;
  payer.replaceChildren(...memberSelect(state.group.members, undefined, '— payer —').options);
  if (state.payerTouched && state.group.members.some((member) => String(member.id) === previous)) payer.value = previous;
  else state.payerTouched = false;
}

function describeGroup(state: State): void {
  const { order, group } = state;
  const source = order.source === 'history' ? `order ${order.placedAt ?? order.orderId ?? ''}`.trim() : 'ready participant(s)';
  $('group-info').textContent = `${group.members.length} members in ${group.name} · ${order.participants.length} people on Wolt · ${source}`;
}

function setupGroupSelect(state: State): void {
  const select = $<HTMLSelectElement>('group-select');
  const groups = state.groups.some((group) => group.id === state.group.id) ? state.groups : [state.group, ...state.groups];
  select.replaceChildren(...groups.map((group) => new Option(group.id === state.settings.groupId ? `${group.name} (default)` : group.name, String(group.id))));
  select.value = String(state.group.id);
  select.addEventListener('change', () => {
    void (async () => {
      select.disabled = true;
      try {
        state.group = await state.client.getGroup(Number(select.value));
        fillPayer(state);
        describeGroup(state);
        renderOrder(state);
      } catch (error) {
        showStatus(`Could not load the group: ${errorText(error)}`, 'error');
        select.value = String(state.group.id);
      } finally {
        select.disabled = false;
      }
    })();
  });
}

function setup(state: State): void {
  const { order } = state;
  $<HTMLInputElement>('description').value = `Wolt${order.venue ? ` – ${order.venue}` : ''}`;
  describeGroup(state);
  setupGroupSelect(state);

  const payer = $<HTMLSelectElement>('payer');
  fillPayer(state);
  payer.addEventListener('change', () => {
    state.payerTouched = true;
    update(state);
  });
  $('add-fee').addEventListener('click', () => {
    addFeeRow(state, 'Fee', 0);
    update(state);
  });
  $('description').addEventListener('input', () => update(state));

  if (order.source === 'history') setupHistoryDiscounts(state);
  else renderOrder(state);

  $('review').classList.remove('hidden');
  const unmatched = state.rows.filter((row) => row.userId === undefined).length;
  showStatus(unmatched ? `Match ${unmatched} Wolt name(s) to Splitwise members, review, then send.` : 'Review the split, then send.', unmatched ? 'warn' : '');
}

async function send(state: State): Promise<void> {
  const button = $<HTMLButtonElement>('send');
  button.disabled = true;
  try {
    const { order, settings, group } = state;
    const fees = readFees(state);
    const payerId = Number($<HTMLSelectElement>('payer').value);
    const items = state.rows.map((row) => ({ userId: row.userId!, itemCents: row.participant.cents }));
    const result = computeShares(items, fees.total, payerId);
    const feeLines = state.fees.map((fee) => `${fee.label.value.trim() || 'Fee'}: ${fee.amount.value}`);
    const details = [
      ...state.rows.map((row, index) => {
        const { name, cents, originalCents } = row.participant;
        const discount = originalCents > cents ? ` - ${centsToDecimal(originalCents - cents)} discount` : '';
        return `${name}: ${centsToDecimal(originalCents)}${discount} + ${centsToDecimal(result.feeShares[index] ?? 0)} fees`;
      }),
      ...(feeLines.length ? ['', ...feeLines] : []),
      ...(order.url ? ['', order.url] : []),
    ].join('\n');
    const payload = buildExpensePayload(result, {
      description: $<HTMLInputElement>('description').value.trim(),
      details,
      currencyCode: order.currency,
      categoryId: settings.categoryId,
      groupId: group.id,
    });

    const created = await state.client.createExpense(payload);

    const nameMappings = { ...settings.nameMappings };
    for (const row of state.rows) nameMappings[normalizeName(row.participant.name)] = row.userId!;
    await saveSettings({ nameMappings });

    showStatus(`Expense of ${formatMoney(result.totalCents, order.currency)} added to ${group.name}${created.expenseId ? ` (#${created.expenseId})` : ''}.`, 'ok');
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
    return showStatus('Open a Wolt group order checkout or an order history page and click the extension again.', 'warn');
  }

  showStatus('Reading the Wolt order…');
  const client = new SplitwiseClient(auth.accessToken);
  const [order, group, me, snapshots, groups] = await Promise.all([
    captureOrder(tab.id),
    client.getGroup(settings.groupId),
    client.getCurrentUser(),
    listCheckoutSnapshots(),
    client.getGroups().catch((): SplitwiseGroup[] => []),
  ]);
  if (!order.participants.length) return showStatus('No participants were found on this page.', 'warn');

  const state: State = { settings, auth, capturedOrder: order, order, snapshots, client, groups, group, me, rows: [], fees: [], payerTouched: false };
  setup(state);

  $('review').addEventListener('submit', (event) => {
    event.preventDefault();
    void send(state);
  });
}

main().catch((error: unknown) => showStatus(errorText(error), 'error'));
