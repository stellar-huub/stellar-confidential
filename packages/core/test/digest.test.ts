import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRangeDigest, merkleRoot, verifyAgainstDigest } from '../src/digest.js';
import { canonicalJson } from '../src/json.js';
import { CURSOR_MAX, CURSOR_MIN } from '../src/cursor.js';
import { event } from './helpers.js';

const events = [1, 2, 3, 4, 5].map((n) => event({ ledgerSequence: n * 10 }));

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it('recurses into nested structures', () => {
    assert.equal(canonicalJson({ z: [{ y: 1, x: 2 }] }), '{"z":[{"x":2,"y":1}]}');
  });
});

describe('merkleRoot', () => {
  it('is deterministic', () => {
    assert.equal(merkleRoot(events), merkleRoot(events));
  });

  it('commits to the empty range', () => {
    assert.match(merkleRoot([]), /^[0-9a-f]{64}$/);
    assert.notEqual(merkleRoot([]), merkleRoot(events));
  });

  it('changes when any replay-relevant field changes', () => {
    const base = merkleRoot(events);
    const mutations = [
      { ...events[2]!, delta: 'debit' as const },
      { ...events[2]!, account: 'GSOMEONEELSE' },
      { ...events[2]!, publicAmount: '1' },
      { ...events[2]!, type: 'withdraw' as const },
      { ...events[2]!, proof: { ...events[2]!.proof, txHash: 'tampered' } },
    ];
    for (const mutated of mutations) {
      const altered = [...events];
      altered[2] = mutated;
      assert.notEqual(merkleRoot(altered), base, `mutation went undetected: ${mutated.type}`);
    }
  });

  it('ignores the adapter-specific raw payload', () => {
    // Two providers may encode `raw` differently while holding the same event.
    const altered = [...events];
    altered[1] = { ...events[1]!, raw: { anything: 'else' } };
    assert.equal(merkleRoot(altered), merkleRoot(events));
  });

  it('does not let a repeated tail leaf forge the same root', () => {
    // Duplicating an odd final leaf (rather than promoting it) would make
    // [a,b,c] and [a,b,c,c] hash identically. Promotion must not.
    const three = events.slice(0, 3);
    const withRepeat = [...three, three[2]!];
    assert.notEqual(merkleRoot(withRepeat), merkleRoot(three));
  });
});

describe('verifyAgainstDigest', () => {
  const digest = computeRangeDigest(CURSOR_MIN, CURSOR_MAX, events);

  it('accepts the events it was computed over', () => {
    assert.deepEqual(verifyAgainstDigest(events, digest), []);
  });

  it('detects an omitted event', () => {
    const problems = verifyAgainstDigest(events.slice(0, 4), digest);
    assert.ok(problems.some((p) => p.kind === 'count'));
    assert.ok(problems.some((p) => p.kind === 'root'));
  });

  it('detects reordering', () => {
    const shuffled = [events[1]!, events[0]!, ...events.slice(2)];
    const problems = verifyAgainstDigest(shuffled, digest);
    assert.ok(problems.some((p) => p.kind === 'ordering'));
  });

  it('detects a duplicated event', () => {
    const problems = verifyAgainstDigest([...events, events[4]!], digest);
    assert.ok(problems.some((p) => p.kind === 'duplicate'));
  });

  it('detects an event outside the digest range', () => {
    const narrow = computeRangeDigest(events[0]!.cursor, events[2]!.cursor, events.slice(0, 3));
    const problems = verifyAgainstDigest(events, narrow);
    assert.ok(problems.some((p) => p.kind === 'range'));
  });

  it('reports every problem, not just the first', () => {
    const problems = verifyAgainstDigest([events[1]!, events[0]!], digest);
    assert.ok(problems.length >= 2);
  });
});
