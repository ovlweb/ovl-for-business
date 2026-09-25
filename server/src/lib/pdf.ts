import { formatAmount } from '@ovl/shared';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

/**
 * Printable documents (statements, certificates). The fonts are bundled so names in any Latin,
 * Cyrillic or Greek script render the same everywhere.
 */
type Pdf = PDFKit.PDFDocument;

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = [
  resolve(process.cwd(), 'assets/fonts'),
  resolve(here, '../assets/fonts'), // dist/index.js
  resolve(here, '../../assets/fonts'), // src/lib/pdf.ts
].find((dir) => existsSync(join(dir, 'LiberationSans-Regular.ttf')));

const INK = '#0F172A';
const TEXT = '#334155';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const SOFT = '#F1F5F9';
const FROM = '#2563EB';
const TO = '#7C3AED';
const GOOD = '#047857';
const BAD = '#B91C1C';

function newPdf(info: { title: string; subject?: string; layout?: 'portrait' | 'landscape' }): Pdf {
  if (!FONT_DIR) throw new Error('PDF fonts are missing (assets/fonts)');
  const regular = join(FONT_DIR, 'LiberationSans-Regular.ttf');
  const doc = new PDFDocument({
    size: 'A4',
    layout: info.layout ?? 'portrait',
    margin: 48,
    bufferPages: true,
    font: regular,
    info: {
      Title: info.title,
      Subject: info.subject,
      Author: 'OVL For Business',
      Creator: 'OVL For Business',
    },
  });
  doc.registerFont('Sans', regular);
  doc.registerFont('Bold', join(FONT_DIR, 'LiberationSans-Bold.ttf'));
  return doc.font('Sans');
}

function finish(doc: Pdf): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => done(Buffer.concat(chunks)));
    doc.on('error', fail);
    doc.end();
  });
}

/** The OVL mark: an orbit around a core on the brand gradient. */
function mark(doc: Pdf, x: number, y: number, size: number) {
  const s = size / 64;
  const gradient = doc
    .linearGradient(x, y, x + size, y + size)
    .stop(0, FROM)
    .stop(1, TO);
  doc.roundedRect(x, y, size, size, 18 * s).fill(gradient);
  doc
    .lineWidth(5 * s)
    .ellipse(x + 32 * s, y + 32 * s, 19 * s, 13 * s)
    .stroke('#FFFFFF');
  doc.circle(x + 32 * s, y + 32 * s, 5 * s).fill('#FFFFFF');
}

function brand(doc: Pdf, x: number, y: number) {
  mark(doc, x, y, 30);
  doc
    .font('Bold')
    .fontSize(13)
    .fillColor(INK)
    .text('OVL For Business', x + 40, y + 3, { lineBreak: false });
  doc
    .font('Sans')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('Personal and corporate accounts', x + 40, y + 19, { lineBreak: false });
}

