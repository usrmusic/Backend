/* Quote — PDFKit port of usrmusic_rep/resources/views/pdf/quote.blade.php.
   Same header/footer shell as the invoice, titled "Quote"; body differs after
   the totals: a terms paragraph and a two-column signature block instead of
   Payment Received/Remaining. */

import {
  PAGE_W, PAGE_H, LEFT, GREY, BLACK, F, FB,
  num, gbp, fmtDate,
  drawHeader, drawFooter, drawClientDetails, drawItemsList,
} from './shared.js';

// The same terms paragraph the blade hardcodes — not client data, so it lives
// here rather than being threaded through as a parameter.
const TERMS =
  '**All USR packages are subject to venue restrictions on power supply, smoke alarms, capacity, timing and general ' +
  'rules and regulations. Any additional cost set out by the venue will be passed along to the client. USR reserve ' +
  'the right to change package to enhance the look and performance. Please note, Dry Ice Machine service is subject ' +
  'to pellets being available and not melted prior to event. Glow sticks are subject to ordered supply. USR do not ' +
  'take responsibility for faulty products. Deposits are NOT returned for any events cancelled due to non-natural ' +
  'disaster related reasons. If events are cancelled by customer within 8 months of event date then 50% of the ' +
  'remaining balance will need to be paid. The package price may be subject to change following a site visit. All ' +
  'stage money/s will be kept by Unique Soundz Roadshow. Our equipment is covered by PAT testing and also covered ' +
  'up to £10 million Public Liability insurance.';

const AGREEMENT_NOTE =
  'Once this document has been signed and returned along with the agreed deposit. You are agreeing to book USR ' +
  'for your event and will enter the agreement.';

export default function renderQuotePdf(doc, {
  event = {},
  companyDetails = {},
  standardPackage = [],
  extraEquipment = [],
  djName = '',
  logo = null,
  adminSignature = null,
  clientName = '',
  quoteDate = null,
} = {}) {
  drawHeader(doc, companyDetails, logo, 'Quote');
  drawFooter(doc, companyDetails);

  drawClientDetails(doc, {
    name: event?.users_events_user_idTousers?.name,
    date: fmtDate(event?.date),
    venue: event?.venues?.venue,
  });

  doc.y = 182;
  drawItemsList(doc, { djName, standardPackage, extraEquipment });

  // Totals — the quote only ever shows Total Price (with an optional VAT
  // breakdown); there is no Received/Remaining as on the invoice.
  const total = num(event?.total_cost_for_equipment);
  const totals = [];
  if (event?.is_vat_available_for_the_event && companyDetails?.vat) {
    totals.push(['Package Price', gbp(event.event_amount_without_vat)]);
    totals.push(['VAT', gbp(event.vat_value)]);
  }
  totals.push(['Total Price', gbp(total)]);

  let ty = Math.max(doc.y + 60, 300);
  totals.forEach(([label, value]) => {
    doc.font(F).fontSize(9).fillColor(GREY).text(label, LEFT, ty);
    doc.font(F).fontSize(9).fillColor(GREY).text(`: ${value}`, LEFT + 130, ty);
    ty += 15;
  });

  // Terms — justified body text, matching `.description { font-size: 8px }`.
  let ny = ty + 20;
  if (ny > PAGE_H - 160) {
    doc.addPage();
    ny = 40;
  }
  doc.font(F).fontSize(7.5).fillColor(BLACK)
    .text(TERMS, LEFT, ny, { width: PAGE_W - LEFT - 45, align: 'justify' });
  ny = doc.y + 10;
  doc.font(F).fontSize(7.5).fillColor(BLACK)
    .text(AGREEMENT_NOTE, LEFT, ny, { width: PAGE_W - LEFT - 45, align: 'justify' });

  // Signature block — left: admin's pre-signed mark + fixed name; right: the
  // client's name and today's date, both awaiting the client's own signature
  // once the quote comes back. This mirrors the blade's two-column layout.
  let sy = doc.y + 30;
  if (sy > PAGE_H - 100) {
    doc.addPage();
    sy = 40;
  }

  if (adminSignature) {
    try {
      doc.image(adminSignature, LEFT, sy, { fit: [100, 40] });
    } catch (_) {
      // Corrupt asset — leave the line blank rather than fail the render.
    }
  }
  doc.font(F).fontSize(8).fillColor(GREY)
    .text('[ Gurpreet Sanghera (USR) ]', LEFT, sy + 44);

  const rightX = PAGE_W / 2 + 10;
  doc.font(F).fontSize(8).fillColor(GREY)
    .text(`[ ${clientName || ''} ]`, rightX, sy + 44);
  doc.font(F).fontSize(8).fillColor(GREY)
    .text(`[ ${fmtDate(quoteDate || new Date())} ]`, rightX, sy + 74);

  return doc;
}
