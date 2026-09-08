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

**Phase 0 — Foundations, in progress.**

The repository today contains documentation and a pitch deck. **No application code exists yet.** Do not assume otherwise; do not describe unbuilt components as if they work.

```text
.
├── README.md          # vision, architecture, roadmap
├── MILESTONES.md      # delivery plan, acceptance criteria, open decisions
├── CONTRIBUTING.md    # contribution guide
├── CLAUDE.md          # this file
└── pitch/             # pitch film (see below)
```

The next concrete work is milestones **M0.1–M0.4**: monorepo scaffolding, CI, governance files, and a local Docker stack. Nothing downstream can start until those land.

### The `pitch/` directory

A self-contained, deterministic pitch film. It is not part of the product and shares no code with it.

| File | Role |
|------|------|
| `script.json` | Narration source of truth. TTS and the deck both read it. |
| `voiceover.py` | Synthesizes narration per line (Piper TTS) → `vo/*.wav` + `timeline.json` |
| `timeline.json` | Per-line start/end times; the deck keys visual beats off these |
| `deck.html` | The film itself. Deterministic: `SEEK(t)` fully determines the pixels |
| `render.py` | Walks the frame grid, pipes screenshots into ffmpeg → `out/picture.mp4` |
| `fonts/`, `vo/` | Bundled fonts and rendered narration |

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

### Target repository structure

Not yet created. Establish it in M0.1 and keep this list accurate as it fills in.

```text
packages/    sdk/ indexer/ recovery/ crypto/ api/
apps/        explorer/ auditor/ payroll-demo/
services/    indexer/ recovery/ api/
contracts/   Soroban contracts and bindings
docs/        specs, ADRs, runbooks
examples/    runnable integration examples
pitch/       pitch film (not product code)
```

### Planned stack

| Layer | Choice |
|-------|--------|
| Chain | Stellar, Soroban, Confidential Token contracts, Stellar RPC |
| Backend | Node.js, TypeScript, PostgreSQL, Redis |
| API | REST + WebSocket |
| SDK | TypeScript, browser support, WebAssembly, mobile bindings |
| Infra | Docker, cloud deployment, self-hosted archive nodes |
| Monorepo | pnpm workspaces + Turborepo *(proposed — open decision #2)* |

---

## Invariants

These are not style preferences. Violating one is a correctness or security bug.

1. **Spend keys never leave the client.** Not to a server, not into a log line, not into an error message, not into a test fixture. Viewing keys and spend keys are derived independently.
2. **Viewing ≠ controlling.** An authorized auditor must be cryptographically unable to spend. Enforced by key separation and covered by a negative test, never by policy alone.
3. **Never return a silently wrong balance.** A typed error always beats a plausible wrong number. Recovery must distinguish *missing events* from *wrong key* from *stale index*.
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
- **Comments** explain *why*; crypto and consensus-adjacent code additionally states the invariant and cites the spec
- **Logging** structured, never key material, seed phrases, decrypted amounts, or full ciphertexts
- **Commits** follow Conventional Commits: `feat(indexer): handle ledger reorgs during live follow`
- **Branches**: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`
- **Tests** are part of the change; bug fixes ship with a test that failed before the fix
- **Coverage floor** 80% on `packages/crypto` and `packages/recovery`

---

## Commands

⚠️ Most of these are **not wired up yet** — making them real is Phase 0. Verify before quoting them to a user as working.

```bash
pnpm install        # install workspace dependencies      [M0.1 — not yet]
pnpm build          # build all packages                  [M0.1 — not yet]
pnpm test           # run test suite                      [M0.1 — not yet]
pnpm lint           # ESLint                              [M0.1 — not yet]
pnpm typecheck      # tsc --noEmit                        [M0.1 — not yet]
pnpm dev            # local stack                         [M0.4 — not yet]
docker compose up -d  # PostgreSQL + Redis                [M0.4 — not yet]
```

Working today, in `pitch/`: `./voiceover.py`, `./render.py`.

---

## Guidance for assistants

**Before answering questions about this codebase:** check what actually exists. The README and this file describe a great deal that is planned. Read the filesystem before asserting that a package, service, or command exists.

**When implementing:**

- Work against a named milestone in [MILESTONES.md](MILESTONES.md); acceptance criteria there are the definition of done
- Respect the [invariants](#invariants) — they outrank convenience, brevity, and test-passing
- Do not scaffold speculative structure. Create a package when a milestone calls for it.
- Do not invent Confidential Token contract APIs. If the event surface or contract interface is unknown, that is milestone M1.1 research, not something to guess. Say so.
- Prefer typed errors over defensive fallbacks in anything touching balances or keys

**When finishing any change:** update this file (see the maintenance rule at the top), tick the relevant criteria in `MILESTONES.md`, and add the Change Log entry. This is not optional bookkeeping — it is how the next session avoids re-deriving what you already worked out.

**Do not:** commit or push unless asked; add attribution lines to commits; recommend mainnet use; suggest handling real funds.

---

## Decisions made

Record decisions here as they are settled, with the reasoning. Non-obvious technical decisions also get an ADR in `docs/adr/`.

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-09-07 | `MILESTONES.md` is the single source of truth for scope and sequencing | The README's roadmap is prose for readers; delivery needs testable acceptance criteria |
| 2026-09-07 | Every phase must end in something runnable | Prevents design-only phases that cannot be validated |

Open decisions still needing a call are listed in [MILESTONES.md](MILESTONES.md) § Open decisions — license, monorepo tooling, API style, package scope, archive incentive model, mobile target.

---

## Change Log

Newest first. One entry per merged change. Include what changed and why it matters to someone reading this file later.

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
