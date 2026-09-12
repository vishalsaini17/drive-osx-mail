import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { signOciPostRequest, type OciSigningIdentity } from './oci-signer.js';

interface OciClient extends OciSigningIdentity {
  compartmentId: string;
  apiHost: string;
}

let cachedClient: OciClient | null | undefined; // undefined = not resolved yet

/** Loaded once and cached — re-reading the key file on every signup is pointless I/O. */
function loadClient(): OciClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const { ociTenancyOcid, ociUserOcid, ociKeyFingerprint, ociPrivateKeyPath, ociRegion, ociEmailCompartmentId } =
    config;

  if (!ociTenancyOcid || !ociUserOcid || !ociKeyFingerprint || !ociPrivateKeyPath || !ociRegion || !ociEmailCompartmentId) {
    logger.info('OCI API credentials not configured — new mailboxes will not be auto-approved as senders');
    cachedClient = null;
    return null;
  }

  try {
    cachedClient = {
      tenancyOcid: ociTenancyOcid,
      userOcid: ociUserOcid,
      fingerprint: ociKeyFingerprint,
      privateKey: readFileSync(ociPrivateKeyPath, 'utf8'),
      compartmentId: ociEmailCompartmentId,
      // "ctrl." prefix confirmed against the OCI SDK's own EmailClient
      // source (service_endpoint_template) — easy to miss, since the SMTP
      // relay endpoint (smtp.email.<region>...) has no such prefix.
      apiHost: config.ociEmailApiHost || `ctrl.email.${ociRegion}.oci.oraclecloud.com`,
    };
  } catch (error) {
    logger.error('failed to read OCI API private key, sender auto-approval disabled', {
      path: ociPrivateKeyPath,
      error: (error as Error).message,
    });
    cachedClient = null;
  }
  return cachedClient;
}

export interface ProvisionSenderResult {
  /** 'skipped' when OCI credentials aren't configured — always treated as success by the caller. */
  status: 'ok' | 'skipped' | 'failed';
  permanent: boolean;
  error?: string;
}

/**
 * Approves `emailAddress` as an OCI Email Delivery sender via OCI's
 * CreateSender API, so the relay will accept mail whose "From:" header is
 * this address — OCI checks that header itself, not just the SMTP envelope
 * (confirmed empirically: a verified/Active domain does not imply its
 * addresses are pre-approved). Idempotent: a 409 for an address already
 * approved is treated as success, since the queue job that calls this can
 * run more than once for the same signup.
 */
export async function ensureApprovedSender(emailAddress: string): Promise<ProvisionSenderResult> {
  const client = loadClient();
  if (!client) {
    return { status: 'skipped', permanent: false };
  }

  const path = '/20170907/senders';
  const body = JSON.stringify({ compartmentId: client.compartmentId, emailAddress });
  const headers = signOciPostRequest(client, path, client.apiHost, body);

  try {
    const response = await fetch(`https://${client.apiHost}${path}`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok || response.status === 409) {
      logger.info('sender approved with OCI Email Delivery', { emailAddress, alreadyApproved: response.status === 409 });
      return { status: 'ok', permanent: false };
    }

    const text = await response.text().catch(() => '');
    logger.error('OCI rejected sender approval', { emailAddress, status: response.status, body: text.slice(0, 500) });
    return {
      status: 'failed',
      permanent: response.status < 500,
      error: `OCI returned ${response.status}: ${text.slice(0, 200)}`,
    };
  } catch (error) {
    logger.error('OCI sender approval request failed', { emailAddress, error: (error as Error).message });
    return { status: 'failed', permanent: false, error: (error as Error).message };
  }
}
