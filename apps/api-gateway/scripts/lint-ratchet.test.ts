/**
 * ESLint debt ratchet — test suite. Run via `pnpm --filter api-gateway run test:lint-ratchet`
 * (`tsx --test`, Node's built-in test runner — no new dependency).
 *
 * Deliberately does not use the project's Jest setup: Jest's config (apps/api-gateway/package.json
 * "jest".rootDir = "src") only discovers specs under src/, and this module intentionally lives
 * under scripts/ (matching the existing docs:export/db:seed/deploy:smoke-test convention of
 * CLI tooling living outside src/). Node's built-in test runner needs no config change to reach it.
 */
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, describe } from 'node:test';

import eslintJs from '@eslint/js';
import tseslint from 'typescript-eslint';

import {
  loadBaseline,
  parseBaseline,
  serializeBaseline,
  BaselineParseError,
} from './lint-ratchet/baseline';
import { compareAgainstBaseline } from './lint-ratchet/compare';
import { runEslintWithConfig } from './lint-ratchet/eslint-runner';
import {
  computeIdentities,
  extractText,
  type RawFileResult,
} from './lint-ratchet/identity';
import { applyRenameMap, detectRenames } from './lint-ratchet/rename';
import type { DiagnosticIdentity } from './lint-ratchet/types';

function file(
  filePath: string,
  source: string,
  messages: RawFileResult['messages'],
): RawFileResult {
  return { filePath, source, messages };
}

void describe('identity.extractText', () => {
  void test('extracts and normalizes a single-line range', () => {
    const source = 'const y = req.body.foo;\n';
    // "req.body.foo" starts at column 11 (1-based), ends at column 23 (exclusive end per ESLint's
    // own convention: endColumn is one past the last character).
    const text = extractText(source, {
      ruleId: 'x',
      severity: 2,
      line: 1,
      column: 11,
      endLine: 1,
      endColumn: 23,
    });
    assert.equal(text, 'req.body.foo');
  });

  void test('extracts and normalizes a multi-line range', () => {
    const source = 'const y =\n  req.body\n    .foo;\n';
    const text = extractText(source, {
      ruleId: 'x',
      severity: 2,
      line: 2,
      column: 3,
      endLine: 3,
      endColumn: 9,
    });
    assert.equal(text, 'req.body .foo');
  });
});

