export interface Money {
  cents: number;
  currency: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '₪': 'ILS', '¥': 'JPY', '₸': 'KZT', '₾': 'GEL' };
const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'RSD', 'BAM', 'MKD', 'ALL', 'GEL', 'AZN', 'KZT', 'ILS', 'JPY', 'UZS'];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CURRENCY = [...Object.keys(CURRENCY_SYMBOLS).map(escapeRegExp), ...CURRENCY_CODES].join('|');
const AMOUNT = String.raw`[-−]?\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|[-−]?\d+(?:[.,]\d{1,2})?`;
const MONEY = String.raw`(?:([-−])?(${CURRENCY})\s?(${AMOUNT})|(${AMOUNT})\s?(${CURRENCY}))`;
const MONEY_LINE_RE = new RegExp(String.raw`^${MONEY}$`);
const MONEY_ANYWHERE_RE = new RegExp(MONEY, 'g');

export function amountToCents(raw: string): number {
  const text = raw.replace('−', '-').trim();
  const negative = text.startsWith('-');
  const decimals = /[.,](\d{1,2})$/.exec(text);
  const integerPart = (decimals ? text.slice(0, decimals.index) : text).replace(/\D/g, '');
  const cents = Number(integerPart || '0') * 100 + Number((decimals?.[1] ?? '0').padEnd(2, '0'));
  return negative ? -cents : cents;
}

function toMoney(match: RegExpExecArray): Money {
  const symbol = match[2] ?? match[5] ?? '';
  const amount = `${match[1] ?? ''}${match[3] ?? match[4] ?? '0'}`;
  return { cents: amountToCents(amount), currency: CURRENCY_SYMBOLS[symbol] ?? symbol };
}

/** Parses a line that consists solely of a currency amount (e.g. "€8.67" or "8,67 €"). Plain numbers without currency return null. */
export function parseMoneyLine(line: string | undefined): Money | null {
  if (!line) return null;
  const match = MONEY_LINE_RE.exec(line.replace(/\s+/g, ' ').trim());
  return match ? toMoney(match) : null;
}

/** Finds the last currency amount inside a line and returns it together with the remaining label text. */
export function extractTrailingMoney(line: string): { money: Money; label: string } | null {
  const matches = [...line.matchAll(MONEY_ANYWHERE_RE)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;
  const label = (line.slice(0, last.index) + line.slice(last.index + last[0].length)).replace(/[\s:–-]+$/, '').trim();
  return { money: toMoney(last as RegExpExecArray), label };
}

/** Formats cents as a decimal string with two places, as required by the Splitwise API. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parses a user-entered decimal amount (accepts "," or "." as decimal separator). */
export function decimalToCents(value: string): number | null {
  const text = value.trim();
  if (!/^-?\d+(?:[.,]\d{0,2})?$/.test(text)) return null;
  return amountToCents(text);
}

export function formatMoney(cents: number, currency: string): string {
  return `${centsToDecimal(cents)} ${currency}`;
}
