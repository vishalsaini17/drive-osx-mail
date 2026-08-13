/** Extracts the bare address from "Display Name <user@host>" and lowercases it. */
export function normalizeAddress(address: unknown): string {
  if (typeof address !== 'string') return '';

  const cleaned = address.trim();
  const angled = /<([^>]+)>/.exec(cleaned);
  return (angled?.[1] ?? cleaned).trim().toLowerCase();
}

export function localPart(address: string): string {
  const normalized = normalizeAddress(address);
  const at = normalized.indexOf('@');
  return at === -1 ? normalized : normalized.slice(0, at);
}

export function domainPart(address: string): string {
  const normalized = normalizeAddress(address);
  const at = normalized.indexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

const ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function isValidAddress(address: string): boolean {
  return ADDRESS_PATTERN.test(normalizeAddress(address));
}
