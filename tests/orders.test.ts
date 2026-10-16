import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWoltCheckout, parseWoltHistory } from '../src/content/parser';
import { applyCheckoutDiscounts, rankSnapshots, toSnapshot, upsertSnapshot } from '../src/shared/orders';
import { distributeProportionally } from '../src/shared/split';

const read = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const history = parseWoltHistory(read('wolt-order-history.txt'));
const checkout = toSnapshot('f6ffacffffa1f0d8359f2f74', parseWoltCheckout(read('wolt-snapshot.txt'), 'Checkout | The BRGR | Wolt'), 1000);

describe('applyCheckoutDiscounts', () => {
  it('assigns each participant the discount seen on the checkout page', () => {
    const result = applyCheckoutDiscounts(history, checkout);
    expect(result.order.participants.map(({ name, cents }) => [name, cents])).toEqual([
      ['Participant One', 867],
      ['Participant Two', 867],
      ['Participant Three', 867],
      ['Participant Four', 1239],
      ['Participant Five', 867],
      ['Participant Six', 1096],
    ]);
    expect(result.snapshotCents).toBe(1860);
    expect(result.proportionalCents).toBe(0);
    const items = result.order.participants.reduce((sum, participant) => sum + participant.cents, 0);
    expect(items + 207).toBe(history.totalCents);
  });

  it('splits the order discount proportionally without a snapshot', () => {
    const result = applyCheckoutDiscounts(history);
    expect(result.proportionalCents).toBe(1860);
    expect(result.order.participants.reduce((sum, participant) => sum + participant.cents, 0)).toBe(7663 - 1860);
  });
});

describe('snapshots', () => {
  it('ranks the snapshot of the same venue and people first', () => {
    const otherVenue = { ...checkout, id: 'other', venue: 'Other place', capturedAt: 2000 };
    const fewerPeople = { ...checkout, id: 'older', participants: checkout.participants.slice(0, 2), capturedAt: 3000 };
    expect(rankSnapshots(history, [otherVenue, fewerPeople, checkout]).map((snapshot) => snapshot.id)).toEqual([checkout.id, 'older']);
  });

  it('upserts newest first, skips unchanged content and caps the list', () => {
    const list = Array.from({ length: 3 }, (_, index) => ({ ...checkout, id: `id${index}`, capturedAt: index }));
    expect(upsertSnapshot(list, { ...list[1]!, capturedAt: 99 })).toBeNull();
    expect(upsertSnapshot(list, { ...checkout, id: 'new', capturedAt: 50 }, 3)!.map((snapshot) => snapshot.id)).toEqual(['new', 'id2', 'id1']);
  });
});

describe('distributeProportionally', () => {
  it('sums exactly to the amount', () => {
    expect(distributeProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distributeProportionally(-1860, [1239, 1468])).toEqual([-851, -1009]);
  });
});
