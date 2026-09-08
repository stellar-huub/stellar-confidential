import { IndexerError, type JsonValue } from '@stellar-confidential/core';

/**
 * ScVal decoding.
 *
 * Stellar RPC returns event topics and bodies as base64 XDR. Turning those into
 * values an adapter can read is the one place a full XDR codec is needed, so it
 * is isolated behind this function type and injected into the pipeline.
 *
 * `jsonScValCodec` below is the codec the reference adapter uses: base64-encoded
 * JSON. It exercises the entire pipeline without pulling in an XDR dependency,
 * and it is what the test suite and the reference demo run on.
 *
 * A production adapter targeting the real Confidential Token contract supplies
 * an XDR codec here instead — `scValToNative` from @stellar/stellar-sdk is a
 * drop-in for this signature. That substitution is the only change required;
 * nothing downstream of this point knows which codec ran.
 */
export type ScValCodec = (base64: string) => JsonValue;

export const jsonScValCodec: ScValCodec = (base64) => {
  try {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as JsonValue;
  } catch (cause) {
    throw new IndexerError('ADAPTER_DECODE', 'value is not base64-encoded JSON', {
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

/** Inverse of `jsonScValCodec`. Used by the synthetic event generator and tests. */
export function encodeJsonScVal(value: JsonValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}
