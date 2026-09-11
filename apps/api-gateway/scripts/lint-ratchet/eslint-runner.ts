import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { ESLint } from 'eslint';

import type { RawFileResult } from './identity';

/**
 * The EXACT literal string from the CLI's existing `lint:ci` script (package.json: `eslint
 * "{src,apps,libs,test}/**\/*.ts" --max-warnings=0`) — passed to `lintFiles()` unmodified, not
 * decomposed into separate patterns. This matters: ESLint's own glob engine treats a single
 * `{a,b,c,d}/**` pattern as matched as long as ANY branch matches (which `src`/`test` always do),
 * but if this were instead passed as 4 separate array elements, `apps/**\/*.ts` and `libs/**\/*.ts`
 * (which don't exist under apps/api-gateway) would each independently trigger ESLint 9's
 * `errorOnUnmatchedPattern` default and throw — confirmed empirically while building this module.
 * Passing the literal original string is what actually preserves the existing scope byte-for-byte.
 */
const LINT_PATTERN = '{src,apps,libs,test}/**/*.ts';

/**
 * Runs ESLint via its own Node API (`ESLint#lintFiles`) against the project's existing flat config
 * (`eslint.config.mjs`, auto-discovered from `eslintCwd`) — no new dependency, no shelling out to
 * the `eslint` CLI, and no change to which rules run or which files are in scope.
 *
 * `filePath` on every returned result is repository-root-relative and forward-slash-normalized
 * (computed via `pathRoot`, not `eslintCwd` — the two differ: ESLint itself must run from
 * apps/api-gateway so its config/tsconfig auto-discovery works, but the baseline's stated
 * requirement is repository-relative paths, i.e. relative to the repo root).
 */
export async function runEslint(
  eslintCwd: string,
  pathRoot: string,
): Promise<RawFileResult[]> {
  const eslint = new ESLint({ cwd: eslintCwd });
  return runWithInstance(eslint, pathRoot);
}

/**
 * Same as `runEslint`, but for an ESLint instance already constructed by the caller — used only by
 * lint-ratchet.test.ts to exercise a real lint run against a throwaway fixture directory using an
 * inline `overrideConfig` (a fixture placed outside apps/api-gateway/node_modules can't resolve
 * its own eslint.config.mjs's imports, since Node's module resolution walks up from the fixture's
 * own location, not from this package's node_modules) — never used by the production verify/update
 * path, which always relies on config-file auto-discovery to stay faithful to the real project.
 */
export async function runEslintWithConfig(
  eslintCwd: string,
  pathRoot: string,
  overrideConfig: NonNullable<
    ConstructorParameters<typeof ESLint>[0]
  >['overrideConfig'],
): Promise<RawFileResult[]> {
  const eslint = new ESLint({
    cwd: eslintCwd,
    overrideConfigFile: true,
    overrideConfig,
  });
  return runWithInstance(eslint, pathRoot);
}

async function runWithInstance(
  eslint: ESLint,
  pathRoot: string,
): Promise<RawFileResult[]> {
  const results = await eslint.lintFiles(LINT_PATTERN);

  return results.map((result) => {
    const filePath = relative(pathRoot, result.filePath).split('\\').join('/');

    // ESLint only populates `source` on a result when it has ≥1 message (to avoid holding every
    // linted file's full text in memory) — falls back to reading the file directly on disk in the
    // rare case a message exists without it, so identity extraction never silently degrades to
    // the `<no-source:...>` placeholder for a file that plainly still exists on disk.
    const source =
      result.source ??
      (result.messages.length > 0
        ? readFileSync(result.filePath, 'utf8')
        : undefined);

    return {
      filePath,
      source,
      messages: result.messages.map((message) => ({
        ruleId: message.ruleId,
        severity: message.severity,
        line: message.line,
        column: message.column,
        endLine: message.endLine,
        endColumn: message.endColumn,
      })),
    };
  });
}
