import type { JsonValue } from '@stellar-confidential/core';

/**
 * OpenAPI description of the archive API (milestone M1.4).
 *
 * Served at /openapi.json so a client can be generated from a running instance,
 * and so a second archive implementation has a precise target to conform to.
 */
export function openApiDocument(version: string): JsonValue {
  const cursor = {
    type: 'string',
    pattern: '^\\d{10}-\\d{5}-\\d{5}-\\d{5}$',
    description: 'Total ordering key: ledger-transaction-operation-event, zero padded.',
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Confidential Stellar Archive API',
      version,
      description:
        'Read-only access to indexed Confidential Token events, with integrity digests so ' +
        'clients can verify what they were served rather than trusting this archive.',
    },
    paths: {
      '/health': {
        get: {
          summary: 'Service health and ingestion progress',
          responses: {
            '200': {
              description: 'Health',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['healthy', 'degraded'] },
                      latestLedger: { type: 'integer' },
                      oldestLedger: { type: 'integer' },
                      eventCount: { type: 'integer' },
                      adapter: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/events': {
        get: {
          summary: 'Page through all indexed events',
          parameters: [
            { name: 'after', in: 'query', schema: cursor, description: 'Exclusive lower bound.' },
            { name: 'to', in: 'query', schema: cursor, description: 'Inclusive upper bound.' },
            { name: 'account', in: 'query', schema: { type: 'string' } },
            { name: 'contract', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
          ],
          responses: { '200': { description: 'A page of events' } },
        },
      },
      '/accounts/{account}/events': {
        get: {
          summary: "One account's confidential event history",
          parameters: [
            { name: 'account', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'after', in: 'query', schema: cursor },
            { name: 'to', in: 'query', schema: cursor },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
          ],
          responses: { '200': { description: 'A page of events for the account' } },
        },
      },
      '/accounts/{account}/summary': {
        get: {
          summary: 'Event count and cursor bounds for an account',
          parameters: [{ name: 'account', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Account summary' } },
        },
      },
      '/accounts/{account}/digest': {
        get: {
          summary: 'Integrity digest over an account cursor range',
          description:
            'Merkle root over the events this archive holds in the range. Clients recompute it ' +
            'from the events they received to detect omission, reordering or tampering.',
          parameters: [
            { name: 'account', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'after',
              in: 'query',
              schema: cursor,
              description: 'Exclusive lower bound. Takes precedence over `from`.',
            },
            { name: 'from', in: 'query', schema: cursor, description: 'Inclusive lower bound.' },
            { name: 'to', in: 'query', schema: cursor },
          ],
          responses: { '200': { description: 'Range digest' } },
        },
      },
      '/digest': {
        get: {
          summary: 'Integrity digest over a global cursor range',
          parameters: [
            { name: 'from', in: 'query', schema: cursor },
            { name: 'to', in: 'query', schema: cursor },
            { name: 'contract', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Range digest' } },
        },
      },
    },
  };
}