void describe('identity.computeIdentities + compare.compareAgainstBaseline', () => {
  // --- Step 12 requirement 1: unchanged baseline passes ---
  void test('1. unchanged input produces zero new diagnostics against its own baseline', () => {
    const files = [
      file('src/a.ts', 'const y = req.body.foo;\n', [
        {
          ruleId: 'no-unsafe-member-access',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ];
    const identities = computeIdentities(files);
    const { newIdentities, removedIdentities } = compareAgainstBaseline(
      identities,
      identities,
    );
    assert.equal(newIdentities.length, 0);
    assert.equal(removedIdentities.length, 0);
  });

  // --- Step 12 requirement 2 / ESLint-1 §5.B: violation moved within the file ---
  void test('2. same violation reported at a different line/column (unrelated insertion above it) is NOT new', () => {
    const baselineFiles = [
      file('src/a.ts', 'const y = req.body.foo;\n', [
        {
          ruleId: 'no-unsafe-member-access',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ];
    const baseline = computeIdentities(baselineFiles);

    // Two blank lines inserted above — same violating expression, now at line 3.
    const currentFiles = [
      file('src/a.ts', '\n\nconst y = req.body.foo;\n', [
        {
          ruleId: 'no-unsafe-member-access',
          severity: 2,
          line: 3,
          column: 11,
          endLine: 3,
          endColumn: 23,
        },
      ]),
    ];
    const current = computeIdentities(currentFiles);

    const { newIdentities } = compareAgainstBaseline(current, baseline);
    assert.equal(newIdentities.length, 0);
  });

  // --- Step 12 requirement 3: violation removed passes (and is reported as removed) ---
  void test('3. a baselined violation that no longer appears passes and is reported removed', () => {
    const baseline = computeIdentities([
      file('src/a.ts', 'const y = req.body.foo;\nconst z = req.body.bar;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
        {
          ruleId: 'R',
          severity: 2,
          line: 2,
          column: 11,
          endLine: 2,
          endColumn: 23,
        },
      ]),
    ]);
    const current = computeIdentities([
      file('src/a.ts', 'const z = req.body.bar;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ]);
    const { newIdentities, removedIdentities } = compareAgainstBaseline(
      current,
      baseline,
    );
    assert.equal(newIdentities.length, 0);
    assert.equal(removedIdentities.length, 1);
    assert.equal(removedIdentities[0].text, 'req.body.foo');
  });

  // --- Step 12 requirement 4: genuinely new violation fails ---
  void test('4. a genuinely new violation is detected as new', () => {
    const baseline = computeIdentities([
      file('src/a.ts', 'const y = req.body.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ]);
    const current = computeIdentities([
      file('src/a.ts', 'const y = req.body.foo;\nconst z = res.body.bar;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
        {
          ruleId: 'R',
          severity: 2,
          line: 2,
          column: 11,
          endLine: 2,
          endColumn: 23,
        },
      ]),
    ]);
    const { newIdentities } = compareAgainstBaseline(current, baseline);
    assert.equal(newIdentities.length, 1);
    assert.equal(newIdentities[0].text, 'res.body.bar');
  });

  // --- Step 12 requirement 5 / THE central regression: remove-one add-one, same total count ---
  void test('5. removing one violation while adding a different one (net count unchanged) still fails', () => {
    const baseline = computeIdentities([
      file('src/a.ts', 'const y = req.body.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ]);
    // Same file, same rule, count still exactly 1 — but a DIFFERENT expression is now flagged.
    const current = computeIdentities([
      file('src/a.ts', 'const y = res.body.bar;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 23,
        },
      ]),
    ]);
    assert.equal(
      baseline.length,
      current.length,
      'counts must be identical for this to be a real test of the regression',
    );
    const { newIdentities, removedIdentities } = compareAgainstBaseline(
      current,
      baseline,
    );
    assert.equal(
      newIdentities.length,
      1,
      'a per-file/per-rule COUNT-only baseline would have missed this — identity comparison must not',
    );
    assert.equal(removedIdentities.length, 1);
  });

  // --- Step 12 requirement 6: duplicate identical diagnostics are distinguishable ---
  void test('6. two byte-identical diagnostics in the same file get distinct occurrence ordinals', () => {
    const identities = computeIdentities([
      file('src/a.ts', 'const a = x.foo;\nconst b = x.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 16,
        },
        {
          ruleId: 'R',
          severity: 2,
          line: 2,
          column: 11,
          endLine: 2,
          endColumn: 16,
        },
      ]),
    ]);
    assert.equal(identities.length, 2);
    assert.equal(identities[0].text, 'x.foo');
    assert.equal(identities[1].text, 'x.foo');
    assert.notEqual(identities[0].occurrence, identities[1].occurrence);
    assert.deepEqual(
      new Set(identities.map((i) => i.occurrence)),
      new Set([0, 1]),
    );
  });

  // --- Step 12 requirement 6 (companion): reordering identical duplicates is a no-op for the set ---
  void test('6b. swapping which physical instance is "first" does not change the identity SET', () => {
    const baseline = computeIdentities([
      file('src/a.ts', 'const a = x.foo;\nconst b = x.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 16,
        },
        {
          ruleId: 'R',
          severity: 2,
          line: 2,
          column: 11,
          endLine: 2,
          endColumn: 16,
        },
      ]),
    ]);
    // Same two identical violations, order swapped (e.g. the two statements were reordered).
    const current = computeIdentities([
      file('src/a.ts', 'const b = x.foo;\nconst a = x.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 16,
        },
        {
          ruleId: 'R',
          severity: 2,
          line: 2,
          column: 11,
          endLine: 2,
          endColumn: 16,
        },
      ]),
    ]);
    const { newIdentities, removedIdentities } = compareAgainstBaseline(
      current,
      baseline,
    );
    assert.equal(newIdentities.length, 0);
    assert.equal(removedIdentities.length, 0);
  });
});

// --- Step 12 requirement 7: rename behavior ---
void describe('rename', () => {
  void test('7a. applyRenameMap remaps only entries whose file matches the map', () => {
    const entries: DiagnosticIdentity[] = [
      { file: 'src/old-name.ts', rule: 'R', text: 'x.foo', occurrence: 0 },
      { file: 'src/untouched.ts', rule: 'R', text: 'y.bar', occurrence: 0 },
    ];
    const remapped = applyRenameMap(
      entries,
      new Map([['src/old-name.ts', 'src/new-name.ts']]),
    );
    assert.equal(remapped[0].file, 'src/new-name.ts');
    assert.equal(remapped[1].file, 'src/untouched.ts');
  });

  void test('7b. detectRenames fails safe (returns an empty map, does not throw) when the ref cannot be resolved', () => {
    const renameMap = detectRenames(
      process.cwd(),
      'this-ref-does-not-exist-0000000',
    );
    assert.equal(renameMap.size, 0);
  });
});

// --- Step 12 requirement 8: malformed baseline fails safely ---
void describe('baseline parsing — fail-safe behavior', () => {
  void test('8a. invalid JSON throws BaselineParseError, not a silently-empty baseline', () => {
    assert.throws(() => parseBaseline('{ not valid json'), BaselineParseError);
  });

  void test('8b. valid JSON with the wrong shape throws BaselineParseError', () => {
    assert.throws(
      () => parseBaseline('{"version": 1, "entries": "not-an-array"}'),
      BaselineParseError,
    );
    assert.throws(
      () => parseBaseline('{"version": 2, "entries": []}'),
      BaselineParseError,
    );
    assert.throws(
      () => parseBaseline('{"version": 1, "entries": [{"file": "a.ts"}]}'),
      BaselineParseError,
    );
  });

  void test('8c. loadBaseline throws (does not default to empty) for a missing file', () => {
    assert.throws(
      () =>
        loadBaseline(
          join(tmpdir(), 'this-file-does-not-exist-eslint-baseline.json'),
        ),
      BaselineParseError,
    );
  });

  // --- Step 12 requirement 9: empty baseline works, and correctly blocks everything ---
  void test('9. an empty (but well-formed) baseline is valid and blocks every current diagnostic', () => {
    const parsed = parseBaseline('{"version": 1, "entries": []}');
    assert.deepEqual(parsed.entries, []);

    const current = computeIdentities([
      file('src/a.ts', 'const y = x.foo;\n', [
        {
          ruleId: 'R',
          severity: 2,
          line: 1,
          column: 11,
          endLine: 1,
          endColumn: 16,
        },
      ]),
    ]);
    const { newIdentities } = compareAgainstBaseline(current, parsed.entries);
    assert.equal(newIdentities.length, 1);
  });
});

// --- Step 12 requirement 10: zero-findings state works ---
void describe('zero-findings state', () => {
  void test('10. no messages anywhere produces zero identities and always passes regardless of baseline', () => {
    const identities = computeIdentities([
      file('src/a.ts', 'const y = 1;\n', []),
    ]);
    assert.deepEqual(identities, []);

    const { newIdentities } = compareAgainstBaseline(identities, [
      { file: 'src/other.ts', rule: 'R', text: 'z.q', occurrence: 0 },
    ]);
    assert.equal(newIdentities.length, 0);
  });
});

// --- Step 12 requirement 11: deterministic baseline ordering ---
void describe('serializeBaseline determinism', () => {
  void test('11. output is stable regardless of input order, and stable across repeated calls', () => {
    const a: DiagnosticIdentity = {
      file: 'src/b.ts',
      rule: 'R2',
      text: 'a',
      occurrence: 0,
    };
    const b: DiagnosticIdentity = {
      file: 'src/a.ts',
      rule: 'R1',
      text: 'z',
      occurrence: 1,
    };
    const c: DiagnosticIdentity = {
      file: 'src/a.ts',
      rule: 'R1',
      text: 'z',
      occurrence: 0,
    };

    const serialized1 = serializeBaseline([a, b, c]);
    const serialized2 = serializeBaseline([c, b, a]); // same entries, different input order
    const serialized3 = serializeBaseline([a, b, c]); // same order as the first call, again

    assert.equal(
      serialized1,
      serialized2,
      'input order must not affect output',
    );
    assert.equal(
      serialized1,
      serialized3,
      'repeated calls on identical input must be byte-identical',
    );
    assert.match(serialized1, /\n$/);
  });
});

// --- Step 12 requirement 12: verify() must never write the baseline ---
void describe('architectural invariant: verify never writes', () => {
  void test('12. the verify() function body contains no call to writeBaseline (static source check)', () => {
    const cliSource = readFileSync(join(__dirname, 'lint-ratchet.ts'), 'utf8');

    const verifyStart = cliSource.indexOf('export async function verify(');
    const updateStart = cliSource.indexOf('export async function update(');
    assert.ok(
      verifyStart >= 0 && updateStart > verifyStart,
      'expected to locate verify() before update() in lint-ratchet.ts',
    );

    const verifyBody = cliSource.slice(verifyStart, updateStart);
    assert.doesNotMatch(
      verifyBody,
      /writeBaseline\s*\(/,
      "verify() must never call writeBaseline — baseline mutation is exclusively update()'s responsibility",
    );

    // Companion check: update() (and only update()) is the one place that does call it, so this
    // test would also fail if writeBaseline's own name were ever renamed without updating either
    // function — a signal that this check itself needs to be revisited.
    const updateBody = cliSource.slice(updateStart);
    assert.match(updateBody, /writeBaseline\s*\(/);
  });
});

// --- Real, end-to-end wiring confidence: an actual ESLint run against a tiny throwaway fixture ---
void describe('eslint-runner (real ESLint invocation, temporary fixture, fully cleaned up)', () => {
  void test('runEslint reports a real type-aware violation with a correctly repo-relative path', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'lint-ratchet-fixture-'));
    try {
      mkdirSync(join(fixtureDir, 'src'));
      writeFileSync(
        join(fixtureDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'commonjs',
            strict: false,
            noImplicitAny: false,
          },
          include: ['**/*.ts'],
        }),
      );
      writeFileSync(
        join(fixtureDir, 'src', 'bad.ts'),
        'function f(x: any): string {\n  return x;\n}\n',
      );

      const fixtureConfig = tseslint.config(
        eslintJs.configs.recommended,
        ...tseslint.configs.recommendedTypeChecked,
        {
          languageOptions: {
            parserOptions: {
              projectService: true,
              tsconfigRootDir: fixtureDir,
            },
          },
        },
      );

      // `typescript-eslint`'s own `ConfigArray` type and `eslint`'s `overrideConfig` parameter type
      // are structurally near-identical (both are flat-config arrays) but declared independently
      // by the two packages, so TS sees them as nominally incompatible — the actual runtime values
      // are exactly what ESLint expects (this fixture already proves that: the test passes and
      // reports a real diagnostic). Asserting through `unknown` reflects a type-declaration
      // mismatch between two third-party packages, not a cast around any logic of this module's own.
      const results = await runEslintWithConfig(
        fixtureDir,
        fixtureDir,
        fixtureConfig as unknown as Parameters<typeof runEslintWithConfig>[2],
      );
      const identities = computeIdentities(results);

      const unsafeReturn = identities.filter(
        (i) => i.rule === '@typescript-eslint/no-unsafe-return',
      );
      assert.ok(
        unsafeReturn.length >= 1,
        'expected the fixture to produce a real no-unsafe-return finding',
      );
      assert.equal(unsafeReturn[0].file, 'src/bad.ts');
      assert.equal(unsafeReturn[0].text, 'return x;');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
