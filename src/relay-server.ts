import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { deliverViaSmtp } from './outbound/deliver.js';
import { ensureApprovedSender } from './outbound/oci-senders.js';
import { logger } from './logger.js';

const GATEWAY_HEADER = 'x-mail-gateway-token';
const MAX_BODY_BYTES = 30 * 1024 * 1024;

/**
 * Constant-time comparison; a length mismatch is a mismatch, not a shortcut,
 * matching the check the API applies to inbound deliveries from this
 * service.
 */
function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

interface DeliverRequest {
  envelopeFrom: string;
  envelopeTo: string;
  raw: string;
}

function isDeliverRequest(value: unknown): value is DeliverRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.envelopeFrom === 'string' && typeof v.envelopeTo === 'string' && typeof v.raw === 'string';
}

interface ProvisionSenderRequest {
  emailAddress: string;
}

function isProvisionSenderRequest(value: unknown): value is ProvisionSenderRequest {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as Record<string, unknown>).emailAddress === 'string';
}

/**
 * Outbound counterpart to the SMTP server: the platform API hands off a
 * fully-composed message here and this service does the MX lookup + SMTP
 * client work. Protocol mechanics stay in this service; the API never speaks
 * SMTP directly (CLAUDE.md §9 — domain boundaries stay obvious).
 */
export function startRelayServer(): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/deliver' && req.url !== '/provision-sender')) {
      sendJson(res, 404, { message: 'Not found' });
      return;
    }

    if (!tokenMatches(req.headers[GATEWAY_HEADER] as string | undefined, config.apiGatewayToken)) {
      logger.error('rejected outbound relay request: bad or missing gateway token');
      sendJson(res, 401, { message: 'Invalid or missing gateway token' });
      return;
    }

    if (req.url === '/provision-sender') {
      void handleProvisionSender(req, res);
      return;
    }

    void handleDeliver(req, res);
  });

  server.on('error', (error) => {
    logger.error('relay server error', { error: error.message });
  });

  server.listen(config.relayPort, config.host, () => {
    logger.info('outbound relay listening', { host: config.host, port: config.relayPort });
  });

  return server;
}

async function handleDeliver(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    const body = await readBody(req);
    parsed = JSON.parse(body);
  } catch (error) {
    sendJson(res, 400, { message: `Invalid request body: ${(error as Error).message}` });
    return;
  }

  if (!isDeliverRequest(parsed)) {
    sendJson(res, 400, { message: 'envelopeFrom, envelopeTo and raw are required' });
    return;
  }

  try {
    const result = await deliverViaSmtp(parsed.envelopeFrom, parsed.envelopeTo, parsed.raw);

    if (result.status === 'sent') {
      logger.info('outbound delivery accepted', { to: parsed.envelopeTo, mxHost: result.mxHost });
      sendJson(res, 200, result);
      return;
    }

    // Permanent: the caller should not retry. Temporary: 502 signals a
    // retryable failure, matching the convention this service already uses
    // for its own calls to the API (see api-client.ts's ApiError.retryable).
    logger.error('outbound delivery failed', {
      to: parsed.envelopeTo,
      permanent: result.permanent,
      error: result.error,
    });
    sendJson(res, result.permanent ? 422 : 502, result);
  } catch (error) {
    logger.error('unexpected error during outbound delivery', { error: (error as Error).message });
    sendJson(res, 502, { status: 'failed', permanent: false, error: (error as Error).message });
  }
}

/**
 * Called by the API once per signup so the new mailbox can send through
 * whichever relay is currently active — a no-op success when that relay
 * doesn't require sender approval (see ensureApprovedSender).
 */
async function handleProvisionSender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    const body = await readBody(req);
    parsed = JSON.parse(body);
  } catch (error) {
    sendJson(res, 400, { message: `Invalid request body: ${(error as Error).message}` });
    return;
  }

  if (!isProvisionSenderRequest(parsed)) {
    sendJson(res, 400, { message: 'emailAddress is required' });
    return;
  }

  const result = await ensureApprovedSender(parsed.emailAddress);

  if (result.status === 'ok' || result.status === 'skipped') {
    sendJson(res, 200, result);
    return;
  }

  // Same convention as /deliver: permanent rejections should not be retried
  // by the caller, transient ones (502) should.
  sendJson(res, result.permanent ? 422 : 502, result);
}
