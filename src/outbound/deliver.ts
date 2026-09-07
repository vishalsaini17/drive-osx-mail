import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { domainPart } from '../mail/address.js';
import { resolveMxHosts } from './mx.js';

export interface DeliveryResult {
  status: 'sent' | 'failed';
  /** A permanent failure (5xx, unknown domain) must not be retried. */
  permanent: boolean;
  mxHost?: string;
  response?: string;
  error?: string;
}

let dkimPrivateKey: string | null | undefined; // undefined = not loaded yet

/** Loaded once and cached — re-reading a key file on every send is pointless I/O. */
function loadDkimPrivateKey(): string | null {
  if (dkimPrivateKey !== undefined) return dkimPrivateKey;

  if (!config.dkimPrivateKeyPath) {
    logger.info('DKIM_PRIVATE_KEY_PATH not set — outbound mail will be unsigned');
    dkimPrivateKey = null;
    return dkimPrivateKey;
  }

  try {
    dkimPrivateKey = readFileSync(config.dkimPrivateKeyPath, 'utf8');
  } catch (error) {
    logger.error('failed to read DKIM private key, outbound mail will be unsigned', {
      path: config.dkimPrivateKeyPath,
      error: (error as Error).message,
    });
    dkimPrivateKey = null;
  }
  return dkimPrivateKey;
}

async function trySend(
  host: string,
  port: number,
  envelopeFrom: string,
  envelopeTo: string,
  raw: string,
  auth?: { user: string; pass: string },
): Promise<DeliveryResult> {
  const privateKey = loadDkimPrivateKey();

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    // Opportunistic direct-to-MX delivery (no auth) has no secret to protect
    // and most receiving MTAs on the public internet present a certificate
    // that doesn't cover every hostname the box answers to — refusing to
    // encrypt at all there is worse than accepting that mismatch. A relay
    // connection (auth set) is a different story: it carries real
    // credentials, so it must not accept a MITM'd certificate.
    tls: { rejectUnauthorized: Boolean(auth) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    name: config.mailDomain,
    ...(auth ? { auth } : {}),
    // Unsigned mail is likely to be rejected or spam-bucketed by real
    // providers (Gmail, Outlook) — see scripts/generate-dkim-key.sh.
    ...(privateKey
      ? { dkim: { domainName: config.mailDomain, keySelector: config.dkimSelector, privateKey } }
      : {}),
  });

  try {
    const info = await transport.sendMail({
      envelope: { from: envelopeFrom, to: envelopeTo },
      raw,
    });
    return { status: 'sent', permanent: false, mxHost: host, response: String(info.response ?? '') };
  } catch (error) {
    return classifyFailure(host, error);
  } finally {
    transport.close();
  }
}

function classifyFailure(host: string, error: unknown): DeliveryResult {
  const err = error as NodeJS.ErrnoException & { responseCode?: number };
  const message = err.message ?? String(error);

  // SMTP reply codes: 5xx is a permanent rejection, 4xx is temporary
  // (greylisting, recipient mailbox over quota, etc).
  if (typeof err.responseCode === 'number') {
    return { status: 'failed', permanent: err.responseCode >= 500, mxHost: host, error: message };
  }

  // Connection-level failures (refused, timed out, reset) are always worth
  // retrying, either against the next MX host or on a later attempt.
  return { status: 'failed', permanent: false, mxHost: host, error: message };
}

/**
 * Attempts delivery against each MX host in priority order, stopping at the
 * first that accepts the message. A permanent rejection from any host ends
 * the whole attempt — retrying a different host would not help, since it was
 * the message itself that was refused, not that particular server.
 */
export async function deliverViaSmtp(envelopeFrom: string, envelopeTo: string, raw: string): Promise<DeliveryResult> {
  if (config.smtpRelayHost) {
    const auth =
      config.smtpRelayUser && config.smtpRelayPassword
        ? { user: config.smtpRelayUser, pass: config.smtpRelayPassword }
        : undefined;
    return trySend(config.smtpRelayHost, config.smtpRelayPort, envelopeFrom, envelopeTo, raw, auth);
  }

  const domain = domainPart(envelopeTo);
  if (!domain) {
    return { status: 'failed', permanent: true, error: `Recipient has no domain: ${envelopeTo}` };
  }

  const hosts = await resolveMxHosts(domain);
  if (hosts.length === 0) {
    return { status: 'failed', permanent: true, error: `No mail exchanger found for ${domain}` };
  }

  let lastResult: DeliveryResult | undefined;
  for (const mx of hosts) {
    const result = await trySend(mx.host, 25, envelopeFrom, envelopeTo, raw);
    if (result.status === 'sent' || result.permanent) return result;
    lastResult = result;
    logger.debug('mx host rejected delivery, trying next', { host: mx.host, error: result.error });
  }

  return lastResult ?? { status: 'failed', permanent: false, error: 'No MX host accepted the message' };
}
