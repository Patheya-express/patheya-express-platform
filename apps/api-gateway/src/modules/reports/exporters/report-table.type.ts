/**
 * The single generic tabular shape every report type maps into — the three exporters below
 * (CSV/Excel/PDF) each know how to render exactly this shape, so adding a new report type only
 * ever means writing one aggregation query + one row mapper, never a new exporter.
 */
export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportSummaryEntry {
  label: string;
  value: string | number;
}

export interface ReportTable {
  title: string;
  generatedAt: Date;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary?: ReportSummaryEntry[];
}
