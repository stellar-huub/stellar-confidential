/**
 * Typed errors.
 *
 * Invariant 3 of CLAUDE.md: never return a silently wrong balance. A caller must
 * be able to tell "the archive is behind" from "you gave me the wrong key" from
 * "events are missing", because the three have different remedies. Every failure
 * mode that a caller could reasonably act on gets its own code.
 */

export type IndexerErrorCode =
  | 'RPC_UNAVAILABLE'
  | 'RPC_PROTOCOL'
  | 'LEDGER_GAP'
  | 'REORG_DETECTED'
  | 'CURSOR_CONFLICT'
  | 'STORAGE_FAILURE'
  | 'ADAPTER_DECODE'
  | 'RETENTION_EVICTED';

export type RecoveryErrorCode =
  | 'MISSING_EVENTS'
  | 'WRONG_KEY'
  | 'STALE_INDEX'
  | 'BALANCE_MISMATCH'
  | 'INTEGRITY_FAILURE'
  | 'CHECKPOINT_MISMATCH'
  | 'SOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_EVENT';

export type CryptoErrorCode =
  | 'INVALID_POINT'
  | 'INVALID_SCALAR'
  | 'DECRYPT_OUT_OF_RANGE'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'LIMB_MISMATCH'
  | 'INVALID_KEY_MATERIAL';

export type ValidationErrorCode = 'INVALID_REQUEST' | 'NOT_FOUND' | 'RATE_LIMITED';

export type ErrorCode =
  IndexerErrorCode | RecoveryErrorCode | CryptoErrorCode | ValidationErrorCode;

export interface ErrorContext {
  readonly [key: string]: string | number | boolean | null | undefined;
}

/** Base class for every error this project raises deliberately. */
export class ConfidentialError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
  }

  toJSON(): { name: string; code: ErrorCode; message: string; context: ErrorContext } {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

export class IndexerError extends ConfidentialError {
  declare readonly code: IndexerErrorCode;
  constructor(code: IndexerErrorCode, message: string, context: ErrorContext = {}) {
    super(code, message, context);
  }
}

export class RecoveryError extends ConfidentialError {
  declare readonly code: RecoveryErrorCode;
  constructor(code: RecoveryErrorCode, message: string, context: ErrorContext = {}) {
    super(code, message, context);
  }
}

export class CryptoError extends ConfidentialError {
  declare readonly code: CryptoErrorCode;
  constructor(code: CryptoErrorCode, message: string, context: ErrorContext = {}) {
    super(code, message, context);
  }
}

export class ValidationError extends ConfidentialError {
  declare readonly code: ValidationErrorCode;
  constructor(code: ValidationErrorCode, message: string, context: ErrorContext = {}) {
    super(code, message, context);
  }
}

export function isConfidentialError(e: unknown): e is ConfidentialError {
  return e instanceof ConfidentialError;
}
