import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError, isConfidentialError, type Logger } from '@stellar-confidential/core';

/** Small HTTP helpers shared by the routes. Deliberately not a framework. */

export interface RequestContext {
  readonly url: URL;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly logger: Logger;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // Archives are public data; a wallet may be served from anywhere.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  response.end(payload);
}

/**
 * Turn an error into a response.
 *
 * Typed errors keep their code so a client can branch on it. Anything else
 * becomes a bare 500: an unexpected error's message may name internals, and an
 * archive holding confidential data should not narrate them to the internet.
 */
export function sendError(response: ServerResponse, logger: Logger, error: unknown): void {
  if (error instanceof ValidationError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'RATE_LIMITED' ? 429 : 400;
    sendJson(response, status, {
      error: error.code,
      message: error.message,
      context: error.context,
    });
    return;
  }
  if (isConfidentialError(error)) {
    logger.warn('request failed', { code: error.code, message: error.message });
    sendJson(response, 502, { error: error.code, message: error.message });
    return;
  }
  logger.error('unhandled request error', { error });
  sendJson(response, 500, { error: 'INTERNAL', message: 'internal error' });
}

export function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null || value.length === 0) {
    throw new ValidationError('INVALID_REQUEST', `missing required parameter ${name}`, { name });
  }
  return value;
}

export function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value.length === 0 ? undefined : value;
}

export function parseLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError('INVALID_REQUEST', `limit must be an integer between 1 and ${max}`, {
      limit: raw,
      max,
    });
  }
  return value;
}

/**
 * Fixed-window rate limiter, keyed by client address.
 *
 * Enough to stop one client exhausting a shared archive. Deployments behind a
 * proxy should set trustProxy so the real client is limited rather than the
 * proxy.
 */
export class RateLimiter {
  private windowStart = Date.now();
  private counts = new Map<string, number>();

  constructor(
    private readonly perMinute: number,
    private readonly windowMs = 60_000,
  ) {}

  check(key: string): void {
    if (this.perMinute <= 0) return;
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.counts.clear();
    }
    const used = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, used);
    if (used > this.perMinute) {
      throw new ValidationError('RATE_LIMITED', 'too many requests', { limit: this.perMinute });
    }
  }
}

export function clientKey(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first !== undefined && first.trim().length > 0) return first.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}
