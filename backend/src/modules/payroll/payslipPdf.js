'use strict';

// A payslip as a PDF file, drawn from the same template as the page and the email.
//
// Uses the PDF standard fonts (Helvetica, Times, Courier) so nothing has to be shipped or loaded;
// they cover Latin text only, so any other characters in a name show as "?". A repeat send is
// stamped with a large diagonal DUPLICATE across the page.

const PDFDocument = require('pdfkit');

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const FONTS = {
  sans: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
  serif: { regular: 'Times-Roman', bold: 'Times-Bold' },
  mono: { regular: 'Courier', bold: 'Courier-Bold' },
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 42;

/** Keeps to what the standard fonts can draw (Latin-1 plus a few punctuation marks); the rest becomes "?". */
const safe = (value) =>
  String(value ?? '').replace(/[^\u0009\u000A -~ -ÿ–—‘’“”•€]/g, '?');

/**
 * @param {object} slip       from pay.service.payslip
 * @param {object} options
 * @param {string} options.company
 * @param {object} options.template      from services/payslipTemplate
 * @param {Buffer|null} [options.logo]   PNG or JPEG bytes (other formats are left out)
 * @param {boolean} [options.duplicate]  stamp DUPLICATE across the page
 * @returns {Promise<Buffer>}
 */
function renderPayslipPdf(slip, { company, template, logo = null, duplicate = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${template.title} ${slip.month}`, Author: company } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, slip, { company, template, logo, duplicate });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function draw(doc, slip, { company, template, logo, duplicate }) {
  const { colors, show } = template;
  const font = FONTS[template.font] || FONTS.sans;
  const monthTitle = MONTH_NAME.format(new Date(`${slip.month}-01T00:00:00Z`));
  const right = PAGE.width - MARGIN;
  const contentWidth = PAGE.width - MARGIN * 2;
  const GREY = '#6b6b7b';
  const RULE = '#d9d7e6';

  // The sheet.
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(colors.background);

  // Header band.
  const headH = 96;
  doc.rect(0, 0, PAGE.width, headH).fill(colors.headerBackground);
  doc.rect(0, headH, PAGE.width, 3).fill(colors.accent);

  let textX = MARGIN;
  if (show.logo && logo) {
    try {
      doc.image(logo, MARGIN, 26, { fit: [46, 46], align: 'center', valign: 'center' });
      textX = MARGIN + 60;
    } catch {
      // A logo the PDF library cannot read is left out; the payslip must still be produced.
    }
  }
  doc.fillColor(colors.accent).font(font.bold).fontSize(20).text(safe(company), textX, 28, { width: 330, lineBreak: false });
  doc.fillColor(colors.text).font(font.regular).fontSize(11).text(safe(`${template.title} for ${monthTitle}`), textX, 56, { width: 330, lineBreak: false });

  doc.fillColor(GREY).font(font.regular).fontSize(8.5);
  let sideY = 32;
  if (show.employeeId && slip.employee.employeeCode) {
    doc.text(safe(`ID ${slip.employee.employeeCode}`), MARGIN, sideY, { width: contentWidth, align: 'right' });
    sideY += 13;
  }
  doc.text('All amounts in US dollars', MARGIN, sideY, { width: contentWidth, align: 'right' });

  // Facts.
  let y = headH + 30;
  const facts = (items) => {
    const colW = contentWidth / Math.max(items.length, 1);
    items.forEach(([label, value], i) => {
      const x = MARGIN + colW * i;
      doc.fillColor(GREY).font(font.regular).fontSize(8).text(label, x, y, { width: colW - 8, lineBreak: false });
      doc.fillColor(colors.text).font(font.bold).fontSize(10.5).text(safe(value), x, y + 12, { width: colW - 8, lineBreak: false });
    });
    y += 40;
  };

  const info = [['Employee', slip.employee.name]];
  if (show.email) info.push(['Email', slip.employee.email]);
  if (show.department) info.push(['Department', slip.employee.department || '-']);
  facts(info);

  const counts = [['Days worked', String(slip.daysWorked)]];
  if (show.totalHours) counts.push(['Total hours worked', String(slip.totalHours)]);
  facts(counts);

  if (show.dayBreakdown) {
    facts([
      ['Full days', String(slip.fullDays)],
      ['Half days', String(slip.halfDays)],
      [
        'Other hours',
        slip.otherDays > 0
          ? `${slip.otherHours} (over ${slip.otherDays} day${slip.otherDays === 1 ? '' : 's'})`
          : String(slip.otherHours),
      ],
    ]);
  }

  // Earnings table.
  const col = { desc: MARGIN + 8, qty: MARGIN + 250, rate: MARGIN + 330, amountRight: right - 8 };
  const row = (cells, { bold = false, size = 10, colour = colors.text, rule = true, pad = 8 } = {}) => {
    doc.fillColor(colour).font(bold ? font.bold : font.regular).fontSize(size);
    doc.text(safe(cells[0]), col.desc, y + pad, { width: 235, lineBreak: false });
    if (cells[1] !== undefined) doc.text(safe(cells[1]), col.qty, y + pad, { width: 70, align: 'right', lineBreak: false });
    if (cells[2] !== undefined) doc.text(safe(cells[2]), col.rate, y + pad, { width: 100, align: 'right', lineBreak: false });
    doc.text(safe(cells[3]), right - 96, y + pad, { width: 88, align: 'right', lineBreak: false });
    y += size + pad * 2;
    if (rule) doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
  };

  row(['EARNINGS', 'QTY', 'RATE', 'AMOUNT'], { bold: true, size: 8, colour: colors.accent, rule: false, pad: 6 });
  doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(1.5).strokeColor(colors.accent).stroke();

  for (const l of slip.lines) {
    if (l.kind === 'full') row(['Full days', String(l.days), `${MONEY.format(l.dailyRate)} / day`, MONEY.format(l.amount)]);
    else if (l.kind === 'half') row(['Half days', String(l.days), `${MONEY.format(l.dailyRate / 2)} / half day`, MONEY.format(l.amount)]);
    else row([`Other hours (over ${l.days} day${l.days === 1 ? '' : 's'})`, `${l.hours} h`, `${MONEY.format(l.hourlyRate)} / hour`, MONEY.format(l.amount)]);
  }
  if (!slip.lines.length) row(['No paid days this month.', undefined, undefined, '']);

  row(['Base pay', undefined, undefined, MONEY.format(slip.basePay)], { bold: true });
  for (const b of slip.bonuses) row([`Bonus: ${b.reason}`, undefined, undefined, MONEY.format(b.amount)]);
  if (slip.bonuses.length) row(['Bonuses', undefined, undefined, MONEY.format(slip.bonusTotal)], { bold: true });

  doc.moveTo(MARGIN, y + 6).lineTo(right, y + 6).lineWidth(1.5).strokeColor(colors.accent).stroke();
  y += 6;
  row(['Net pay', undefined, undefined, MONEY.format(slip.netPay)], { bold: true, size: 14, colour: colors.accent, rule: false, pad: 10 });

  // Closing note.
  if (show.rulesNote) {
    const note =
      template.footerNote ||
      `A full day (${slip.dayLimits.fullDayHours}+ hours of work) pays the daily rate, a half day (${slip.dayLimits.halfDayHours}+ hours) pays half, and other work is paid by the hour. Breaks are not counted as work. Bonuses are added on top. Generated on ${new Date(slip.generatedOn).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}.`;
    doc.fillColor(GREY).font(font.regular).fontSize(8.5).text(safe(note), MARGIN, y + 20, { width: contentWidth, lineGap: 2 });
  }

  // A repeat of a payslip already sent: DUPLICATE across the page, over everything.
  if (duplicate) {
    const cx = PAGE.width / 2;
    const cy = PAGE.height / 2;
    doc.save();
    doc.rotate(-38, { origin: [cx, cy] });
    doc.fillColor('#c0392b').fillOpacity(0.18).font('Helvetica-Bold').fontSize(104);
    const w = doc.widthOfString('DUPLICATE');
    doc.text('DUPLICATE', cx - w / 2, cy - 52, { lineBreak: false });
    doc.restore();
  }
}

module.exports = { renderPayslipPdf };
