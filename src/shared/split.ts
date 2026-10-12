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
  date?: Date;
}

export function buildExpensePayload(result: ShareResult, meta: ExpenseMeta): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    cost: centsToDecimal(result.totalCents),
    description: meta.description,
    currency_code: meta.currencyCode,
    group_id: meta.groupId,
    date: (meta.date ?? new Date()).toISOString(),
  };
  if (meta.details) payload.details = meta.details;
  result.shares.forEach((share, index) => {
    payload[`users__${index}__user_id`] = share.userId;
    payload[`users__${index}__paid_share`] = centsToDecimal(share.paidCents);
    payload[`users__${index}__owed_share`] = centsToDecimal(share.owedCents);
  });
  return payload;
}
