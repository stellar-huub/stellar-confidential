# Milestones

Delivery plan for **Confidential Stellar Infrastructure**.

This file is the single source of truth for *what ships, in what order, and what "done" means*. The README describes the vision; this file describes the contract.

**Status legend**

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done — acceptance criteria met and merged to `main` |
| `[!]` | Blocked (blocker named inline) |

**Rules**

1. A milestone is `[x]` only when **every** acceptance criterion is demonstrably met, tested in CI, and documented.
2. Each milestone ends in something runnable. No milestone is "design only".
3. Phase *N+1* may start before phase *N* closes, but may not **ship** until its stated dependencies are `[x]`.
4. Every change to this file must be mirrored in `CLAUDE.md` (see [CLAUDE.md](CLAUDE.md) § Change Log).

---

## Phase 0 — Foundations

> Make the repository buildable, testable, and contributable before writing product code.

**Depends on:** nothing
**Goal:** a new contributor can clone, install, and run the full test suite in under 10 minutes.

### M0.1 — Repository scaffolding
- [ ] Monorepo tooling chosen and configured (pnpm workspaces + Turborepo)
- [ ] `packages/`, `apps/`, `services/`, `contracts/`, `docs/`, `examples/` created with placeholder READMEs
- [ ] Root `package.json` with `build`, `test`, `lint`, `typecheck`, `format` scripts
- [ ] TypeScript strict mode, shared `tsconfig.base.json`
- [ ] ESLint + Prettier, enforced in CI

**Acceptance:** `pnpm install && pnpm build && pnpm test` succeeds on a clean clone on Linux and macOS.

### M0.2 — Continuous integration
- [ ] GitHub Actions: install → lint → typecheck → build → test on every PR
- [ ] Node LTS matrix (20.x, 22.x)
- [ ] Dependency audit step (`pnpm audit`) — non-blocking initially, blocking from Phase 4
- [ ] Branch protection on `main`: green CI + one review required

**Acceptance:** a PR with a failing test cannot be merged.

### M0.3 — Project governance
- [x] `README.md` — vision and architecture
- [x] `MILESTONES.md` — this file
- [x] `CONTRIBUTING.md` — contribution guide
- [x] `CLAUDE.md` — agent/contributor working notes, kept current
- [ ] `LICENSE` selected and added (**open decision** — Apache-2.0 recommended for patent grant)
- [ ] `SECURITY.md` with private disclosure contact
- [ ] `CODE_OF_CONDUCT.md`
- [ ] Issue and PR templates

**Acceptance:** repository passes GitHub's community standards checklist except items intentionally deferred.

### M0.4 — Local development environment
- [ ] `docker-compose.yml` bringing up PostgreSQL + Redis
- [ ] Stellar testnet RPC configuration documented
- [ ] `.env.example` with every variable the services read
- [ ] `pnpm dev` starts the local stack

**Acceptance:** documented steps take a fresh machine to a running local stack.

---

## Phase 1 — Confidential Indexer

> Ingest Confidential Token events from Stellar and serve them back reliably.

**Depends on:** Phase 0
**Goal:** given an account, return its complete, ordered, verifiable confidential event history.

### M1.1 — Event schema and research spike
- [ ] Document the Confidential Token contract event surface actually emitted on testnet
- [ ] Define canonical internal event model (deposit, withdraw, transfer, rollover, key rotation, disclosure)
- [ ] Decide ordering key (ledger sequence, tx index, op index, event index)
- [ ] Write `docs/events.md`

**Acceptance:** a written spec that a second engineer can implement against without reading contract source.

### M1.2 — Ingestion pipeline
- [ ] Stellar RPC client with retry, backoff, and rate limiting
- [ ] Ledger cursor tracking with durable checkpoint
- [ ] Backfill mode (historical range) and follow mode (live tip)
- [ ] Reorg / rollback handling
- [ ] Idempotent writes — replaying a ledger produces no duplicates

**Acceptance:** indexer ingests 10,000 testnet ledgers, is killed mid-run, restarts, and produces byte-identical state to an uninterrupted run.

### M1.3 — Storage layer
- [ ] PostgreSQL schema with migrations (events, accounts, cursors, contracts)
- [ ] Indexes for account-scoped and time-scoped queries
- [ ] Redis caching for hot account reads
- [ ] Retention and pruning policy documented

