export interface WoltParticipant {
  name: string;
  isHost: boolean;
  status: string;
  itemCount?: number;
  /** Amount the participant is charged (after item discounts when known). */
  cents: number;
  /** Price before discounts (struck-through price on checkout, item price on order history). */
  originalCents: number;
}

export interface WoltFee {
  label: string;
  cents: number;
}

export interface WoltOrder {
  source: 'checkout' | 'history';
  /** Group order id on checkout pages, order id on order history pages. */
  orderId?: string;
  venue?: string;
  placedAt?: string;
  currency: string;
  participants: WoltParticipant[];
  fees: WoltFee[];
  /** Order-level discounts as negative amounts. */
  discounts: WoltFee[];
  totalCents?: number;
  url?: string;
}

export type CaptureRequest = { type: 'wolt-capture' };
export type CaptureResponse = { ok: true; order: WoltOrder } | { ok: false; error: string };

export type OAuthRequest = { type: 'splitwise-oauth' };
export type OAuthResponse = { ok: true } | { ok: false; error: string };
