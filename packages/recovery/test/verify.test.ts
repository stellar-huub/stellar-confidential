import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRangeDigest, CURSOR_MAX, CURSOR_MIN, RecoveryError } from '@stellar-confidential/core';
import { encryptAmount } from '@stellar-confidential/crypto';
import { replayFromGenesis } from '../src/replay.js';
import { verifyEventIntegrity, verifyState } from '../src/verify.js';
import { ALICE, aliceKeys, bobKeys, buildHistory, payrollHistory, rng } from './fixtures.js';

const history = payrollHistory(10);
const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);

function input(overrides: Partial<Parameters<typeof verifyState>[0]> = {}) {
  return verifyState({
    state,
    viewingKey: aliceKeys.viewing,
    chainBalance: history.chainBalance,
    chainLedger: history.latestLedger,
    archiveLedger: history.latestLedger,
    ...overrides,
  });
}

describe('verifyState', () => {
  it('verifies state that matches the chain', () => {
    const report = input();
    assert.equal(report.verified, true);
    assert.equal(report.failure, null);
    assert.ok(report.checks.every((check) => check.passed));
  });

  it('reports MISSING_EVENTS when the chain holds more than we replayed', () => {
    // Replay only part of the history: the chain is ahead of us.
    const partial = replayFromGenesis(ALICE, history.events.slice(0, 5), aliceKeys.viewing);
    const report = input({ state: partial });

    assert.equal(report.verified, false);
    assert.equal(report.failure?.code, 'MISSING_EVENTS');
    assert.equal(report.failure?.context['chainValue'], history.expectedValue.toString());
    assert.ok(BigInt(String(report.failure?.context['shortfall'])) > 0n);
  });

  it('reports BALANCE_MISMATCH when we replayed more than the chain holds', () => {
    const inflated = { ...state, value: state.value + 1_000n };
    const report = input({ state: inflated });

    assert.equal(report.verified, false);
    assert.equal(report.failure?.code, 'BALANCE_MISMATCH');
    assert.equal(report.failure?.context['excess'], '1000');
  });

  it('reports WRONG_KEY when the chain balance will not decrypt', () => {
    const report = input({ viewingKey: bobKeys.viewing });
    assert.equal(report.verified, false);
    assert.equal(report.failure?.code, 'WRONG_KEY');
    assert.ok(report.checks.some((check) => check.name === 'chain-balance-decrypts' && !check.passed));
  });

  it('reports STALE_INDEX when the archive lags, even if our balance is self-consistent', () => {
    const report = input({ chainLedger: history.latestLedger + 500, maxAcceptableLag: 10 });
    assert.equal(report.verified, false);
    assert.equal(report.failure?.code, 'STALE_INDEX');
    assert.equal(report.failure?.context['lag'], 500);
  });

  it('prefers STALE_INDEX over MISSING_EVENTS when the archive is known to be behind', () => {
    // Both are true; the actionable one is "wait for the archive to catch up".
    const partial = replayFromGenesis(ALICE, history.events.slice(0, 5), aliceKeys.viewing);
    const report = input({ state: partial, chainLedger: history.latestLedger + 500 });
    assert.equal(report.failure?.code, 'STALE_INDEX');
  });

  it('tolerates lag within the configured window', () => {
    const report = input({ chainLedger: history.latestLedger + 3, maxAcceptableLag: 10 });
    assert.equal(report.verified, true);
  });

  it('accepts an empty history for an account with no chain balance', () => {
    const empty = replayFromGenesis(ALICE, [], aliceKeys.viewing);
    const report = verifyState({
      state: empty,
      viewingKey: aliceKeys.viewing,
      chainBalance: null,
      chainLedger: 100,
      archiveLedger: 100,
    });
    assert.equal(report.verified, true);
  });

  it('rejects replayed events for an account with no chain balance', () => {
    const report = input({ chainBalance: null });
    assert.equal(report.verified, false);
    assert.equal(report.failure?.code, 'BALANCE_MISMATCH');
  });

  it('verifies a balance too large to decrypt by search', () => {
    // verifyAmount is constant work, so a huge balance still verifies.
    const huge = 9_000_000_000_000_000n;
    const built = buildHistory(ALICE, aliceKeys, [{ delta: 'credit', value: huge }]);
    const replayed = replayFromGenesis(ALICE, built.events, aliceKeys.viewing);
    const report = verifyState({
      state: replayed,
      viewingKey: aliceKeys.viewing,
      chainBalance: built.chainBalance,
      chainLedger: built.latestLedger,
      archiveLedger: built.latestLedger,
    });
    assert.equal(report.verified, true);
  });

  it('explains every check it ran', () => {
    const report = input();
    assert.ok(report.checks.length >= 2);
    for (const check of report.checks) {
      assert.ok(check.name.length > 0);
      assert.ok(check.detail.length > 0);
    }
  });
});

describe('verifyEventIntegrity', () => {
  const digest = computeRangeDigest(CURSOR_MIN, CURSOR_MAX, history.events);

  it('accepts events that match the published digest', () => {
    assert.doesNotThrow(() => verifyEventIntegrity(history.events, digest, 'archive-a'));
  });

  it('rejects an archive that withholds an event', () => {
    assert.throws(
      () => verifyEventIntegrity(history.events.slice(0, 5), digest, 'archive-a'),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'INTEGRITY_FAILURE');
        assert.equal(error.context['source'], 'archive-a');
        return true;
      },
    );
  });

  it('rejects an archive that alters an amount', () => {
    const tampered = history.events.map((event, index) =>
      index === 3
        ? { ...event, amount: encryptAmount(999_999n, aliceKeys.viewing, rng) }
        : event,
    );
    assert.throws(() => verifyEventIntegrity(tampered, digest, 'archive-a'), RecoveryError);
  });

  it('rejects an archive that reorders history', () => {
    const shuffled = [history.events[2]!, history.events[1]!, ...history.events.slice(3)];
    assert.throws(() => verifyEventIntegrity(shuffled, digest, 'archive-a'), RecoveryError);
  });
});
