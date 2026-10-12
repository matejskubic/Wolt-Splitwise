import type { CaptureRequest, CaptureResponse, WoltOrder } from '../shared/types';
import { parseWoltCheckout } from './parser';

const READY_TAB_RE = /^ready:?\s*\d+$/i;
const CLICKABLE = 'button, [role="tab"], [role="button"], a';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function findReadyTab(): HTMLElement | undefined {
  const candidates = [...document.querySelectorAll<HTMLElement>(`${CLICKABLE}, div, span, p`)].filter((element) =>
    READY_TAB_RE.test((element.innerText ?? '').replace(/\s+/g, ' ').trim()),
  );
  // Prefer the innermost match, then climb to its clickable ancestor.
  const innermost = candidates.find((element) => !candidates.some((other) => other !== element && element.contains(other)));
  return innermost?.closest<HTMLElement>(CLICKABLE) ?? innermost;
}

function isActive(element: HTMLElement): boolean {
  return element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-current') === 'true';
}

function capture(): WoltOrder {
  return { ...parseWoltCheckout(document.body.innerText, document.title), url: location.href };
}

async function captureReadyParticipants(): Promise<WoltOrder> {
  const tab = findReadyTab();
  if (tab && !isActive(tab)) {
    tab.click();
    for (let elapsed = 0; elapsed < 3000; elapsed += 150) {
      await delay(150);
      const order = capture();
      if (order.participants.length > 0 && order.participants.every((p) => /^ready$/i.test(p.status))) {
        return order;
      }
    }
  }
  return capture();
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
        const order = await captureReadyParticipants();
        sendResponse(order.participants.length ? { ok: true, order } : { ok: false, error: 'No participants found. Open the group order checkout page (Group summary).' });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });
}