/** "1234567.8" → "1,234,567.80"-style grouping of what formatAmount returns. */
export function groupAmount(amount: bigint, currency: string, sign = false): string {
  const [whole, fraction] = formatAmount(amount < 0n ? -amount : amount, currency).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = amount < 0n ? '−' : sign && amount > 0n ? '+' : '';
  return `${prefix}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
export const pdfDate = (d: Date | string) =>
  dateFormat.format(typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : d);

const humanize = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');

/** Page numbers and a line of small print on every page (call once everything is drawn). */
function footer(doc: Pdf, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 30;
    doc
      .font('Sans')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(text, doc.page.margins.left, y, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface StatementData {
  owner: { name: string; handle: string; type: 'user' | 'organization' };
  currency: string;
  from: string | null;
  to: string | null;
  opening: bigint;
  closing: bigint;
  moneyIn: bigint;
  moneyOut: bigint;
  entries: {
    id: number;
    createdAt: Date;
    kind: string;
    description: string;
    amount: bigint;
    balanceAfter: bigint;
  }[];
  truncated: boolean;
  generatedAt: Date;
}

export async function statementPdf(data: StatementData): Promise<Buffer> {
  const period =
    data.from && data.to
      ? `${pdfDate(data.from)} – ${pdfDate(data.to)}`
      : data.from
        ? `Since ${pdfDate(data.from)}`
        : data.to
          ? `Until ${pdfDate(data.to)}`
          : 'All time';
  const doc = newPdf({ title: `Statement ${data.currency} · ${data.owner.name}`, subject: period });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  brand(doc, left, 44);
  doc.font('Bold').fontSize(20).fillColor(INK).text('Account statement', left, 44, { width, align: 'right' });
  doc
    .font('Sans')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${data.currency} balance · ${period}`, left, 70, { width, align: 'right' });

  // Who and when.
  let y = 104;
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.7)
    .stroke(LINE);
  y += 14;
  const col = width / 3;
  const fact = (x: number, label: string, value: string, sub?: string) => {
    doc
      .font('Sans')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, y, { characterSpacing: 0.6 });
    doc
      .font('Bold')
      .fontSize(10.5)
      .fillColor(INK)
      .text(value, x, y + 12, { width: col - 12 });
    if (sub)
      doc
        .font('Sans')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(sub, x, doc.y + 1, { width: col - 12 });
  };
  fact(
    left,
    data.owner.type === 'organization' ? 'Company' : 'Account holder',
    data.owner.name,
    data.owner.handle,
  );
  fact(left + col, 'Period', period, 'Times in UTC');
  fact(
    left + col * 2,
    'Generated',
    `${pdfDate(data.generatedAt)} ${timeFormat.format(data.generatedAt)} UTC`,
  );

  // Summary.
  y += 54;
  const box = (width - 3 * 10) / 4;
  const cells: [string, bigint, string, boolean][] = [
    ['Opening balance', data.opening, INK, false],
    ['Money in', data.moneyIn, GOOD, true],
    ['Money out', -data.moneyOut, BAD, true],
    ['Closing balance', data.closing, INK, false],
  ];
  cells.forEach(([label, value, color, sign], i) => {
    const x = left + i * (box + 10);
    doc.roundedRect(x, y, box, 52, 8).fill(i === 3 ? '#EEF2FF' : SOFT);
    doc
      .font('Sans')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x + 10, y + 10, { width: box - 20, characterSpacing: 0.5 });
    doc
      .font('Bold')
      .fontSize(12.5)
      .fillColor(color)
      .text(`${groupAmount(value, data.currency, sign)} ${data.currency}`, x + 10, y + 26, {
        width: box - 20,
        lineBreak: false,
        ellipsis: true,
      });
  });
  y += 70;

  // Operations.
  const cols = { date: 70, amount: 86, balance: 86 };
  const opWidth = width - cols.date - cols.amount - cols.balance;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const header = () => {
    doc.rect(left, y, width, 20).fill(SOFT);
    doc.font('Bold').fontSize(7.5).fillColor(MUTED);
    doc.text('DATE', left + 8, y + 7, { lineBreak: false });
    doc.text('OPERATION', left + cols.date, y + 7, { lineBreak: false });
    doc.text('AMOUNT', left + cols.date + opWidth, y + 7, { width: cols.amount - 8, align: 'right' });
    doc.text('BALANCE', left + cols.date + opWidth + cols.amount, y + 7, {
      width: cols.balance - 8,
      align: 'right',
    });
    y += 26;
  };
  header();
  if (!data.entries.length) {
    doc
      .font('Sans')
      .fontSize(10)
      .fillColor(MUTED)
      .text('No operations in this period.', left + 8, y + 6);
    y += 30;
  }
  for (const e of data.entries) {
    doc.font('Sans').fontSize(8.5);
    const descHeight = e.description ? doc.heightOfString(e.description, { width: opWidth - 12 }) : 0;
    const rowHeight = Math.max(26, 14 + descHeight + 8);
    if (y + rowHeight > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    doc
      .font('Sans')
      .fontSize(8.5)
      .fillColor(TEXT)
      .text(pdfDate(e.createdAt), left + 8, y, { lineBreak: false });
    doc
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(timeFormat.format(e.createdAt), left + 8, y + 11, { lineBreak: false });
    doc
      .font('Bold')
      .fontSize(9)
      .fillColor(INK)
      .text(humanize(e.kind), left + cols.date, y, { width: opWidth - 12, lineBreak: false });
    if (e.description)
      doc
        .font('Sans')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(e.description, left + cols.date, y + 12, { width: opWidth - 12 });
    doc
      .font('Bold')
      .fontSize(9)
      .fillColor(e.amount < 0n ? BAD : GOOD)
      .text(groupAmount(e.amount, data.currency, true), left + cols.date + opWidth, y, {
        width: cols.amount - 8,
        align: 'right',
        lineBreak: false,
      });
    doc
      .font('Sans')
      .fontSize(9)
      .fillColor(TEXT)
      .text(groupAmount(e.balanceAfter, data.currency), left + cols.date + opWidth + cols.amount, y, {
        width: cols.balance - 8,
        align: 'right',
        lineBreak: false,
      });
    y += rowHeight;
    doc
      .moveTo(left, y - 6)
      .lineTo(left + width, y - 6)
      .lineWidth(0.5)
      .stroke(LINE);
  }
  if (data.truncated) {
    doc
      .font('Sans')
      .fontSize(8.5)
      .fillColor(BAD)
      .text(
        'Only the first operations fit in one document; choose a shorter period for the rest.',
        left,
        y + 4,
      );
  }
  footer(
    doc,
    `OVL For Business · ${data.owner.name} · ${data.currency} statement · amounts in ${data.currency}, balances after each operation`,
  );
  return finish(doc);
}

