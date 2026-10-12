import { describe, expect, it } from 'vitest';
import { centsToDecimal, decimalToCents, extractTrailingMoney, parseMoneyLine } from '../src/shared/money';
import { matchMember, type SplitwiseMember } from '../src/shared/names';
import { buildExpensePayload, computeShares, distribute } from '../src/shared/split';

describe('money', () => {
  it.each([
    ['€8.67', 867, 'EUR'],
    ['8,67 €', 867, 'EUR'],
    ['€1,234.50', 123450, 'EUR'],
    ['1.234,50 €', 123450, 'EUR'],
    ['CHF 12', 1200, 'CHF'],
    ['-€2.00', -200, 'EUR'],
  ])('parses %s', (text, cents, currency) => {
    expect(parseMoneyLine(text)).toEqual({ cents, currency });
  });

  it('ignores plain numbers without currency', () => {
    expect(parseMoneyLine('12.39')).toBeNull();
  });

  it('extracts inline amounts', () => {
    expect(extractTrailingMoney('Service fee: €0.99')).toEqual({ label: 'Service fee', money: { cents: 99, currency: 'EUR' } });
  });

  it('formats and parses decimals', () => {
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(1239)).toBe('12.39');
    expect(decimalToCents('1,5')).toBe(150);
    expect(decimalToCents('abc')).toBeNull();
  });
});

describe('matchMember', () => {
  const members: SplitwiseMember[] = [
    { id: 1, first_name: 'Matej', last_name: 'Skubic' },
    { id: 2, first_name: 'Ivan', last_name: 'Batinic' },
    { id: 3, first_name: 'Valentina', last_name: 'Novak' },
    { id: 4, first_name: 'Tomi', last_name: null },
    { id: 5, first_name: 'Kris', last_name: 'Stopar' },
    { id: 6, first_name: 'Kris', last_name: 'Other' },
  ];

  it('matches full names ignoring diacritics', () => {
    expect(matchMember('Ivan Batinić', members)).toBe(2);
    expect(matchMember('Kris Stopar', members)).toBe(5);
  });

  it('matches by first name when the member has no last name', () => {
    expect(matchMember('Tomi Bandelj', members)).toBe(4);
  });

  it('leaves ambiguous or unknown names unmatched', () => {
    expect(matchMember('Kris', members)).toBeUndefined();
    expect(matchMember('Marko Tasevski', members)).toBeUndefined();
  });

  it('prefers remembered mappings', () => {
    expect(matchMember('Vale', members, { vale: 3 })).toBe(3);
  });
});

describe('split', () => {
  it('distributes remainders by cent', () => {
    expect(distribute(100, 3)).toEqual([34, 33, 33]);
    expect(distribute(0, 2)).toEqual([0, 0]);
  });

  it('splits fees across all participants and lets the payer cover the total', () => {
    const result = computeShares(
      [
        { userId: 1, itemCents: 867 },
        { userId: 2, itemCents: 1239 },
        { userId: 3, itemCents: 1096 },
      ],
      298,
      1,
    );
    expect(result.totalCents).toBe(3500);
    expect(result.shares).toEqual([
      { userId: 1, owedCents: 967, paidCents: 3500 },
      { userId: 2, owedCents: 1338, paidCents: 0 },
      { userId: 3, owedCents: 1195, paidCents: 0 },
    ]);

    const payload = buildExpensePayload(result, { description: 'Wolt', currencyCode: 'EUR', groupId: 104554904, date: new Date('2026-10-12T12:00:00Z') });
    expect(payload).toMatchObject({
      cost: '35.00',
      group_id: 104554904,
      users__0__user_id: 1,
      users__0__paid_share: '35.00',
      users__0__owed_share: '9.67',
      users__2__owed_share: '11.95',
    });
  });

  it('merges participants mapped to the same user and adds an external payer', () => {
    const result = computeShares(
      [
        { userId: 1, itemCents: 500 },
        { userId: 1, itemCents: 300 },
      ],
      0,
      9,
    );
    expect(result.shares).toEqual([
      { userId: 1, owedCents: 800, paidCents: 0 },
      { userId: 9, owedCents: 0, paidCents: 800 },
    ]);
  });
});
