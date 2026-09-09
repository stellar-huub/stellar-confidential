import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StellarRpc } from '../src/rpc.js';
import { STELLAR_RPC_URL, skipUnlessLiveRpc } from './integration-config.js';

/**
 * Against a live Stellar node.
 *
 * These assert the things a unit test with a stubbed fetch cannot: that the
 * shapes we parse are the shapes a real node emits, and that our ledger-header
 * parsing agrees with the node's own hashes.
 */
describe('StellarRpc against a live node', { skip: skipUnlessLiveRpc() }, () => {
  const rpc = new StellarRpc({ url: STELLAR_RPC_URL, maxRequestsPerSecond: 20 });

  it('reports health', async () => {
    const health = await rpc.getHealth();
    assert.equal(health.status, 'healthy');
    assert.ok(health.latestLedger > 0);
    assert.ok(health.oldestLedger > 0);
  });

  it('reads the latest ledger', async () => {
    const latest = await rpc.getLatestLedger();
    assert.ok(latest.sequence > 0);
    assert.match(latest.hash, /^[0-9a-f]{64}$/);
    assert.ok(latest.protocolVersion >= 20);
  });

  it('parses real ledger headers into a verifiable hash chain', async () => {
    const health = await rpc.getHealth();
    const start = Math.max(health.oldestLedger, health.latestLedger - 5);
    const ledgers = await rpc.getLedgers(start, 5);
    assert.ok(ledgers.length >= 2);

    // The whole reorg-detection mechanism rests on this: the previousHash we
    // pull out of the header XDR must equal the node's hash for the ledger
    // before it. If this ever fails, reorg detection is silently broken.
    for (let i = 1; i < ledgers.length; i += 1) {
      const parent = ledgers[i - 1]!;
      const child = ledgers[i]!;
      assert.equal(child.sequence, parent.sequence + 1);
      assert.equal(
        child.previousHash,
        parent.hash,
        `ledger ${child.sequence} does not chain to ${parent.sequence}`,
      );
    }
  });

  it('reports a consistent protocol version across the window', async () => {
    const health = await rpc.getHealth();
    const ledgers = await rpc.getLedgers(Math.max(health.oldestLedger, health.latestLedger - 3), 3);
    for (const ledger of ledgers) {
      assert.ok(ledger.protocolVersion >= 20, 'header prefix parsed a nonsense protocol version');
      assert.ok(ledger.closeTime > 1_500_000_000);
    }
  });

  it('queries contract events without error', async () => {
    const health = await rpc.getHealth();
    const page = await rpc.getEvents({
      startLedger: Math.max(health.oldestLedger, health.latestLedger - 100),
      limit: 10,
    });
    assert.ok(Array.isArray(page.events));
    assert.ok(page.latestLedger >= page.oldestLedger);
  });
});
