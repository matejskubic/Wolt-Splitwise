import { saveCheckoutSnapshot, toSnapshot } from '../shared/orders';
import type { CaptureRequest, CaptureResponse, WoltOrder } from '../shared/types';
import { parseWoltCheckout, parseWoltHistory } from './parser';

const READY_TAB_RE = /^ready:?\s*\d+$/i;
const CHECKOUT_PATH_RE = /\/group-order\/([^/?#]+)\/checkout/;
const HISTORY_PATH_RE = /\/me\/order-history\/([^/?#]+)/;
const AUTO_CAPTURE_DELAY_MS = 1500;
const PRICE_SETTLE_MS = 1000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function findReadyTab(): HTMLElement | undefined {
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"], button')];
  return tabs.find((element) => READY_TAB_RE.test((element.innerText ?? '').replace(/\s+/g, ' ').trim()));
}

const isSelected = (element: HTMLElement): boolean => element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true';

function captureCheckout(): WoltOrder {
  const orderId = CHECKOUT_PATH_RE.exec(location.pathname)?.[1];
  return { ...parseWoltCheckout(document.body.innerText, document.title), orderId, url: location.href };
}

async function storeSnapshot(order: WoltOrder): Promise<void> {
  if (order.orderId && order.participants.length) await saveCheckoutSnapshot(toSnapshot(order.orderId, order));
}

async function captureCheckoutOnRequest(): Promise<WoltOrder> {
  const tab = findReadyTab();
  if (tab && !isSelected(tab)) {
    tab.click();
    for (let elapsed = 0; elapsed < 3000 && !isSelected(tab); elapsed += 150) await delay(150);
    // Discounted per-person prices re-render shortly after the Ready tab becomes selected.
    await delay(PRICE_SETTLE_MS);
  }
  const order = captureCheckout();
  if (!tab || isSelected(tab)) await storeSnapshot(order);
  return order;
}

async function captureHistory(): Promise<WoltOrder> {
  for (let elapsed = 0; elapsed < 5000 && !/total sum/i.test(document.body.innerText); elapsed += 250) await delay(250);
  return { ...parseWoltHistory(document.body.innerText), url: location.href };
}

let lastAutoCapture = '';

/** Stores the checkout breakdown without user interaction, but only while the "Ready" tab is selected. */
async function autoCaptureCheckout(): Promise<void> {
  if (!CHECKOUT_PATH_RE.test(location.pathname)) return;
  const tab = findReadyTab();
  if (!tab || !isSelected(tab)) return;
  const order = captureCheckout();
  const key = JSON.stringify([order.orderId, order.participants, order.fees, order.discounts, order.totalCents]);
  if (key === lastAutoCapture) return;
  lastAutoCapture = key;
  await storeSnapshot(order);
}

declare global {
  interface Window {
    __woltSplitwiseLoaded?: boolean;
  }
}

if (!window.__woltSplitwiseLoaded) {
  window.__woltSplitwiseLoaded = true;

  chrome.runtime.onMessage.addListener((message: CaptureRequest, sender, sendResponse: (response: CaptureResponse) => void) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'wolt-capture') return false;
    void (async () => {
      try {
        if (HISTORY_PATH_RE.test(location.pathname)) {
          const order = await captureHistory();
          sendResponse(order.participants.length ? { ok: true, order } : { ok: false, error: 'No participants found on this order history page.' });
          return;
        }
        const order = await captureCheckoutOnRequest();
        sendResponse(order.participants.length ? { ok: true, order } : { ok: false, error: 'No ready participants found. Open the group order checkout or an order history page.' });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      autoCaptureCheckout().catch((error: unknown) => console.warn('Wolt to Splitwise: auto-capture failed', error));
    }, AUTO_CAPTURE_DELAY_MS);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected'] });
  schedule();
}
