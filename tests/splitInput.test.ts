import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWoltHistory } from '../src/content/parser';
import { applyCheckoutDiscounts, snapshotFromAmounts } from '../src/shared/orders';
import { parseSplitInput } from '../src/shared/splitInput';

describe('parseSplitInput', () => {
  const expected = [
    { name: 'Matej Skubic', cents: 867 },
    { name: 'Miha Boh', cents: 967 },
  ];

  it('parses JSON matching split.schema.json', () => {
    expect(parseSplitInput('[{"name":"Matej Skubic","amount":8.67},{"name":"Miha Boh","amount":9.67}]')).toEqual(expected);
  });

  it.each([
    ['comma CSV', 'Matej Skubic,8.67\nMiha Boh,9.67\n'],
    ['semicolon CSV with decimal comma and header', 'name;amount\r\n"Matej Skubic";8,67\r\nMiha Boh;€9,67'],
    ['tab separated (spreadsheet paste)', 'Matej Skubic\t8.67\nMiha Boh\t9.67'],
  ])('parses %s', (_label, text) => {
    expect(parseSplitInput(text)).toEqual(expected);
  });

  it.each([
    ['', /Paste/],
    ['{"name":"x"}', /array/],
    ['[{"name":"x","amount":"1"}]', /amount/],
    ['Matej,abc\nMiha,1', /not a valid amount/],
  ])('rejects %j', (text, message) => {
    expect(() => parseSplitInput(text)).toThrow(message);
  });
});

describe('snapshotFromAmounts', () => {
  it('has the same effect as a checkout snapshot on an order history order', () => {
    const history = parseWoltHistory(readFileSync(new URL('./fixtures/wolt-order-history.txt', import.meta.url), 'utf8'));
    const pasted = parseSplitInput(['Matej Skubic,8.67', 'Marko Tasevski,8.67', 'Ivan Batinic,8.67', 'Kris Stopar,12.39', 'Tomi Bandelj,8.67', 'Vale,10.96'].join('\n'));
    const snapshot = snapshotFromAmounts(history, pasted, 1);
    expect(snapshot.id).toBe('pasted:6acca6a76b439397dec49874');
    expect(snapshot.participants[2]).toEqual({ name: 'Ivan Batinić', isHost: false, cents: 867, originalCents: 1239 });

    const result = applyCheckoutDiscounts(history, snapshot);
    expect(result.snapshotCents).toBe(1860);
    expect(result.proportionalCents).toBe(0);
    expect(result.order.participants.map((participant) => participant.cents)).toEqual([867, 867, 867, 1239, 867, 1096]);
  });
});
