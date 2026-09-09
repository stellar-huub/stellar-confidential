import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { RedisCache, createCache } from '../src/cache.js';
import { REDIS_URL, skipUnlessIntegration } from './integration-config.js';

describe('RedisCache', { skip: skipUnlessIntegration() }, () => {
  let cache: RedisCache | null = null;

  after(async () => {
    await cache?.close();
  });

  it('connects and answers PING', async () => {
    cache = await RedisCache.connect(REDIS_URL);
    assert.equal(await cache.ping(), 'PONG');
  });

  it('round-trips a value', async () => {
    const client = cache as RedisCache;
    const key = `sc-test:${Date.now()}`;
    await client.set(key, 'hello', 30);
    assert.equal(await client.get(key), 'hello');
    await client.delete(key);
    assert.equal(await client.get(key), null);
  });

  it('handles a value larger than one TCP frame', async () => {
    // RESP replies arrive split across chunks; the parser must reassemble them.
    const client = cache as RedisCache;
    const key = `sc-test-large:${Date.now()}`;
    const payload = 'x'.repeat(256 * 1024);
    await client.set(key, payload, 30);
    assert.equal((await client.get(key))?.length, payload.length);
    await client.delete(key);
  });

  it('serves concurrent commands in order', async () => {
    const client = cache as RedisCache;
    const keys = Array.from({ length: 20 }, (_, i) => `sc-test-concurrent:${i}`);
    await Promise.all(keys.map((key, i) => client.set(key, String(i), 30)));
    const values = await Promise.all(keys.map((key) => client.get(key)));
    assert.deepEqual(
      values,
      keys.map((_, i) => String(i)),
    );
    await Promise.all(keys.map((key) => client.delete(key)));
  });

  it('is selected by createCache when reachable', async () => {
    const created = await createCache(REDIS_URL);
    assert.ok(created instanceof RedisCache);
    await created.close();
  });
});
