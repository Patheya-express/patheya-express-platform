import ExcelJS from 'exceljs';

import { ReportTable } from './report-table.type';

/** Worksheet names can't exceed 31 characters and can't contain: \ / ? * [ ] */
function toSheetName(title: string): string {
  return title.replace(/[\\/?*[\]]/g, ' ').slice(0, 31);
}

export async function toExcel(table: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Patheya Express';
  workbook.created = table.generatedAt;

  const sheet = workbook.addWorksheet(toSheetName(table.title));

  sheet.columns = table.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(column.label.length + 4, 14),
  }));

  sheet.getRow(1).font = { bold: true };

  for (const row of table.rows) {
    sheet.addRow(row);
  }

  if (table.summary && table.summary.length > 0) {
    sheet.addRow([]);
    for (const entry of table.summary) {
      const summaryRow = sheet.addRow([entry.label, entry.value]);
      summaryRow.font = { bold: true };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
