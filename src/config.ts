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
  maxConnections: number;
  maxMessageBytes: number;
  banner: string;
  logLevel: 'debug' | 'info' | 'error';
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
  maxConnections: number('MAX_CONNECTIONS', 100),
  maxMessageBytes: number('MAX_MESSAGE_BYTES', 25 * 1024 * 1024),
  banner: process.env.SMTP_BANNER || 'Drive OSX Mail Service Ready',
  logLevel: (process.env.LOG_LEVEL as MailConfig['logLevel']) || 'info',
};

export const apiUrl = (path: string): string => `${config.apiBaseUrl}/api/${config.apiVersion}${path}`;
