import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The site's page manifest.
 *
 * Every page renders a Markdown file that already exists in the repository.
 * Nothing here restates documentation, because a docs site that keeps its own
 * copy of the content is a docs site that goes stale — the repository stays the
 * single source of truth and this only decides ordering and titles.
 */

export interface PageSpec {
  /** Output path, without extension. `index` becomes the site root. */
  readonly slug: string;
  readonly title: string;
  /** Short line under the title, and the meta description. */
  readonly summary: string;
  /** Markdown file, relative to the repository root. */
  readonly source: string;
  readonly section: string;
}

export interface Section {
  readonly name: string;
  readonly pages: readonly PageSpec[];
}

const STATIC_PAGES: readonly PageSpec[] = [
  {
    slug: 'overview',
    title: 'Overview',
    summary: 'What the project is, why it exists, and what it is building.',
    source: 'README.md',
    section: 'Start here',
  },
  {
    slug: 'milestones',
    title: 'Milestones',
    summary: 'The delivery plan, with the acceptance criteria each milestone is held to.',
    source: 'MILESTONES.md',
    section: 'Start here',
  },
  {
    slug: 'contributing',
    title: 'Contributing',
    summary: 'Setup, workflow, code standards and how a change gets reviewed.',
    source: 'CONTRIBUTING.md',
    section: 'Start here',
  },
  {
    slug: 'events',
    title: 'Event model',
    summary: 'The canonical confidential event model, cursor ordering and integrity digests.',
    source: 'docs/events.md',
    section: 'Reference',
  },
  {
    slug: 'operations',
    title: 'Operations',
    summary: 'Running the services: what to watch, and what to do when it moves.',
    source: 'docs/operations.md',
    section: 'Reference',
  },
  {
    slug: 'threat-model',
    title: 'Threat model',
    summary: 'What is protected, and — more usefully — what is not.',
    source: 'docs/threat-model.md',
    section: 'Reference',
  },
];

/**
 * Architecture decision records, discovered rather than listed.
 *
 * ADRs are append-only and numbered, so enumerating them by hand would mean
 * every new decision needs a second edit here that someone will forget.
 */
function decisionRecords(repoRoot: string): PageSpec[] {
  const dir = join(repoRoot, 'docs', 'adr');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort()
    .map((name) => {
      const id = name.slice(0, 4);
      const title = name
        .slice(5, -3)
        .split('-')
        .join(' ')
        .replace(/^./, (c) => c.toUpperCase());
      return {
        slug: `adr/${name.slice(0, -3)}`,
        title: `${id} — ${title}`,
        summary: 'Architecture decision record.',
        source: `docs/adr/${name}`,
        section: 'Decisions',
      };
    });
}

export function buildManifest(repoRoot: string): Section[] {
  const all = [...STATIC_PAGES, ...decisionRecords(repoRoot)];
  const order = ['Start here', 'Reference', 'Decisions'];
  return order
    .map((name) => ({ name, pages: all.filter((page) => page.section === name) }))
    .filter((section) => section.pages.length > 0);
}
