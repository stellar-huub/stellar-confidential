import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CURSOR_MAX,
  CURSOR_MIN,
  ValidationError,
  isCursor,
  isConfidentialEventType,
  silentLogger,
  type ConfidentialEvent,
  type ConfidentialEventType,
  type Logger,
} from '@stellar-confidential/core';
import type { EventStore, IntegrityService } from '@stellar-confidential/indexer';
import {
  RateLimiter,
  clientKey,
  optionalParam,
  parseLimit,
  sendError,
  sendJson,
} from './http.js';
import { openApiDocument } from './openapi.js';

/**
 * The archive HTTP and WebSocket API (milestone M1.4).
 *
 * Read-only by design. Ingestion writes to the store; this process only serves
 * what is there. Nothing here can decrypt anything: it moves ciphertexts and
 * digests, and the client does the rest.
 */

export interface ApiServerOptions {
  readonly store: EventStore;
  readonly integrity: IntegrityService;
  readonly logger?: Logger;
  readonly version?: string;
  readonly adapterId?: string;
  readonly maxPageSize?: number;
  readonly defaultPageSize?: number;
  readonly ratePerMinute?: number;
  readonly trustProxy?: boolean;
}

interface Subscription {
  readonly socket: WebSocket;
  readonly account: string | null;
}

export class ApiServer {
  private readonly logger: Logger;
  private readonly limiter: RateLimiter;
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly subscriptions = new Set<Subscription>();

  constructor(private readonly options: ApiServerOptions) {
    this.logger = (options.logger ?? silentLogger).child({ component: 'api' });
    this.limiter = new RateLimiter(options.ratePerMinute ?? 600);
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (socket, request) => this.onSocket(socket, request));
  }

  async listen(port: number, host = '0.0.0.0'): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
    const address = this.server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    this.logger.info('api listening', { port: bound, host });
    return bound;
  }

  async close(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.socket.close();
    this.subscriptions.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  /**
   * Push newly ingested events to subscribers.
   *
   * Called by the ingestion loop after a window commits, so a subscriber never
   * sees an event that is not yet durable.
   */
  broadcast(events: readonly ConfidentialEvent[]): void {
    if (events.length === 0 || this.subscriptions.size === 0) return;
    for (const subscription of this.subscriptions) {
      const relevant =
        subscription.account === null
          ? events
          : events.filter((event) => event.account === subscription.account);
      if (relevant.length === 0) continue;
      if (subscription.socket.readyState !== subscription.socket.OPEN) continue;
      subscription.socket.send(JSON.stringify({ type: 'events', events: relevant }));
    }
  }

  private onSocket(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/ws', 'http://localhost');
    const account = url.searchParams.get('account');
    const subscription: Subscription = { socket, account };
    this.subscriptions.add(subscription);
    this.logger.debug('subscriber connected', { account, subscribers: this.subscriptions.size });

    socket.send(JSON.stringify({ type: 'subscribed', account }));
    socket.on('close', () => {
      this.subscriptions.delete(subscription);
    });
    socket.on('error', () => {
      this.subscriptions.delete(subscription);
    });
  }

  private cursorParam(url: URL, name: string, fallback: string): string {
    const value = optionalParam(url, name);
    if (value === undefined) return fallback;
    if (!isCursor(value)) {
      throw new ValidationError('INVALID_REQUEST', `${name} is not a valid cursor`, { [name]: value });
    }
    return value;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const started = process.hrtime.bigint();

    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        response.end();
        return;
      }
      if (request.method !== 'GET') {
        throw new ValidationError('INVALID_REQUEST', 'only GET is supported', {
          method: request.method ?? 'unknown',
        });
      }

      this.limiter.check(clientKey(request, this.options.trustProxy ?? false));
      await this.route(url, response);
    } catch (error) {
      sendError(response, this.logger, error);
    } finally {
      this.logger.debug('request', {
        path: url.pathname,
        status: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    }
  }

  private async route(url: URL, response: ServerResponse): Promise<void> {
    const { store, integrity } = this.options;
    const maxPageSize = this.options.maxPageSize ?? 1_000;
    const defaultPageSize = this.options.defaultPageSize ?? 100;
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health' || path === '/') {
      const latest = await store.getLatestLedger();
      const checkpoint = await store.getCheckpoint('primary');
      sendJson(response, 200, {
        status: 'healthy',
        latestLedger: latest?.sequence ?? 0,
        oldestLedger: 0,
        checkpointLedger: checkpoint?.ledgerSequence ?? 0,
        eventCount: await store.countEvents({}),
        adapter: this.options.adapterId ?? 'unknown',
        version: this.options.version ?? '0.1.0',
      });
      return;
    }

    if (path === '/openapi.json') {
      sendJson(response, 200, openApiDocument(this.options.version ?? '0.1.0'));
      return;
    }

    if (path === '/events') {
      const type = optionalParam(url, 'type');
      if (type !== undefined && !isConfidentialEventType(type)) {
        throw new ValidationError('INVALID_REQUEST', 'unknown event type', { type });
      }
      const account = optionalParam(url, 'account');
      const contract = optionalParam(url, 'contract');
      const page = await store.getEvents({
        ...(account === undefined ? {} : { account }),
        ...(contract === undefined ? {} : { contractId: contract }),
        ...(type === undefined ? {} : { types: [type as ConfidentialEventType] }),
        afterCursor: this.cursorParam(url, 'after', CURSOR_MIN),
        toCursor: this.cursorParam(url, 'to', CURSOR_MAX),
        limit: parseLimit(url, defaultPageSize, maxPageSize),
      });
      sendJson(response, 200, page);
      return;
    }

    if (path === '/digest') {
      const contract = optionalParam(url, 'contract');
      sendJson(
        response,
        200,
        await integrity.digest({
          fromCursor: this.cursorParam(url, 'from', CURSOR_MIN),
          toCursor: this.cursorParam(url, 'to', CURSOR_MAX),
          ...(contract === undefined ? {} : { contractId: contract }),
        }),
      );
      return;
    }

    const accountMatch = /^\/accounts\/([^/]+)\/(events|summary|digest)$/.exec(path);
    if (accountMatch !== null) {
      const account = decodeURIComponent(accountMatch[1] as string);
      const kind = accountMatch[2] as string;

      if (kind === 'events') {
        const page = await store.getEvents({
          account,
          afterCursor: this.cursorParam(url, 'after', CURSOR_MIN),
          toCursor: this.cursorParam(url, 'to', CURSOR_MAX),
          limit: parseLimit(url, defaultPageSize, maxPageSize),
        });
        sendJson(response, 200, page);
        return;
      }
      if (kind === 'summary') {
        sendJson(response, 200, await store.getAccountSummary(account));
        return;
      }
      // `after` is exclusive and `from` inclusive; a client resuming from a
      // cursor uses `after` so the boundary event it already holds is excluded.
      const afterCursor = optionalParam(url, 'after');
      sendJson(
        response,
        200,
        await integrity.digest({
          account,
          ...(afterCursor === undefined
            ? { fromCursor: this.cursorParam(url, 'from', CURSOR_MIN) }
            : { afterCursor: this.cursorParam(url, 'after', CURSOR_MIN) }),
          toCursor: this.cursorParam(url, 'to', CURSOR_MAX),
        }),
      );
      return;
    }

    throw new ValidationError('NOT_FOUND', 'no such route', { path });
  }
}
