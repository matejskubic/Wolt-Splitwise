import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWoltHistory } from '../src/content/parser';
import { applyCheckoutDiscounts, snapshotFromAmounts } from '../src/shared/orders';
import { parseSplitInput } from '../src/shared/splitInput';

describe('parseSplitInput', () => {
  const expected = [
    { name: 'Participant One', cents: 867 },
    { name: 'Participant Seven', cents: 967 },
  ];

  it('parses JSON matching split.schema.json', () => {
    expect(parseSplitInput('[{"name":"Participant One","amount":8.67},{"name":"Participant Seven","amount":9.67}]')).toEqual(expected);
  });

  it.each([
    ['comma CSV', 'Participant One,8.67\nParticipant Seven,9.67\n'],
    ['semicolon CSV with decimal comma and header', 'name;amount\r\n"Participant One";8,67\r\nParticipant Seven;€9,67'],
    ['tab separated (spreadsheet paste)', 'Participant One\t8.67\nParticipant Seven\t9.67'],
  ])('parses %s', (_label, text) => {
    expect(parseSplitInput(text)).toEqual(expected);
  });

  it.each([
    ['', /Paste/],
    ['{"name":"x"}', /array/],
    ['[{"name":"x","amount":"1"}]', /amount/],
    ['Participant One,abc\nParticipant Two,1', /not a valid amount/],
  ])('rejects %j', (text, message) => {
    expect(() => parseSplitInput(text)).toThrow(message);
  });
});

describe('snapshotFromAmounts', () => {
  it('has the same effect as a checkout snapshot on an order history order', () => {
    const history = parseWoltHistory(readFileSync(new URL('./fixtures/wolt-order-history.txt', import.meta.url), 'utf8'));
    const pasted = parseSplitInput(['Participant One,8.67', 'Participant Two,8.67', 'Participant Three,8.67', 'Participant Four,12.39', 'Participant Five,8.67', 'Participant Six,10.96'].join('\n'));
    const snapshot = snapshotFromAmounts(history, pasted, 1);
    expect(snapshot.id).toBe('pasted:6acca6a76b439397dec49874');
    expect(snapshot.participants[2]).toEqual({ name: 'Participant Three', isHost: false, cents: 867, originalCents: 1239 });

    const result = applyCheckoutDiscounts(history, snapshot);
    expect(result.snapshotCents).toBe(1860);
    expect(result.proportionalCents).toBe(0);
    expect(result.order.participants.map((participant) => participant.cents)).toEqual([867, 867, 867, 1239, 867, 1096]);
  });
});
