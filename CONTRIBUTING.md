# Contributing

Thanks for your interest in **Confidential Stellar Infrastructure**.

This project builds infrastructure around Stellar's Confidential Token technology — indexing, state recovery, an SDK, auditing, and compliance tooling. Read [README.md](README.md) for the vision and [MILESTONES.md](MILESTONES.md) for what is actually being built right now.

The project is in **early development**. Interfaces move fast, and the fastest way to have your work merged is to agree on the approach before writing it.

---

## Table of contents

- [Ground rules](#ground-rules)
- [Ways to contribute](#ways-to-contribute)
- [Getting set up](#getting-set-up)
- [Repository layout](#repository-layout)
- [Workflow](#workflow)
- [Branches and commits](#branches-and-commits)
- [Code standards](#code-standards)
- [Testing](#testing)
- [Documentation duties](#documentation-duties)
- [Pull requests](#pull-requests)
- [Security](#security)
- [Licensing](#licensing)
- [Getting help](#getting-help)

---

## Ground rules

1. **Discuss before you build.** For anything larger than a bug fix or a doc tweak, open an issue first. A rejected 800-line PR wastes your time more than a five-minute conversation would have.
2. **Never handle real funds.** This is experimental software targeting testnet. Do not open PRs that encourage mainnet use.
3. **No secret material leaves the client.** Spend keys, seed phrases, and private material must never reach a server, a log line, an error message, or a test fixture. This is not negotiable and is the fastest way to get a PR closed.
4. **Match the surrounding code.** Same naming, same error style, same comment density.
5. **Be decent to people.** Assume good faith, critique code and not authors.

---

## Ways to contribute

You do not need to be a cryptographer.

**Especially useful right now (Phase 0–1):**

- Monorepo scaffolding, CI, and build tooling
- Stellar / Soroban integration and RPC handling
- PostgreSQL schema design and query performance
- Blockchain indexing — cursors, reorgs, idempotent ingest
- Developer documentation and examples

**Useful soon:**

- Cryptography and zero-knowledge systems review
- WebAssembly performance work
- Android / React Native
- Security research and threat modelling
- TypeScript SDK design and DX

**Always useful:**

- Bug reports with reproduction steps
- Documentation fixes
- Test coverage for existing behaviour
- Reviewing open pull requests

---

## Getting set up

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x or 22.x LTS | |
| pnpm | 9+ | `corepack enable` |
| Docker | recent | for PostgreSQL and Redis |
| Git | 2.30+ | |
| Rust + `stellar` CLI | latest stable | only for contract work |

### First run

```bash
git clone https://github.com/<org>/stellar-confidential.git
cd stellar-confidential

pnpm install
cp .env.example .env      # fill in testnet RPC settings
docker compose up -d      # PostgreSQL + Redis

pnpm build
pnpm test
```

If any of these steps fail on a clean clone, that is a bug — please open an issue. Keeping this sequence working is milestone **M0.1**.

> **Note:** the repository is currently documentation and a pitch deck. The commands above describe the target set up defined in Phase 0 of [MILESTONES.md](MILESTONES.md); some are not wired up yet. If you are picking up a Phase 0 milestone, making these commands real *is* the task.

### Useful commands

```bash
pnpm build          # build all packages
pnpm test           # run the test suite
pnpm test --watch   # watch mode
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm format         # Prettier
pnpm dev            # start the local stack
```

---

## Repository layout

```text
packages/     # published libraries
  sdk/        # developer-facing TypeScript SDK
  indexer/    # indexing library
  recovery/   # state replay and verification
  crypto/     # cryptographic primitives and WASM bindings
  api/        # shared API types and clients

apps/         # user-facing applications
  explorer/   # confidential event explorer
  auditor/    # auditor dashboard
  payroll-demo/

services/     # deployable long-running services
  indexer/
  recovery/
  api/

contracts/    # Soroban contracts and bindings
docs/         # specs, ADRs, operations runbooks
examples/     # runnable integration examples
pitch/        # project pitch deck and narration
```

Put new code in the package that owns the concern. If nothing owns it, raise that in your issue rather than inventing a top-level directory.

---

## Workflow

1. **Find or open an issue.** Check [MILESTONES.md](MILESTONES.md) — work that maps to a named milestone gets reviewed fastest. Comment on the issue to claim it.
2. **Agree on the approach** in the issue for anything non-trivial.
3. **Fork and branch** from `main`.
4. **Build it**, with tests and docs.
5. **Run the full local suite** before pushing.
6. **Open a PR** referencing the issue.
7. **Respond to review.** Push follow-up commits; do not force-push over an in-flight review.
8. **Squash-merge** once approved and green.

---

## Branches and commits

### Branch names

```text
feat/indexer-reorg-handling
fix/recovery-cursor-off-by-one
docs/archive-spec
chore/ci-node-22
refactor/event-model
test/replay-determinism
```

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <subject>

<body — what and why, not how>

<footer — Closes #123>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `build`, `ci`.

Scopes: `sdk`, `indexer`, `recovery`, `crypto`, `api`, `contracts`, `docs`, `ci`, or the app name.

```text
feat(indexer): handle ledger reorgs during live follow

Rolls back events above the fork point and re-ingests from the
common ancestor. Previously a reorg left orphaned events that
corrupted account history replay.

Closes #42
```

Keep the subject under 72 characters, imperative mood, no trailing period.

---

## Code standards

### TypeScript

- Strict mode. `any` needs a comment explaining why.
- Export types for everything on a public API surface.
- Prefer `unknown` over `any` at boundaries, then narrow.
- No default exports in library packages — named exports only.
- `async`/`await` over raw promise chains.

### Errors

Typed and actionable. A caller must be able to distinguish *missing events* from *wrong key* from *stale index* — this is a hard requirement of the recovery engine (milestone M2.3).

```typescript
// good
throw new RecoveryError('MISSING_EVENTS', {
  account,
  expectedCursor,
  receivedCursor,
});

// bad
throw new Error('recovery failed');
```

Never silently return a wrong value where a typed error belongs. A wrong confidential balance is worse than a thrown error.

### Naming

- `camelCase` for values and functions, `PascalCase` for types and classes
- `SCREAMING_SNAKE_CASE` for constants and error codes
- `kebab-case` for filenames
- Spell it out: `ledgerSequence`, not `ls`

### Comments

Explain *why*, not *what*. Cryptographic and consensus-adjacent code is the exception — there, explain the invariant being maintained and cite the spec section.

### Logging

- Structured logs, no `console.log` in library code
- **Never log** key material, seed phrases, decrypted amounts, or full ciphertexts
- Account identifiers are acceptable; balances are not

---

## Testing

Every behavioural change needs a test. Bug fixes need a test that fails before the fix.

| Layer | What it covers |
|-------|----------------|
| Unit | pure logic, crypto primitives, parsers |
| Integration | database, RPC, service boundaries |
| End-to-end | full scenarios against Stellar testnet |

**Requirements:**

- Coverage floor of 80% on `packages/crypto` and `packages/recovery`
- Deterministic — no wall-clock or network dependence in unit tests
- Crypto changes must include or update published test vectors
- Replay and recovery changes must include a determinism test: the same event set replayed twice yields identical state

```bash
pnpm test                        # everything
pnpm --filter @scope/recovery test
pnpm test:e2e                    # needs testnet configuration
```

Do not weaken an assertion to make a test pass. If a test is wrong, fix the test in its own commit and say why.

---

## Documentation duties

Docs are part of the change, not a follow-up.

A PR must update:

- **`CLAUDE.md`** — required on **every** merged change. Add an entry to its Change Log and update any section your change makes stale. This file is how contributors and AI assistants stay oriented; a stale one is worse than none.
- **`MILESTONES.md`** — tick the criteria you satisfied; move the milestone status if it closes.
- **`README.md`** — if you changed the architecture, stack, or roadmap.
- **`docs/`** — new specs, ADRs for non-obvious technical decisions, runbooks for new services.
- **API reference** — public API changes need doc comments.

Architectural decisions get an ADR in `docs/adr/` — context, options considered, decision, consequences.

---

## Pull requests

### Before opening

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass
- [ ] Tests added or updated
- [ ] `CLAUDE.md` updated
- [ ] `MILESTONES.md` updated if a criterion moved
- [ ] No secrets, keys, or `.env` files committed
- [ ] No `console.log` or commented-out code left behind

### PR description

Include:

- **What** changed and **why**
- **Issue** it closes
- **Milestone** it advances, if any
- **How to verify** — the reviewer should not have to guess
- **Breaking changes**, called out explicitly
- **Screenshots** for UI work

### Review

- One approval and green CI required to merge
- Security-relevant changes (crypto, key handling, disclosure, auth) require review from a maintainer
- Keep PRs focused; split unrelated changes
- Under ~400 lines of diff gets reviewed much faster

### Scope

One PR, one concern. Drive-by refactors in a feature PR make review harder and get sent back.

---

## Security

**Do not open a public issue for a security vulnerability.**

Report privately to the maintainers (see `SECURITY.md`; until it exists, contact a maintainer directly). Include reproduction steps and impact. Expect an acknowledgement within a few days.

Areas where extra scrutiny is expected in review:

- Anything touching key derivation, storage, or transmission
- Anything that could cause a server to observe plaintext amounts
- Disclosure scope enforcement — a viewing key must never widen into spend authority
- Event verification — a malicious archive provider must not be able to hide or forge history
- Dependency additions, especially cryptographic ones

Reminder: Stellar Confidential Tokens are emerging technology. This infrastructure is not production-ready and must not be used with real assets until independently audited.

---

## Licensing

The project license is **TBD** (see open decision #1 in [MILESTONES.md](MILESTONES.md)). By contributing you agree that your contribution will be released under the license the project ultimately adopts. Contribute only code you have the right to contribute.

---

## Getting help

- **Questions about the codebase** — open a discussion or issue
- **Questions about a milestone** — comment on the tracking issue
- **Stellar / Soroban questions** — [Stellar Developers](https://developers.stellar.org/) and the Stellar Developer Discord
- **Unsure whether an idea fits** — ask before building it

New here? Look for issues labelled `good first issue` or pick an unclaimed Phase 0 milestone from [MILESTONES.md](MILESTONES.md) — that phase is deliberately approachable and does not require cryptography knowledge.
