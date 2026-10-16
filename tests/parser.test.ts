import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWoltCheckout, parseWoltHistory, parseWoltHistoryReceipt } from '../src/content/parser';

const snapshot = readFileSync(new URL('./fixtures/wolt-snapshot.txt', import.meta.url), 'utf8');

describe('parseWoltCheckout', () => {
  it('parses the participants of the captured snapshot', () => {
    const order = parseWoltCheckout(snapshot, 'Checkout | The BRGR | Wolt');
    expect(order.venue).toBe('The BRGR');
    expect(order.currency).toBe('EUR');
    expect(order.participants.map(({ name, cents, isHost }) => ({ name, cents, isHost }))).toEqual([
      { name: 'Participant One', cents: 867, isHost: true },
      { name: 'Participant Two', cents: 867, isHost: false },
      { name: 'Participant Three', cents: 867, isHost: false },
      { name: 'Participant Four', cents: 1239, isHost: false },
      { name: 'Participant Five', cents: 867, isHost: false },
      { name: 'Participant Six', cents: 1096, isHost: false },
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
      'Participant One HOST',
      'Ready • 2 items',
      '17,34 €',
      '24,78',
      'V',
      'Participant Six',
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
      { name: 'Participant One', isHost: true, status: 'Ready', itemCount: 2, cents: 1734, originalCents: 2478 },
      { name: 'Participant Six', isHost: false, status: 'Ready', itemCount: 1, cents: 1096, originalCents: 1096 },
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
      { name: 'Participant One', cents: 867, originalCents: 1239, isHost: true },
      { name: 'Participant Seven', cents: 967, originalCents: 1339, isHost: false },
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
      ['Participant One', 1239, true],
      ['Participant Two', 1239, false],
      ['Participant Three', 1239, false],
      ['Participant Four', 1239, false],
      ['Participant Five', 1239, false],
      ['Participant Six', 1468, false],
    ]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 207 }]);
    expect(order.discounts).toEqual([{ label: 'Discounts', cents: -1860 }]);
  });

  it('stops at the last item price when there are no add-ons', () => {
    const order = parseWoltHistory(['Items', 'Participant One', '€9.00', 'Burger', '9.00', '×1', '9.00', 'Service fee', '1.00', 'Total sum', '€10.00'].join('\n'));
    expect(order.participants).toEqual([{ name: 'Participant One', isHost: false, status: 'Ready', cents: 900, originalCents: 900 }]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 100 }]);
  });

  it('captures short uppercase participant names when followed by a participant price', () => {
    const order = parseWoltHistory(['Items', 'XYZ', '€10.50', 'Tortilija Greek', '10.50', '×1', '10.50', 'Participant Eight', '€10.50', 'Tortilija Greek', '10.50', '×1', '10.50', 'Service fee', '2.02', 'Total sum', '€23.02'].join('\n'));
    expect(order.participants.map(({ name, cents }) => [name, cents])).toEqual([['XYZ', 1050], ['Participant Eight', 1050]]);
    expect(order.totalCents).toBe(2302);
  });

  it('parses a Slovenian order-history receipt', () => {
    const text = [
      'Nazaj na status naročila', 'Greenbox', 'Naročilo je oddano: 16. 10. 26, 11:05',
      'Dostava', 'Naroči skupaj', 'V pripravi', 'Tvoja številka naročila: 103',
      'ID naročila: 6ad1e8e18553ec271b4ace06', 'Artikli',
      'XYZ', '10,50 €', 'Tortilija Greek', '10,50', '×1', '10,50',
      'Participant Eight', '10,50 €', 'Tortilija Greek', '10,50', '×1', '10,50',
      'Participant Nine', '10,50 €', 'Tortilija Greek', '10,50', '×1', '10,50',
      'DostavaWork\t0,00', 'Strošek storitve', '2,02', 'Skupni znesek', '33,52 €',
    ].join('\n');
    const order = parseWoltHistory(text);
    expect(order).toMatchObject({ venue: 'Greenbox', orderId: '6ad1e8e18553ec271b4ace06', placedAt: '16. 10. 26, 11:05', currency: 'EUR', totalCents: 3352 });
    expect(order.participants.map(({ name, cents }) => [name, cents])).toEqual([
      ['XYZ', 1050], ['Participant Eight', 1050], ['Participant Nine', 1050],
    ]);
    expect(order.fees).toEqual([{ label: 'Strošek storitve', cents: 202 }]);
  });

  it('reads receipt data attributes even when receipt labels are in an unknown language', () => {
    const node = (innerText: string, textContent = innerText): HTMLElement => ({ innerText, textContent } as HTMLElement);
    const selectors = new Map<string, HTMLElement>([
      ['h2', node('Greenbox')],
      ['[data-test-id="receipt-header.order.order-id"]', node('ID: 6ad1e8e18553ec271b4ace06')],
      ['[data-test-id="TotalRowCheckoutTotal"]', node('Summe\n33,52 €')],
    ]);
    const collections = new Map<string, HTMLElement[]>([
      ['[data-test-id="ParticipantNameLine"]', [node('XYZ\n10,50 €'), node('Participant Eight\n10,50 €')]],
      ['[data-test-id="OrderDetailsWoltServiceFee"]', [node('Gebühr\n2,02')]],
      ['[data-test-id="RowWithSubItems-MainRow"]', [node('Zustellung\n0,00')]],
      ['[data-test-id^="OrderDetailsWoltDiscount"]', []],
    ]);
    const receipt = {
      innerText: 'Unrecognized localized order receipt',
      querySelector: (selector: string) => selectors.get(selector) ?? null,
      querySelectorAll: (selector: string) => collections.get(selector) ?? [],
    } as unknown as HTMLElement;

    const order = parseWoltHistoryReceipt(receipt);
    expect(order).toMatchObject({ venue: 'Greenbox', orderId: '6ad1e8e18553ec271b4ace06', totalCents: 3352, currency: 'EUR' });
    expect(order.participants.map(({ name, cents }) => [name, cents])).toEqual([['XYZ', 1050], ['Participant Eight', 1050]]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 202 }]);
  });
});
