import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryError } from '@stellar-confidential/core';
import { initialState, replay, replayFromGenesis } from '../src/replay.js';
import { fromCheckpoint, toCheckpoint } from '../src/checkpoint.js';
import { ALICE, aliceKeys, bobKeys, buildHistory, payrollHistory } from './fixtures.js';

describe('replay engine', () => {
  it('reconstructs a balance from an event history', () => {
    const history = buildHistory(ALICE, aliceKeys, [
      { delta: 'credit', value: 1_000n },
      { delta: 'credit', value: 250n },
      { delta: 'debit', value: 400n },
    ]);
    const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);

    assert.equal(state.value, 850n);
    assert.equal(state.value, history.expectedValue);
    assert.equal(state.eventCount, 3);
    assert.equal(state.lastCursor, history.events[2]?.cursor);
  });

  it('is deterministic: the same events always produce the same state', () => {
    const history = payrollHistory(30);
    const first = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    const second = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);

    assert.deepEqual(first, second);
    assert.equal(first.digest, second.digest);
    assert.deepEqual(first.balance, second.balance);
  });

  it('reproduces the chain ciphertext exactly, not just the value', () => {
    // The replayed ciphertext is the homomorphic sum of the same event
    // ciphertexts, so it must equal what the chain holds bit for bit.
    const history = payrollHistory(12);
    const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    assert.deepEqual(state.balance, history.chainBalance);
  });

  it('matches a full replay when resumed from a checkpoint (M2.2)', () => {
    const history = payrollHistory(25);
    const full = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);

    for (const splitAt of [1, 7, 18, history.events.length - 1]) {
      const partial = replayFromGenesis(ALICE, history.events.slice(0, splitAt), aliceKeys.viewing);
      const checkpoint = toCheckpoint(partial);
      const resumed = replay(
        fromCheckpoint(checkpoint),
        history.events.slice(splitAt),
        aliceKeys.viewing,
      );

      assert.equal(resumed.value, full.value, `value diverged at split ${splitAt}`);
      assert.equal(resumed.eventCount, full.eventCount);
      assert.equal(resumed.lastCursor, full.lastCursor);
      assert.deepEqual(resumed.balance, full.balance);
      // The rolling digest is what makes the equivalence checkable, not merely likely.
      assert.equal(resumed.digest, full.digest, `digest diverged at split ${splitAt}`);
    }
  });

  it('applies a rollover by replacing rather than accumulating', () => {
    const history = buildHistory(ALICE, aliceKeys, [
      { delta: 'credit', value: 900n },
      { delta: 'credit', value: 100n },
      { delta: 'replace', value: 1_000n },
      { delta: 'credit', value: 50n },
    ]);
    const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    // Accumulating the rollover instead would double the balance to 2050.
    assert.equal(state.value, 1_050n);
    assert.deepEqual(state.balance, history.chainBalance);
  });

  it('ignores events that carry no balance change', () => {
    const history = buildHistory(ALICE, aliceKeys, [
      { delta: 'credit', value: 500n },
      { delta: 'none', value: 0n },
    ]);
    const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    assert.equal(state.value, 500n);
    assert.equal(state.eventCount, 2);
    assert.equal(state.history[1]?.value, null);
  });

  it('records a history entry per event', () => {
    const history = payrollHistory(4);
    const state = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    assert.equal(state.history.length, history.events.length);
    assert.equal(state.history[0]?.cursor, history.events[0]?.cursor);
    assert.equal(state.history[0]?.txHash, history.events[0]?.proof.txHash);
  });

  it('can cap retained history without affecting the balance', () => {
    const history = payrollHistory(20);
    const full = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    const capped = replayFromGenesis(ALICE, history.events, aliceKeys.viewing, { maxHistory: 5 });

    assert.equal(capped.history.length, 5);
    assert.equal(capped.value, full.value);
    assert.equal(capped.digest, full.digest);
  });
});

describe('replay refuses bad input rather than producing a wrong balance', () => {
  const history = payrollHistory(6);

  it('rejects a duplicated event', () => {
    const withDuplicate = [...history.events, history.events[history.events.length - 1]!];
    assert.throws(
      () => replayFromGenesis(ALICE, withDuplicate, aliceKeys.viewing),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'MISSING_EVENTS');
        return true;
      },
    );
  });

  it('rejects out-of-order events', () => {
    const shuffled = [history.events[3]!, history.events[1]!];
    assert.throws(() => replayFromGenesis(ALICE, shuffled, aliceKeys.viewing), RecoveryError);
  });

  it('rejects an event belonging to another account', () => {
    const foreign = [{ ...history.events[0]!, account: 'GSOMEONEELSE' }];
    assert.throws(
      () => replayFromGenesis(ALICE, foreign, aliceKeys.viewing),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'UNSUPPORTED_EVENT');
        return true;
      },
    );
  });

  it('reports the wrong key distinctly from missing data', () => {
    assert.throws(
      () => replayFromGenesis(ALICE, history.events, bobKeys.viewing),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'WRONG_KEY');
        assert.match(error.message, /viewing key/);
        return true;
      },
    );
  });

  it('reports missing events when a debit outruns the credits it was given', () => {
    // Start the history at a spend: the credits that funded it are absent.
    const truncated = buildHistory(ALICE, aliceKeys, [
      { delta: 'credit', value: 10n },
      { delta: 'debit', value: 5_000n },
    ]);
    assert.throws(
      () => replayFromGenesis(ALICE, truncated.events, aliceKeys.viewing),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'MISSING_EVENTS');
        assert.match(error.message, /negative/);
        return true;
      },
    );
  });

  it('rejects a balance-changing event with no amount', () => {
    const broken = [{ ...history.events[0]!, amount: null }];
    assert.throws(
      () => replayFromGenesis(ALICE, broken, aliceKeys.viewing),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'UNSUPPORTED_EVENT');
        return true;
      },
    );
  });

  it('refuses to checkpoint an empty state', () => {
    assert.throws(() => toCheckpoint(initialState(ALICE)), RecoveryError);
  });

  it('rejects a checkpoint from a future version', () => {
    const checkpoint = toCheckpoint(replayFromGenesis(ALICE, history.events, aliceKeys.viewing));
    assert.throws(() => fromCheckpoint({ ...checkpoint, version: 99 }), RecoveryError);
  });
});
