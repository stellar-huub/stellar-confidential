# Architecture Decision Records

One file per decision that was not obvious. Context, options, decision, consequences.

Add an ADR when a choice would otherwise have to be re-derived from the code — especially when the alternative was reasonable and the reason for rejecting it is not visible in the result.

| #                                         | Decision                                           | Status   |
| ----------------------------------------- | -------------------------------------------------- | -------- |
| [0001](0001-monorepo-tooling.md)          | pnpm workspaces with TypeScript project references | Accepted |
| [0002](0002-contract-adapter-boundary.md) | Confine contract knowledge to a ContractAdapter    | Accepted |
| [0003](0003-ledger-window-atomicity.md)   | Commit ingestion a ledger window at a time         | Accepted |
| [0004](0004-limbed-amounts.md)            | Carry amounts as four 16-bit limbs                 | Accepted |
| [0005](0005-two-balances-in-replay.md)    | Track ciphertext and plaintext balances together   | Accepted |