**Acceptance:** account history query over 1M stored events returns p95 < 200ms.

### M1.4 — Query APIs
- [ ] REST: `GET /events`, `GET /accounts/:id/events`, `GET /accounts/:id/cursor`, `GET /health`
- [ ] Cursor-based pagination
- [ ] WebSocket subscription for live account events
- [ ] OpenAPI specification published
- [ ] Rate limiting and request logging

**Acceptance:** OpenAPI spec validates; a generated client can page an account's full history.

### M1.5 — Data integrity
- [ ] Every stored event carries its ledger proof metadata (ledger seq, tx hash, op index)
- [ ] Integrity endpoint returning a verifiable digest over an account's event range
- [ ] Client-side verification helper that detects omitted or reordered events

**Acceptance:** a deliberately tampered database is detected by the verification helper.

### M1.6 — Testnet deployment
- [ ] Dockerized indexer
- [ ] Deployed public testnet instance
- [ ] Uptime and lag monitoring (ledger lag, error rate, ingest throughput)
- [ ] Runbook in `docs/operations.md`

**Acceptance:** public testnet endpoint stays within 5 ledgers of the network tip for 7 consecutive days.

---

## Phase 2 — Confidential State Recovery

> Rebuild a user's confidential balance and history from indexed events plus their keys.

**Depends on:** Phase 1
**Goal:** a wiped wallet, given only its secret material, returns to correct state.

### M2.1 — Crypto package
- [ ] `packages/crypto`: encryption, decryption, and proof helpers matching the Confidential Token scheme
- [ ] Key derivation: spend key vs. viewing key separation
- [ ] Test vectors checked in and verified against on-chain data
- [ ] WebAssembly build target

**Acceptance:** published test vectors decrypt correctly in Node and in a browser.

### M2.2 — Replay engine
- [ ] Deterministic event replay producing balance and history
- [ ] Handles out-of-order arrival, gaps, and partial ranges
- [ ] Resumable from a checkpoint rather than genesis
- [ ] Pluggable event source (indexer, local cache, file)

**Acceptance:** replaying the same event set twice yields identical state; replaying from a mid-point checkpoint matches a full replay.

### M2.3 — State verification
- [ ] Reconstructed balance reconciled against on-chain ciphertext
- [ ] Mismatch surfaces a typed, actionable error (missing events, wrong key, stale index)
- [ ] Verification report describing what was checked

**Acceptance:** injecting a missing event or a wrong key produces the correct distinct error, never a silently wrong balance.

### M2.4 — Recovery API and sync
- [ ] `POST /recovery/session`, `GET /recovery/status` service endpoints
- [ ] Incremental sync — only fetch events newer than the client cursor
- [ ] Offline-tolerant: resumes cleanly after network loss
- [ ] Server never receives spend keys — documented and tested

**Acceptance:** an end-to-end test wipes local state and recovers a correct balance across ≥100 transactions in under 30 seconds.

---

## Phase 3 — Multi-Provider Infrastructure

> Remove single-provider dependence.

**Depends on:** Phase 2
**Goal:** a wallet keeps working, and stays verifiable, when any one archive provider fails or lies.

### M3.1 — Archive provider specification
- [ ] Versioned wire specification any provider can implement
- [ ] Conformance test suite an implementation can run against itself
- [ ] Published in `docs/archive-spec.md`

**Acceptance:** the first-party indexer passes its own conformance suite with zero special cases.

### M3.2 — Multi-provider client
- [ ] Configure N providers with weights and priorities
- [ ] Parallel fetch with quorum reads
- [ ] Automatic failover on error, timeout, or lag
- [ ] Per-provider health scoring

**Acceptance:** killing the primary provider mid-sync completes the sync from a secondary with no client-visible error.

### M3.3 — Cross-provider consistency
- [ ] Compare event digests across providers
- [ ] Disagreement detection and reporting
- [ ] Documented policy for resolving a disagreement (trust none, prefer on-chain re-verification)

**Acceptance:** a provider serving a truncated or altered history is detected and excluded automatically.

### M3.4 — Provider discovery
- [ ] Provider registry format
- [ ] Optional on-chain or DNS-based discovery
- [ ] Self-hosting guide

