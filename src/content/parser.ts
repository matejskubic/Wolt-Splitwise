import { amountToCents, extractTrailingMoney, parseMoneyLine, type Money } from '../shared/money';
import type { WoltFee, WoltOrder, WoltParticipant } from '../shared/types';

const STATUS_RE = /^(ready|not started|not ready|in progress|ordering|browsing|joined|done)(?:\s*[•·]\s*(\d+)\s+items?)?$/i;
const ITEM_RE = /^(\d+)\s+items?$/i;
const HOST_RE = /^host$/i;
const HOST_SUFFIX_RE = /\s*\bhost$/i;
const INITIALS_RE = /^\p{Lu}{1,3}$/u;
const PLAIN_NUMBER_RE = /^[-−]?[\d\s.,]+$/;
const PARTICIPANTS_RE = /^participants$/i;
const SECTION_END_RE = /^(lock order together|unlock order|cancel this order|order summary|payment summary|summary|payment method|items)$/i;
const SKIP_RE = /^(host pays for everyone|everyone pays for themselves|.*pays for .*|not ready:?\s*\d*|ready:?\s*\d+|participants|you)$/i;

const FEE_RE = /\b(delivery|service|small order|surcharge|bag|packaging|fee|dostava|storitev|provizija)\b/i;
const FEE_EXCLUDE_RE = /\b(subtotal|total|discount|tip|promo|credits?|time|address|estimate|minutes?|min|free delivery|pickup|order together|skupni znesek|popust|napitnina)\b/i;
const TOTAL_RE = /^(?:total(?:\s+(?:sum|price|amount))?|skupni znesek)$/i;
const LABEL_STOP_RE = /\b(subtotal|total|applied offers|offers?|discounts?)\b/i;
const DISCOUNT_LABEL_RE = /^(applied offers|discounts?\d*|offers|promo(?:tion)?s?|credits?|popusti?)$/i;
const DISCOUNT_WORD_RE = /\b(discounts?|offers?|promo|credits?|vouchers?|popusti?)\b/i;
const AMOUNT_LOOKAHEAD = 5;
const READY_STATUS_RE = /^ready$/i;

