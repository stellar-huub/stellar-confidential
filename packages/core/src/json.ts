/** The subset of JSON we accept from adapters and store verbatim. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Deterministic JSON: object keys sorted, no insignificant whitespace.
 *
 * Integrity digests are computed over this encoding, so two nodes that hold the
 * same logical event must produce byte-identical output. `JSON.stringify` alone
 * does not guarantee that — it preserves insertion order.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as JsonValue)}`);
  return `{${body.join(',')}}`;
}
