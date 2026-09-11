/**
 * ESLint debt ratchet (Phase ESLint-1/ESLint-1A) — see apps/api-gateway/.eslint-baseline.json's
 * own header comment (in this module's baseline.ts) for the full design rationale. This file only
 * declares the shared shapes every other module in this directory imports.
 */

/**
 * Identifies one individual ESLint diagnostic in a way that survives unrelated edits elsewhere in
 * the file (no line/column in the identity — those shift on any edit above the violation) while
 * still changing when the violation itself is actually edited or removed.
 *
 * `occurrence` disambiguates multiple diagnostics that share the same (file, rule, text) —
 * assigned by position order (top-to-bottom) among just that group, not a global index.
 */
export interface DiagnosticIdentity {
  file: string;
  rule: string;
  text: string;
  occurrence: number;
}

export interface BaselineFile {
  version: 1;
  entries: DiagnosticIdentity[];
}