export function splitLines(text: string): string[] {
  return text
    .replace(/[\u200b-\u200d\u2060\u00ad\ufeff]/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Finds the charged amount after a label, skipping badges (e.g. "Wolt+") and struck-through original prices. */
function findAmountAfter(lines: string[], index: number): Money | null {
  for (let next = index + 1; next <= index + AMOUNT_LOOKAHEAD && next < lines.length; next++) {
    const line = lines[next]!;
    const money = parseMoneyLine(line);
    if (money) return money;
    if (FEE_RE.test(line) || TOTAL_RE.test(line) || LABEL_STOP_RE.test(line)) return null;
  }
  return null;
}

function isNameCandidate(line: string): boolean {
  return !(
    line.length > 60 ||
    HOST_RE.test(line) ||
    SKIP_RE.test(line) ||
    STATUS_RE.test(line) ||
    ITEM_RE.test(line) ||
    INITIALS_RE.test(line) ||
    PLAIN_NUMBER_RE.test(line) ||
    parseMoneyLine(line) !== null
  );
}

export function parseParticipants(lines: string[]): { participants: WoltParticipant[]; currency?: string } {
  const start = lines.findIndex((line) => PARTICIPANTS_RE.test(line));
  if (start < 0) return { participants: [] };
  const endOffset = lines.slice(start + 1).findIndex((line) => SECTION_END_RE.test(line));
  const section = lines.slice(start + 1, endOffset < 0 ? undefined : start + 1 + endOffset);

  const statusIndexes = section.flatMap((line, index) => (STATUS_RE.test(line) ? [index] : []));
  const participants: WoltParticipant[] = [];
  let currency: string | undefined;
  let floor = 0;

  statusIndexes.forEach((statusIndex, position) => {
    const next = statusIndexes[position + 1] ?? section.length;
    let nameIndex = -1;
    for (let index = statusIndex - 1; index >= floor; index--) {
      if (isNameCandidate(section[index]!)) {
        nameIndex = index;
        break;
      }
    }
    floor = statusIndex + 1;
    if (nameIndex < 0) return;

    const statusMatch = STATUS_RE.exec(section[statusIndex]!)!;
    const rawName = section[nameIndex]!;
    const hostBadge = section.slice(nameIndex + 1, statusIndex).some((line) => HOST_RE.test(line));
    const following = section.slice(statusIndex + 1, next);
    const itemLine = following.find((line) => ITEM_RE.test(line));
    const priceIndex = following.findIndex((line) => parseMoneyLine(line) !== null);
    if (priceIndex < 0) return;
    const price = parseMoneyLine(following[priceIndex])!;
    const struckThrough = following[priceIndex + 1];
    const original = struckThrough && PLAIN_NUMBER_RE.test(struckThrough) ? amountToCents(struckThrough) : price.cents;

    currency ??= price.currency;
    participants.push({
      name: rawName.replace(HOST_SUFFIX_RE, '').trim(),
      isHost: hostBadge || HOST_SUFFIX_RE.test(rawName),
      status: statusMatch[1]!,
      itemCount: Number(statusMatch[2] ?? (itemLine ? ITEM_RE.exec(itemLine)?.[1] : undefined)) || undefined,
      cents: price.cents,
      originalCents: Math.max(original, price.cents),
    });
  });

  return { participants, currency };
}

export function parseFees(lines: string[]): WoltFee[] {
  const fees: WoltFee[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (line.length > 48 || !FEE_RE.test(line) || FEE_EXCLUDE_RE.test(line)) return;
    const inline = extractTrailingMoney(line);
    const label = inline?.label || line;
    const money = inline?.money ?? findAmountAfter(lines, index);
    if (!money || money.cents <= 0 || !label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    fees.push({ label, cents: money.cents });
  });
  return fees;
}

export function parseDiscounts(lines: string[]): WoltFee[] {
  const discounts: WoltFee[] = [];
  lines.forEach((line, index) => {
    if (!DISCOUNT_LABEL_RE.test(line)) return;
    const money = parseMoneyLine(lines[index + 1]);
    if (money && money.cents !== 0) discounts.push({ label: line, cents: -Math.abs(money.cents) });
  });
  return discounts;
}

/** Returns the last total on the page; the checkout also shows a "Total sum" for the host's own basket earlier. */
export function parseTotal(lines: string[]): number | undefined {
  let total: number | undefined;
  for (const [index, line] of lines.entries()) {
    const inline = extractTrailingMoney(line);
    if (inline && TOTAL_RE.test(inline.label)) total = inline.money.cents;
    else if (TOTAL_RE.test(line)) total = findAmountAfter(lines, index)?.cents ?? total;
  }
  return total;
}

export function parseVenue(lines: string[], title = ''): string | undefined {
  const fromTitle = title.split('|').map((part) => part.trim());
  if (fromTitle.length >= 3 && fromTitle[1]) return fromTitle[1];
  for (const line of lines) {
    const match = /^order together from (.+)$/i.exec(line);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Parses the group order checkout page; only participants with status "Ready" are returned. */
export function parseWoltCheckout(text: string, title = ''): WoltOrder {
  const lines = splitLines(text);
  const { participants, currency } = parseParticipants(lines);
  return {
    source: 'checkout',
    venue: parseVenue(lines, title),
    currency: currency ?? 'EUR',
    participants: participants.filter((participant) => READY_STATUS_RE.test(participant.status)),
    fees: parseFees(lines),
    discounts: parseDiscounts(lines),
    totalCents: parseTotal(lines),
  };
}

const HISTORY_AMOUNT_RE = /^[-−]?\d+(?:[.,]\d{1,2})?$/;
const HISTORY_INLINE_RE = /^(.*?\D)\s+([-−]?\d+(?:[.,]\d{1,2})?)$/;
const QUANTITY_RE = /^[×x]\s?\d+$/i;

function historyAmount(line: string | undefined): number | null {
  if (!line) return null;
  const money = parseMoneyLine(line);
  if (money) return money.cents;
  return HISTORY_AMOUNT_RE.test(line) ? amountToCents(line) : null;
}

function elementAmount(element: HTMLElement | null): number | null {
  if (!element) return null;
  for (const line of splitLines(element.innerText).reverse()) {
    const amount = historyAmount(line);
    if (amount !== null) return amount;
  }
  return null;
}

/** Reads the label/amount rows (delivery, service fee, discounts) that sit between the last item and the total. */
function parseHistoryCharges(lines: string[], start: number, totalIndex: number): { rows: WoltFee[]; firstIndex: number } {
  const rows: WoltFee[] = [];
  let index = totalIndex - 1;
  while (index > start) {
    const line = lines[index]!;
    let label: string | undefined;
    let cents: number;
    let consumed: number;
    const amount = historyAmount(line);
    if (amount !== null) {
      label = lines[index - 1];
      cents = amount;
      consumed = 2;
    } else {
      const inline = HISTORY_INLINE_RE.exec(line);
      if (!inline) break;
      label = inline[1];
      cents = amountToCents(inline[2]!);
      consumed = 1;
    }
    if (!label || label.includes('?:') || QUANTITY_RE.test(label) || historyAmount(label) !== null || label.startsWith('+')) break;
    rows.unshift({ label: label.replace(/^(Delivery)(?=\p{Lu})/u, '$1 – '), cents });
    index -= consumed;
  }
  return { rows, firstIndex: index + 1 };
}

/** Parses a past order on wolt.com/…/me/order-history/<id>. Prices there are before item discounts. */
export function parseWoltHistory(text: string): WoltOrder {
  const lines = splitLines(text);
  const backIndex = lines.findIndex((line) => /^(back to order history|nazaj na (?:status naročila|zgodovino naročil))$/i.test(line));
  const orderId = lines.map((line) => /(?:^order id:\s*|^id naročila:\s*)([a-f\d]{24})/i.exec(line)?.[1]).find(Boolean);
  const placedAt = lines.map((line) => /((?:\d{1,2}\.\s*)?\d{1,2}[./]\s*\d{1,2}[./]\s*\d{2,4},?\s*\d{1,2}:\d{2}|[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i.exec(line)?.[1]).find(Boolean);
  const itemsIndex = lines.findIndex((line) => /^(items|artikli)$/i.test(line));
  let totalIndex = -1;
  lines.forEach((line, index) => {
    if (index > itemsIndex && TOTAL_RE.test(line)) totalIndex = index;
  });

  const order: WoltOrder = {
    source: 'history',
    orderId,
    placedAt,
    venue: backIndex >= 0 ? lines[backIndex + 1] : undefined,
    currency: 'EUR',
    participants: [],
    fees: [],
    discounts: [],
    totalCents: totalIndex >= 0 ? (findAmountAfter(lines, totalIndex)?.cents ?? undefined) : undefined,
  };
  if (itemsIndex < 0 || totalIndex < 0) return order;

  const { rows, firstIndex } = parseHistoryCharges(lines, itemsIndex, totalIndex);
  for (const row of rows) {
    if (row.cents < 0 || DISCOUNT_WORD_RE.test(row.label)) order.discounts.push({ label: row.label, cents: -Math.abs(row.cents) });
    else if (row.cents > 0) order.fees.push(row);
  }

  for (let index = itemsIndex + 1; index < firstIndex; index++) {
    const line = lines[index]!;
    const isHost = HOST_RE.test(lines[index + 1] ?? '');
    const price = parseMoneyLine(lines[index + (isHost ? 2 : 1)]);
    if ((!isNameCandidate(line) && !(INITIALS_RE.test(line) && price)) || line.includes('?:')) continue;
    if (!price) continue;
    order.currency = price.currency;
    order.participants.push({ name: line, isHost, status: 'Ready', cents: price.cents, originalCents: price.cents });
  }
  const totalLine = lines[totalIndex + 1];
  if (order.totalCents === undefined && totalLine) order.totalCents = historyAmount(totalLine) ?? undefined;
  return order;
}

/** Reads the locale-independent data-test-id receipt structure, falling back to its localized text. */
export function parseWoltHistoryReceipt(receipt: HTMLElement): WoltOrder {
  const fallback = parseWoltHistory(receipt.innerText);
  const participantElements = [...receipt.querySelectorAll<HTMLElement>('[data-test-id="ParticipantNameLine"]')];
  if (!participantElements.length) return fallback;

  const participants: WoltParticipant[] = [];
  let currency = fallback.currency;
  for (const element of participantElements) {
    const lines = splitLines(element.innerText);
    const price = lines.map(parseMoneyLine).find((value) => value !== null);
    const isHost = lines.some((line) => /^(host|gostitelj)$/i.test(line));
    const name = lines.find((line) => parseMoneyLine(line) === null && !/^(host|gostitelj)$/i.test(line));
    if (!name || !price) continue;
    currency = price.currency;
    participants.push({ name, isHost, status: 'Ready', cents: price.cents, originalCents: price.cents });
  }
  if (!participants.length) return fallback;

  const serviceFees = [...receipt.querySelectorAll<HTMLElement>('[data-test-id="OrderDetailsWoltServiceFee"]')]
    .map((element) => elementAmount(element))
    .filter((cents): cents is number => cents !== null && cents > 0)
    .map((cents) => ({ label: 'Service fee', cents }));
  const deliveryFees = [...receipt.querySelectorAll<HTMLElement>('[data-test-id="RowWithSubItems-MainRow"]')]
    .map((element) => elementAmount(element))
    .filter((cents): cents is number => cents !== null && cents > 0)
    .map((cents) => ({ label: 'Delivery', cents }));
  const discountRows = [...receipt.querySelectorAll<HTMLElement>('[data-test-id^="OrderDetailsWoltDiscount"]')]
    .map((element) => elementAmount(element))
    .filter((cents): cents is number => cents !== null && cents !== 0)
    .map((cents) => ({ label: 'Discount', cents: -Math.abs(cents) }));
  const totalElement = receipt.querySelector<HTMLElement>('[data-test-id="TotalRowCheckoutTotal"]');
  const idElement = receipt.querySelector<HTMLElement>('[data-test-id="receipt-header.order.order-id"]');

  return {
    ...fallback,
    orderId: idElement?.innerText.match(/[a-f\d]{24}/i)?.[0] ?? fallback.orderId,
    venue: receipt.querySelector<HTMLElement>('h2')?.innerText.trim() || fallback.venue,
    currency,
    participants,
    fees: serviceFees.length || deliveryFees.length ? [...deliveryFees, ...serviceFees] : fallback.fees,
    discounts: discountRows.length ? discountRows : fallback.discounts,
    totalCents: elementAmount(totalElement) ?? fallback.totalCents,
  };
}
