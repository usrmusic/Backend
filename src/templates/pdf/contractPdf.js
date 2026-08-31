/* Signed contract — PDFKit port of the Node app's own contractTemplate.js.
   Unlike the invoice and quote, this one has no legacy Laravel PDF to match
   (the old app's contract was a Blade *web view*, never rendered to PDF), so
   it reproduces the existing Node/Puppeteer design one-for-one rather than
   porting an older layout. */

import { round2 } from '../../utils/money.js';

const PAGE_W = 595.28;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '#222222';
const LABEL = '#666666';
const RULE = '#dddddd';
const HEAD_FILL = '#f6f6f6';
const F = 'Helvetica';
const FB = 'Helvetica-Bold';

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

// round2 handles dirty VARCHAR values (currency symbols, commas, the literal
// "NaN" seen in real data, garbage) the same way every other money site in the
// app does — the old `Number(n)` fallback printed raw garbage text on a signed
// legal document instead of a number.
function fmtMoney(n) {
  return round2(n).toFixed(2);
}

function labelValue(doc, x, y, w, label, value, { bold = false } = {}) {
  doc.font(F).fontSize(8.5).fillColor(LABEL).text(label, x, y, { width: w });
  doc.font(bold ? FB : F).fontSize(10).fillColor(INK)
    .text(String(value), x, y + 12, { width: w });
}

