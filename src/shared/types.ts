export interface WoltParticipant {
  name: string;
  isHost: boolean;
  status: string;
  itemCount?: number;
  cents: number;
}

export interface WoltFee {
  label: string;
  cents: number;
}

export interface WoltOrder {
  venue?: string;
  currency: string;
  participants: WoltParticipant[];
  fees: WoltFee[];
  totalCents?: number;
  url?: string;
}

export type CaptureRequest = { type: 'wolt-capture' };
export type CaptureResponse = { ok: true; order: WoltOrder } | { ok: false; error: string };

export type OAuthRequest = { type: 'splitwise-oauth' };
export type OAuthResponse = { ok: true } | { ok: false; error: string };
