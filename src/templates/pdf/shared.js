/* Shared header/footer for the PDFKit invoice and quote.

   Both documents are ports of the legacy Laravel views
   (usrmusic_rep/resources/views/pdf/invoice.blade.php and pdf/quote.blade.php)
   rather than the HTML templates the Node app had been using — those had
   drifted from what the client's invoices/quotes actually look like (no
   company address, a "Qty/Price" grid instead of the flat dotted list, and a
   logo path built from an unset APP_URL that never resolved).

   Geometry below is read off the blade's CSS: header 3.5cm tall, logo at
   0.5cm/0.7cm, black rule under the header, grey 11px body text, items list
   at 10px with 1px dotted separators. */

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const LEFT = 28;         // .client-details / .equipment-table margin-left
export const RIGHT_PAD = 23;    // .company-details padding-right
export const HEADER_H = 99;     // header { height: 3.5cm }

export const GREY = '#808080'; // body { color: grey }
export const BLACK = '#000000';
export const F = 'Helvetica';
export const FB = 'Helvetica-Bold';

import { round2 } from '../../utils/money.js';

// Rounds to pennies before use — without this, float artifacts upstream (e.g.
// a VAT multiplication, or the frontend's unrounded running total) print
// literally on a client-facing PDF: "£129.99999999999997" instead of "£130".
export const num = (v) => round2(v);

// Laravel printed bare "£{{ $value }}" (so 4250 -> "£4250", not "£4250.00").
// Kept that formatting — the point of this port is to match what the client
// already has — but the value going into it is now always clean pennies:
// a whole pound prints with no decimals, a real fractional amount prints with
// exactly 2 (never the 15-digit float tail a raw value could carry).
export const gbp = (v) => {
  const n = num(v);
  const isWhole = Math.abs(n - Math.round(n)) < 1e-9;
  return `£${isWhole ? Math.round(n) : n.toFixed(2)}`;
};

export const fmtDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}-${p(dt.getMonth() + 1)}-${dt.getFullYear()}`;
};

/* Header: logo (or company name in type — see brandAssets.js for why this
   never substitutes a different company's logo), a title, and the company's
   address block right-aligned, all above a 1px black rule. */
export function drawHeader(doc, companyDetails = {}, logo, title) {
  let drewLogo = false;
  if (logo) {
    try {
      doc.image(logo, LEFT, 18, { fit: [95, 34] });
      drewLogo = true;
    } catch (_) {
      // Corrupt/unsupported bytes slipped through — fall back to type below.
    }
  }
  if (!drewLogo) {
    doc.font(FB).fontSize(19).fillColor(BLACK)
      .text(companyDetails.name || 'USR', LEFT, 24, { width: PAGE_W / 2 - LEFT });
  }

  doc.font(F).fontSize(15).fillColor(BLACK).text(title, LEFT, 56);

  const lines = [
    companyDetails.address_name,
    companyDetails.street,
    companyDetails.city,
    companyDetails.postal_code,
  ].filter(Boolean);

  let y = 20;
  doc.font(FB).fontSize(9);
  lines.forEach((l) => {
    doc.fillColor(BLACK).text(String(l), PAGE_W / 2, y, {
      width: PAGE_W / 2 - RIGHT_PAD,
      align: 'right',
    });
    y += 12;
  });

  const contact = [companyDetails.telephone_number, companyDetails.website]
    .filter(Boolean)
    .join(' | ');
  if (contact) {
    doc.font(FB).fontSize(9).fillColor(BLACK).text(contact, PAGE_W / 2, 82, {
      width: PAGE_W / 2 - RIGHT_PAD,
      align: 'right',
    });
  }

  doc.save().moveTo(0, HEADER_H).lineTo(PAGE_W, HEADER_H)
    .lineWidth(1).strokeColor(BLACK).stroke().restore();
}

export function drawFooter(doc, companyDetails = {}) {
  const y = PAGE_H - 34;
  doc.save().moveTo(0, y).lineTo(PAGE_W, y)
    .lineWidth(1).strokeColor(GREY).stroke().restore();

  const parts = [
    `Payment details - ${companyDetails.bank_name || 'Starling Bank'}`,
    `Name: ${companyDetails.name || 'USR Holdings Ltd'}`,
    `Account No: ${companyDetails.account_number || '12345678'}`,
    `Sort Code: ${companyDetails.sort_code || '12-34-56'}`,
  ];
  if (companyDetails.vat) parts.push(`Vat: ${companyDetails.vat}`);

  doc.font(F).fontSize(8).fillColor(GREY)
    .text(parts.join(', '), 40, y + 9, { width: PAGE_W - 80, align: 'center' });
}

/* Client block: Name / Date / Venue as "label: value" pairs, matching the
   blade's two-cell event-details-table. */
export function drawClientDetails(doc, { name, date, venue }, startY = 128) {
  const rows = [['Name', name || ''], ['Date', date || ''], ['Venue', venue || '']];
  let y = startY;
  rows.forEach(([label, value]) => {
    doc.font(F).fontSize(9).fillColor(GREY).text(label, LEFT, y);
    doc.font(F).fontSize(9).fillColor(GREY).text(`: ${value}`, LEFT + 92, y, {
      width: PAGE_W - LEFT - 92 - 45,
    });
    y += 15;
  });
  return y;
}

/* One row of the equipment/extras list, with the 1px dotted rule above it
   that `.equipment-table tbody td { border-top: 1px dotted grey }` draws.
   PDFKit has no page-break CSS equivalent, so the page check here is what
   Chromium's automatic reflow used to do for free — needed because a real
   event can carry 20+ line items (verified against event 1162, 21 rows). */
export function itemRow(doc, text, { bold = false } = {}) {
  if (doc.y > PAGE_H - 90) {
    doc.addPage();
    doc.y = LEFT + 8;
  }
  const y = doc.y;
  doc.save().moveTo(LEFT, y).lineTo(PAGE_W - 45, y)
    .lineWidth(0.5).strokeColor(GREY).dash(1, { space: 2 }).stroke().undash().restore();

  doc.font(bold ? FB : F).fontSize(9).fillColor(bold ? BLACK : GREY)
    .text(String(text), LEFT, y + 3, { width: PAGE_W - 45 - LEFT });
  doc.y += 3;
}

/* enrichedDetails carry package_type_id (1 = BASIC, 2 = EXTRAS in the
   package_types table) — the same split Laravel made between $standardPackage
   (rendered plainly) and $extraEquipment (rendered after a bold "Additional
   Extras" divider, with quantity prefixed and any note appended). */
export function drawItemsList(doc, { djName, standardPackage = [], extraEquipment = [] }) {
  if (djName) itemRow(doc, djName);

  standardPackage.forEach((e) => {
    const qty = num(e.quantity);
    itemRow(doc, qty > 1 ? `${qty}X ${e.name}` : e.name);
  });

  if (extraEquipment.length) {
    itemRow(doc, 'Additional Extras', { bold: true });
    extraEquipment.forEach((e) => {
      const qty = num(e.quantity);
      const base = qty > 1 ? `${qty}X ${e.name}` : e.name;
      itemRow(doc, e.notes ? `${base} - ${e.notes}` : base);
    });
  }
}
