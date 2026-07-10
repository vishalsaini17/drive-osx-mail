import { SMTPServer } from 'smtp-server';
import { config } from './config.js';
import { normalizeAddress } from './mail/utils.js';
import { authenticateSession } from './handlers/auth.js';

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
    async onAuth(auth, session, callback) {
      const user = await authenticateSession(session);
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
      stream.on('end', () => {
        const message = Buffer.concat(chunks).toString('utf8');
        console.log(`[smtp] received message for ${session.envelope.rcptTo.length} recipient(s)`);
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
