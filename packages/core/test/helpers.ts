import { encodeCursor } from '../src/cursor.js';
import type { ConfidentialEvent, EncryptedAmount } from '../src/events.js';

export function amount(seed: string, limbs = 4): EncryptedAmount {
  return {
    limbs: Array.from({ length: limbs }, (_, i) => ({
      commitment: `${seed}c${i}`.padEnd(64, '0'),
      handle: `${seed}h${i}`.padEnd(64, '0'),
    })),
  };
}

export function event(overrides: Partial<ConfidentialEvent> & { ledgerSequence?: number } = {}) {
  const ledgerSequence = overrides.ledgerSequence ?? 100;
  const position = {
    ledgerSequence,
    txIndex: overrides.proof?.txIndex ?? 0,
    opIndex: overrides.proof?.opIndex ?? 0,
    eventIndex: overrides.proof?.eventIndex ?? 0,
  };
  const cursor = encodeCursor(position);
  const base: ConfidentialEvent = {
    id: cursor,
    cursor,
    type: 'transfer',
    contractId: 'CONTRACT',
    account: 'GACCOUNT',
    counterparty: 'GOTHER',
    delta: 'credit',
    amount: amount('aa'),
    publicAmount: null,
    proof: {
      ...position,
      ledgerHash: `hash-${ledgerSequence}`,
      ledgerCloseTime: 1_700_000_000 + ledgerSequence,
      txHash: `tx-${ledgerSequence}`,
    },
    raw: null,
  };
  const merged = { ...base, ...overrides } as ConfidentialEvent;
  return { ...merged, proof: { ...base.proof, ...(overrides.proof ?? {}) } };
}
