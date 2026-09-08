# 0001 — pnpm workspaces with TypeScript project references

**Status:** Accepted · 2026-09-07 · Resolves open decision #2 in MILESTONES.md

## Context

The project spans libraries, services and (later) apps that depend on each other. M0.1 needed a build that produces correct incremental rebuilds across those boundaries.

MILESTONES.md originally proposed pnpm workspaces plus Turborepo.

## Options

1. **pnpm workspaces + Turborepo** — task orchestration, caching, parallelism.
2. **Nx** — more capable, more configuration.
3. **pnpm workspaces + TypeScript project references** — `tsc --build` walks the dependency graph itself.

## Decision

Option 3.

The build graph is small and entirely TypeScript. `tsc --build` already understands it, does correct incremental builds, and needs no cache layer to be fast at this size. A task runner would add a dependency and a configuration surface to solve a problem we do not have yet.

"Minimal trust" and a narrow dependency surface are stated design principles. They apply to build tooling too: every dependency in an infrastructure project handling confidential data is a dependency someone must eventually audit.

Tests run on `node:test` via `tsx`, which keeps the test toolchain to one loader rather than a framework.

## Consequences

- One command, `pnpm build`, builds everything in dependency order.
- No remote build cache. If CI becomes slow, revisit — this decision is cheap to reverse, because project references remain valid under Turborepo or Nx.
- Each package declares its own `references`, which must stay in step with its `dependencies`. A missing reference surfaces immediately as a build error.
