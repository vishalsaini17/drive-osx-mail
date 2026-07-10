import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 2525),
  host: process.env.HOST || '0.0.0.0',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:7000',
  apiToken: process.env.API_TOKEN || 'development-token',
  authMode: process.env.AUTH_MODE || 'api',
  maxConnections: Number(process.env.MAX_CONNECTIONS || 100),
  banner: process.env.SMTP_BANNER || 'Drive OSX Mail Service Ready'
};
