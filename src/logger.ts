import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, error: 30 } as const;

function emit(level: keyof typeof LEVELS, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;

  // Structured single-line JSON, matching the API's log format so both
  // services can be read by the same tooling.
  process.stdout.write(
    `${JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: 'drive-osx-mail',
      msg: message,
      ...context,
    })}\n`,
  );
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
