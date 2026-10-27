import 'server-only';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@/generated/prisma/client';
import { formatMoney } from '@/lib/money';

/**
 * Branded invoice PDF.
 *
 * Rendered with pdfkit — deterministic, no headless browser, no network. The
 * figures come from the invoice's immutable issued snapshot when one exists,
 * so a regenerated PDF for an issued invoice is byte-for-byte about the same
 * numbers the client was originally sent, even if a later migration changed
 * how totals are displayed elsewhere.
 */

const INK = '#0B1220';
const MUTED = '#51607A';
const SUBTLE = '#76839A';
const BRAND = '#315CFD';
const LINE = '#E3E8F0';
const SURFACE = '#F7F9FC';

const PAGE_MARGIN = 48;

interface InvoiceForPdf {
  invoiceNumber: string;
  status: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  creditedTotal: Prisma.Decimal;
  terms: string | null;
  notes: string | null;
  issuedAt: Date | null;
  clientSnapshotJson: Prisma.JsonValue;
  issuedSnapshotJson: Prisma.JsonValue;
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    addressJson: Prisma.JsonValue;
  };
  lines: {
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    lineSubtotal: Prisma.Decimal;
    lineTax: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }[];
}

interface WorkspaceForPdf {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
}

function addressLines(address: unknown): string[] {
  if (!address || typeof address !== 'object') return [];
  const a = address as Record<string, string | null | undefined>;
  return [
    a.line1,
    a.line2,
    [a.city, a.state].filter(Boolean).join(', '),
    [a.postalCode, a.country].filter(Boolean).join(' '),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export async function renderInvoicePdf({
  invoice,
  workspace,
}: {
  invoice: InvoiceForPdf;
  workspace: WorkspaceForPdf;
}): Promise<Buffer> {
  // Prefer the frozen snapshot so a reissued PDF shows what was actually sent.
  const snapshot = invoice.issuedSnapshotJson as {
    lines?: {
      description: string;
      quantity: string;
      unitPrice: string;
      discountAmount: string;
      taxRate: string;
      lineSubtotal: string;
      lineTax: string;
      lineTotal: string;
    }[];
    subtotal?: string;
    discountTotal?: string;
    taxTotal?: string;
    grandTotal?: string;
  } | null;

  const lines =
    snapshot?.lines ??
    invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      discountAmount: l.discountAmount.toString(),
      taxRate: l.taxRate.toString(),
      lineSubtotal: l.lineSubtotal.toString(),
      lineTax: l.lineTax.toString(),
      lineTotal: l.lineTotal.toString(),
    }));

  const subtotal = snapshot?.subtotal ?? invoice.subtotal.toString();
  const discountTotal = snapshot?.discountTotal ?? invoice.discountTotal.toString();
  const taxTotal = snapshot?.taxTotal ?? invoice.taxTotal.toString();
  const grandTotal = snapshot?.grandTotal ?? invoice.grandTotal.toString();

  const clientSnapshot = invoice.clientSnapshotJson as {
    name?: string;
    email?: string | null;
    taxId?: string | null;
    address?: unknown;
  } | null;

  const billTo = {
    name: clientSnapshot?.name ?? invoice.client.name,
    email: clientSnapshot?.email ?? invoice.client.email,
    taxId: clientSnapshot?.taxId ?? invoice.client.taxId,
    address: clientSnapshot?.address ?? invoice.client.addressJson,
  };

  const money = (value: string) => formatMoney(value, invoice.currency);
  const date = (value: Date) =>
    value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    // Required so the footer pass can switch back to earlier pages and
    // stamp "Page n of m" once the total is known.
    bufferPages: true,
    info: {
      Title: `Invoice ${invoice.invoiceNumber}`,
      Author: workspace.name,
      Subject: `Invoice ${invoice.invoiceNumber} for ${billTo.name}`,
      Creator: 'Nexora OS',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const right = PAGE_MARGIN + contentWidth;

  // ---- Header band -------------------------------------------------------
  doc.rect(0, 0, pageWidth, 4).fill(BRAND);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(workspace.name, PAGE_MARGIN, 56);

  const issuerLines = [
    workspace.addressLine1,
    workspace.addressLine2,
    [workspace.city, workspace.postalCode].filter(Boolean).join(' '),
    workspace.country,
    workspace.email,
    workspace.phone,
    workspace.taxId ? `Tax ID: ${workspace.taxId}` : null,
  ].filter((l): l is string => Boolean(l && l.trim()));

  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  let y = doc.y + 4;
  for (const line of issuerLines) {
    doc.text(line, PAGE_MARGIN, y, { width: contentWidth * 0.45 });
    y = doc.y;
  }

  // Invoice identity, right aligned.
  doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text('INVOICE', PAGE_MARGIN, 52, {
    width: contentWidth,
    align: 'right',
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(BRAND)
    .text(invoice.invoiceNumber, PAGE_MARGIN, 82, { width: contentWidth, align: 'right' });

  const metaTop = 102;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(`Issue date   ${date(invoice.issueDate)}`, PAGE_MARGIN, metaTop, {
    width: contentWidth,
    align: 'right',
  });
  doc.text(`Due date     ${date(invoice.dueDate)}`, PAGE_MARGIN, metaTop + 13, {
    width: contentWidth,
    align: 'right',
  });

  // A draft must be unmistakable on paper.
  if (invoice.status === 'DRAFT') {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#B45309')
      .text('DRAFT — NOT ISSUED', PAGE_MARGIN, metaTop + 28, {
        width: contentWidth,
        align: 'right',
      });
  } else if (invoice.status === 'VOID') {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#D1333F')
      .text('VOID', PAGE_MARGIN, metaTop + 28, { width: contentWidth, align: 'right' });
  }

  // ---- Bill to -----------------------------------------------------------
  const billTop = Math.max(y, metaTop + 48) + 18;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(SUBTLE)
    .text('BILL TO', PAGE_MARGIN, billTop);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(billTo.name, PAGE_MARGIN, billTop + 13);

  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  let billY = doc.y + 2;
  for (const line of [
    ...addressLines(billTo.address),
    billTo.email ?? '',
    billTo.taxId ? `Tax ID: ${billTo.taxId}` : '',
  ].filter(Boolean)) {
    doc.text(line, PAGE_MARGIN, billY, { width: contentWidth * 0.5 });
    billY = doc.y;
  }

  // ---- Line items --------------------------------------------------------
  const tableTop = billY + 24;

  const col = {
    description: PAGE_MARGIN,
    qty: PAGE_MARGIN + contentWidth * 0.46,
    unit: PAGE_MARGIN + contentWidth * 0.58,
    tax: PAGE_MARGIN + contentWidth * 0.74,
    total: PAGE_MARGIN + contentWidth * 0.84,
  };
  const widths = {
    description: contentWidth * 0.44,
    qty: contentWidth * 0.1,
    unit: contentWidth * 0.14,
    tax: contentWidth * 0.08,
    total: contentWidth * 0.16,
  };

  doc.rect(PAGE_MARGIN, tableTop, contentWidth, 22).fill(SURFACE);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(SUBTLE);
  doc.text('DESCRIPTION', col.description + 8, tableTop + 7, { width: widths.description });
  doc.text('QTY', col.qty, tableTop + 7, { width: widths.qty, align: 'right' });
  doc.text('UNIT PRICE', col.unit, tableTop + 7, { width: widths.unit, align: 'right' });
  doc.text('TAX', col.tax, tableTop + 7, { width: widths.tax, align: 'right' });
  doc.text('AMOUNT', col.total, tableTop + 7, { width: widths.total - 8, align: 'right' });

  let rowY = tableTop + 22;

  for (const line of lines) {
    // Measure first so a long description never collides with the next row.
    const descriptionHeight = doc
      .font('Helvetica')
      .fontSize(9.5)
      .heightOfString(line.description, { width: widths.description - 8 });
    const rowHeight = Math.max(descriptionHeight + 12, 26);

    if (rowY + rowHeight > doc.page.height - 150) {
      doc.addPage();
      rowY = PAGE_MARGIN;
    }

    doc
      .moveTo(PAGE_MARGIN, rowY)
      .lineTo(right, rowY)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();

    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text(line.description, col.description + 8, rowY + 7, { width: widths.description - 8 });
    doc.text(trimNumber(line.quantity), col.qty, rowY + 7, {
      width: widths.qty,
      align: 'right',
    });
    doc.text(money(line.unitPrice), col.unit, rowY + 7, { width: widths.unit, align: 'right' });
    doc.text(`${trimNumber(line.taxRate)}%`, col.tax, rowY + 7, {
      width: widths.tax,
      align: 'right',
    });
    doc.font('Helvetica-Bold').text(money(line.lineTotal), col.total, rowY + 7, {
      width: widths.total - 8,
      align: 'right',
    });

    if (Number(line.discountAmount) > 0) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(SUBTLE)
        .text(`Discount ${money(line.discountAmount)}`, col.description + 8, rowY + 7 + descriptionHeight, {
          width: widths.description - 8,
        });
    }

    rowY += rowHeight;
  }

  doc.moveTo(PAGE_MARGIN, rowY).lineTo(right, rowY).strokeColor(LINE).lineWidth(0.5).stroke();

  // ---- Totals ------------------------------------------------------------
  const totalsLeft = PAGE_MARGIN + contentWidth * 0.56;
  const totalsWidth = contentWidth * 0.44;
  let totalsY = rowY + 14;

  function totalRow(label: string, value: string, options?: { bold?: boolean; color?: string }) {
    doc
      .font(options?.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options?.bold ? 11 : 9.5)
      .fillColor(options?.color ?? (options?.bold ? INK : MUTED));
    doc.text(label, totalsLeft, totalsY, { width: totalsWidth * 0.5 });
    doc.text(value, totalsLeft + totalsWidth * 0.5, totalsY, {
      width: totalsWidth * 0.5 - 8,
      align: 'right',
    });
    totalsY += options?.bold ? 20 : 15;
  }

  totalRow('Subtotal', money(subtotal));
  if (Number(discountTotal) > 0) totalRow('Discount', `−${money(discountTotal)}`);
  totalRow('Tax', money(taxTotal));

  doc
    .moveTo(totalsLeft, totalsY + 1)
    .lineTo(right, totalsY + 1)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();
  totalsY += 9;

  totalRow('Total due', money(grandTotal), { bold: true });

  const paid = invoice.amountPaid.toString();
  const credited = invoice.creditedTotal.toString();
  if (Number(paid) > 0 || Number(credited) > 0) {
    if (Number(paid) > 0) totalRow('Paid', `−${money(paid)}`, { color: '#0F9D58' });
    if (Number(credited) > 0) totalRow('Credited', `−${money(credited)}`, { color: '#0F9D58' });
    const balance = Number(grandTotal) - Number(paid) - Number(credited);
    totalRow('Balance', money(Math.max(0, balance).toFixed(4)), { bold: true });
  }

  // ---- Terms and notes ---------------------------------------------------
  let footerY = Math.max(totalsY + 16, rowY + 24);
  if (footerY > doc.page.height - 120) {
    doc.addPage();
    footerY = PAGE_MARGIN;
  }

  for (const [label, body] of [
    ['Terms', invoice.terms],
    ['Notes', invoice.notes],
  ] as const) {
    if (!body) continue;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(SUBTLE).text(label.toUpperCase(), PAGE_MARGIN, footerY);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(body, PAGE_MARGIN, footerY + 12, { width: contentWidth * 0.52 });
    footerY = doc.y + 12;
  }

  // ---- Page footer -------------------------------------------------------
  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    doc.switchToPage(i);
    const footerBase = doc.page.height - 42;
    doc
      .moveTo(PAGE_MARGIN, footerBase - 10)
      .lineTo(right, footerBase - 10)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(SUBTLE)
      .text(
        `${invoice.invoiceNumber} · ${workspace.name}${
          invoice.issuedAt ? ` · issued ${date(invoice.issuedAt)}` : ''
        }`,
        PAGE_MARGIN,
        footerBase,
        { width: contentWidth * 0.7 },
      );
    doc.text(`Page ${i - pageRange.start + 1} of ${pageRange.count}`, PAGE_MARGIN, footerBase, {
      width: contentWidth,
      align: 'right',
    });
  }

  doc.end();
  return finished;
}

/** Render "2.0000" as "2" and "2.5000" as "2.5" for readability. */
function trimNumber(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}
