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
   * The entire switch between the two outbound delivery layers: when set,
   * outbound delivery always connects here (authenticated relay) instead of
   * resolving MX records and delivering direct-to-MX on port 25. See
   * SMTP_RELAY_HOST in .env.example for the current production setup (OCI
   * Email Delivery, standing in for direct delivery until outbound port 25
   * is open) and dev setup (a local catch-all like Mailpit, unauthenticated).
   */
  smtpRelayHost: string | null;
  smtpRelayPort: number;
  smtpRelayUser: string | null;
  smtpRelayPassword: string | null;
  /**
   * Overrides the SMTP envelope sender (MAIL FROM) for relay deliveries only
   * — direct-to-MX delivery always uses the real sender's address. Every
   * user's own address (e.g. alice@driveosx.com) is still what recipients
   * see in the "From:" header; this only changes what the relay itself
   * authenticates the send against. Needed because OCI Email Delivery (and
   * most transactional relays) only accept mail from pre-approved sender
   * addresses, and approving one address per signup does not scale. Safe for
   * SPF/DKIM/DMARC: they check the envelope/header *domain*, not the local
   * part, and the domain is unchanged.
   */
  smtpRelayEnvelopeFrom: string | null;
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
  /**
   * Credentials for OCI's control-plane API (distinct from the SMTP_RELAY_*
   * credentials above, which only authenticate the SMTP connection itself).
   * Used solely to auto-approve each new mailbox as an OCI Email Delivery
   * sender at signup — see oci-senders.ts. All five must be set together;
   * left unset, POST /provision-sender no-ops (dev, or once delivery has
   * switched back to direct-to-MX, where no such approval exists).
   */
  ociTenancyOcid: string | null;
  ociUserOcid: string | null;
  ociKeyFingerprint: string | null;
  ociPrivateKeyPath: string | null;
  ociRegion: string | null;
  ociEmailCompartmentId: string | null;
  /** Override for the control-plane host; otherwise derived from ociRegion. */
  ociEmailApiHost: string | null;
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
  // Unset for Mailpit (dev) or any other relay that takes unauthenticated
  // connections. Real transactional providers (SendGrid, Mailgun, SES,
  // Postmark) require both — set when pointing SMTP_RELAY_HOST at one of
  // those, typically to work around outbound port 25 being blocked.
  smtpRelayUser: process.env.SMTP_RELAY_USER || null,
  smtpRelayPassword: process.env.SMTP_RELAY_PASSWORD || null,
  smtpRelayEnvelopeFrom: process.env.SMTP_RELAY_ENVELOPE_FROM || null,
  dkimSelector: process.env.DKIM_SELECTOR || 'mail',
  dkimPrivateKeyPath: process.env.DKIM_PRIVATE_KEY_PATH || null,
  tlsKeyPath: process.env.TLS_KEY_PATH || null,
  tlsCertPath: process.env.TLS_CERT_PATH || null,
  ociTenancyOcid: process.env.OCI_TENANCY_OCID || null,
  ociUserOcid: process.env.OCI_USER_OCID || null,
  ociKeyFingerprint: process.env.OCI_API_KEY_FINGERPRINT || null,
  ociPrivateKeyPath: process.env.OCI_API_PRIVATE_KEY_PATH || null,
  ociRegion: process.env.OCI_REGION || null,
  ociEmailCompartmentId: process.env.OCI_EMAIL_COMPARTMENT_ID || null,
  ociEmailApiHost: process.env.OCI_EMAIL_API_HOST || null,
};

export const apiUrl = (path: string): string => `${config.apiBaseUrl}/api/${config.apiVersion}${path}`;
