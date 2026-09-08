# CLAUDE.md

Working notes for AI assistants and contributors on **Confidential Stellar Infrastructure**.

> ## ⚠️ Maintenance rule — read this first
>
> **This file must be updated whenever anything in this project changes.**
>
> Any change to the repository — code, structure, tooling, dependencies, docs, decisions — requires a corresponding update here **in the same commit or pull request**. Specifically:
>
> 1. Update the section this change makes stale (structure, stack, commands, conventions, state).
> 2. Add a dated entry to the [Change Log](#change-log), newest first.
> 3. Record any decision that closes an open question in [Decisions made](#decisions-made) and remove it from `MILESTONES.md` § Open decisions.
>
> A stale `CLAUDE.md` is worse than no `CLAUDE.md` — it makes assistants and new contributors confidently wrong. If you read something here that no longer matches reality, fixing it is your job, not someone else's.

---

## What this project is

Open infrastructure that sits **around** Stellar's Confidential Token technology, not a replacement for it and not a new privacy protocol.

Stellar's Confidential Tokens solve the cryptography: amounts become ciphertext while the network still proves the books balance. Two problems remain, and they are what this project exists to solve:

1. **Confidential state lives on the user's device and only there.** Reinstall the wallet, switch phones, or clear app data and the chain still holds the money while nothing the user owns can read it. There is no block explorer for an encrypted balance.
2. **Developers should not need cryptography expertise** to build confidential payment applications.

So the project builds: an **indexer** for confidential events, a **recovery engine** that replays those events back into wallet state, a **multi-provider archive layer** so no one provider is a dependency, a **developer SDK**, **auditing and disclosure** infrastructure, **mobile support**, and a **confidential payroll** reference application.

Full vision: [README.md](README.md). Delivery plan: [MILESTONES.md](MILESTONES.md). Contribution rules: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Current state

**Phases 1 and 2 are implemented and tested. Phase 0 is complete except for governance files.**

```text
.
├── packages/
│   ├── core/        event model, cursors, typed errors, Merkle digests, logger
│   ├── crypto/      twisted ElGamal amounts, key derivation, frozen test vectors
│   ├── indexer/     RPC client, ingestion pipeline, stores, cache, integrity
│   └── recovery/    replay engine, checkpoints, verification, event sources
├── services/
│   ├── indexer/     archive HTTP + WebSocket API, ingestion process
│   └── recovery/    recovery session coordination
├── examples/end-to-end/   `pnpm demo` — the whole stack in one script
├── docs/            events.md, operations.md, threat-model.md, adr/
└── pitch/           pitch film (not product code)
```

**Test coverage:** 205 unit tests and 28 integration tests, all passing. Integration tests need PostgreSQL, Redis and a Stellar RPC node, and skip cleanly without them.

**What is not done:**

- **M0.3** — licence, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates.
- **M1.6** — a public testnet deployment and seven days of uptime. The service is Dockerised and has a runbook; nothing is deployed.
- **The contract mapping.** The canonical Confidential Token event surface is still unknown. Everything is built against a documented working spec behind a `ContractAdapter`, and the six open items are listed in `docs/events.md`. **Do not describe the adapter as canonical.**
- Browser and mobile targets (Phase 6), multi-provider archives (Phase 3), the SDK (Phase 4).

### The `pitch/` directory

A self-contained, deterministic pitch film. It is not part of the product and shares no code with it.

| File            | Role                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `script.json`   | Narration source of truth. TTS and the deck both read it.                 |
| `voiceover.py`  | Synthesizes narration per line (Piper TTS) → `vo/*.wav` + `timeline.json` |
| `timeline.json` | Per-line start/end times; the deck keys visual beats off these            |
| `deck.html`     | The film itself. Deterministic: `SEEK(t)` fully determines the pixels     |
| `render.py`     | Walks the frame grid, pipes screenshots into ffmpeg → `out/picture.mp4`   |
| `fonts/`, `vo/` | Bundled fonts and rendered narration                                      |

The picture is cut to the voice, not the other way round. Change `script.json` → re-run `voiceover.py` → re-run `render.py`.

```bash
cd pitch
PIPER_VOICES=<dir> ./voiceover.py     # regenerate narration + timeline
./render.py                            # full film
./render.py --scene sealed             # one scene
./render.py --still 41.5 look.png      # single frame
```

---

## Planned architecture

```text
Applications  (wallets, payroll, treasury, escrow)
      ↓
Confidential SDK / API   (wallet, transfer, recovery, disclosure)
      ↓
Archive providers A / B / C   (no single-provider dependence)
      ↓
Recovery engine   (replay, verification, state reconstruction)
      ↓
Stellar   (Confidential Token contracts, Soroban)
```

### Still to be created

`packages/sdk` (Phase 4), `packages/api` shared types, `apps/explorer`, `apps/auditor`, `apps/payroll-demo`, `contracts/`. Create a package when a milestone calls for it, not before.

### Planned stack

| Layer    | Choice                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Chain    | Stellar, Soroban, Confidential Token contracts, Stellar RPC                                     |
| Backend  | Node.js, TypeScript, PostgreSQL, Redis                                                          |
| API      | REST + WebSocket                                                                                |
| SDK      | TypeScript, browser support, WebAssembly, mobile bindings                                       |
| Infra    | Docker, cloud deployment, self-hosted archive nodes                                             |
| Monorepo | pnpm workspaces + TypeScript project references ([ADR-0001](docs/adr/0001-monorepo-tooling.md)) |

---

## Invariants

These are not style preferences. Violating one is a correctness or security bug.

1. **Spend keys never leave the client.** Not to a server, not into a log line, not into an error message, not into a test fixture. Viewing keys and spend keys are derived independently.
2. **Viewing ≠ controlling.** An authorized auditor must be cryptographically unable to spend. Enforced by key separation and covered by a negative test, never by policy alone.
3. **Never return a silently wrong balance.** A typed error always beats a plausible wrong number. Recovery must distinguish _missing events_ from _wrong key_ from _stale index_.
4. **Recovered state must be verifiable.** Clients verify against on-chain data rather than trusting an archive database. A tampering or truncating provider must be detectable.
5. **Replay is deterministic.** The same event set replayed twice yields identical state; a checkpoint replay matches a full replay.
6. **Ingestion is idempotent.** Re-ingesting a ledger produces no duplicates; reorgs roll back cleanly.
7. **No production assets.** Testnet only until the underlying technology and this infrastructure are independently audited.
8. **Non-custodial and minimum trust.** Infrastructure providers must not be able to read confidential user information as a side effect of operating.

---

## Conventions

Full detail in [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

- **TypeScript strict**; `any` requires a justifying comment; named exports only in libraries
- **Typed errors** with codes and structured context — never a bare `Error('failed')`
- **Naming**: `camelCase` values, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants and error codes, `kebab-case` filenames, spelled out (`ledgerSequence`, not `ls`)
- **Comments** explain _why_; crypto and consensus-adjacent code additionally states the invariant and cites the spec
- **Logging** structured, never key material, seed phrases, decrypted amounts, or full ciphertexts
- **Commits** follow Conventional Commits: `feat(indexer): handle ledger reorgs during live follow`
- **Branches**: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`
- **Tests** are part of the change; bug fixes ship with a test that failed before the fix
- **Coverage floor** 80% on `packages/crypto` and `packages/recovery`

---

## Commands

All of these work.

```bash
pnpm install
pnpm build            # tsc --build across the project graph
pnpm test             # 205 unit tests (node:test via tsx)
pnpm test:integration # 28 tests; needs PostgreSQL, Redis, Stellar RPC
pnpm lint             # ESLint, clean
pnpm typecheck
pnpm dev              # indexer: ingestion + archive API on :4000
pnpm demo             # end-to-end walkthrough, no infrastructure needed
pnpm migrate          # apply schema migrations

node --import tsx packages/crypto/scripts/benchmark.ts        # cost baseline
node --import tsx packages/crypto/scripts/generate-vectors.ts # regenerate vectors (breaking!)
```

Integration tests default to a local PostgreSQL over the unix socket. Over TCP a password is required:

```bash
STELLAR_CONFIDENTIAL_INTEGRATION=1 \
  DATABASE_URL="postgresql:///stellar_confidential_test?host=/var/run/postgresql" \
  pnpm test:integration
```

In `pitch/`: `./voiceover.py`, `./render.py`.

## Guidance for assistants

**Before answering questions about this codebase:** check what actually exists. The README describes a great deal that is planned; Phases 1 and 2 are built, Phases 3–7 are not. Read the filesystem before asserting that a package, service, or command exists.

**When implementing:**

- Work against a named milestone in [MILESTONES.md](MILESTONES.md); acceptance criteria there are the definition of done
- Respect the [invariants](#invariants) — they outrank convenience, brevity, and test-passing
- Do not scaffold speculative structure. Create a package when a milestone calls for it.
- Do not invent Confidential Token contract APIs. The event surface is still a working spec; changes belong in a `ContractAdapter` and in `docs/events.md` § Open items, never spread downstream.
- Performance work on decryption should start from `packages/crypto/scripts/benchmark.ts`, not from intuition. Scalar multiplication dominates; the discrete-log table size is already tuned and documented.
- Prefer typed errors over defensive fallbacks in anything touching balances or keys

**When finishing any change:** update this file (see the maintenance rule at the top), tick the relevant criteria in `MILESTONES.md`, and add the Change Log entry. This is not optional bookkeeping — it is how the next session avoids re-deriving what you already worked out.

**Do not:** commit or push unless asked; add attribution lines to commits; recommend mainnet use; suggest handling real funds.

---

## Decisions made

Record decisions here as they are settled, with the reasoning. Non-obvious technical decisions also get an ADR in `docs/adr/`.

| Date       | Decision                                                               | Reasoning                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | `MILESTONES.md` is the single source of truth for scope and sequencing | The README's roadmap is prose for readers; delivery needs testable acceptance criteria                                                               |
| 2026-09-07 | Every phase must end in something runnable                             | Prevents design-only phases that cannot be validated                                                                                                 |
| 2026-09-08 | pnpm workspaces + TypeScript project references, no task runner        | Small all-TypeScript build graph; `tsc --build` handles it correctly with no extra dependency ([ADR-0001](docs/adr/0001-monorepo-tooling.md))        |
| 2026-09-08 | Contract knowledge confined to a `ContractAdapter`                     | Lets Phases 1–2 be built and tested in full while the canonical contract surface is unknown ([ADR-0002](docs/adr/0002-contract-adapter-boundary.md)) |
| 2026-09-08 | Ingestion commits a whole ledger window atomically                     | Makes restart correctness a property of the schema rather than of careful sequencing ([ADR-0003](docs/adr/0003-ledger-window-atomicity.md))          |
| 2026-09-08 | Amounts carried as four 16-bit limbs, independent randomness each      | Makes decryption tractable on a phone; shared randomness would leak limb differences ([ADR-0004](docs/adr/0004-limbed-amounts.md))                   |
| 2026-09-08 | Replay tracks ciphertext and plaintext balances together               | Makes chain verification constant work instead of a wide discrete-log search ([ADR-0005](docs/adr/0005-two-balances-in-replay.md))                   |
| 2026-09-08 | `node:test` via `tsx` rather than a test framework                     | Keeps the test toolchain to one dependency                                                                                                           |
| 2026-09-08 | Redis spoken directly over RESP                                        | Four commands is less code than the client library, and narrows the trusted surface of a service handling confidential data                          |

Open decisions still needing a call are listed in [MILESTONES.md](MILESTONES.md) § Open decisions — license, monorepo tooling, API style, package scope, archive incentive model, mobile target.

---

## Change Log

Newest first. One entry per merged change. Include what changed and why it matters to someone reading this file later.

### 2026-09-08 — Phases 1 and 2 implemented

Built the confidential indexer and the state recovery engine, plus the Phase 0 foundations they needed. 205 unit tests and 28 integration tests, all passing; lint and build clean.

**Packages.** `core` (event model, cursor ordering, typed errors, Merkle digests, redacting logger), `crypto` (twisted ElGamal over ristretto255, HKDF key separation, frozen test vectors, benchmark), `indexer` (RPC client, ingestion pipeline, PostgreSQL and in-memory stores behind one conformance suite, RESP Redis cache, integrity service, reference adapter, synthetic chain), `recovery` (replay engine, checkpoints, verification, event sources).

**Services.** Archive HTTP + WebSocket API with OpenAPI; recovery session coordination.

**Docs.** `events.md` (M1.1's deliverable), `operations.md`, `threat-model.md`, five ADRs.

**Four bugs worth remembering, all found by tests against real infrastructure:**

1. `getLedgers` returns a `LedgerHeaderHistoryEntry`, not a bare `LedgerHeader` — different offsets. Misreading it produced parent hashes that never match, which would have disabled reorg detection _silently_. Found by a live-node integration test; the parser now cross-checks the embedded hash.
2. `rollbackTo` left checkpoints pointing above deleted ledgers, so the next ingest resumed past a hole. Both stores now clamp, and the conformance suite pins it.
3. `verifyAmount` compared limbs one by one against the canonical split, rejecting correct accumulated balances — homomorphic addition does not propagate carries. It now recombines by weight.
4. The recovery session asked for a digest over the range the _archive returned_, letting an archive truncate a history and produce a digest agreeing with the truncation. Digest bounds are now client-chosen and exclusive-lower, matching pagination.

**Two known limits, stated plainly:** the contract mapping is a working spec (six open items in `docs/events.md`), and transaction-graph/timing privacy is unaddressed — confidential amounts are not confidential relationships, which for payroll matters.

### 2026-09-07 — Project documentation foundation

- Added `MILESTONES.md`: the full delivery plan across Phase 0–7, expanding the README's roadmap into 36 milestones with explicit acceptance criteria, dependencies, cross-cutting security/testing/docs tracks, and six open decisions that block specific milestones. Added a Phase 0 (Foundations) that the README did not have — the repository needs to be buildable before product work can start.
- Added `CONTRIBUTING.md`: setup, repository layout, workflow, branch and commit conventions, code standards, testing requirements, PR checklist, and security disclosure. Marks clearly which setup commands are aspirational.
- Added `CLAUDE.md` (this file): project orientation, current state, invariants, conventions, and the maintenance rule requiring this file be updated with every change.
- Added `.gitignore` covering Node, Python, build output, coverage, `pitch/out/`, and an explicit block for key material (`*.pem`, `*.key`, `secrets/`, `.env`) per invariant 1.
- Updated `README.md` § Contributing: replaced the "guidelines once they are available" placeholder with links to `CONTRIBUTING.md`, `MILESTONES.md`, and this file.
- No code changes. The repository remains documentation plus the `pitch/` film.

### 2026-09-07 — Initial repository

- `README.md` with vision, architecture, seven-phase roadmap, and design principles.
- `pitch/`: deterministic pitch film — narration script, Piper TTS pipeline, timeline, HTML deck, and frame-accurate renderer.