// ---------------------------------------------------------------------------
// Registry certificates
// ---------------------------------------------------------------------------

export interface CertificateData {
  number: string;
  title: string;
  /** Company registrations read differently from licences. */
  company: boolean;
  kind: string;
  description: string;
  holder: { name: string; handle: string; verified: boolean };
  website: string | null;
  status: string;
  issuedAt: Date;
  verifyUrl: string;
}

export async function certificatePdf(data: CertificateData): Promise<Buffer> {
  const doc = newPdf({ title: `${data.kind} ${data.number}`, subject: data.title, layout: 'landscape' });
  const W = doc.page.width;
  const H = doc.page.height;
  const valid = data.status === 'active';

  // Frame.
  const gradient = doc.linearGradient(0, 0, W, 0).stop(0, FROM).stop(1, TO);
  doc.rect(0, 0, W, 10).fill(gradient);
  doc.rect(0, H - 10, W, 10).fill(gradient);
  doc
    .roundedRect(28, 28, W - 56, H - 56, 14)
    .lineWidth(1)
    .stroke(LINE);
  doc
    .roundedRect(36, 36, W - 72, H - 72, 10)
    .lineWidth(0.5)
    .stroke(LINE);

  const left = 72;
  const width = W - 2 * left;
  mark(doc, W / 2 - 22, 58, 44);
  doc
    .font('Sans')
    .fontSize(9)
    .fillColor(MUTED)
    .text('OVL FOR BUSINESS · PUBLIC REGISTRY', left, 114, { width, align: 'center', characterSpacing: 2 });
  const noun = data.company ? 'registration' : 'licence';
  doc
    .font('Bold')
    .fontSize(28)
    .fillColor(INK)
    .text(`Certificate of ${noun}`, left, 136, { width, align: 'center' });
  const line = (text: string, y: number, size = 11) =>
    doc.font('Sans').fontSize(size).fillColor(MUTED).text(text, left, y, { width, align: 'center' });
  const big = (text: string, y: number, size: number) =>
    doc
      .font('Bold')
      .fontSize(size)
      .fillColor(INK)
      .text(text, left + 60, y, { width: width - 120, align: 'center' });
  const handle = `${data.holder.handle}${data.holder.verified ? ' · verified business' : ''}`;
  line('This certifies that', 184);
  if (data.company) {
    big(data.title, 204, 22);
    line(handle, 232, 10);
    line('is a company registered in the OVL public registry', 258);
  } else {
    big(data.holder.name, 204, 22);
    line(handle, 232, 10);
    line('holds the licence', 258);
    big(data.title, 278, 17);
  }
  if (data.description)
    doc
      .font('Sans')
      .fontSize(9.5)
      .fillColor(TEXT)
      .text(data.description, left + 110, doc.y + 6, {
        width: width - 220,
        align: 'center',
        height: 44,
        ellipsis: true,
      });

  // Facts along the bottom, the QR code on the right.
  const qrSize = 92;
  const factsY = H - 150;
  const facts: [string, string][] = [
    ['Registry number', data.number],
    ['Type', data.kind],
    ['Issued', pdfDate(data.issuedAt)],
    ['Status', humanize(data.status)],
  ];
  const factWidth = (width - qrSize - 30) / facts.length;
  facts.forEach(([label, value], i) => {
    const x = left + i * factWidth;
    doc
      .font('Sans')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, factsY, { width: factWidth - 10, characterSpacing: 0.6 });
    doc
      .font('Bold')
      .fontSize(11)
      .fillColor(label === 'Status' ? (valid ? GOOD : BAD) : INK)
      .text(value, x, factsY + 13, { width: factWidth - 10 });
  });
  doc
    .font('Sans')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `The registry is the source of truth: scan the code or open ${data.verifyUrl} to check that this ${noun} is still valid.`,
      left,
      factsY + 44,
      { width: width - qrSize - 40 },
    );

  const qr = QRCode.create(data.verifyUrl, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = qrSize / (n + 2);
  const qx = W - left - qrSize;
  const qy = factsY - 18;
  doc.rect(qx, qy, qrSize, qrSize).fill('#FFFFFF');
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c)) doc.rect(qx + (c + 1) * cell, qy + (r + 1) * cell, cell + 0.15, cell + 0.15);
  doc.fill(INK);

  if (!valid) {
    doc.save();
    doc.rotate(-18, { origin: [W / 2, H / 2] });
    doc
      .font('Bold')
      .fontSize(64)
      .fillColor(BAD)
      .fillOpacity(0.18)
      .text(`${data.status.toUpperCase()} · NOT VALID`, 0, H / 2 - 40, { width: W, align: 'center' });
    doc.restore();
  }
  return finish(doc);
}
