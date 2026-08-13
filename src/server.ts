import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { config } from './config.js';
import { logger } from './logger.js';
import { authenticateMailbox, deliverMessage } from './api-client.js';
import { isValidAddress, localPart, normalizeAddress } from './mail/address.js';

/**
 * SMTP gateway. It accepts inbound mail and hands each message to the platform
 * API, which owns mailbox storage. Delivery failures are reported back to the
 * sending server with a temporary code so the message is retried rather than
 * silently lost.
 */
export function createServer(): SMTPServer {
  const server = new SMTPServer({
    banner: config.banner,
    disableReverseLookup: true,
    logger: false,
    maxClients: config.maxConnections,
    size: config.maxMessageBytes,
    authOptional: true,
    allowInsecureAuth: false,

    onConnect(session, callback) {
      logger.debug('connection opened', { remoteAddress: session.remoteAddress });
      callback();
    },

    async onAuth(auth, _session, callback) {
      const username = auth.username ?? '';
      const password = auth.password ?? '';

      if (!username || !password) {
        callback(new Error('Username and password are required'));
        return;
      }

      try {
        const identity = await authenticateMailbox(username, password);
        if (!identity) {
          callback(new Error('Authentication failed'));
          return;
        }
        logger.debug('mailbox authenticated', { username: identity.username });
        callback(null, { user: identity.username });
      } catch (error) {
        // An API outage is not an authentication failure — say so, so the
        // client retries instead of prompting for new credentials.
        logger.error('authentication backend unavailable', { error: (error as Error).message });
        callback(new Error('Authentication service temporarily unavailable'));
      }
    },

    onRcptTo(address, session, callback) {
      const recipient = normalizeAddress(address.address);

      if (!isValidAddress(recipient)) {
        callback(new Error(`Invalid recipient address: ${address.address}`));
        return;
      }

      session.envelope.rcptTo.push({ address: recipient, args: {} });
      callback();
    },

    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on('error', (error) => {
        logger.error('error while reading message stream', { error: error.message });
        callback(error);
      });

      stream.on('end', () => {
        void handleMessage(session, Buffer.concat(chunks).toString('utf8'), size, callback);
      });
    },

    onClose(session) {
      logger.debug('connection closed', { remoteAddress: session.remoteAddress });
    },
  });

  server.on('error', (error) => {
    logger.error('smtp server error', { error: error.message });
  });

  return server;
}

async function handleMessage(
  session: SMTPServerSession,
  message: string,
  size: number,
  callback: (error?: Error | null) => void,
): Promise<void> {
  const recipients = session.envelope.rcptTo.map((entry) => normalizeAddress(entry.address));
  const sender = normalizeAddress(session.envelope.mailFrom ? session.envelope.mailFrom.address : '');
  const authenticatedUser = typeof session.user === 'string' ? session.user : undefined;

  logger.info('message received', { recipients: recipients.length, size, sender });

  const failures: string[] = [];

  // Each recipient is delivered independently: one unknown mailbox must not
  // discard the message for the others.
  for (const recipient of recipients) {
    try {
      await deliverMessage({
        to: recipient,
        from: sender,
        body: message,
        recipientUsername: authenticatedUser ?? localPart(recipient),
      });
      logger.info('message delivered', { recipient });
    } catch (error) {
      failures.push(recipient);
      logger.error('delivery failed', { recipient, error: (error as Error).message });
    }
  }

  if (failures.length === recipients.length && recipients.length > 0) {
    // 4xx: the sending server should try again later.
    callback(new Error('451 Message could not be delivered, please retry later'));
    return;
  }

  callback();
}

export function startServer(): SMTPServer {
  const server = createServer();

  server.listen(config.port, config.host, () => {
    logger.info('smtp gateway listening', { host: config.host, port: config.port, api: config.apiBaseUrl });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}
