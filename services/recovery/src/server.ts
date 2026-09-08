import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CURSOR_MAX, ValidationError, isCursor, silentLogger, type Logger } from '@stellar-confidential/core';
import type { EventStore } from '@stellar-confidential/indexer';

/**
 * Recovery coordination API (milestone M2.4).
 *
 * This service does not recover anything. Replay and decryption happen on the
 * client, because they need the viewing key and the viewing key never leaves the
 * device (invariant 1). What the service provides is the bookkeeping around a
 * recovery: what range needs fetching, how far the archive has got, and whether
 * the client is now caught up.
 *
 * A session therefore holds an account, a cursor and some counters. There is no
 * field on it that could hold a key, and no endpoint that accepts one — the
 * `POST /recovery/session` body is rejected outright if it carries anything but
 * the two fields below.
 */

export interface RecoverySession {
  readonly id: string;
  readonly account: string;
  readonly startedAt: string;
  readonly fromCursor: string;
  toCursor: string;
  cursor: string;
  eventsExpected: number;
  eventsReported: number;
  archiveLedger: number;
  status: 'pending' | 'in-progress' | 'complete';
}

const ALLOWED_SESSION_FIELDS = new Set(['account', 'fromCursor']);

export interface RecoveryServerOptions {
  readonly store: EventStore;
  readonly logger?: Logger;
  readonly sessionTtlMs?: number;
  readonly maxSessions?: number;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage, limitBytes = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) {
      throw new ValidationError('INVALID_REQUEST', 'request body too large', { limitBytes });
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ValidationError('INVALID_REQUEST', 'request body is not valid JSON');
  }
}

export class RecoveryServer {
  private readonly logger: Logger;
  private readonly sessions = new Map<string, RecoverySession>();
  private readonly server: Server;

  constructor(private readonly options: RecoveryServerOptions) {
    this.logger = (options.logger ?? silentLogger).child({ component: 'recovery-api' });
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async listen(port: number, host = '0.0.0.0'): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
    const address = this.server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    this.logger.info('recovery api listening', { port: bound });
    return bound;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private expire(): void {
    const ttl = this.options.sessionTtlMs ?? 3_600_000;
    const cutoff = Date.now() - ttl;
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.startedAt) < cutoff) this.sessions.delete(id);
    }
  }

  private async createSession(body: unknown): Promise<RecoverySession> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new ValidationError('INVALID_REQUEST', 'expected a JSON object');
    }
    const record = body as Record<string, unknown>;

    // Reject unknown fields outright. This is what stops a well-meaning client
    // from ever posting a key here "just in case the server needs it".
    const unexpected = Object.keys(record).filter((key) => !ALLOWED_SESSION_FIELDS.has(key));
    if (unexpected.length > 0) {
      throw new ValidationError(
        'INVALID_REQUEST',
        'unexpected fields: this endpoint accepts an account and a cursor, and never key material',
        { unexpected: unexpected.join(',') },
      );
    }

    const account = record['account'];
    if (typeof account !== 'string' || account.length === 0) {
      throw new ValidationError('INVALID_REQUEST', 'account is required');
    }
    const fromCursorRaw = record['fromCursor'];
    if (fromCursorRaw !== undefined && (typeof fromCursorRaw !== 'string' || !isCursor(fromCursorRaw))) {
      throw new ValidationError('INVALID_REQUEST', 'fromCursor is not a valid cursor');
    }

    const summary = await this.options.store.getAccountSummary(account);
    const latest = await this.options.store.getLatestLedger();
    const fromCursor = (fromCursorRaw as string | undefined) ?? summary.firstCursor ?? CURSOR_MAX;

    const expected = await this.options.store.countEvents({
      account,
      ...(fromCursorRaw === undefined ? {} : { afterCursor: fromCursorRaw as string }),
    });

    this.expire();
    if (this.sessions.size >= (this.options.maxSessions ?? 10_000)) {
      throw new ValidationError('RATE_LIMITED', 'too many active recovery sessions');
    }

    const session: RecoverySession = {
      id: randomUUID(),
      account,
      startedAt: new Date().toISOString(),
      fromCursor,
      toCursor: summary.lastCursor ?? CURSOR_MAX,
      cursor: (fromCursorRaw as string | undefined) ?? '',
      eventsExpected: expected,
      eventsReported: 0,
      archiveLedger: latest?.sequence ?? 0,
      status: expected === 0 ? 'complete' : 'pending',
    };
    this.sessions.set(session.id, session);
    this.logger.info('recovery session opened', {
      session: session.id,
      account,
      eventsExpected: expected,
    });
    return session;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && (path === '/health' || path === '/')) {
        const latest = await this.options.store.getLatestLedger();
        sendJson(response, 200, {
          status: 'healthy',
          latestLedger: latest?.sequence ?? 0,
          activeSessions: this.sessions.size,
        });
        return;
      }

      if (request.method === 'POST' && path === '/recovery/session') {
        sendJson(response, 201, await this.createSession(await readBody(request)));
        return;
      }

      if (request.method === 'GET' && path === '/recovery/status') {
        const id = url.searchParams.get('session');
        if (id === null) throw new ValidationError('INVALID_REQUEST', 'session is required');
        const session = this.sessions.get(id);
        if (session === undefined) throw new ValidationError('NOT_FOUND', 'unknown session', { id });

        const latest = await this.options.store.getLatestLedger();
        session.archiveLedger = latest?.sequence ?? 0;
        const reported = url.searchParams.get('cursor');
        if (reported !== null && isCursor(reported)) {
          session.cursor = reported;
          session.eventsReported = await this.options.store.countEvents({
            account: session.account,
            toCursor: reported,
          });
          session.status = reported >= session.toCursor ? 'complete' : 'in-progress';
        }
        sendJson(response, 200, session);
        return;
      }

      throw new ValidationError('NOT_FOUND', 'no such route', { path });
    } catch (error) {
      if (error instanceof ValidationError) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'RATE_LIMITED' ? 429 : 400;
        sendJson(response, status, {
          error: error.code,
          message: error.message,
          context: error.context,
        });
        return;
      }
      this.logger.error('unhandled recovery request error', { error });
      sendJson(response, 500, { error: 'INTERNAL', message: 'internal error' });
    }
  }
}
