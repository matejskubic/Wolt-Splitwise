import { centsToDecimal } from './money';

export interface ShareInput {
  userId: number;
  itemCents: number;
}

export interface UserShare {
  userId: number;
  paidCents: number;
  owedCents: number;
}

export interface ShareResult {
  totalCents: number;
  feeShares: number[];
  shares: UserShare[];
}

/** Splits an amount into `parts` integer portions that differ by at most one cent and sum to the amount. */
export function distribute(totalCents: number, parts: number): number[] {
  if (parts <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
}

/** Splits an amount proportionally to the weights (largest remainder), so the parts sum exactly to the amount. */
export function distributeProportionally(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  if (weightSum <= 0) return distribute(totalCents, weights.length);
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const exact = weights.map((weight) => (abs * Math.max(weight, 0)) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = abs - parts.reduce((sum, part) => sum + part, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder-- <= 0) break;
    parts[index]! += 1;
  }
  return parts.map((part) => sign * part);
}

/** Computes per-user owed shares (items + equal fee portion per participant); the payer covers the whole total. */
export function computeShares(items: ShareInput[], feeCents: number, payerId: number): ShareResult {
  const feeShares = distribute(feeCents, items.length);
  const owed = new Map<number, number>();
  items.forEach((item, index) => {
    owed.set(item.userId, (owed.get(item.userId) ?? 0) + item.itemCents + (feeShares[index] ?? 0));
  });
  if (!owed.has(payerId)) owed.set(payerId, 0);

  const totalCents = [...owed.values()].reduce((sum, value) => sum + value, 0);
  const shares = [...owed.entries()].map(([userId, owedCents]) => ({
    userId,
    owedCents,
    paidCents: userId === payerId ? totalCents : 0,
  }));
  return { totalCents, feeShares, shares };
}

export interface ExpenseMeta {
  description: string;
  details?: string;
  currencyCode: string;
  groupId: number;
  categoryId: number;
  date?: Date;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function parseOrderPlacedDate(placedAt: string | undefined): Date | undefined {
  if (placedAt === undefined) return undefined;
  const text = placedAt.replace(/^Order placed:\s*/i, '').trim();
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})$/.exec(text);
  const named = /^([a-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(text);
  let month: number;
  let day: number;
  let year: number;
  let hour: number;
  let minute: number;
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]) - 1;
    year = Number(numeric[3]);
    hour = Number(numeric[4]);
    minute = Number(numeric[5]);
  } else if (named && Number(named[4]) >= 1 && Number(named[4]) <= 12) {
    month = MONTH_NAMES.indexOf(named[1]!.toLowerCase());
    day = Number(named[2]);
    year = Number(named[3]);
    hour = Number(named[4]) % 12 + (named[6]!.toUpperCase() === 'PM' ? 12 : 0);
    minute = Number(named[5]);
  } else {
    throw new Error(`Could not parse the order's placement date: ${placedAt}`);
  }
  const date = new Date(year, month, day, hour, minute);
  if (month < 0 || month > 11 || hour > 23 || minute > 59 || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error(`Invalid order placement date: ${placedAt}`);
  }
  return date;
}

export function buildExpensePayload(result: ShareResult, meta: ExpenseMeta): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    cost: centsToDecimal(result.totalCents),
    description: meta.description,
    currency_code: meta.currencyCode,
    group_id: meta.groupId,
    date: (meta.date ?? new Date()).toISOString(),
    category_id: meta.categoryId,
  };
  if (meta.details) payload.details = meta.details;
  result.shares.forEach((share, index) => {
    payload[`users__${index}__user_id`] = share.userId;
    payload[`users__${index}__paid_share`] = centsToDecimal(share.paidCents);
    payload[`users__${index}__owed_share`] = centsToDecimal(share.owedCents);
  });
  return payload;
}
