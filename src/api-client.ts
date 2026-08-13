import { apiUrl, config } from './config.js';
import { logger } from './logger.js';

/**
 * Thin client for the platform API. The gateway never touches PostgreSQL or
 * object storage directly — mailbox state belongs to the mail module.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 5xx and network failures are worth retrying; 4xx are not. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new ApiError(`API request to ${path} failed with ${response.status}`, response.status, text);
    }

    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`API request to ${path} failed: ${(error as Error).message}`, 0, '');
  } finally {
    clearTimeout(timeout);
  }
}

/** Retries only failures that can plausibly succeed on a second attempt. */
async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && !error.retryable) throw error;

      if (attempt < attempts) {
        const delayMs = 2 ** attempt * 250;
        logger.debug('retrying API request', { attempt, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

export interface MailboxIdentity {
  id: string;
  username: string;
  fullName: string;
  email: string;
  organizationId: string | null;
}

export async function authenticateMailbox(username: string, password: string): Promise<MailboxIdentity | null> {
  try {
    const result = await request<{ user: MailboxIdentity }>('/mail/auth', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return result.user ?? null;
  } catch (error) {
    if (error instanceof ApiError && !error.retryable) {
      logger.info('mailbox authentication rejected', { username, status: error.status });
      return null;
    }
    throw error;
  }
}

export interface DeliverInput {
  to: string;
  from: string;
  body: string;
  recipientUsername?: string;
}

export async function deliverMessage(input: DeliverInput): Promise<{ id: string } | null> {
  const result = await withRetry(() =>
    request<{ email: { id: string } }>('/mail/receive', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
  return result.email ?? null;
}

export function healthCheck(): Promise<unknown> {
  return request('/health', { method: 'GET', timeoutMs: 5_000 });
}

export const apiBaseUrl = config.apiBaseUrl;
