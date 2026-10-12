export interface SplitwiseMember {
  id: number;
  first_name: string;
  last_name: string | null;
  email?: string | null;
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\(you\)/gi, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function memberDisplayName(member: SplitwiseMember): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
}

function uniqueMatch(members: SplitwiseMember[], predicate: (member: SplitwiseMember) => boolean): number | undefined {
  const matches = members.filter(predicate);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

/**
 * Resolves a Wolt participant name to a Splitwise member id.
 * Order: remembered mapping, exact full name, unique first name, unique prefix. Ambiguous names stay unmatched.
 */
export function matchMember(woltName: string, members: SplitwiseMember[], savedMappings: Record<string, number> = {}): number | undefined {
  const key = normalizeName(woltName);
  if (!key) return undefined;

  const saved = savedMappings[key];
  if (saved !== undefined && members.some((member) => member.id === saved)) return saved;

  const fullName = (member: SplitwiseMember): string => normalizeName(memberDisplayName(member));
  const firstName = (member: SplitwiseMember): string => normalizeName(member.first_name);
  const woltFirst = key.split(' ')[0] ?? key;

  return (
    uniqueMatch(members, (member) => fullName(member) === key) ??
    (key.includes(' ') ? undefined : uniqueMatch(members, (member) => firstName(member) === key)) ??
    uniqueMatch(members, (member) => firstName(member) === woltFirst && fullName(member).startsWith(key)) ??
    uniqueMatch(members, (member) => fullName(member).startsWith(key) || key.startsWith(fullName(member)))
  );
}
