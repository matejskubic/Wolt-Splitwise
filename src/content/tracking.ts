import type { WoltOrder } from '../shared/types';
import { parseWoltHistory } from './parser';

const TRACKING_PATH_RE = /\/(?:me\/order-tracking-v2\/[^/?#]+|group-order\/[^/?#]+\/tracking-v2)\/?$/;
const RECEIPT_SELECTOR = '[data-test-id="order-receipt-container-element"]';
const RECEIPT_BUTTON_SELECTOR = '[data-test-id="order-tracking-v2.summary.tracking-widget.cta.open-receipt-modal.button"]';

export function isTrackingPage(pathname: string): boolean {
  return TRACKING_PATH_RE.test(pathname);
}

export async function captureTrackingReceipt(page: Document, url: string): Promise<WoltOrder> {
  let opened = false;
  for (let elapsed = 0; elapsed < 5000; elapsed += 250) {
    const receipt = page.querySelector<HTMLElement>(RECEIPT_SELECTOR);
    if (receipt && receipt.getClientRects().length > 0) {
      const order = parseWoltHistory(receipt.innerText);
      if (order.participants.length && order.totalCents !== undefined) {
        return { ...order, venue: receipt.querySelector('h2')?.textContent?.trim() || order.venue, url };
      }
    }
    if (!opened) {
      const button = page.querySelector<HTMLButtonElement>(RECEIPT_BUTTON_SELECTOR);
      if (button && !button.disabled && button.getClientRects().length > 0) {
        button.click();
        opened = true;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Could not read the tracking receipt. Open Receipt on the Wolt page and try again.');
}