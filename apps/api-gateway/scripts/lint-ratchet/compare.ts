import { identityKey } from './baseline';
import type { DiagnosticIdentity } from './types';

export interface ComparisonResult {
  /** Present in the current lint run but not in the baseline — CI must fail on any of these. */
  newIdentities: DiagnosticIdentity[];
  /** Present in the baseline but no longer produced by the current lint run — informational only
   *  (never fails CI); reported so a maintainer knows the baseline can be trimmed. */
  removedIdentities: DiagnosticIdentity[];
}

/**
 * Set-based comparison, deliberately NOT a count comparison — this is the exact mechanism that
 * distinguishes "the same N violations, just moved" from "one violation removed and a different
 * one added, net count unchanged." A count comparison cannot tell these apart; a set of individual
 * diagnostic identities always can, because the newly-added identity simply isn't a member of the
 * baseline set regardless of what happened to the total count.
 */
export function compareAgainstBaseline(
  current: DiagnosticIdentity[],
  baseline: DiagnosticIdentity[],
): ComparisonResult {
  const baselineKeys = new Set(baseline.map(identityKey));
  const currentKeys = new Set(current.map(identityKey));

  const newIdentities = current.filter(
    (id) => !baselineKeys.has(identityKey(id)),
  );
  const removedIdentities = baseline.filter(
    (id) => !currentKeys.has(identityKey(id)),
  );

  return { newIdentities, removedIdentities };
}
