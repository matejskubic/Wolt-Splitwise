import { extractTrailingMoney, parseMoneyLine, type Money } from '../shared/money';
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

const FEE_RE = /\b(delivery|service|small order|surcharge|bag|packaging|fee)\b/i;
const FEE_EXCLUDE_RE = /\b(subtotal|total|discount|tip|promo|credits?|time|address|estimate|minutes?|min|free delivery|pickup|order together)\b/i;
const TOTAL_RE = /^total(?:\s+(?:sum|price|amount))?$/i;
const LABEL_STOP_RE = /\b(subtotal|total|applied offers|offers?|discounts?)\b/i;
const AMOUNT_LOOKAHEAD = 5;

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
    const priceLine = following.map((line) => parseMoneyLine(line)).find((money) => money !== null);
    if (!priceLine) return;

    currency ??= priceLine.currency;
    participants.push({
      name: rawName.replace(HOST_SUFFIX_RE, '').trim(),
      isHost: hostBadge || HOST_SUFFIX_RE.test(rawName),
      status: statusMatch[1]!,
      itemCount: Number(statusMatch[2] ?? (itemLine ? ITEM_RE.exec(itemLine)?.[1] : undefined)) || undefined,
      cents: priceLine.cents,
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

export function parseTotal(lines: string[]): number | undefined {
  for (const [index, line] of lines.entries()) {
    const inline = extractTrailingMoney(line);
    if (inline && TOTAL_RE.test(inline.label)) return inline.money.cents;
    if (TOTAL_RE.test(line)) {
      const money = findAmountAfter(lines, index);
      if (money) return money.cents;
    }
  }
  return undefined;
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

export function parseWoltCheckout(text: string, title = ''): WoltOrder {
  const lines = splitLines(text);
  const { participants, currency } = parseParticipants(lines);
  return {
    venue: parseVenue(lines, title),
    currency: currency ?? 'EUR',
    participants,
    fees: parseFees(lines),
    totalCents: parseTotal(lines),
  };
}
