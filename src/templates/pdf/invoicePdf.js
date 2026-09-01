/* Invoice — PDFKit port of usrmusic_rep/resources/views/pdf/invoice.blade.php.
   See shared.js for why this replaces the old HTML/Puppeteer template. */

import {
  PAGE_W, LEFT, GREY, F,
  num, gbp, fmtDate,
  drawHeader, drawFooter, drawClientDetails, drawItemsList,
} from './shared.js';

export default function renderInvoicePdf(doc, {
  event = {},
  companyDetails = {},
  standardPackage = [],
  extraEquipment = [],
  djName = '',
  logo = null,
} = {}) {
  drawHeader(doc, companyDetails, logo, 'Invoice');
  drawFooter(doc, companyDetails);

  drawClientDetails(doc, {
    name: event?.users_events_user_idTousers?.name,
    date: fmtDate(event?.date),
    venue: event?.venues?.venue,
  });

  doc.y = 182;
  drawItemsList(doc, { djName, standardPackage, extraEquipment });

  /* Totals. The blade shows Package Price / VAT / Total only when the event
     has VAT enabled, and always shows Received and Remaining — "Payment
     Remaining" was missing from the Node HTML invoice entirely. */
  const total = num(event?.total_cost_for_equipment);
  const deposit = Array.isArray(event?.event_payments)
    ? event.event_payments.reduce((s, p) => s + num(p.amount), 0)
    : 0;
  // Matches Laravel's GeneratePdfInvoice::prepareInvoiceData /
  // InvoiceMail::build: $refundAndDeposit = $deposit - $refundAmount;
  // $remainingAmount = $grandTotal - $refundAndDeposit. A refund reduces the
  // amount counted as "received", which correspondingly raises "remaining".
  const refundAmount = num(event?.refund_amount);
  const refundAndDeposit = deposit - refundAmount;

  const totals = [];
  if (event?.is_vat_available_for_the_event && companyDetails?.vat) {
    totals.push(['Package Price', gbp(event.event_amount_without_vat)]);
    totals.push(['VAT', gbp(event.vat_value)]);
  }
  totals.push(['Total Price', gbp(total)]);
  totals.push(['Payment Received', gbp(refundAndDeposit)]);
  totals.push(['Payment Remaining', gbp(total - refundAndDeposit)]);

  let ty = Math.max(doc.y + 60, 300);
  totals.forEach(([label, value]) => {
    doc.font(F).fontSize(9).fillColor(GREY).text(label, LEFT, ty);
    doc.font(F).fontSize(9).fillColor(GREY).text(`: ${value}`, LEFT + 130, ty);
    ty += 15;
  });

  return doc;
}
