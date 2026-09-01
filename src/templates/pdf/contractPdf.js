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

// --- Terms & Conditions rendering helpers -----------------------------
// These mirror the ad hoc font/color conventions already used above
// (F/FB/INK/RULE/HEAD_FILL) rather than introducing a new styling system.

function ensureSpace(doc, y, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed > bottom) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function heading(doc, text, y) {
  y = ensureSpace(doc, y, 30);
  doc.font(FB).fontSize(11).fillColor(INK).text(text, MARGIN, y, { width: CONTENT_W });
  return doc.y + 6;
}

// Renders "<num>  <text>" with the number bold and the body regular,
// wrapping the body within the content width.
function clause(doc, num, text, y) {
  const numW = 26;
  const estHeight = doc.font(F).fontSize(9).heightOfString(text, { width: CONTENT_W - numW, lineGap: 2 });
  y = ensureSpace(doc, y, estHeight + 10);
  doc.font(FB).fontSize(9).fillColor(INK).text(num, MARGIN, y, { width: numW });
  doc.font(F).fontSize(9).fillColor('#333333')
    .text(text, MARGIN + numW, y, { width: CONTENT_W - numW, lineGap: 2 });
  return doc.y + 6;
}

function paragraph(doc, text, y, opts = {}) {
  const estHeight = doc.font(F).fontSize(9).heightOfString(text, { width: CONTENT_W, lineGap: 2 });
  y = ensureSpace(doc, y, estHeight + 8);
  doc.font(opts.bold ? FB : F).fontSize(9).fillColor(opts.color || '#333333')
    .text(text, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  return doc.y + 6;
}

const CANCELLATION_ROWS = [
  ['More than 8 months before Event Date', '£1000 Cancellation Charge'],
  ['4-8 months before Event Date', '50% of Price payable'],
  ['0-3 months before Event Date', '100% of Price payable'],
];

function drawCancellationTable(doc, y) {
  const col1W = CONTENT_W * 0.5;
  const col2W = CONTENT_W - col1W;
  const rowPadY = 6;

  function rowHeight(c1, c2, bold = false) {
    doc.font(bold ? FB : F).fontSize(8.5);
    const h1 = doc.heightOfString(c1, { width: col1W - 12, lineGap: 1.5 });
    const h2 = doc.heightOfString(c2, { width: col2W - 12, lineGap: 1.5 });
    return Math.max(h1, h2) + rowPadY * 2;
  }

  function drawRow(c1, c2, { bold = false, fill = null } = {}) {
    const h = rowHeight(c1, c2, bold);
    y = ensureSpace(doc, y, h);
    if (fill) {
      doc.save().rect(MARGIN, y, CONTENT_W, h).fill(fill).restore();
    }
    doc.save().rect(MARGIN, y, col1W, h).lineWidth(0.5).strokeColor(RULE).stroke().restore();
    doc.save().rect(MARGIN + col1W, y, col2W, h).lineWidth(0.5).strokeColor(RULE).stroke().restore();
    doc.font(bold ? FB : F).fontSize(8.5).fillColor(INK)
      .text(c1, MARGIN + 6, y + rowPadY, { width: col1W - 12, lineGap: 1.5 });
    doc.font(bold ? FB : F).fontSize(8.5).fillColor(INK)
      .text(c2, MARGIN + col1W + 6, y + rowPadY, { width: col2W - 12, lineGap: 1.5 });
    y += h;
  }

  drawRow(
    'Date of Client Cancellation',
    'Cancellation Costs calculated as a percentage (%) of the Price payable for the Event, as confirmed in the Contract Details.',
    { bold: true, fill: HEAD_FILL },
  );
  for (const [c1, c2] of CANCELLATION_ROWS) drawRow(c1, c2);
  drawRow(
    'Please Note',
    'For very late cancellations you may also be required to pay compensation to us for additional unavoidable costs we incur as a result of your cancellation, if our costs exceed the above Cancellation Costs. For example, for staffing, pre-purchased products.',
  );

  return y + 8;
}

function renderTermsAndConditions(doc, { companyName, contactEmail }, y) {
  y = heading(doc, 'Agreed Terms and Conditions', y);

  y = heading(doc, '1. Definitions', y);
  y = paragraph(doc, `Price: the charges payable by the Client for the supply of the Services by ${companyName}, as set out in the Contract Details.`, y);
  y = paragraph(doc, 'Event Details: the date, location in which ' + companyName + ' will provide its Services, as set out in the Contract Details.', y);
  y = paragraph(doc, `Services: the DJ entertainment package and associated services as further described in the Contract Details.`, y);

  y = heading(doc, '2. Package & Supply of Services', y);
  y = clause(doc, '2.1', `${companyName} shall perform the Services and provide the Package on Event Date for the duration of the Event Period.`, y);
  y = clause(doc, '2.2', `In supplying the Services, ${companyName} shall perform the Services with reasonable care and skill.`, y);
  y = clause(doc, '2.3', `${companyName} does not warrant that the Services will be uninterrupted or error-free. There may be brief stoppages or technical issues during the Event and ${companyName} will use reasonable endeavours to rectify such issues.`, y);
  y = clause(doc, '2.4', `The Client may request a date change prior to the Event Date or a variation to the Package. Such change may be subject to additional charges or Cancellation Costs (as set out at 5.7) if such date is not available. ${companyName} shall at their sole discretion confirm (in writing) if such change can be accommodated.`, y);

  y = heading(doc, "3. Client's Obligations", y);
  y = clause(doc, '3.1', `The Client shall co-operate with ${companyName} in all matters relating to the Services.`, y);
  y = clause(doc, '3.2', `If ${companyName}'s performance of its obligations under the Contract is prevented or delayed by any act or omission of the Client (or venue staff) ${companyName} shall: a) not be liable for any costs, charges or losses sustained or incurred by the Client that arise directly or indirectly from such prevention or delay; and b) be entitled to payment of the Charges despite any such prevention or delay.`, y);

  y = heading(doc, '4. Charges and Payment', y);
  y = clause(doc, '4.1', `In consideration for the provision of the Services, the Client shall pay ${companyName} the Charges in accordance with the Contract Details.`, y);
  y = clause(doc, '4.2', `The Deposit shall be deducted from the final payment. Once payment has been received, ${companyName}'s sole obligation is to provide the Services subject to the terms of this Contract.`, y);

  y = heading(doc, "5. Liability & Cancellation - Client's Attention Is Particularly Drawn to This Clause", y);
  y = clause(doc, '5.1', 'Nothing in the Contract limits any liability where it is unlawful to do so.', y);
  y = clause(doc, '5.2', `${companyName} shall not be liable to the Client for any losses, damages, costs or expenses which are not reasonably foreseeable. Subject to 5.1, ${companyName}'s total liability to the Client shall be limited to 50% of the total Price payable under this Contract.`, y);
  y = clause(doc, '5.3', `Client shall be responsible for any loss of or damage to any of ${companyName}'s equipment arising out of or in connection with any damage, misuse, theft, mishandling of ${companyName}'s equipment at the Event by the Client or their guests (unless such damage is caused by ${companyName}). The Client agrees to reimburse ${companyName} in full to remedy any such defects/damages to ensure that all ${companyName} equipment is in the same condition as it was prior to the Event.`, y);
  y = clause(doc, '5.4', `${companyName} may cancel the Contract with immediate effect if: (i) You fail to make any payments as specified in the Contract Details; or (ii) You commit a serious breach of any term of this Contract.`, y);
  y = clause(doc, '5.5', `You may end your contract with us. However, your rights to any refund of the Price, or part thereof, will depend on when you decide to end your Contract or the reason in which the contract is ended. If you wish to cancel your Event, for whatever reason, you must contact us in writing${contactEmail ? ` (which can be by email to ${contactEmail})` : ''}. Unless we agree otherwise with you, your cancellation will come into effect on the date that we confirm receipt of your request to cancel.`, y);
  y = clause(doc, '5.6', 'Except where we are at fault, if you cancel your Event or this Contract, you agree that the Cancellation Costs set out in the Cancellation Costs Table (below) will apply and you agree that they will be payable by you to us.', y);
  y = clause(doc, '5.7', 'CANCELLATIONS COSTS TABLE - FOR CANCELLATIONS WHERE WE ARE NOT AT FAULT. The below Cancellation Costs have been carefully calculated as a pre-estimate only of our losses that directly result from your Event cancellation. This includes the costs of Services provided to you before cancellation, the unavoidable expenses we will incur and our direct loss of profit (including the value of your booked date and likelihood of us being able to rebook your cancelled Event).', y);
  y = drawCancellationTable(doc, y);
  y = paragraph(doc, 'The above Cancellation Costs will not apply if you cancel because we have breached our own obligations to you under your Contract.', y);

  y = heading(doc, '6. General', y);
  y = clause(doc, '6.1', `Force majeure. Neither party shall be in breach of the Contract nor liable for delay in performing, or failure to perform, any of its obligations under the Contract if such delay or failure result from events, circumstances or causes beyond its reasonable control. This includes but is not limited to any delay or failure to perform as a result of or in connection with acts of God (flood, drought, earthquake, other natural disaster, severe weather warning or adverse weather event); collapse of buildings, fire, explosion or accident; environmental issues which are not reasonably treatable/remediable; epidemic or pandemic; any law or any action taken by a government or public authority, including without limitation imposing an export or import restriction, quota or prohibition; and interruption or failure of utility service.`, y);
  y = clause(doc, '6.2', `${companyName} Packages. Packages are subject to Venue restrictions on power supply, smoke alarms, capacity, timing and other Venue rules and regulations. We shall not be liable for any such issues arising out of or in connection with the same. Any additional costs charged by the Venue to ${companyName} will be passed to the Client. ${companyName} reserve the right to change the Package to enhance the look and performance at their sole discretion. Please note, Dry Ice Machine service is subject to pellets being available and not melted prior to Event. Glow sticks are subject to ordered supply. ${companyName} do not take responsibility for any faulty or defective products.`, y);
  y = clause(doc, '6.3', 'Entire agreement. The Contract constitutes the entire agreement between the parties and supersedes and extinguishes all previous agreements, promises, assurances, warranties, representations and understandings between them, whether written or oral, relating to its subject matter.', y);
  y = clause(doc, '6.4', 'Variation. No variation of the Contract shall be effective unless it is in writing and signed by the parties (or their authorised representatives).', y);
  y = clause(doc, '6.5', 'Governing Law & Jurisdiction. The Contract, and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation, shall be governed by, and construed in accordance with the law of England and Wales and each party irrevocably agrees that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with the Contract or its subject matter or formation.', y);

  return y;
}

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

  // Deposit / balance schedule and bank payment instructions — pulled from
  // the company's own record rather than hardcoded.
  doc.font(F).fontSize(9.5).fillColor(INK)
    .text(`Deposit payable £${deposit} on signature of Contract. Remaining balance of price payable 1 week before ${eventDate}.`,
      MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 4;

  const bankParts = [
    company?.bank_name && `Bank Name: ${company.bank_name}`,
    company?.name && `Account Name: ${company.name}`,
    company?.account_number && `Account No: ${company.account_number}`,
    company?.sort_code && `Sort Code: ${company.sort_code}`,
  ].filter(Boolean);
  if (bankParts.length) {
    doc.font(F).fontSize(9.5).fillColor('#cc0000')
      .text(`Please make payment to: ${bankParts.join(', ')}`, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
    y = doc.y + 14;
  } else {
    y += 14;
  }

  // Terms & Conditions — full legal terms, mirroring the legacy Laravel
  // contract's "Agreed Terms and Conditions" section (clauses 1-6),
  // including the liability cap, cancellation costs table, entire
  // agreement clause and governing law / jurisdiction clause.
  doc.addPage();
  y = MARGIN;
  y = renderTermsAndConditions(doc, { companyName, contactEmail: company?.email }, y);
  y += 10;

  // Signatures — two side-by-side boxes, each a rule with a signature image
  // (or "(unsigned)") and a name underneath.
  y = ensureSpace(doc, y + 24, 100);
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
