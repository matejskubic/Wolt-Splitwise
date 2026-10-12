import { decimalToCents } from './money';

export interface SplitAmount {
  name: string;
  cents: number;
}

const HEADER_NAME_RE = /^(name|participant|person|ime)$/i;

function toCents(value: string, line: number): number {
  const cents = decimalToCents(value.replace(/[€$£\s\u00a0]/g, '').replace(/^EUR|EUR$/i, ''));
  if (cents === null || cents < 0) throw new Error(`Line ${line}: "${value}" is not a valid amount.`);
  return cents;
}

function parseJson(text: string): SplitAmount[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(data)) throw new Error('JSON must be an array of { "name": string, "amount": number }.');
  return data.map((item: unknown, index) => {
    const { name, amount } = (item ?? {}) as { name?: unknown; amount?: unknown };
    if (typeof name !== 'string' || !name.trim()) throw new Error(`Item ${index + 1}: "name" must be a non-empty string.`);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error(`Item ${index + 1}: "amount" must be a non-negative number.`);
    return { name: name.trim(), cents: Math.round(amount * 100) };
  });
}

/** Lines of `name<delimiter>amount`; delimiter is tab, ";" or ",". Use ";" or tab for decimal commas. */
function parseCsv(text: string): SplitAmount[] {
  const entries: SplitAmount[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const delimiter = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const at = line.lastIndexOf(delimiter);
    if (at < 0) throw new Error(`Line ${index + 1}: expected "name${delimiter}amount".`);
    const name = line.slice(0, at).trim().replace(/^"(.*)"$/, '$1').trim();
    const amount = line.slice(at + 1).trim().replace(/^"(.*)"$/, '$1');
    if (entries.length === 0 && HEADER_NAME_RE.test(name)) return;
    if (!name) throw new Error(`Line ${index + 1}: name is missing.`);
    entries.push({ name, cents: toCents(amount, index + 1) });
  });
  return entries;
}

/** Parses per-participant amounts (after discounts, before fees) pasted as CSV or JSON (see split.schema.json). */
export function parseSplitInput(text: string): SplitAmount[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Paste CSV lines or a JSON array first.');
  const entries = /^[[{]/.test(trimmed) ? parseJson(trimmed) : parseCsv(trimmed);
  if (!entries.length) throw new Error('No amounts found.');
  return entries;
}
