import dotenv from 'dotenv';

dotenv.config();

/**
 * SMTP gateway configuration. The gateway holds no state of its own — it
 * authenticates against the platform API and hands messages to it.
 */
export interface MailConfig {
  port: number;
  host: string;
  apiBaseUrl: string;
  apiVersion: string;
  /**
   * Shared secret proving to the API that a delivery came from this gateway.
   * Must match MAIL_GATEWAY_TOKEN on the API; without it the API rejects
   * deliveries in production. The same secret is checked on the way back in
   * (see relayPort below): it also proves an outbound relay request came
   * from the API, not from anyone who can reach this container.
   */
  apiGatewayToken: string;
  maxConnections: number;
  maxMessageBytes: number;
  banner: string;
  logLevel: 'debug' | 'info' | 'error';
  /** Domain used in the outbound EHLO greeting and generated Message-IDs. */
  mailDomain: string;
  /** Internal HTTP port the platform API calls to hand off outbound mail. */
  relayPort: number;
  /**
   * Dev-only escape hatch: when set, outbound delivery always connects here
   * instead of resolving MX records — real port-25 delivery does not work
   * from a laptop or most cloud VMs (blocked outbound, no reverse DNS, no
   * sending reputation). Point this at a local catch-all like Mailpit.
   * Must be unset in production, where real MX lookups are required.
   */
  smtpRelayHost: string | null;
  smtpRelayPort: number;
  /** DKIM selector — the "mail" in "mail._domainkey.<domain>". */
  dkimSelector: string;
  /**
   * Path to the DKIM private key (see scripts/generate-dkim-key.sh). Signing
   * is skipped entirely when unset — real providers are likely to reject or
   * spam-bucket unsigned mail, but the gateway still works for local testing
   * without one.
   */
  dkimPrivateKeyPath: string | null;
  /**
   * Real TLS certificate for STARTTLS. Without these, smtp-server still
   * offers STARTTLS but falls back to its own well-known test certificate —
   * technically present, trusted by no one. Use a real cert (e.g. Let's
   * Encrypt) in production.
   */
  tlsKeyPath: string | null;
  tlsCertPath: string | null;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, received "${raw}"`);
  }
  return parsed;
}

export const config: MailConfig = {
  port: number('PORT', 2525),
  host: process.env.HOST || '0.0.0.0',
  apiBaseUrl: (process.env.API_BASE_URL || 'http://localhost:7000').replace(/\/$/, ''),
  apiVersion: process.env.API_VERSION || 'v1',
  apiGatewayToken: process.env.MAIL_GATEWAY_TOKEN || '',
  maxConnections: number('MAX_CONNECTIONS', 100),
  maxMessageBytes: number('MAX_MESSAGE_BYTES', 25 * 1024 * 1024),
  banner: process.env.SMTP_BANNER || 'Drive OSX Mail Service Ready',
  logLevel: (process.env.LOG_LEVEL as MailConfig['logLevel']) || 'info',
  mailDomain: process.env.MAIL_DOMAIN || 'driveosx.com',
  relayPort: number('RELAY_PORT', 2526),
  smtpRelayHost: process.env.SMTP_RELAY_HOST || null,
  smtpRelayPort: number('SMTP_RELAY_PORT', 1025),
  dkimSelector: process.env.DKIM_SELECTOR || 'mail',
  dkimPrivateKeyPath: process.env.DKIM_PRIVATE_KEY_PATH || null,
  tlsKeyPath: process.env.TLS_KEY_PATH || null,
  tlsCertPath: process.env.TLS_CERT_PATH || null,
};

export const apiUrl = (path: string): string => `${config.apiBaseUrl}/api/${config.apiVersion}${path}`;
