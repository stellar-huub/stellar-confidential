import {
  IndexerError,
  encodeCursor,
  isConfidentialEventType,
  type BalanceDelta,
  type ConfidentialEvent,
  type ContractAdapter,
  type EncryptedAmount,
  type JsonValue,
  type RawContractEvent,
} from '@stellar-confidential/core';

/**
 * Reference Confidential Token adapter.
 *
 * WORKING SPEC. This decodes the event encoding documented in docs/events.md,
 * which is the encoding the reference contract, the synthetic generator and the
 * whole test suite use. It is a faithful implementation of the *shape* a
 * Confidential Token contract emits — subject account, counterparty, per-party
 * ciphertexts, public leg for deposits and withdrawals — not a claim about the
 * canonical contract's exact topic names or XDR layout.
 *
 * Wire format:
 *   topics = ["confidential_v1", <type>, <account>, <counterparty or "">]
 *   value  = type-specific object, see decode() below.
 *
 * Retargeting this at the canonical contract means rewriting this file. Nothing
 * else in the project needs to change, which is the entire point of the adapter
 * boundary (milestone M1.1).
 */

export const REFERENCE_TOPIC = 'confidential_v1';

/**
 * A raw event may fan out into several canonical events — a transfer becomes one
 * for the sender and one for the recipient. Their cursors must stay distinct and
 * correctly ordered, so the party index is folded into the event index.
 */
const MAX_FANOUT = 10;
const MAX_RAW_EVENT_INDEX = 9_999;

function asObject(value: JsonValue, context: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IndexerError('ADAPTER_DECODE', `expected an object for ${context}`, { context });
  }
  return value;
}

function optionalString(source: Record<string, JsonValue>, field: string): string | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new IndexerError('ADAPTER_DECODE', `field ${field} must be a string`, { field });
  }
  return value;
}

function requiredString(source: Record<string, JsonValue>, field: string): string {
  const value = optionalString(source, field);
  if (value === null) {
    throw new IndexerError('ADAPTER_DECODE', `field ${field} is required`, { field });
  }
  return value;
}

function optionalAmount(source: Record<string, JsonValue>, field: string): EncryptedAmount | null {
  const value = source[field];
  if (value === undefined || value === null) return null;
  const record = asObject(value, field);
  const limbs = record['limbs'];
  if (!Array.isArray(limbs)) {
    throw new IndexerError('ADAPTER_DECODE', `field ${field} must carry a limb array`, { field });
  }
  return {
    limbs: limbs.map((limb, index) => {
      const entry = asObject(limb, `${field}.limbs[${index}]`);
      return {
        commitment: requiredString(entry, 'commitment'),
        handle: requiredString(entry, 'handle'),
      };
    }),
  };
}

interface Party {
  readonly account: string;
  readonly counterparty: string | null;
  readonly delta: BalanceDelta;
  readonly amount: EncryptedAmount | null;
  readonly publicAmount: string | null;
}

export class ReferenceContractAdapter implements ContractAdapter {
  readonly id = 'reference-confidential-token';
  readonly version = '1.0.0';

  recognises(raw: RawContractEvent): boolean {
    const [marker, type] = raw.topics;
    return marker === REFERENCE_TOPIC && typeof type === 'string' && isConfidentialEventType(type);
  }

  decode(raw: RawContractEvent): readonly ConfidentialEvent[] {
    if (!this.recognises(raw)) return [];
    if (raw.eventIndex > MAX_RAW_EVENT_INDEX) {
      throw new IndexerError('ADAPTER_DECODE', 'event index too large to fan out safely', {
        eventIndex: raw.eventIndex,
      });
    }

    const type = raw.topics[1] as ConfidentialEvent['type'];
    const body = asObject(raw.value, 'event value');
    const parties = this.partiesFor(type, body);

    if (parties.length > MAX_FANOUT) {
      throw new IndexerError('ADAPTER_DECODE', 'event fans out beyond the reserved index space', {
        parties: parties.length,
      });
    }

    return parties.map((party, index) => {
      const cursor = encodeCursor({
        ledgerSequence: raw.ledgerSequence,
        txIndex: raw.txIndex,
        opIndex: raw.opIndex,
        eventIndex: raw.eventIndex * MAX_FANOUT + index,
      });
      return {
        id: cursor,
        cursor,
        type,
        contractId: raw.contractId,
        account: party.account,
        counterparty: party.counterparty,
        delta: party.delta,
        amount: party.amount,
        publicAmount: party.publicAmount,
        proof: {
          ledgerSequence: raw.ledgerSequence,
          ledgerHash: raw.ledgerHash,
          ledgerCloseTime: raw.ledgerCloseTime,
          txHash: raw.txHash,
          txIndex: raw.txIndex,
          opIndex: raw.opIndex,
          eventIndex: raw.eventIndex * MAX_FANOUT + index,
        },
        raw: raw.value,
      };
    });
  }

  private partiesFor(type: ConfidentialEvent['type'], body: Record<string, JsonValue>): Party[] {
    switch (type) {
      case 'deposit':
        // Public balance moves into the confidential balance: the public leg is
        // visible on chain, the confidential leg is not.
        return [
          {
            account: requiredString(body, 'account'),
            counterparty: null,
            delta: 'credit',
            amount: optionalAmount(body, 'amount'),
            publicAmount: optionalString(body, 'publicAmount'),
          },
        ];

      case 'withdraw':
        return [
          {
            account: requiredString(body, 'account'),
            counterparty: null,
            delta: 'debit',
            amount: optionalAmount(body, 'amount'),
            publicAmount: optionalString(body, 'publicAmount'),
          },
        ];

      case 'transfer': {
        // Each side carries its own ciphertext, encrypted under its own viewing
        // key. Neither party can read the other's copy, and each can replay its
        // own history without the other's cooperation.
        const from = requiredString(body, 'from');
        const to = requiredString(body, 'to');
        return [
          {
            account: from,
            counterparty: to,
            delta: 'debit',
            amount: optionalAmount(body, 'fromAmount'),
            publicAmount: null,
          },
          {
            account: to,
            counterparty: from,
            delta: 'credit',
            amount: optionalAmount(body, 'toAmount'),
            publicAmount: null,
          },
        ];
      }

      case 'rollover':
      case 'key_rotation':
        // The value is unchanged; the ciphertext representation is replaced.
        // Replay must assign, not accumulate — hence delta 'replace'.
        return [
          {
            account: requiredString(body, 'account'),
            counterparty: null,
            delta: 'replace',
            amount: optionalAmount(body, 'balance'),
            publicAmount: null,
          },
        ];

      case 'disclosure':
        return [
          {
            account: requiredString(body, 'account'),
            counterparty: optionalString(body, 'auditor'),
            delta: 'none',
            amount: null,
            publicAmount: null,
          },
        ];

      default: {
        const exhaustive: never = type;
        throw new IndexerError('ADAPTER_DECODE', 'unhandled event type', {
          type: String(exhaustive),
        });
      }
    }
  }
}
