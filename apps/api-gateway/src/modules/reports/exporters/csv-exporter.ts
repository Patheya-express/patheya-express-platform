import { ReportTable } from './report-table.type';

// Leading BOM so Excel (which otherwise guesses ANSI) opens UTF-8 CSVs with non-ASCII currency
// symbols intact. Written as a \u escape rather than a literal character in the source so it
// isn't flagged as irregular/invisible whitespace by the linter.
const BOM = '﻿';

function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // Quote any value containing a comma, quote, or newline, per RFC 4180 — doubling embedded
  // quotes is the standard escape, not a backslash.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function toCsv(table: ReportTable): Buffer {
  const lines: string[] = [];

  lines.push(
    table.columns.map((column) => escapeCsvValue(column.label)).join(','),
  );

  for (const row of table.rows) {
    lines.push(
      table.columns.map((column) => escapeCsvValue(row[column.key])).join(','),
    );
  }

  if (table.summary && table.summary.length > 0) {
    lines.push('');
    for (const entry of table.summary) {
      lines.push(
        `${escapeCsvValue(entry.label)},${escapeCsvValue(entry.value)}`,
      );
    }
  }

  return Buffer.from(BOM + lines.join('\r\n'), 'utf-8');
}
