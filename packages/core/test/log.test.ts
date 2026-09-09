import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/log.js';

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe('logger', () => {
  it('emits structured JSON', () => {
    const { lines, sink } = capture();
    createLogger('info', { service: 'indexer' }, sink).info('ingested', { ledger: 5 });
    const record = JSON.parse(lines[0] as string);
    assert.equal(record.level, 'info');
    assert.equal(record.message, 'ingested');
    assert.equal(record.service, 'indexer');
    assert.equal(record.ledger, 5);
  });

  it('redacts anything that looks like key material', () => {
    const { lines, sink } = capture();
    const log = createLogger('debug', {}, sink);
    log.info('oops', {
      spendKey: 'S...',
      viewing_key: 'V...',
      seed: 'word word',
      mnemonic: 'x',
      password: 'hunter2',
      account: 'GPUBLIC',
    });
    const record = JSON.parse(lines[0] as string);
    for (const field of ['spendKey', 'viewing_key', 'seed', 'mnemonic', 'password']) {
      assert.equal(record[field], '[redacted]', `${field} leaked`);
    }
    // Account identifiers are public and stay legible.
    assert.equal(record.account, 'GPUBLIC');
  });

  it('refuses to print a bigint, which is how decrypted amounts arrive', () => {
    const { lines, sink } = capture();
    createLogger('debug', {}, sink).info('balance', { value: 12345n });
    assert.equal(JSON.parse(lines[0] as string).value, '[redacted:bigint]');
  });

  it('honours the level threshold', () => {
    const { lines, sink } = capture();
    const log = createLogger('warn', {}, sink);
    log.debug('no');
    log.info('no');
    log.warn('yes');
    log.error('yes');
    assert.equal(lines.length, 2);
  });

  it('merges child bindings', () => {
    const { lines, sink } = capture();
    createLogger('info', { a: 1 }, sink).child({ b: 2 }).info('m');
    const record = JSON.parse(lines[0] as string);
    assert.equal(record.a, 1);
    assert.equal(record.b, 2);
  });
});
