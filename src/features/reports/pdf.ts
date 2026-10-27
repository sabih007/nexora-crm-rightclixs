import 'server-only';
import PDFDocument from 'pdfkit';

/**
 * Management report PDF.
 *
 * The same sectioned data the CSV export produces, laid out as a document.
 * Both renderers consume one `ReportDocument`, so the two exports cannot
 * disagree about the figures — only about how they are presented.
 *
 * Deliberately plain: no charts. A chart in a static export invites the reader
 * to compare shapes without the conversion disclosures that sit beside the
 * numbers, and those disclosures are the part that must not be lost.
 */

const INK = '#0B1220';
const MUTED = '#51607A';
const SUBTLE = '#76839A';
const BRAND = '#315CFD';
const LINE = '#E3E8F0';
const SURFACE = '#F7F9FC';

const PAGE_MARGIN = 40;

export interface ReportSection {
  title: string;
  /** Printed under the title, before the table. Definitions and caveats. */
  notes?: string[];
  header?: string[];
  rows: (string | number)[][];
  /** Relative column widths; defaults to equal. */
  weights?: number[];
  /** Column indexes to right-align — the numeric ones. */
  numericColumns?: number[];
  /** Shown instead of a table when `rows` is empty. */
  emptyText?: string;
}

export interface ReportDocument {
  title: string;
  subtitle: string;
  meta: [string, string][];
  disclaimer: string;
  sections: ReportSection[];
}

export async function renderReportPdf(report: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: report.title,
      Subject: report.subtitle,
      Creator: 'Nexora OS',
    },
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  // Leave room for the footer rule and its caption.
  const bottomLimit = doc.page.height - PAGE_MARGIN - 26;

  function ensureSpace(needed: number) {
    if (doc.y + needed > bottomLimit) doc.addPage();
  }

  // ---- Header -------------------------------------------------------------
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(INK)
    .text(report.title, PAGE_MARGIN, PAGE_MARGIN);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(report.subtitle);
  doc.moveDown(0.6);

  const metaTop = doc.y;
  doc.font('Helvetica').fontSize(8.5);
  const metaColumnWidth = contentWidth / Math.max(report.meta.length, 1);
  report.meta.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * metaColumnWidth;
    doc.fillColor(SUBTLE).text(label.toUpperCase(), x, metaTop, { width: metaColumnWidth - 8 });
    doc
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(value, x, metaTop + 11, { width: metaColumnWidth - 8 });
    doc.font('Helvetica');
  });
  doc.y = metaTop + 28;

  doc.rect(PAGE_MARGIN, doc.y, contentWidth, 20).fillColor(SURFACE).fill();
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor(MUTED)
    .text(report.disclaimer, PAGE_MARGIN + 8, doc.y + 6, { width: contentWidth - 16 });
  doc.y += 14;
  doc.moveDown(1);

  // ---- Sections -----------------------------------------------------------
  for (const section of report.sections) {
    ensureSpace(60);

    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(BRAND)
      .text(section.title.toUpperCase(), PAGE_MARGIN, doc.y, { width: contentWidth });
    doc.moveDown(0.3);

    for (const note of section.notes ?? []) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(SUBTLE)
        .text(note, PAGE_MARGIN, doc.y, { width: contentWidth });
    }
    doc.moveDown(0.3);

    if (section.rows.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(section.emptyText ?? 'No records in this period.', PAGE_MARGIN, doc.y, {
          width: contentWidth,
        });
      doc.moveDown(1.2);
      continue;
    }

    const columnCount = Math.max(
      section.header?.length ?? 0,
      ...section.rows.map((row) => row.length),
    );
    const weights =
      section.weights && section.weights.length === columnCount
        ? section.weights
        : Array.from({ length: columnCount }, () => 1);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight) => (weight / weightTotal) * contentWidth);
    const offsets = widths.map((_, index) =>
      widths.slice(0, index).reduce((sum, width) => sum + width, PAGE_MARGIN),
    );
    const numeric = new Set(section.numericColumns ?? []);

    const drawHeader = () => {
      if (!section.header) return;
      const top = doc.y;
      doc.rect(PAGE_MARGIN, top, contentWidth, 16).fillColor(SURFACE).fill();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      section.header.forEach((label, index) => {
        doc.text(label.toUpperCase(), (offsets[index] ?? PAGE_MARGIN) + 4, top + 5, {
          width: (widths[index] ?? contentWidth) - 8,
          align: numeric.has(index) ? 'right' : 'left',
          lineBreak: false,
        });
      });
      doc.y = top + 18;
    };

    drawHeader();

    for (const row of section.rows) {
      // Measure the tallest cell so wrapped text cannot overlap the next row.
      doc.font('Helvetica').fontSize(8);
      const rowHeight = Math.max(
        12,
        ...row.map((cell, index) =>
          doc.heightOfString(String(cell ?? ''), { width: (widths[index] ?? contentWidth) - 8 }),
        ),
      );

      if (doc.y + rowHeight + 4 > bottomLimit) {
        doc.addPage();
        drawHeader();
      }

      const top = doc.y;
      row.forEach((cell, index) => {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(INK)
          .text(String(cell ?? ''), (offsets[index] ?? PAGE_MARGIN) + 4, top + 2, {
            width: (widths[index] ?? contentWidth) - 8,
            align: numeric.has(index) ? 'right' : 'left',
          });
      });
      doc.y = top + rowHeight + 4;
      doc
        .moveTo(PAGE_MARGIN, doc.y - 2)
        .lineTo(PAGE_MARGIN + contentWidth, doc.y - 2)
        .strokeColor(LINE)
        .lineWidth(0.4)
        .stroke();
    }

    doc.moveDown(1.2);
  }

  // ---- Footers ------------------------------------------------------------
  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    doc.switchToPage(i);
    const footerBase = doc.page.height - PAGE_MARGIN + 4;
    doc
      .moveTo(PAGE_MARGIN, footerBase - 8)
      .lineTo(doc.page.width - PAGE_MARGIN, footerBase - 8)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(SUBTLE)
      .text(report.subtitle, PAGE_MARGIN, footerBase, {
        width: contentWidth * 0.7,
        lineBreak: false,
      });
    doc.text(`Page ${i - pageRange.start + 1} of ${pageRange.count}`, PAGE_MARGIN, footerBase, {
      width: contentWidth,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return finished;
}

/** Flatten a report document into the row grid the CSV writer expects. */
export function reportToCsvRows(report: ReportDocument): unknown[][] {
  const rows: unknown[][] = [[report.title], [report.subtitle]];
  for (const [label, value] of report.meta) rows.push([label, value]);
  rows.push(['Note', report.disclaimer]);
  rows.push([]);

  for (const section of report.sections) {
    rows.push([section.title.toUpperCase()]);
    for (const note of section.notes ?? []) rows.push(['Note', note]);
    if (section.header) rows.push(section.header);
    if (section.rows.length === 0) {
      rows.push([section.emptyText ?? 'No records in this period.']);
    } else {
      for (const row of section.rows) rows.push(row);
    }
    rows.push([]);
  }

  return rows;
}
