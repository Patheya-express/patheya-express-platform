import PDFDocument from 'pdfkit';

import { ReportTable } from './report-table.type';

const ROW_HEIGHT = 16;
const HEADER_FONT_SIZE = 9;
const BODY_FONT_SIZE = 8;

/**
 * pdfkit has no built-in table widget, so columns/rows/pagination are laid out manually here —
 * the one place in this module that needs it, since CSV/Excel both have native tabular support.
 */
export function toPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    const colWidth = contentWidth / table.columns.length;

    doc.fontSize(16).fillColor('#000').text(table.title, left, doc.y);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Generated ${table.generatedAt.toLocaleString()}`);
    doc.moveDown();

    let y = doc.y;

    const drawHeader = () => {
      doc.fontSize(HEADER_FONT_SIZE).fillColor('#000').font('Helvetica-Bold');
      table.columns.forEach((column, i) => {
        doc.text(column.label, left + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
        });
      });
      y += ROW_HEIGHT;
      doc
        .moveTo(left, y)
        .lineTo(left + contentWidth, y)
        .strokeColor('#ccc')
        .stroke();
      y += 4;
      doc.font('Helvetica').fontSize(BODY_FONT_SIZE);
    };

    const ensureSpace = () => {
      if (y > bottomLimit - ROW_HEIGHT) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
    };

    drawHeader();

    for (const row of table.rows) {
      ensureSpace();
      table.columns.forEach((column, i) => {
        const value = row[column.key];
        doc.text(
          value === null || value === undefined ? '' : String(value),
          left + i * colWidth,
          y,
          {
            width: colWidth - 4,
            ellipsis: true,
          },
        );
      });
      y += ROW_HEIGHT;
    }

    if (table.summary && table.summary.length > 0) {
      y += 10;
      doc.fontSize(10).font('Helvetica-Bold');
      for (const entry of table.summary) {
        if (y > bottomLimit - ROW_HEIGHT) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        doc.text(`${entry.label}: ${entry.value}`, left, y);
        y += ROW_HEIGHT;
      }
    }

    doc.end();
  });
}
