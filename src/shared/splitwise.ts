import { SPLITWISE_API_URL } from './constants';
import type { SplitwiseMember } from './names';

export interface SplitwiseGroup {
  id: number;
  name: string;
  members: SplitwiseMember[];
}

export interface CreateExpenseResult {
  expenseId?: number;
  raw: string;
}

export class SplitwiseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SplitwiseError';
  }
}

const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

function describeErrors(errors: unknown): string | undefined {
  if (!errors) return undefined;
  if (Array.isArray(errors)) return errors.length ? errors.join('; ') : undefined;
  if (typeof errors === 'object') {
    const parts = Object.entries(errors as Record<string, unknown>).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
    return parts.length ? parts.join('; ') : undefined;
  }
  return String(errors);
}

export class SplitwiseClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(joinUrl(SPLITWISE_API_URL, path), {
      ...init,
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.accessToken}`, ...init.headers },
    });
    const text = await response.text();
    if (response.status === 401) throw new SplitwiseError('Splitwise rejected the access token. Reconnect in the extension settings.', 401);
    if (!response.ok) throw new SplitwiseError(`Splitwise ${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`, response.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SplitwiseError(`Splitwise ${path} returned a non-JSON response.`, response.status);
    }
  }

  async getCurrentUser(): Promise<SplitwiseMember> {
    return (await this.request<{ user: SplitwiseMember }>('get_current_user')).user;
  }

  async getGroups(): Promise<SplitwiseGroup[]> {
    const { groups } = await this.request<{ groups: SplitwiseGroup[] }>('get_groups');
    return groups.filter((group) => group.id !== 0);
  }

  async getGroup(id: number): Promise<SplitwiseGroup> {
    return (await this.request<{ group: SplitwiseGroup }>(`get_group/${id}`)).group;
  }

  async createExpense(payload: Record<string, string | number>): Promise<CreateExpenseResult> {
    const result = await this.request<{ expenses?: { id: number }[]; errors?: unknown }>('create_expense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const errors = describeErrors(result.errors);
    if (errors) throw new SplitwiseError(`Splitwise refused the expense: ${errors}`);
    return { expenseId: result.expenses?.[0]?.id, raw: JSON.stringify(result) };
  }
}