**Acceptance:** a third party stands up a conforming archive from the guide alone.

---

## Phase 4 — Developer SDK

> The layer developers actually touch.

**Depends on:** Phase 2 (Phase 3 for multi-provider config)
**Goal:** the README's code sample compiles and runs against testnet.

### M4.1 — Core client
- [ ] `ConfidentialWallet.connect({ account, token })`
- [ ] `wallet.sync()`, `wallet.balance()`, `wallet.history()`
- [ ] Typed errors, no thrown strings
- [ ] Configurable providers, retries, and timeouts

**Acceptance:** the README example runs unmodified against testnet.

### M4.2 — Transaction client
- [ ] `wallet.transfer({ recipient, amount })`
- [ ] Deposit and withdraw between public and confidential balances
- [ ] Proof-generation orchestration with progress callbacks
- [ ] Submission, confirmation, and failure handling

**Acceptance:** a confidential transfer sends, confirms, and is reflected in both parties' recovered state.

### M4.3 — Disclosure client
- [ ] Generate viewing keys and scoped disclosures
- [ ] Time-bounded and amount-bounded disclosure scopes
- [ ] Revocation

**Acceptance:** a disclosure grants read access to exactly its declared scope and nothing wider.

### M4.4 — Browser and bundling
- [ ] ESM + CJS builds, correct `exports` map
- [ ] Works in Vite, Next.js, and plain `<script type="module">`
- [ ] WASM loading strategy documented for each
- [ ] Bundle size budget defined and enforced in CI

**Acceptance:** a browser example app performs a full sync with no bundler configuration hacks.

### M4.5 — Documentation and examples
- [ ] API reference generated from source
- [ ] Getting-started guide, 15 minutes to first confidential transfer
- [ ] `examples/`: node script, browser app, server integration
- [ ] Migration and versioning policy

**Acceptance:** an external developer completes the getting-started guide without asking for help.

### M4.6 — Release
- [ ] Package published under a stable scope
- [ ] Semantic versioning, changelogs, provenance attestation
- [ ] Public API frozen for the major version

**Acceptance:** `npm install` of the published package reproduces the examples.

---

## Phase 5 — Auditing & Compliance

> Viewing information without controlling funds.

**Depends on:** Phase 4
**Goal:** an authorized auditor inspects permitted data and provably cannot spend.

### M5.1 — Viewing-key infrastructure
- [ ] Viewing keys derived independently of spend authority
- [ ] Scoped issuance: per-account, per-token, per-time-range
- [ ] Key rotation and revocation
- [ ] Negative test proving a viewing key cannot construct a valid spend

**Acceptance:** the separation is enforced by cryptography and covered by tests, not by policy alone.

### M5.2 — Disclosure workflows
- [ ] Request → approve → grant → expire lifecycle
- [ ] User-facing approval surface
- [ ] Immutable, append-only access log
- [ ] Automatic expiry

**Acceptance:** every read against a disclosure is logged, attributable, and expires on schedule.

### M5.3 — Auditor dashboard
- [ ] `apps/auditor`: authenticate, browse granted scopes, view disclosed history
- [ ] Export to CSV and PDF
- [ ] Report generation over a period
- [ ] Zero access to anything outside granted scope

**Acceptance:** a pen-test attempt to read an ungranted account fails at the service layer, not just the UI.

### M5.4 — Compliance toolkit
- [ ] Account authorization and restriction primitives
- [ ] Administrative permission model with separation of duties
- [ ] Audit history export
- [ ] Integration guide for regulated deployments

**Acceptance:** a demo application enforces an authorization policy end to end.

---

## Phase 6 — Mobile

> Real phones, real networks.

**Depends on:** Phase 4
**Goal:** confidential send and recover work on a mid-range Android device over a poor network.

### M6.1 — WebAssembly optimization
- [ ] Profile proof generation; establish a baseline
- [ ] Reduce peak memory below the mobile browser ceiling
- [ ] Multi-threading where available, single-thread fallback
- [ ] Published performance budget

**Acceptance:** proof generation completes on a mid-range Android device without an out-of-memory crash.

