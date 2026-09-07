# Confidential Stellar Infrastructure

> Open infrastructure for private, recoverable, and compliant digital asset applications on Stellar.

[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blue)](https://stellar.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Early%20Development-orange)]()
[![License](https://img.shields.io/badge/License-TBD-lightgrey)]()

Confidential Stellar Infrastructure is an open-source infrastructure project designed to make **Confidential Tokens on Stellar easier to build, integrate, recover, audit, and operate**.

The project does not attempt to replace Stellar's Confidential Token technology or develop a new privacy protocol.

Instead, it provides the infrastructure layer around it.

---

## Why This Project Exists

Blockchain transparency is powerful, but many financial applications cannot expose transaction amounts publicly.

Consider:

* payroll
* business payments
* treasury management
* private escrow
* institutional settlement
* confidential asset management

A company may want everyone to verify that a payment happened without publicly revealing the amount.

Stellar's emerging Confidential Token technology provides the cryptographic foundation for this.

The next challenge is making that technology practical for developers.

A developer should not need to understand advanced cryptography just to build a confidential payment application.

That is the problem this project aims to solve.

---

## Our Vision

> **Make confidential assets on Stellar as easy to build with as ordinary Stellar assets.**

We want developers to be able to build confidential applications using familiar APIs while the infrastructure handles the difficult parts underneath.

```text
Stellar Confidential Tokens
            │
            ▼
┌───────────────────────────────┐
│ Confidential Infrastructure  │
│                               │
│ • Indexing                   │
│ • State Recovery             │
│ • SDK                         │
│ • APIs                        │
│ • Auditing                    │
│ • Compliance                 │
│ • Mobile Support             │
└───────────────┬───────────────┘
                │
                ▼
      Real Applications
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
     Wallet   Payroll   Treasury
```

---

# What We Are Building

The project is organized around several components.

## 1. Confidential Indexer

A blockchain data service that collects and organizes Confidential Token events.

The indexer will provide applications with access to historical information needed to reconstruct confidential account state.

### Planned capabilities

* Historical event storage
* Transaction history
* Account-specific history
* Event ordering
* State reconstruction
* Data integrity verification
* REST APIs
* WebSocket APIs

---

## 2. Confidential State Recovery

Users should not lose access to their confidential transaction history simply because they:

* change devices
* reinstall a wallet
* clear local application data
* remain offline for an extended period

The recovery layer will retrieve relevant historical events and reconstruct the user's confidential state.

```text
User Wallet
     │
     ▼
Recovery SDK
     │
     ▼
Historical Events
     │
     ▼
Replay Transactions
     │
     ▼
Verify State
     │
     ▼
Recovered Wallet State
```

---

## 3. Multi-Provider Recovery

The project will avoid making applications dependent on a single infrastructure provider.

Instead, applications will be able to retrieve historical data from multiple archive providers.

```text
                    Wallet
                       │
                 Recovery SDK
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Archive A    Archive B    Archive C
          │            │            │
          └────────────┼────────────┘
                       ▼
                Verified State
```

This can improve:

* availability
* resilience
* data redundancy
* censorship resistance
* infrastructure independence

---

## 4. Developer SDK

The SDK will provide a simple interface for developers building applications on top of Confidential Tokens.

A developer should eventually be able to write code similar to:

```typescript
const wallet = await ConfidentialWallet.connect({
  account,
  token
});

await wallet.sync();

await wallet.transfer({
  recipient,
  amount
});
```

The SDK will handle the underlying complexity of:

* wallet synchronization
* state recovery
* transaction preparation
* proof-generation orchestration
* transaction submission
* disclosure operations

The SDK is intended to be a developer-friendly interface rather than a replacement for Stellar's underlying cryptographic infrastructure.

---

## 5. Viewing & Auditing

Privacy does not mean that financial applications should become impossible to audit.

Authorized organizations may need controlled access to financial information.

The project will provide infrastructure for:

* auditor access
* viewing-key workflows
* selective disclosure
* permissions
* access logs
* audit reports

The architecture will maintain a separation between:

```text
Viewing financial information
              ≠
Controlling funds
```

An authorized auditor should be able to inspect permitted information without automatically obtaining the ability to spend the user's assets.

---

## 6. Compliance Infrastructure

Different applications require different levels of control.

The infrastructure will provide reusable tools for applications that need capabilities such as:

* account authorization
* account restrictions
* controlled disclosure
* compliance workflows
* audit history
* administrative permissions

The goal is to make these capabilities easier to integrate into real applications without forcing every developer to build the same infrastructure from scratch.

---

## 7. Mobile Support

Mobile devices are a major target for this project.

Confidential applications must work under the constraints of real-world phones, including:

* limited memory
* limited CPU resources
* unreliable network connectivity
* mobile browser limitations
* application lifecycle interruptions

The project will investigate:

* WebAssembly optimization
* mobile-friendly proving
* Android compatibility
* efficient state synchronization
* background recovery
* native/mobile SDK integrations

---

# Reference Application

The first major reference application will be **Confidential Payroll**.

The application will demonstrate how a company could use confidential assets for employee payments.

```text
                 Company
                    │
          ┌─────────┼─────────┐
          │         │         │
          ▼         ▼         ▼
      Employee A Employee B Employee C
          │         │         │
          └─────────┼─────────┘
                    ▼
          Confidential Token
```

The application will demonstrate:

* confidential payments
* wallet synchronization
* state recovery
* mobile access
* authorized auditing
* transaction history

The payroll application is a reference implementation, not the entire project.

The underlying infrastructure is intended to support many types of applications.

---

# Architecture

```text
┌────────────────────────────────────────────────┐
│                 Applications                    │
│                                                │
│ Wallets • Payroll • Treasury • Escrow • Apps  │
└───────────────────────┬────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────┐
│             Confidential SDK / API              │
│                                                │
│ Wallet • Transfer • Recovery • Disclosure      │
└───────────────────────┬────────────────────────┘
                        │
             ┌──────────┼──────────┐
             │          │          │
             ▼          ▼          ▼
        Archive A   Archive B   Archive C
             │          │          │
             └──────────┼──────────┘
                        ▼
┌────────────────────────────────────────────────┐
│              Recovery Engine                    │
│                                                │
│ Replay • Verification • State Reconstruction   │
└───────────────────────┬────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────┐
│                  Stellar                        │
│                                                │
│ Confidential Token Contracts • Soroban         │
└────────────────────────────────────────────────┘
```

---

# Technology Stack

The initial implementation is planned around the following technologies.

### Blockchain

* Stellar
* Soroban
* Confidential Token contracts
* Stellar RPC

### Backend

* Node.js
* TypeScript
* PostgreSQL
* Redis

### API

* REST
* WebSocket

### SDK

* TypeScript
* Browser support
* WebAssembly
* Mobile integrations

### Infrastructure

* Docker
* Cloud deployments
* Self-hosted archive nodes

---

# Design Principles

## Non-Custodial

The infrastructure should not require users to give up control of their assets.

## Minimal Trust

Infrastructure providers should not automatically be able to view confidential user information.

## Verifiable Data

Applications should be able to verify recovered information rather than blindly trusting a database.

## Open Source

Core infrastructure is intended to be publicly auditable and reusable.

## Interoperability

The project should complement existing Stellar Confidential Token implementations rather than create incompatible alternatives.

## Developer First

Complex cryptographic operations should be hidden behind simple and well-documented interfaces.

---

# Project Structure

The repository is expected to evolve toward a structure similar to:

```text
.
├── packages/
│   ├── sdk/
│   ├── indexer/
│   ├── recovery/
│   ├── crypto/
│   └── api/
│
├── apps/
│   ├── explorer/
│   ├── auditor/
│   └── payroll-demo/
│
├── services/
│   ├── indexer/
│   ├── recovery/
│   └── api/
│
├── contracts/
│
├── docs/
│
├── examples/
│
└── README.md
```

This structure may change as development progresses.

---

# Development Roadmap

## Phase 1 — Indexing

* Confidential Token event ingestion
* PostgreSQL storage
* Historical event API
* Account history
* Testnet deployment

## Phase 2 — Recovery

* Event replay
* State reconstruction
* State verification
* Recovery API
* Wallet synchronization

## Phase 3 — Multi-Provider Infrastructure

* Archive provider specification
* Multiple archive support
* Provider discovery
* Failover
* Consistency verification

## Phase 4 — Developer SDK

* TypeScript client
* Wallet integration
* Recovery client
* Transaction client
* Documentation
* Example applications

## Phase 5 — Auditing & Compliance

* Auditor dashboard
* Viewing-key workflows
* Disclosure requests
* Access controls
* Audit logs

## Phase 6 — Mobile

* Android support
* Mobile recovery
* WebAssembly optimization
* Mobile SDK
* Mobile reference wallet

## Phase 7 — Reference Application

Launch the Confidential Payroll testnet application.

---

# Security

Security is a core requirement of the project.

The project will prioritize:

* non-custodial architecture
* secure key handling
* cryptographic verification
* minimal infrastructure trust
* permission separation
* reproducible testing
* open-source review
* independent security audits before production use

**Important:** Stellar Confidential Tokens are currently an emerging/developer-preview technology. This project should not be used with production assets until the underlying technology and this infrastructure have been independently reviewed and declared production-ready.

---

# Current Status

🚧 **Early Development**

The project is currently focused on research, architecture, prototype implementation, and testnet experimentation.

The immediate objective is to build a working proof of concept for:

```text
Confidential Token
       ↓
Indexer
       ↓
Historical Recovery
       ↓
SDK
       ↓
Reference Application
```

---

# Contributing

Contributions are welcome.

Areas that will be particularly useful include:

* Stellar/Soroban development
* TypeScript
* PostgreSQL
* blockchain indexing
* cryptography
* zero-knowledge systems
* WebAssembly
* Android/mobile development
* security research
* developer documentation

Before contributing, please read the project contribution guidelines once they are available.

---

# Research & References

This project builds on the emerging Stellar Confidential Token ecosystem and related open-source work.

Useful starting points include:

* [Stellar](https://stellar.org/)
* [Stellar Developers](https://developers.stellar.org/)
* [Soroban](https://developers.stellar.org/docs/learn/soroban)
* [OpenZeppelin](https://www.openzeppelin.com/)
* [Stellar Community Fund](https://communityfund.stellar.org/)

---

# License

License: **TBD**

The final license will be selected before the first public production release.

---

# Disclaimer

This project is experimental software.

Nothing in this repository constitutes financial, investment, legal, or compliance advice.

The project is intended for development and research purposes during its early stages. Do not use experimental deployments for real-world funds until the relevant software, contracts, cryptographic components, and operational infrastructure have undergone appropriate security review.

---

# Vision

We believe privacy should not require sacrificing usability.

Stellar provides an increasingly powerful foundation for confidential digital assets.

Our goal is to build the infrastructure that connects that foundation to real applications.

> **Private assets. Verifiable transactions. Recoverable state. Developer-friendly infrastructure.**

Built for Stellar.