export default function renderContractPdf(doc, {
  event = {},
  user,
  company,
  signature,       // Buffer | null — client's drawn signature
  adminSignature,  // Buffer | null — company's on-file signature
  signedAt,
} = {}) {
  const userName = user?.name || event?.users_events_user_idTousers?.name || 'Client';
  const venue = event?.venues?.venue || '';
  // Package/equipment lines — the contract previously showed only the total
  // price with nothing describing what that price actually covers.
  const packageLines = Array.isArray(event?.event_package)
    ? event.event_package.map((p) => ({
        name: p.equipment?.name || 'Item',
        quantity: p.quantity ?? 1,
        price: p.total_price ?? p.sell_price ?? 0,
      }))
    : [];
  const eventDate = fmtDate(event?.date);
  const total = fmtMoney(event?.total_cost_for_equipment);
  const deposit = fmtMoney(event?.deposit_amount);
  const invoice = event?.invoice ?? '';
  const companyName = company?.name || 'USR Music';
  const companyAddress = [company?.address_name, company?.street, company?.city, company?.postal_code]
    .filter(Boolean).join(', ');
  const companyContact = [
    company?.telephone_number && `Tel: ${company.telephone_number}`,
    company?.email,
    company?.website,
  ].filter(Boolean).join('   |   ');

  let y = MARGIN;

  // Header — title + company block on the left, invoice/date on the right.
  doc.font(FB).fontSize(20).fillColor(INK).text('Performance Contract', MARGIN, y);
  doc.font(F).fontSize(11).fillColor(LABEL).text(`Invoice #${invoice}`, MARGIN, y, {
    width: CONTENT_W, align: 'right',
  });
  doc.font(F).fontSize(11).fillColor(LABEL)
    .text(`Date: ${fmtDate(signedAt || new Date())}`, MARGIN, y + 13, {
      width: CONTENT_W, align: 'right',
    });

  y += 26;
  doc.font(F).fontSize(8.5).fillColor(LABEL).text(companyName, MARGIN, y);
  y = doc.y;
  if (companyAddress) {
    doc.font(F).fontSize(9).fillColor(INK).text(companyAddress, MARGIN, y);
    y = doc.y;
  }
  if (companyContact) {
    doc.font(F).fontSize(9).fillColor(INK).text(companyContact, MARGIN, y);
    y = doc.y;
  }

  // Event details box — a bordered, rounded box holding three rows of pairs.
  y += 16;
  const boxTop = y;
  const boxPadX = 14;
  const boxPadY = 10;
  const colW = (CONTENT_W - boxPadX * 2) / 2;
  const rowH = 30;
  const boxH = boxPadY * 2 + rowH * 3 - 6;

  doc.save().roundedRect(MARGIN, boxTop, CONTENT_W, boxH, 4)
    .lineWidth(1).strokeColor(RULE).stroke().restore();

  let ry = boxTop + boxPadY;
  labelValue(doc, MARGIN + boxPadX, ry, colW - 12, 'Client', userName, { bold: true });
  labelValue(doc, MARGIN + boxPadX + colW, ry, colW - 12, 'Event date', eventDate);
  ry += rowH;
  labelValue(doc, MARGIN + boxPadX, ry, colW - 12, 'Venue', venue);
  labelValue(doc, MARGIN + boxPadX + colW, ry, colW - 12, 'Package price', `£${total}`);
  ry += rowH;
  labelValue(doc, MARGIN + boxPadX, ry, colW - 12, 'Deposit', `£${deposit}`);
  labelValue(doc, MARGIN + boxPadX + colW, ry, colW - 12, 'Event ID', `#${event?.id ?? ''}`);

  y = boxTop + boxH + 22;

  // Package includes — DJ package name plus any equipment/extras attached
  // to the event, so the contract actually shows what the price covers.
  if (event?.dj_package_name || packageLines.length) {
    doc.font(FB).fontSize(13).fillColor(INK).text('Package Includes', MARGIN, y);
    y = doc.y + 6;
    if (event?.dj_package_name) {
      doc.font(FB).fontSize(9.5).fillColor(INK).text(event.dj_package_name, MARGIN, y);
      y = doc.y + 4;
    }
    for (const line of packageLines) {
      const qtyLabel = line.quantity > 1 ? `${line.quantity} x ` : '';
      doc.font(F).fontSize(9).fillColor('#333333')
        .text(`${qtyLabel}${line.name}`, MARGIN, y, { width: CONTENT_W - 70, continued: false });
      doc.font(F).fontSize(9).fillColor('#333333')
        .text(`£${fmtMoney(line.price)}`, MARGIN, y, { width: CONTENT_W, align: 'right' });
      y = doc.y + 3;
    }
    y += 14;
  }

  // Terms
  doc.font(FB).fontSize(13).fillColor(INK).text('Terms & Conditions', MARGIN, y);
  y = doc.y + 6;
  const terms =
    `By signing this contract you agree to the standard ${companyName} performance terms: deposit is ` +
    `non-refundable, the balance is due no later than 14 days before the event date, and ${companyName} ` +
    `will provide the equipment and services described above. Cancellations made less than 30 days before ` +
    `the event are subject to the full balance. Any changes to the event date, venue or package must be ` +
    `agreed in writing.`;
  doc.font(F).fontSize(9).fillColor('#333333')
    .text(terms, MARGIN, y, { width: CONTENT_W, lineGap: 2.5 });

  // Signatures — two side-by-side boxes, each a rule with a signature image
  // (or "(unsigned)") and a name underneath.
  y = doc.y + 34;
  const sigColW = (CONTENT_W - 32) / 2;
  const sigRight = MARGIN + sigColW + 32;

  doc.save().moveTo(MARGIN, y).lineTo(MARGIN + sigColW, y)
    .lineWidth(1).strokeColor('#333333').stroke().restore();
  doc.save().moveTo(sigRight, y).lineTo(sigRight + sigColW, y)
    .lineWidth(1).strokeColor('#333333').stroke().restore();

  let ly = y + 6;
  doc.font(F).fontSize(8.5).fillColor(LABEL).text('Client signature', MARGIN, ly);
  let ry2 = y + 6;
  doc.font(F).fontSize(8.5).fillColor(LABEL).text(companyName, sigRight, ry2);

  const sigImgY = ly + 12;
  if (signature) {
    try {
      doc.image(signature, MARGIN, sigImgY, { fit: [180, 60] });
    } catch (_) {
      doc.font(F).fontSize(9).fillColor('#888888').text('(unsigned)', MARGIN, sigImgY);
    }
  } else {
    doc.font(F).fontSize(9).fillColor('#888888').text('(unsigned)', MARGIN, sigImgY);
  }
  if (adminSignature) {
    try {
      doc.image(adminSignature, sigRight, sigImgY, { fit: [180, 60] });
    } catch (_) {
      // Company signature missing — leave that side blank, same as the HTML did.
    }
  }

  const afterSigY = sigImgY + 64;
  doc.font(F).fontSize(9.5).fillColor(INK).text(userName, MARGIN, afterSigY);
  doc.font(F).fontSize(8.5).fillColor(LABEL)
    .text(`Signed: ${fmtDate(signedAt || new Date())}`, MARGIN, afterSigY + 12);

  doc.font(F).fontSize(9.5).fillColor(INK)
    .text(company?.contact_name || companyName, sigRight, afterSigY);

  return doc;
}
