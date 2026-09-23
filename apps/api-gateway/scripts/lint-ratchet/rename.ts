import { execFileSync } from 'node:child_process';

import type { DiagnosticIdentity } from './types';

/** Below this similarity percentage, git's own rename detection is treated as too uncertain to
 *  trust automatically — git's own `-M` default threshold is 50%; this module deliberately
 *  requires a much higher bar (90%) before remapping a baseline path, per the fail-safe principle:
 *  an uncertain rename must fall through to being treated as a new file (a safe false positive
 *  requiring one explicit baseline update), never silently matched to the wrong prior history. */
const MIN_RENAME_SIMILARITY = 90;

/**
 * Best-effort only — this is explicitly NOT the primary correctness mechanism (that's the identity
 * comparison in compare.ts). If `git` is unavailable, `fromRef` doesn't resolve, or anything else
 * goes wrong, this fails safe by returning an empty map: no remapping is applied, and any baseline
 * entry for a genuinely-renamed file will be reported as "new" at the new path — a false positive
 * requiring an explicit, reviewed baseline update, never a false negative that silently drops a
 * pre-existing violation's protection.
 */
export function detectRenames(
  cwd: string,
  fromRef: string,
  toRef = 'HEAD',
): Map<string, string> {
  const renameMap = new Map<string, string>();

  let output: string;
  try {
    output = execFileSync(
      'git',
      ['diff', '--name-status', '-M', fromRef, toRef],
      {
        cwd,
        encoding: 'utf8',
      },
    );
  } catch {
    return renameMap;
  }

  for (const line of output.split('\n')) {
    const match = /^R(\d+)\t(.+)\t(.+)$/.exec(line);
    if (!match) continue;

    const [, similarity, oldPath, newPath] = match;
    if (Number(similarity) >= MIN_RENAME_SIMILARITY) {
      renameMap.set(oldPath, newPath);
    }
  }

  return renameMap;
}

export function applyRenameMap(
  entries: DiagnosticIdentity[],
  renameMap: Map<string, string>,
): DiagnosticIdentity[] {
  if (renameMap.size === 0) return entries;

  return entries.map((entry) =>
    renameMap.has(entry.file)
      ? { ...entry, file: renameMap.get(entry.file)! }
      : entry,
  );
}
