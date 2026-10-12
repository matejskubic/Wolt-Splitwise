import { normalizeName } from './names';
import { distributeProportionally } from './split';
import type { SplitAmount } from './splitInput';
import type { WoltFee, WoltOrder } from './types';

export interface SnapshotParticipant {
  name: string;
  isHost: boolean;
  cents: number;
  originalCents: number;
}

/** Checkout data captured while the group order was still open; discounts per participant are only visible there. */
export interface CheckoutSnapshot {
  id: string;
  venue?: string;
  currency: string;
  capturedAt: number;
  participants: SnapshotParticipant[];
  fees: WoltFee[];
  discounts: WoltFee[];
  totalCents?: number;
}

export const MAX_SNAPSHOTS = 50;
const LOCAL_KEY = 'checkoutSnapshots';
const SYNC_PREFIX = 'checkout:';

export function toSnapshot(id: string, order: WoltOrder, capturedAt = Date.now()): CheckoutSnapshot {
  return {
    id,
    venue: order.venue,
    currency: order.currency,
    capturedAt,
    participants: order.participants.map(({ name, isHost, cents, originalCents }) => ({ name, isHost, cents, originalCents })),
    fees: order.fees,
    discounts: order.discounts,
    totalCents: order.totalCents,
  };
}

const contentKey = ({ capturedAt: _ignored, ...rest }: CheckoutSnapshot): string => JSON.stringify(rest);

/** Builds a snapshot from pasted per-person amounts (after discounts, before fees) for an order history order. */
export function snapshotFromAmounts(order: WoltOrder, amounts: SplitAmount[], capturedAt = Date.now()): CheckoutSnapshot {
  const byName = new Map(order.participants.map((participant) => [normalizeName(participant.name), participant]));
  return {
    id: `pasted:${order.orderId ?? capturedAt}`,
    venue: order.venue,
    currency: order.currency,
    capturedAt,
    participants: amounts.map(({ name, cents }) => {
      const match = byName.get(normalizeName(name));
      return { name: match?.name ?? name, isHost: match?.isHost ?? false, cents, originalCents: Math.max(match?.originalCents ?? cents, cents) };
    }),
    fees: [],
    discounts: [],
  };
}

/** Inserts or replaces a snapshot, newest first, capped at `max`. Returns null when nothing changed. */
export function upsertSnapshot(list: CheckoutSnapshot[], snapshot: CheckoutSnapshot, max = MAX_SNAPSHOTS): CheckoutSnapshot[] | null {
  const existing = list.find((item) => item.id === snapshot.id);
  if (existing && contentKey(existing) === contentKey(snapshot)) return null;
  return [snapshot, ...list.filter((item) => item.id !== snapshot.id)].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, max);
}

export async function saveCheckoutSnapshot(snapshot: CheckoutSnapshot): Promise<boolean> {
  const stored = await chrome.storage.local.get(LOCAL_KEY);
  const next = upsertSnapshot((stored[LOCAL_KEY] as CheckoutSnapshot[] | undefined) ?? [], snapshot);
  if (!next) return false;
  await chrome.storage.local.set({ [LOCAL_KEY]: next });

  try {
    // One sync item per order keeps each item well below the 8 KB per-item quota.
    await chrome.storage.sync.set({ [`${SYNC_PREFIX}${snapshot.id}`]: snapshot });
    const all = await chrome.storage.sync.get(null);
    const stale = Object.entries(all)
      .filter(([key]) => key.startsWith(SYNC_PREFIX))
      .sort(([, a], [, b]) => (b as CheckoutSnapshot).capturedAt - (a as CheckoutSnapshot).capturedAt)
      .slice(MAX_SNAPSHOTS)
      .map(([key]) => key);
    if (stale.length) await chrome.storage.sync.remove(stale);
  } catch (error) {
    console.warn('Wolt to Splitwise: could not sync checkout snapshot', error);
  }
  return true;
}

export async function listCheckoutSnapshots(): Promise<CheckoutSnapshot[]> {
  const [local, sync] = await Promise.all([chrome.storage.local.get(LOCAL_KEY), chrome.storage.sync.get(null).catch(() => ({}))]);
  const merged = new Map<string, CheckoutSnapshot>();
  const candidates = [
    ...((local[LOCAL_KEY] as CheckoutSnapshot[] | undefined) ?? []),
    ...Object.entries(sync as Record<string, unknown>)
      .filter(([key]) => key.startsWith(SYNC_PREFIX))
      .map(([, value]) => value as CheckoutSnapshot),
  ];
  for (const snapshot of candidates) {
    const current = merged.get(snapshot.id);
    if (!current || snapshot.capturedAt > current.capturedAt) merged.set(snapshot.id, snapshot);
  }
  return [...merged.values()].sort((a, b) => b.capturedAt - a.capturedAt);
}

/** Ranks snapshots by venue, matching participant names and matching pre-discount prices; best first. */
export function rankSnapshots(order: WoltOrder, snapshots: CheckoutSnapshot[]): CheckoutSnapshot[] {
  const venue = order.venue ? normalizeName(order.venue) : undefined;
  const scored = snapshots.flatMap((snapshot) => {
    if (venue && snapshot.venue && normalizeName(snapshot.venue) !== venue) return [];
    const byName = new Map(snapshot.participants.map((participant) => [normalizeName(participant.name), participant]));
    let names = 0;
    let prices = 0;
    for (const participant of order.participants) {
      const match = byName.get(normalizeName(participant.name));
      if (!match) continue;
      names++;
      if (match.originalCents === participant.originalCents) prices++;
    }
    return names === 0 ? [] : [{ snapshot, score: names * 100 + prices }];
  });
  return scored.sort((a, b) => b.score - a.score || b.snapshot.capturedAt - a.snapshot.capturedAt).map(({ snapshot }) => snapshot);
}

export interface DiscountedOrder {
  order: WoltOrder;
  /** Discount taken from the checkout snapshot, per participant. */
  snapshotCents: number;
  /** Discount on the order that the snapshot did not explain; split proportionally to item prices. */
  proportionalCents: number;
  unmatchedNames: string[];
}

/** Applies per-participant discounts from a checkout snapshot to an order history order (whose prices are pre-discount). */
export function applyCheckoutDiscounts(order: WoltOrder, snapshot?: CheckoutSnapshot): DiscountedOrder {
  const byName = new Map((snapshot?.participants ?? []).map((participant) => [normalizeName(participant.name), participant]));
  const unmatchedNames: string[] = [];
  const perParticipant = order.participants.map((participant) => {
    const match = byName.get(normalizeName(participant.name));
    if (!match) {
      if (snapshot) unmatchedNames.push(participant.name);
      return 0;
    }
    return Math.min(Math.max(match.originalCents - match.cents, 0), participant.originalCents);
  });
  const snapshotCents = perParticipant.reduce((sum, value) => sum + value, 0);
  const orderDiscount = -order.discounts.reduce((sum, discount) => sum + discount.cents, 0);
  const proportionalCents = order.discounts.length ? orderDiscount - snapshotCents : 0;
  const remaining = order.participants.map((participant, index) => participant.originalCents - perParticipant[index]!);
  const proportional = distributeProportionally(proportionalCents, remaining);

  return {
    order: {
      ...order,
      participants: order.participants.map((participant, index) => ({ ...participant, cents: remaining[index]! - proportional[index]! })),
    },
    snapshotCents,
    proportionalCents,
    unmatchedNames,
  };
}
