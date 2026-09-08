import { createConnection, type Socket } from 'node:net';
import { IndexerError } from '@stellar-confidential/core';

/**
 * Read-through cache for hot account queries (milestone M1.3).
 *
 * Two implementations: an in-process LRU that every deployment gets for free,
 * and Redis for multi-instance deployments that need a shared cache.
 *
 * The cache holds only what a client could already read from the public API, and
 * every entry is keyed by a cursor range, so an entry can never go stale in a
 * way that returns wrong history — new events land beyond the range that was
 * cached. Nothing decrypted and no key material is ever cached.
 */

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly maxEntries = 5_000) {}

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // Refresh recency: Map preserves insertion order, so re-inserting moves the
    // key to the end and makes the first key the least recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async close(): Promise<void> {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Minimal Redis client speaking RESP directly.
 *
 * We use four commands. A dependency-free implementation of those is smaller
 * than the dependency would be, and keeps the trusted surface of an
 * infrastructure service that handles confidential data as narrow as possible.
 */
export class RedisCache implements Cache {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private readonly pending: Array<{
    resolve: (value: string | null) => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  static async connect(url: string): Promise<RedisCache> {
    const parsed = new URL(url);
    const cache = new RedisCache(parsed.hostname, Number(parsed.port || 6379));
    await cache.open();
    return cache;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port }, () => {
        socket.setNoDelay(true);
        this.socket = socket;
        resolve();
      });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('error', (error) => {
        this.failAll(error);
        reject(error);
      });
      socket.on('close', () => {
        this.socket = null;
        this.failAll(new IndexerError('STORAGE_FAILURE', 'redis connection closed'));
      });
    });
  }

  private failAll(error: Error): void {
    while (this.pending.length > 0) this.pending.shift()?.reject(error);
  }

  /** Parse as many complete replies out of the buffer as are available. */
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end === -1) return;
      const type = String.fromCharCode(this.buffer[0] as number);
      const header = this.buffer.subarray(1, end).toString();

      if (type === '+' || type === ':') {
        this.buffer = this.buffer.subarray(end + 2);
        this.pending.shift()?.resolve(header);
        continue;
      }
      if (type === '-') {
        this.buffer = this.buffer.subarray(end + 2);
        this.pending.shift()?.reject(new IndexerError('STORAGE_FAILURE', `redis: ${header}`));
        continue;
      }
      if (type === '$') {
        const length = Number(header);
        if (length === -1) {
          this.buffer = this.buffer.subarray(end + 2);
          this.pending.shift()?.resolve(null);
          continue;
        }
        const bodyEnd = end + 2 + length + 2;
        if (this.buffer.length < bodyEnd) return; // wait for the rest
        const value = this.buffer.subarray(end + 2, end + 2 + length).toString();
        this.buffer = this.buffer.subarray(bodyEnd);
        this.pending.shift()?.resolve(value);
        continue;
      }
      // Any other reply type means we sent a command this client does not model.
      this.buffer = this.buffer.subarray(end + 2);
      this.pending.shift()?.reject(
        new IndexerError('STORAGE_FAILURE', `unsupported redis reply type ${type}`),
      );
    }
  }

  private command(...args: string[]): Promise<string | null> {
    const socket = this.socket;
    if (socket === null) {
      return Promise.reject(new IndexerError('STORAGE_FAILURE', 'redis is not connected'));
    }
    const encoded =
      `*${args.length}\r\n` +
      args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('');
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      socket.write(encoded, (error) => {
        if (error) {
          this.pending.pop();
          reject(error);
        }
      });
    });
  }

  async get(key: string): Promise<string | null> {
    return this.command('GET', key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.command('SET', key, value, 'EX', String(Math.max(1, Math.floor(ttlSeconds))));
  }

  async delete(key: string): Promise<void> {
    await this.command('DEL', key);
  }

  async ping(): Promise<string | null> {
    return this.command('PING');
  }

  async close(): Promise<void> {
    this.socket?.end();
    this.socket = null;
  }
}

/** Redis when a URL is configured and reachable, in-process otherwise. */
export async function createCache(redisUrl: string | undefined): Promise<Cache> {
  if (!redisUrl) return new MemoryCache();
  try {
    return await RedisCache.connect(redisUrl);
  } catch {
    // A cache is an optimisation. Losing it must not take the service down.
    return new MemoryCache();
  }
}
