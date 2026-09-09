import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache, createCache } from '../src/cache.js';

describe('MemoryCache', () => {
  it('stores and returns values', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 'v', 60);
    assert.equal(await cache.get('k'), 'v');
    assert.equal(await cache.get('missing'), null);
  });

  it('expires entries', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 'v', 0);
    assert.equal(await cache.get('k'), null);
  });

  it('deletes entries', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 'v', 60);
    await cache.delete('k');
    assert.equal(await cache.get('k'), null);
  });

  it('evicts the least recently used entry when full', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', '1', 60);
    await cache.set('b', '2', 60);
    await cache.get('a'); // 'a' is now the most recently used
    await cache.set('c', '3', 60);

    assert.equal(cache.size, 2);
    assert.equal(await cache.get('b'), null, 'b was least recently used');
    assert.equal(await cache.get('a'), '1');
    assert.equal(await cache.get('c'), '3');
  });
});

describe('createCache', () => {
  it('falls back to memory when no Redis is configured', async () => {
    assert.ok((await createCache(undefined)) instanceof MemoryCache);
  });

  it('falls back to memory rather than failing when Redis is unreachable', async () => {
    // A cache is an optimisation; losing it must not take the service down.
    const cache = await createCache('redis://127.0.0.1:1');
    assert.ok(cache instanceof MemoryCache);
  });
});
