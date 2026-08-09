import { SMTPServer } from 'smtp-server';
import { config } from './config.js';
import { normalizeAddress } from './mail/utils.js';
import { authenticateSession } from './handlers/auth.js';
import { storeReceivedEmail } from './api-client.js';

function createServer() {
  const server = new SMTPServer({
    banner: config.banner,
    disableReverseLookup: true,
    hideSTARTTLS: false,
    logger: false,
    maxClients: config.maxConnections,
    authOptional: true,
    allowInsecureAuth: false,
    async onConnect(session, callback) {
      callback();
    },
    async onAuth(auth, _session, callback) {
      const user = await authenticateSession(auth);
      if (user) {
        return callback(null, { user: user.username });
      }
      return callback(new Error('Authentication failed'));
    },
    onRcptTo(address, session, callback) {
      const recipient = normalizeAddress(address.address);
      if (!recipient) {
        return callback(new Error('Invalid recipient address'));
      }
      session.envelope.rcptTo.push({ address: recipient });
      callback();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', async () => {
        const message = Buffer.concat(chunks).toString('utf8');
        console.log(`[smtp] received message for ${session.envelope.rcptTo.length} recipient(s)`);

        const recipient = session.envelope.rcptTo[0]?.address || '';
        const username = session.auth?.user?.username || '';

        try {
          await storeReceivedEmail({
            baseUrl: config.apiBaseUrl,
            to: recipient,
            from: session.envelope.mailFrom?.address || '',
            subject: '',
            body: message,
            recipientUsername: username
          });
          console.log(`[smtp] stored email for ${recipient}`);
        } catch (error) {
          console.error('[smtp] failed to store email', error.message);
        }

        callback();
      });
      stream.on('error', (error) => callback(error));
    },
    onClose(session) {
      console.log(`[smtp] connection closed for ${session.remoteAddress}`);
    }
  });

  server.on('error', (error) => {
    console.error('[smtp] server error', error);
  });

  return server;
}

export function startServer() {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`[smtp] server listening on ${config.host}:${config.port}`);
  });
  return server;
}
