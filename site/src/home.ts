import { REPO_URL } from './template.js';

/**
 * The landing page.
 *
 * Hand-written rather than rendered from the README, because a landing page and
 * a README have different jobs. It states only things that change slowly — what
 * the project is, what is built, what is not — and links to the generated pages
 * for anything detailed, so there is nothing here to drift out of step with the
 * documentation.
 */
export function homePage(base: string): string {
  const components: Array<[string, string, string, 'built' | 'planned']> = [
    [
      'Confidential Indexer',
      'Ingests Confidential Token events, survives reorgs and restarts, and serves a verifiable archive.',
      'events.html',
      'built',
    ],
    [
      'State Recovery',
      'Replays an account’s history back into a balance, and proves it against the chain.',
      'events.html',
      'built',
    ],
    [
      'Multi-Provider Archives',
      'No single infrastructure provider is a dependency. Quorum reads and disagreement detection.',
      'milestones.html',
      'planned',
    ],
    [
      'Developer SDK',
      'A familiar API over wallet sync, transfers, recovery and disclosure.',
      'milestones.html',
      'planned',
    ],
    [
      'Viewing & Auditing',
      'Scoped disclosure, access logs, and an auditor who provably cannot spend.',
      'threat-model.html',
      'planned',
    ],
    [
      'Mobile',
      'Proving and recovery within the memory, CPU and connectivity limits of a real phone.',
      'milestones.html',
      'planned',
    ],
  ];

  const cards = components
    .map(
      ([
        title,
        body,
        href,
        status,
      ]) => `<a class="card" href="${base}${href}" style="display:block;color:inherit">
        <span class="status ${status}">${status === 'built' ? 'Built' : 'Planned'}</span>
        <h3>${title}</h3>
        <p>${body}</p>
      </a>`,
    )
    .join('\n      ');

  return `<div class="hero">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="${base}assets/banner-dark.svg">
      <img class="banner" src="${base}assets/banner-light.svg" alt="Confidential Stellar Infrastructure">
    </picture>
    <h1>The infrastructure layer for <span class="accent">confidential assets</span> on Stellar.</h1>
    <p class="lede">
      Stellar&rsquo;s Confidential Tokens solve the cryptography: amounts become ciphertext while
      the network still proves the books balance. Two problems remain &mdash; confidential state
      lives on one device and nowhere else, and building on it should not require a cryptographer.
      This is the layer that closes both.
    </p>
    <div class="cta">
      <a class="button primary" href="${base}overview.html">Read the overview</a>
      <a class="button" href="${base}events.html">Event model</a>
      <a class="button" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
  </div>

  <div class="content">
    <h2 id="the-problem">The problem, in one paragraph</h2>
    <p>
      Reinstall a wallet, switch phones, or clear app data, and the chain still holds your money
      while nothing you own can read it. There is no block explorer for an encrypted balance.
      Recovering that state means replaying history you can verify &mdash; from archives you do
      not have to trust.
    </p>

    <h2 id="components">Components</h2>
    <div class="card-grid">
      ${cards}
    </div>

    <div class="note">
      <strong>Status: early development, testnet only.</strong>
      <p>
        The indexer and recovery engine are implemented and tested. The contract mapping is a
        working spec pending the canonical Confidential Token event surface, and none of this has
        had an external cryptographic review. Do not use it with production assets.
      </p>
    </div>

    <h2 id="start">Where to start</h2>
    <ul>
      <li><a href="${base}overview.html">Overview</a> &mdash; what the project is and why it exists.</li>
      <li><a href="${base}events.html">Event model</a> &mdash; the model everything else assumes.</li>
      <li><a href="${base}threat-model.html">Threat model</a> &mdash; what is protected, and what is not.</li>
      <li><a href="${base}operations.html">Operations</a> &mdash; running the services.</li>
      <li><a href="${base}contributing.html">Contributing</a> &mdash; setup and workflow.</li>
    </ul>
  </div>`;
}
