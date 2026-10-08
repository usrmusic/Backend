/* Invoice — redesigned to match the client-supplied reference sample
   (a clean, modern layout: logo + "Invoice" heading, client/meta block,
   a "Due by" banner, bank-transfer detail boxes, then an itemised
   Qty/Description/Unit price/Total price table).

   This intentionally does NOT reuse shared.js's drawHeader/drawClientDetails/
   drawItemsList — those still back the Quote PDF (quotePdf.js), which keeps
   the old Laravel-style dotted list on purpose; only the invoice is getting
   this new look. */

import { PAGE_W, PAGE_H, LEFT, BLACK, F, FB, num } from './shared.js';
import { formatMoney } from '../../utils/money.js';

const RIGHT = PAGE_W - 28; // mirrors shared.js's LEFT margin
const CONTENT_W = RIGHT - LEFT;
const LIGHT_BG = '#F2F2F2';
const RULE = '#E3E3E3';
const LABEL_GREY = '#767676';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// "8th October 2026" — matches the reference sample's date format exactly
// (ordinal day + full month name + year), distinct from shared.js's fmtDate
// (DD-MM-YYYY), which the Quote PDF still uses.
function fmtDateLong(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${ordinal(dt.getDate())} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// "Saturday 7th November 2026" — the "Due by" line's format in the sample.
function fmtDateLongWithDay(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${DAYS[dt.getDay()]} ${fmtDateLong(dt)}`;
}

function hRule(doc, y, color = RULE, x1 = LEFT, x2 = RIGHT) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(color).stroke().restore();
}

function drawLogoHeader(doc, companyDetails, logo) {
  if (logo) {
    try {
      doc.image(logo, LEFT, 20, { fit: [110, 32] });
    } catch (_) {
      doc.font(FB).fontSize(16).fillColor(BLACK).text(companyDetails?.name || 'USR', LEFT, 28);
    }
  } else {
    doc.font(FB).fontSize(16).fillColor(BLACK).text(companyDetails?.name || 'USR', LEFT, 28);
  }
  hRule(doc, 68);
}

/* Client block (left) + Invoice number / Invoice date / Date of issue (right).
   Also carries Venue + Event Date — real information this invoice needs that
   the generic reference sample didn't have to show — as two extra rows under
   the client's address, in the same quiet grey-label style as the rest of
   the block. */
function drawTitleClientAndMeta(doc, {
  clientName, addressLines, venue, eventDate, invoiceNumber, invoiceDate, issueDate,
}) {
  const topY = 88;
  doc.font(FB).fontSize(24).fillColor(BLACK).text('Invoice', LEFT, topY);

  let cy = topY + 40;
  const leftColW = 260;
  doc.font(FB).fontSize(10).fillColor(BLACK).text(clientName || '', LEFT, cy, { width: leftColW });
  cy += 14;
  doc.font(F).fontSize(9).fillColor(BLACK);
  addressLines.forEach((line) => {
    doc.text(line, LEFT, cy, { width: leftColW });
    cy += 12;
  });
  if (venue || eventDate) cy += 4;
  if (venue) {
    doc.font(F).fontSize(9).fillColor(LABEL_GREY).text(`Venue: ${venue}`, LEFT, cy, { width: leftColW });
    cy += 12;
  }
  if (eventDate) {
    doc.font(F).fontSize(9).fillColor(LABEL_GREY).text(`Event date: ${eventDate}`, LEFT, cy, { width: leftColW });
    cy += 12;
  }

  const metaX = 350;
  const metaW = RIGHT - metaX;
  let my = topY;
  doc.font(FB).fontSize(8).fillColor(LABEL_GREY).text('Invoice number', metaX, my, { width: metaW });
  doc.font(F).fontSize(10).fillColor(BLACK).text(invoiceNumber || '', metaX, my + 11, { width: metaW });
  my += 32;

  const halfW = metaW / 2 - 8;
  doc.font(FB).fontSize(8).fillColor(LABEL_GREY).text('Invoice date', metaX, my, { width: halfW });
  doc.font(F).fontSize(10).fillColor(BLACK).text(invoiceDate || '', metaX, my + 11, { width: halfW });
  doc.font(FB).fontSize(8).fillColor(LABEL_GREY).text('Date of issue', metaX + halfW + 16, my, { width: halfW });
  doc.font(F).fontSize(10).fillColor(BLACK).text(issueDate || '', metaX + halfW + 16, my + 11, { width: halfW });
  my += 30;

  return Math.max(cy, my) + 14;
}

function drawDueBanner(doc, y, { dueDateLabel, amountLabel }) {
  hRule(doc, y);
  const rowY = y + 10;
  doc.font(FB).fontSize(10).fillColor(BLACK).text('Due by', LEFT, rowY, { continued: true });
  doc.font(F).fontSize(10).fillColor(BLACK).text(` ${dueDateLabel}`);
  doc.font(FB).fontSize(13).fillColor(BLACK).text(amountLabel, LEFT, rowY - 2, { width: CONTENT_W, align: 'right' });
  const afterY = rowY + 20;
  hRule(doc, afterY);
  doc.font(F).fontSize(8).fillColor(LABEL_GREY)
    .text('Pay online, or do a bank transfer with the account number, sort code, and reference below.', LEFT, afterY + 10);
  return afterY + 28;
}

function paymentBox(doc, x, y, w, h, label, value) {
  doc.save().roundedRect(x, y, w, h, 4).fill(LIGHT_BG).restore();
  doc.font(FB).fontSize(7).fillColor(LABEL_GREY).text(label, x + 10, y + 8, { width: w - 20 });
  doc.font(F).fontSize(10).fillColor(BLACK).text(value || '—', x + 10, y + 20, { width: w - 20 });
}

function drawPaymentBoxes(doc, y, companyDetails, reference) {
  const gap = 10;
  const boxW = (CONTENT_W - gap) / 2;
  const boxH = 38;
  paymentBox(doc, LEFT, y, boxW, boxH, 'Account name', companyDetails?.name);
  paymentBox(doc, LEFT + boxW + gap, y, boxW, boxH, 'Sort code', companyDetails?.sort_code);
  paymentBox(doc, LEFT, y + boxH + gap, boxW, boxH, 'Account number', companyDetails?.account_number);
  paymentBox(doc, LEFT + boxW + gap, y + boxH + gap, boxW, boxH, 'Reference', reference);
  return y + boxH * 2 + gap + 20;
}

// Column geometry for the itemised table.
const COL_QTY_X = LEFT;
const COL_QTY_W = 34;
const COL_DESC_X = LEFT + 40;
const COL_PRICE_W = 80;
const COL_TOTAL_X = RIGHT - COL_PRICE_W;
const COL_UNIT_X = COL_TOTAL_X - COL_PRICE_W - 16;
const COL_DESC_W = COL_UNIT_X - 16 - COL_DESC_X;

function drawTableHeader(doc, y) {
  doc.font(FB).fontSize(8).fillColor(LABEL_GREY);
  doc.text('Qty.', COL_QTY_X, y, { width: COL_QTY_W });
  doc.text('Description', COL_DESC_X, y, { width: COL_DESC_W });
  doc.text('Unit price', COL_UNIT_X, y, { width: COL_PRICE_W, align: 'right' });
  doc.text('Total price', COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
  hRule(doc, y + 16);
  return y + 26;
}

function drawRow(doc, y, { qty, name, unitPrice, totalPrice }, { bold = false } = {}) {
  if (y > PAGE_H - 140) {
    doc.addPage();
    y = LEFT + 20;
    y = drawTableHeader(doc, y);
  }
  const font = bold ? FB : F;
  const color = bold ? BLACK : BLACK;
  doc.font(font).fontSize(9).fillColor(color);
  doc.text(qty != null ? String(qty) : '', COL_QTY_X, y, { width: COL_QTY_W });
  doc.text(name || '', COL_DESC_X, y, { width: COL_DESC_W });
  doc.text(unitPrice != null ? formatMoney(unitPrice) : '', COL_UNIT_X, y, { width: COL_PRICE_W, align: 'right' });
  doc.text(totalPrice != null ? formatMoney(totalPrice) : '', COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
  return y + 20;
}

function drawFooter(doc, companyDetails = {}, pageNumber = 1) {
  const y = PAGE_H - 70;
  hRule(doc, y, '#CFCFCF');
  const colW = CONTENT_W / 2;

  doc.font(FB).fontSize(8).fillColor(BLACK).text('Business address', LEFT, y + 10, { width: colW });
  const addrLines = [
    companyDetails.address_name,
    companyDetails.street,
    companyDetails.city,
    companyDetails.postal_code,
  ].filter(Boolean);
  doc.font(F).fontSize(8).fillColor(LABEL_GREY).text(addrLines.join(', '), LEFT, y + 22, { width: colW });

  doc.font(FB).fontSize(8).fillColor(BLACK).text('Contact details', LEFT + colW, y + 10, { width: colW, align: 'left' });
  const contactParts = [];
  if (companyDetails.email) contactParts.push(`Email ${companyDetails.email}`);
  if (companyDetails.telephone_number) contactParts.push(`Tel ${companyDetails.telephone_number}`);
  doc.font(F).fontSize(8).fillColor(LABEL_GREY).text(contactParts.join('   '), LEFT + colW, y + 22, { width: colW });

  doc.font(F).fontSize(8).fillColor(LABEL_GREY).text(`Page ${pageNumber}`, LEFT, PAGE_H - 24, { width: CONTENT_W, align: 'center' });
}

export default function renderInvoicePdf(doc, {
  event = {},
  companyDetails = {},
  standardPackage = [],
  extraEquipment = [],
  djName = '',
  logo = null,
} = {}) {
  drawLogoHeader(doc, companyDetails, logo);

  const addressLines = String(event?.users_events_user_idTousers?.address || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const invoiceNumber = event?.invoice ? `INV-${event.invoice}` : '';
  const issuedOn = new Date();

  const total = num(event?.total_cost_for_equipment);
  const deposit = Array.isArray(event?.event_payments)
    ? event.event_payments.reduce((s, p) => s + num(p.amount), 0)
    : 0;
  const refundAmount = num(event?.refund_amount);
  const refundAndDeposit = deposit - refundAmount;
  const remaining = total - refundAndDeposit;

  let y = drawTitleClientAndMeta(doc, {
    clientName: event?.users_events_user_idTousers?.name,
    addressLines,
    venue: event?.venues?.venue,
    eventDate: fmtDateLong(event?.date),
    invoiceNumber,
    invoiceDate: fmtDateLong(issuedOn),
    issueDate: fmtDateLong(issuedOn),
  });

  y = drawDueBanner(doc, y, {
    dueDateLabel: fmtDateLongWithDay(event?.date),
    amountLabel: formatMoney(Math.max(remaining, 0)),
  });

  y = drawPaymentBoxes(doc, y, companyDetails, invoiceNumber);

  y = drawTableHeader(doc, y);
  // No qty/price columns — this is the package/DJ label, not a priced line
  // item, so it reads as a bold heading row rather than a stray empty row.
  if (djName) y = drawRow(doc, y, { qty: null, name: djName, unitPrice: null, totalPrice: null }, { bold: true });
  standardPackage.forEach((e) => {
    y = drawRow(doc, y, { qty: num(e.quantity), name: e.name, unitPrice: e.unitPrice, totalPrice: e.totalPrice });
  });
  extraEquipment.forEach((e) => {
    const name = e.notes ? `${e.name} - ${e.notes}` : e.name;
    y = drawRow(doc, y, { qty: num(e.quantity), name, unitPrice: e.unitPrice, totalPrice: e.totalPrice });
  });

  y += 6;
  hRule(doc, y, '#CFCFCF', COL_UNIT_X, RIGHT);
  y += 10;
  if (event?.is_vat_available_for_the_event && companyDetails?.vat) {
    doc.font(F).fontSize(9).fillColor(BLACK).text('Subtotal (ex. VAT)', COL_DESC_X, y, { width: COL_UNIT_X - 16 - COL_DESC_X });
    doc.font(F).fontSize(9).fillColor(BLACK).text(formatMoney(event.event_amount_without_vat), COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
    y += 16;
    doc.font(F).fontSize(9).fillColor(BLACK).text('VAT', COL_DESC_X, y, { width: COL_UNIT_X - 16 - COL_DESC_X });
    doc.font(F).fontSize(9).fillColor(BLACK).text(formatMoney(event.vat_value), COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
    y += 16;
  }
  doc.font(FB).fontSize(10).fillColor(BLACK).text('Total', COL_DESC_X, y, { width: COL_UNIT_X - 16 - COL_DESC_X });
  doc.font(FB).fontSize(10).fillColor(BLACK).text(formatMoney(total), COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
  y += 20;
  doc.font(F).fontSize(9).fillColor(BLACK).text('Payment received', COL_DESC_X, y, { width: COL_UNIT_X - 16 - COL_DESC_X });
  doc.font(F).fontSize(9).fillColor(BLACK).text(formatMoney(refundAndDeposit), COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });
  y += 16;
  doc.font(FB).fontSize(9).fillColor(BLACK).text('Payment remaining', COL_DESC_X, y, { width: COL_UNIT_X - 16 - COL_DESC_X });
  doc.font(FB).fontSize(9).fillColor(BLACK).text(formatMoney(remaining), COL_TOTAL_X, y, { width: COL_PRICE_W, align: 'right' });

  drawFooter(doc, companyDetails, 1);

  return doc;
}
