export function normalizeAddress(address) {
  if (typeof address !== 'string') return '';

  const cleaned = address.trim();
  const match = cleaned.match(/<([^>]+)>/);
  const candidate = match ? match[1] : cleaned;
  return candidate.trim().toLowerCase();
}
