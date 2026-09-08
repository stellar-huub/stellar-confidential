/**
 * Structured logging with a redaction guard.
 *
 * Invariant 1: key material, seed phrases and decrypted amounts must never reach
 * a log line. Discipline alone does not survive a 2am debugging session, so the
 * logger drops any field whose name looks like a secret and refuses to serialise
 * bigints (the type decrypted balances arrive as).
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const FORBIDDEN_FIELD = /secret|seed|mnemonic|privkey|private_?key|spend_?key|viewing_?key|password/i;

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function sanitise(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'bigint') {
      // A bigint here is almost always a decrypted amount. Refuse it loudly
      // rather than printing someone's balance.
      out[key] = '[redacted:bigint]';
      continue;
    }
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message };
      continue;
    }
    out[key] = value;
  }
  return out;
}

class JsonLogger implements Logger {
  constructor(
    readonly level: LogLevel,
    private readonly bindings: LogFields,
    private readonly sink: (line: string) => void,
  ) {}

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...sanitise(this.bindings),
      ...sanitise(fields),
    };
    this.sink(JSON.stringify(record));
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  child(bindings: LogFields): Logger {
    return new JsonLogger(this.level, { ...this.bindings, ...bindings }, this.sink);
  }
}

export function createLogger(
  level: LogLevel = 'info',
  bindings: LogFields = {},
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  return new JsonLogger(level, bindings, sink);
}

/** A logger that discards everything. Default for libraries, used widely in tests. */
export const silentLogger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