### M6.2 — Mobile-friendly sync
- [ ] Chunked, interruptible sync
- [ ] Background and resumable recovery
- [ ] Survives app lifecycle suspension
- [ ] Bandwidth-conscious event fetching

**Acceptance:** a sync interrupted by backgrounding the app resumes and completes correctly.

### M6.3 — Mobile SDK
- [ ] React Native / Android integration path
- [ ] Secure key storage using platform keystore
- [ ] Biometric unlock hook
- [ ] Mobile integration guide

**Acceptance:** a reference mobile wallet performs a confidential transfer on testnet.

### M6.4 — Reference mobile wallet
- [ ] Send, receive, history, recovery flows
- [ ] Device-change recovery walkthrough
- [ ] Testnet distribution build

**Acceptance:** wiping and reinstalling the app restores full state from the seed phrase alone.

---

## Phase 7 — Reference Application: Confidential Payroll

> Prove the stack with a real workload.

**Depends on:** Phases 4, 5, 6
**Goal:** a company runs a payroll cycle on testnet where amounts are private and the run is auditable.

### M7.1 — Employer application
- [ ] Employee roster and payment schedule
- [ ] Batch confidential disbursement
- [ ] Run history and reconciliation
- [ ] Treasury balance view

**Acceptance:** a batch of 50 confidential payments completes in one run with a reconciliation report.

### M7.2 — Employee experience
- [ ] Wallet onboarding
- [ ] Payment notification and history
- [ ] Withdrawal to a public balance
- [ ] Device-change recovery

**Acceptance:** an employee recovers their full payment history on a new device.

### M7.3 — Audit integration
- [ ] Employer grants an auditor a scoped, time-bounded view
- [ ] Auditor verifies the payroll run without seeing unrelated activity
- [ ] Exportable audit report

**Acceptance:** the auditor confirms totals without any access to non-payroll transactions.

### M7.4 — Public testnet launch
- [ ] Hosted demo with seeded data
- [ ] Walkthrough documentation and demo video
- [ ] Feedback channel
- [ ] Known-limitations page

**Acceptance:** an external user completes the full demo unaided.

---

## Cross-cutting tracks

Continuous work that does not belong to a single phase.

### Security
- [ ] Threat model documented (`docs/threat-model.md`) — start of Phase 1
- [ ] No spend keys ever leave the client — enforced by tests
- [ ] Dependency scanning in CI
- [ ] Fuzzing for the replay engine and event parser
- [ ] External security audit before any mainnet recommendation

### Testing
- [ ] Unit coverage floor: 80% on `crypto` and `recovery`
- [ ] Integration tests against Stellar testnet
- [ ] End-to-end scenario suite
- [ ] Load testing on indexer and API

### Documentation
- [ ] Architecture decision records in `docs/adr/`
- [ ] Every public API documented before release
- [ ] Operations runbook per service
- [ ] `CLAUDE.md` updated with every merged change

---

## Open decisions

Blocking items needing a call. Resolve, then record as an ADR in `docs/adr/`.

| # | Decision | Options | Needed by |
|---|----------|---------|-----------|
| 1 | License | Apache-2.0 (recommended) · MIT · AGPL-3.0 | M0.3 |
| 2 | Monorepo tooling | pnpm + Turborepo (recommended) · Nx · plain workspaces | M0.1 |
| 3 | API style | REST + WebSocket (per README) · add gRPC for provider-to-provider | M1.4 |
| 4 | Package scope | `@stellar-confidential/*` · other | M4.6 |
| 5 | Archive incentive model | Free/community · operator-funded · paid tier | M3.4 |
| 6 | Mobile target | React Native · native Android first | M6.3 |

---

## Progress

| Phase | Milestones | Done | Status |
|-------|-----------|------|--------|
| 0 — Foundations | 4 | 0 | `[~]` in progress |
| 1 — Indexer | 6 | 0 | `[ ]` |
| 2 — Recovery | 4 | 0 | `[ ]` |
| 3 — Multi-provider | 4 | 0 | `[ ]` |
| 4 — SDK | 6 | 0 | `[ ]` |
| 5 — Audit & compliance | 4 | 0 | `[ ]` |
| 6 — Mobile | 4 | 0 | `[ ]` |
| 7 — Payroll reference | 4 | 0 | `[ ]` |

Update this table whenever a milestone closes.
