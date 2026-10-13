import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTrackingReceipt, isTrackingPage } from '../src/content/tracking';

const receiptText = [
  'Roza Slon Be\u017eigrad',
  'Order placed: October 13, 2026 11:05 AM',
  'Order ID: 6acdf45d03dc0509834fba40',
  'Items',
  'Matej Skubic', 'Host', '\u20ac11.10', 'Thai Spicy Fried rice', '11.10', '\u00d71', '11.10',
  'Bla\u017e Bani\u010d', '\u20ac10.00', 'Tajske perutni\u010dke', '5.00', '\u00d72', '10.00',
  'Darko Bashukoski', '\u20ac11.10', 'Pad Thai', '11.10', '\u00d71', '11.10',
  'Kris Stopar', '\u20ac14.10', 'Thai Spicy Fried rice', '11.10', '\u00d71', '11.10',
  'Gyoza meat 3 pcs', '3.00', '\u00d71', '3.00',
  'DeliveryWork\t0.00', 'Service fee', '2.07', 'Total sum', '\u20ac48.37',
].join('\n');

function mockPage(alreadyOpen = false, text = receiptText): { page: Document; click: ReturnType<typeof vi.fn> } {
  let open = alreadyOpen;
  const receipt = {
    innerText: text,
    getClientRects: () => [{}],
    querySelector: () => ({ textContent: 'Roza Slon Be\u017eigrad' }),
  };
  const click = vi.fn(() => { open = true; });
  const button = { click, disabled: false, getClientRects: () => [{}] };
  const page = {
    querySelector: (selector: string) => selector.includes('open-receipt-modal') ? button : open ? receipt : null,
  } as Document;
  return { page, click };
}

afterEach(() => vi.useRealTimers());

describe('tracking receipt', () => {
  it.each([
    '/en/me/order-tracking-v2/6acdf45d03dc0509834fba40',
    '/en/group-order/a6a5bacf1b9977f081f2239d/tracking-v2',
    '/sl/group-order/a6a5bacf1b9977f081f2239d/tracking-v2/',
  ])('recognizes %s', (pathname) => {
    expect(isTrackingPage(pathname)).toBe(true);
  });

  it('does not route checkout or history to tracking capture', () => {
    expect(isTrackingPage('/en/group-order/id/checkout')).toBe(false);
    expect(isTrackingPage('/en/me/order-history/id')).toBe(false);
  });

  it('opens the receipt and parses participant totals, not individual items', async () => {
    vi.useFakeTimers();
    const { page, click } = mockPage();
    const url = 'https://wolt.com/en/group-order/a6a5bacf1b9977f081f2239d/tracking-v2';
    const pending = captureTrackingReceipt(page, url);
    await vi.runAllTimersAsync();
    const order = await pending;
    expect(click).toHaveBeenCalledOnce();
    expect(order).toMatchObject({ source: 'history', orderId: '6acdf45d03dc0509834fba40', venue: 'Roza Slon Be\u017eigrad', totalCents: 4837, url });
    expect(order.participants.map(({ name, cents }) => [name, cents])).toEqual([
      ['Matej Skubic', 1110], ['Bla\u017e Bani\u010d', 1000], ['Darko Bashukoski', 1110], ['Kris Stopar', 1410],
    ]);
    expect(order.fees).toEqual([{ label: 'Service fee', cents: 207 }]);
    expect(order.discounts).toEqual([]);
    expect(order.participants.reduce((sum, participant) => sum + participant.cents, 207)).toBe(4837);
  });

  it('reuses an already-open receipt without clicking the button', async () => {
    const { page, click } = mockPage(true);
    await captureTrackingReceipt(page, 'https://wolt.com/en/me/order-tracking-v2/id');
    expect(click).not.toHaveBeenCalled();
  });

  it('reports an actionable error if the receipt never loads', async () => {
    vi.useFakeTimers();
    const { page, click } = mockPage(false, 'Loading');
    const result = expect(captureTrackingReceipt(page, 'https://wolt.com/en/me/order-tracking-v2/id')).rejects.toThrow('Open Receipt');
    await vi.runAllTimersAsync();
    await result;
    expect(click).toHaveBeenCalledOnce();
  });
});