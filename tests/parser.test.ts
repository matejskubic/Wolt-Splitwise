import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWoltCheckout, parseWoltHistory } from '../src/content/parser';

const snapshot = readFileSync(new URL('./fixtures/wolt-snapshot.txt', import.meta.url), 'utf8');

describe('parseWoltCheckout', () => {
  it('parses the participants of the captured snapshot', () => {
    const order = parseWoltCheckout(snapshot, 'Checkout | The BRGR | Wolt');
    expect(order.venue).toBe('The BRGR');
    expect(order.currency).toBe('EUR');
    expect(order.participants.map(({ name, cents, isHost }) => ({ name, cents, isHost }))).toEqual([
      { name: 'Matej Skubic', cents: 867, isHost: true },
      { name: 'Marko Tasevski', cents: 867, isHost: false },
      { name: 'Ivan Batinić', cents: 867, isHost: false },
      { name: 'Kris Stopar', cents: 1239, isHost: false },
      { name: 'Tomi Bandelj', cents: 867, isHost: false },
      { name: 'Vale', cents: 1096, isHost: false },
    ]);
    expect(order.participants.every((p) => p.status === 'Ready' && p.itemCount === 1)).toBe(true);
    expect(order.fees).toEqual([]);
  });

  it('handles avatar initials, inline status, comma decimals, fees and total', () => {
    const text = [
      'Group summary',
      'Participants',
      'Not ready: 0',
      'Ready: 2',
      'MS',
      'Matej Skubic HOST',
      'Ready • 2 items',
      '17,34 €',
      '24,78',
      'V',
      'Vale',
      'Ready • 1 item',
      '10,96 €',
      'Lock order together',
      'Order summary',
      'Item subtotal',
      '28,30 €',
      'Delivery',
      '1,99 €',
      'Service fee 0,99 €',
      'Total',
      '31,28 €',
    ].join('\n');
    const order = parseWoltCheckout(text);
    expect(order.participants).toEqual([
      { name: 'Matej Skubic', isHost: true, status: 'Ready', itemCount: 2, cents: 1734, originalCents: 2478 },
      { name: 'Vale', isHost: false, status: 'Ready', itemCount: 1, cents: 1096, originalCents: 1096 },
    ]);
    expect(order.fees).toEqual([
      { label: 'Delivery', cents: 199 },
      { label: 'Service fee', cents: 99 },
    ]);
    expect(order.totalCents).toBe(3128);
  });

  it('ignores coffee items and free delivery lines when looking for fees', () => {
    const order = parseWoltCheckout(['Iced coffee', '€3.50', 'Free delivery', '€0.00', 'Delivery fee', '€0.00'].join('\n'));
    expect(order.fees).toEqual([]);
  });

  it('imports discounted fees and total from the summary with Wolt+ badges and applied offers', () => {
    const summary = readFileSync(new URL('./fixtures/wolt-fee-discount.txt', import.meta.url), 'utf8');
    const order = parseWoltCheckout(`${snapshot}\n${summary}`);
    expect(order.participants).toHaveLength(6);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 118 }]);
    expect(order.totalCents).toBe(1952);
  });

  it('imports non-zero delivery fees with a distance in the label', () => {
    const order = parseWoltCheckout(['Summary', 'Item subtotal', '€18.34', 'Delivery (1.3 km)', 'Wolt+', '2.49', '€1.99', 'Total', '€20.33'].join('\n'));
    expect(order.fees).toEqual([{ label: 'Delivery (1.3 km)', cents: 199 }]);
    expect(order.totalCents).toBe(2033);
  });

  it('parses the live checkout: ready participants only, original prices, discounts and the order total', () => {
    const [title, ...rest] = readFileSync(new URL('./fixtures/wolt-checkout-live.txt', import.meta.url), 'utf8').split('\n');
    const order = parseWoltCheckout(rest.join('\n'), title);
    expect(order.venue).toBe('The BRGR');
    expect(order.participants.map(({ name, cents, originalCents, isHost }) => ({ name, cents, originalCents, isHost }))).toEqual([
      { name: 'Matej Skubic', cents: 867, originalCents: 1239, isHost: true },
      { name: 'Miha Boh', cents: 967, originalCents: 1339, isHost: false },
    ]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 118 }]);
    expect(order.discounts).toEqual([{ label: 'Applied offers', cents: -744 }]);
    expect(order.totalCents).toBe(1952);
  });
});

describe('parseWoltHistory', () => {
  const history = readFileSync(new URL('./fixtures/wolt-order-history.txt', import.meta.url), 'utf8');

  it('parses participants, fees, discounts and total of a past order', () => {
    const order = parseWoltHistory(history);
    expect(order).toMatchObject({ source: 'history', venue: 'The BRGR', orderId: '6acca6a76b439397dec49874', placedAt: '12/10/2026, 11:21', currency: 'EUR', totalCents: 6010 });
    expect(order.participants.map(({ name, cents, isHost }) => [name, cents, isHost])).toEqual([
      ['Matej Skubic', 1239, true],
      ['Marko Tasevski', 1239, false],
      ['Ivan Batinić', 1239, false],
      ['Kris Stopar', 1239, false],
      ['Tomi Bandelj', 1239, false],
      ['Vale', 1468, false],
    ]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 207 }]);
    expect(order.discounts).toEqual([{ label: 'Discounts', cents: -1860 }]);
  });

  it('stops at the last item price when there are no add-ons', () => {
    const order = parseWoltHistory(['Items', 'Ana', '€9.00', 'Burger', '9.00', '×1', '9.00', 'Service fee', '1.00', 'Total sum', '€10.00'].join('\n'));
    expect(order.participants).toEqual([{ name: 'Ana', isHost: false, status: 'Ready', cents: 900, originalCents: 900 }]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 100 }]);
  });
});
