import { describe, expect, it } from 'vitest';
import { centsToDecimal, decimalToCents, extractTrailingMoney, parseMoneyLine } from '../src/shared/money';
import { matchMember, type SplitwiseMember } from '../src/shared/names';
import { buildExpensePayload, computeShares, distribute, parseOrderPlacedDate } from '../src/shared/split';

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
  it('uses the day-first order placement time in the local timezone for the UTC expense date', () => {
    const date = parseOrderPlacedDate('09/10/2026, 10:36')!;
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(9);
    expect(date.getHours()).toBe(10);
    expect(date.getMinutes()).toBe(36);
    const payload = buildExpensePayload(computeShares([{ userId: 1, itemCents: 100 }], 0, 1), {
      description: 'Wolt', currencyCode: 'EUR', categoryId: 25, groupId: 1, date,
    });
    expect(payload.date).toBe(new Date(2026, 9, 9, 10, 36).toISOString());
    expect(String(payload.date)).toMatch(/T\d{2}:\d{2}:00\.000Z$/);
  });

  it.each([
    ['Order placed: 09/10/2026, 10:36', 9, 10, 36],
    ['October 13, 2026 11:05 AM', 13, 11, 5],
    ['October 13, 2026 12:05 AM', 13, 0, 5],
    ['October 13, 2026 12:05 PM', 13, 12, 5],
  ])('parses %s as local time', (text, day, hour, minute) => {
    expect(parseOrderPlacedDate(text)).toEqual(new Date(2026, 9, day, hour, minute));
  });

  it.each(['31/02/2026, 10:36', '09/13/2026, 10:36', '09/10/2026, 24:00', '09/10/2026, 10:60', 'October 13, 2026 13:05 PM', 'bad date', ''])('rejects invalid placement time %s', (text) => {
    expect(() => parseOrderPlacedDate(text)).toThrow();
  });

  it('leaves checkout dates without a placement timestamp unset', () => {
    expect(parseOrderPlacedDate(undefined)).toBeUndefined();
  });

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

    const payload = buildExpensePayload(result, { description: 'Wolt', currencyCode: 'EUR', groupId: 104554904, categoryId: 25, date: new Date('2026-10-12T12:00:00Z') });
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
