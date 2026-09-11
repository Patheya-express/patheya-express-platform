/**
 * ESLint debt ratchet — CLI entry point.
 *
 * Two subcommands, deliberately kept in two separate functions with no shared write path:
 *
 *   verify   Runs ESLint, compares against the committed baseline, fails if any diagnostic isn't
 *            in the baseline. NEVER writes to the baseline file. This is what CI invokes
 *            (package.json's "lint:ratchet" script, wired into backend-ci.yml's lint-command).
 *
 *   update   Regenerates the baseline file from the current lint state. NEVER invoked by "verify",
 *            by "lint"/"lint:ci", by CI, or by any automatic hook — a developer runs this
 *            explicitly and by name ("lint:baseline:update"), and the resulting diff to
 *            .eslint-baseline.json is then reviewed like any other change (see CODEOWNERS' entry
 *            for that path). This is a privileged maintenance operation, not a routine one.
 *
 * Usage:
 *   tsx scripts/lint-ratchet.ts verify [--base-ref=<git-ref>]
 *   tsx scripts/lint-ratchet.ts update
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  loadBaseline,
  writeBaseline,
  BaselineParseError,
} from './lint-ratchet/baseline';
import { compareAgainstBaseline } from './lint-ratchet/compare';
import { runEslint } from './lint-ratchet/eslint-runner';
import { computeIdentities } from './lint-ratchet/identity';
import { applyRenameMap, detectRenames } from './lint-ratchet/rename';
import type { BaselineFile } from './lint-ratchet/types';

const API_GATEWAY_DIR = resolve(__dirname, '..');
const BASELINE_PATH = resolve(API_GATEWAY_DIR, '.eslint-baseline.json');

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: API_GATEWAY_DIR,
    encoding: 'utf8',
  }).trim();
}

export async function verify(baseRef?: string): Promise<void> {
  const root = repoRoot();
  const files = await runEslint(API_GATEWAY_DIR, root);
  const currentIdentities = computeIdentities(files);

  let baseline: BaselineFile;
  try {
    baseline = loadBaseline(BASELINE_PATH);
  } catch (error) {
    // Fail-safe: a missing/malformed baseline is a hard failure, never treated as "no baseline,
    // so allow everything" — that would silently defeat the entire ratchet.
    console.error('ESLint ratchet: FAIL — baseline could not be loaded.');
    console.error(
      error instanceof BaselineParseError ? error.message : String(error),
    );
    process.exitCode = 1;
    return;
  }

  let baselineEntries = baseline.entries;
  if (baseRef) {
    const renameMap = detectRenames(API_GATEWAY_DIR, baseRef);
    if (renameMap.size > 0) {
      baselineEntries = applyRenameMap(baselineEntries, renameMap);
      console.log(
        `ESLint ratchet: applied ${renameMap.size} high-confidence detected file rename(s) before comparison.`,
      );
    }
  }

  const { newIdentities, removedIdentities } = compareAgainstBaseline(
    currentIdentities,
    baselineEntries,
  );

  if (removedIdentities.length > 0) {
    console.log(
      `ESLint ratchet: ${removedIdentities.length} previously-baselined diagnostic(s) no longer present (fixed). Run "pnpm run lint:baseline:update" and review the diff to shrink the baseline.`,
    );
  }

  if (newIdentities.length > 0) {
    console.error(
      `ESLint ratchet: FAIL — ${newIdentities.length} diagnostic(s) not present in the committed baseline:`,
    );
    for (const id of newIdentities) {
      console.error(
        `  ${id.file} :: ${id.rule} :: "${id.text}" (occurrence ${id.occurrence})`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `ESLint ratchet: PASS — 0 new diagnostics (${currentIdentities.length} pre-existing diagnostic(s), all within the committed baseline).`,
  );
}

export async function update(): Promise<void> {
  const root = repoRoot();
  const files = await runEslint(API_GATEWAY_DIR, root);
  const currentIdentities = computeIdentities(files);

  writeBaseline(BASELINE_PATH, currentIdentities);

  console.log(
    `ESLint ratchet: baseline regenerated with ${currentIdentities.length} entries.`,
  );
  console.log(
    'This is a privileged maintenance operation. Review the resulting diff to .eslint-baseline.json before committing: ' +
      'a shrinking diff (removed entries) represents remediation and is expected; a growing diff (added entries) ' +
      'represents new debt being explicitly grandfathered in and must be justified in review.',
  );
}

// Guarded so importing this module (e.g. from lint-ratchet.test.ts, to unit-test `verify`/`update`
// directly) never triggers a real run against process.argv — only executing this file directly
// (`tsx scripts/lint-ratchet.ts ...`) does. `require.main === module` is the standard CommonJS
// "is this the entry file" check (this file compiles to CommonJS — see tsconfig's `module:
// nodenext` with no package.json "type" override).
if (require.main === module) {
  const [, , command, ...rest] = process.argv;
  const baseRefArg = rest
    .find((arg) => arg.startsWith('--base-ref='))
    ?.split('=')[1];

  if (command === 'verify') {
    verify(baseRefArg).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else if (command === 'update') {
    update().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    console.error(
      'Usage: tsx scripts/lint-ratchet.ts <verify|update> [--base-ref=<git-ref>]',
    );
    process.exitCode = 1;
  }
}
