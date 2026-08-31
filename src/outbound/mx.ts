import { promises as dns } from 'node:dns';

export interface MxHost {
  host: string;
  priority: number;
}

/**
 * Resolves the mail exchangers for a domain, lowest priority number first
 * (RFC 5321 §5: the sender tries hosts in preference order). A domain with no
 * MX records is still deliverable straight to its A record — a small but
 * real minority of domains rely on this fallback.
 */
export async function resolveMxHosts(domain: string): Promise<MxHost[]> {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length > 0) {
      return records
        .map((record) => ({ host: record.exchange, priority: record.priority }))
        .sort((a, b) => a.priority - b.priority);
    }
  } catch {
    // NXDOMAIN or no MX records — fall through to the A-record fallback.
  }

  try {
    await dns.resolve4(domain);
    return [{ host: domain, priority: 0 }];
  } catch {
    return [];
  }
}
