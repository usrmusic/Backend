/* Signed contract — "Charcoal & Champagne" design.

   Reproduces the client-supplied reference USR_Contract_Charcoal_Champagne.pdf:
   page 1 is the contract summary (logo + company block, client/date/venue,
   charcoal itemised table, totals, bank footer); every following page carries
   the charcoal "THE DETAILS" band with the Terms & Conditions, ending in the
   signature table.

   Coordinates, sizes and colours were read straight out of the reference
   PDF's content streams, so they're kept as literal numbers rather than
   derived. All y values are top-down (PDFKit), i.e. 841.89 minus the
   reference's PDF-space y. Text is positioned by BASELINE (see `at()`), which
   is how the reference itself was laid out. */

import { fileURLToPath } from 'node:url';
import { round2 } from '../../utils/money.js';

const PAGE_W = 595.28;
const L = 38;              // page-1 left edge
const R = 557.28;          // page-1 right edge
const BODY_X = 45;         // T&C pages body column
const BODY_W = 504;
const BODY_BOTTOM = 785;   // nothing in the flow may extend below this

// Palette (from the reference).
const CHARCOAL = '#26282B';
const TEXT = '#383A3C';
const MUTED = '#8B8176';
const CHAMPAGNE = '#E5D4B8';
const RULE_CHAMPAGNE = '#C8BDAE';
const RULE_LIGHT = '#E2DCD2';
const CREAM = '#F6F2EB';
const CREAM_LIGHT = '#FAF8F4';

// DejaVu Sans is what the reference was set in; bundled so the render is
// identical on any host (PDFKit's built-ins are Helvetica only).
const F = 'DejaVu';
const FB = 'DejaVu-Bold';
const FONT_FILES = {
  [F]: fileURLToPath(new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url)),
  [FB]: fileURLToPath(new URL('../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url)),
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- formatting

function toDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// "10 September 2028"
function fmtDateLong(d) {
  const dt = toDate(d);
  return dt ? `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}` : '';
}

// "10 NOV 2026"
function fmtDateShort(d) {
  const dt = toDate(d);
  return dt ? `${dt.getDate()} ${MONTHS[dt.getMonth()].slice(0, 3).toUpperCase()} ${dt.getFullYear()}` : '';
}

const withCommas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Line items: "£1,450" for whole pounds, "£1,450.50" otherwise.
function gbpShort(v) {
  const n = round2(v);
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  if (whole) return `£${withCommas(String(Math.round(n)))}`;
  const [i, f] = n.toFixed(2).split('.');
  return `£${withCommas(i)}.${f}`;
}

// Totals: always "£6,800.00".
function gbpLong(v) {
  const [i, f] = round2(v).toFixed(2).split('.');
  return `£${withCommas(i)}.${f}`;
}

// "08008407447" -> "0800 840 7447"; anything not a plain 11-digit UK number
// is printed as stored.
function fmtPhone(p) {
  const s = String(p || '').replace(/\s+/g, '');
  if (/^08\d{9}$/.test(s)) return `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7)}`;
  if (/^0\d{10}$/.test(s)) return `${s.slice(0, 5)} ${s.slice(5)}`;
  return String(p || '');
}

// "608371" -> "60-83-71"
function fmtSortCode(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : String(s || '');
}

// ------------------------------------------------------------------ drawing

// Draw a single line of text with its BASELINE at `baseline`.
// align: 'left' (x = left edge), 'right' (x = right edge), 'center' (x = centre).
function at(doc, str, x, baseline, { font = F, size, color = TEXT, align = 'left' } = {}) {
  const s = String(str ?? '');
  doc.font(font).fontSize(size).fillColor(color);
  const w = doc.widthOfString(s);
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const top = baseline - (doc._font.ascender / 1000) * size;
  doc.text(s, left, top, { lineBreak: false });
  return w;
}

function hline(doc, x1, x2, y, color, width) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}

// Wrapped paragraph with a fixed leading. Returns the paragraph's height.
function block(doc, str, x, top, { font = F, size, color = TEXT, leading, width = BODY_W } = {}) {
  doc.font(font).fontSize(size);
  const lineGap = leading - doc.currentLineHeight(true);
  doc.fillColor(color).text(String(str), x, top, { width, lineGap });
  return doc.y - top;
}

function measure(doc, str, { font = F, size, leading, width = BODY_W }) {
  doc.font(font).fontSize(size);
  const lineGap = leading - doc.currentLineHeight(true);
  return doc.heightOfString(String(str), { width, lineGap });
}

function bankLine(company, companyName) {
  const parts = ['BANK TRANSFER'];
  if (company?.bank_name) parts.push(company.bank_name);
  parts.push(companyName);
  if (company?.account_number) parts.push(`A/C ${company.account_number}`);
  if (company?.sort_code) parts.push(`Sort ${fmtSortCode(company.sort_code)}`);
  return parts.join('  |  ');
}

function pageLabel(n) {
  return `EVENT CONTRACT  ·  ${String(n).padStart(2, '0')}`;
}

function footerFirst(doc, ctx) {
  hline(doc, L, R, 807.89, RULE_CHAMPAGNE, 0.7);
  at(doc, ctx.bank, L, 821, { font: 'Helvetica-Bold', size: 7, color: MUTED });
  at(doc, pageLabel(ctx.page), R, 821.89, { font: FB, size: 8.2, color: MUTED, align: 'right' });
}

function footerDetails(doc, ctx) {
  hline(doc, 39, 556.28, 805.89, RULE_LIGHT, 0.7);
  at(doc, ctx.bank, L, 820.9, { font: 'Helvetica-Bold', size: 7, color: MUTED });
  at(doc, pageLabel(ctx.page), 556.28, 819.89, { font: FB, size: 7, color: MUTED, align: 'right' });
}

// New T&C page: charcoal band + footer. Returns the y where the flow resumes.
function detailsPage(doc, ctx) {
  doc.addPage();
  ctx.page += 1;
  doc.save().rect(0, 0, PAGE_W, 86).fill(CHARCOAL).restore();
  at(doc, 'THE DETAILS', 39, 42, { font: FB, size: 19, color: '#FFFFFF' });
  at(doc, 'EVENT CONTRACT  /  TERMS & CONDITIONS', 39, 63, { font: FB, size: 8, color: CHAMPAGNE });
  footerDetails(doc, ctx);
  return 113.6;
}

// Plain continuation page for an item list too long for page 1.
function continuationPage(doc, ctx) {
  doc.addPage();
  ctx.page += 1;
  footerFirst(doc, ctx);
  return 40;
}

// ---------------------------------------------------------------- page one

function drawItemsHeader(doc, top) {
  doc.save().roundedRect(L, top, R - L, 30, 8).fill(CHARCOAL).restore();
  const b = top + 20;
  const o = { font: FB, size: 8.5, color: '#FFFFFF' };
  at(doc, '#', 56, b, o);
  at(doc, 'DESCRIPTION', 86, b, o);
  at(doc, 'QTY', 419.5, b, { ...o, align: 'right' });
  at(doc, 'UNIT PRICE', 488, b, { ...o, align: 'right' });
  at(doc, 'TOTAL', 544, b, { ...o, align: 'right' });
  return top + 30;
}

function drawItemRow(doc, top, idx, line) {
  const b = top + 15;
  at(doc, String(idx).padStart(2, '0'), 52, b, { size: 8.1, color: MUTED });
  // Long equipment names are clipped to the description column.
  doc.save().rect(86, top, 300, 21).clip();
  at(doc, line.name, 86, b, { size: 8.9 });
  doc.restore();
  at(doc, String(line.quantity), 419.5, b, { size: 8.9, align: 'right' });
  if (round2(line.total) === 0) {
    at(doc, 'Included', 544, b, { size: 8.9, color: MUTED, align: 'right' });
  } else {
    at(doc, gbpShort(line.unit), 488, b, { size: 8.9, align: 'right' });
    at(doc, gbpShort(line.total), 544, b, { font: FB, size: 8.9, color: CHARCOAL, align: 'right' });
  }
  hline(doc, L, R, top + 21, RULE_LIGHT, 0.55);
  return top + 21;
}

function drawPageOne(doc, ctx, d) {
  // Logo (or the company name in type — never another company's mark).
  let drewLogo = false;
  if (d.logo) {
    try {
      doc.image(d.logo, 40, 30, { fit: [180, 63], valign: 'center' });
      drewLogo = true;
    } catch (_) { /* unreadable bytes — fall through to type */ }
  }
  if (!drewLogo) at(doc, d.companyName, 40, 72, { font: FB, size: 26, color: CHARCOAL });

  // Company block, right-aligned.
  at(doc, d.companyName.toUpperCase(), R, 38, { font: FB, size: 15, color: CHARCOAL, align: 'right' });
  if (d.addr1) at(doc, d.addr1, R, 56, { size: 11, align: 'right' });
  if (d.addr2) at(doc, d.addr2, R, 73, { size: 11, align: 'right' });
  if (d.contact) at(doc, d.contact, R, 91, { size: 9.5, color: MUTED, align: 'right' });

  hline(doc, L, R, 116, RULE_CHAMPAGNE, 0.7);

  // Client / date / venue + issue date.
  at(doc, d.clientName, L, 134, { size: 10.8 });
  if (d.eventDate) at(doc, d.eventDate, L, 156, { size: 10.8 });
  if (d.venue) at(doc, d.venue, L, 178, { size: 10.8 });
  at(doc, `ISSUED  ${d.issued}`, R, 132, { font: FB, size: 10, color: MUTED, align: 'right' });

  footerFirst(doc, ctx);

  // Itemised table.
  let y = drawItemsHeader(doc, 235);
  d.lines.forEach((line, i) => {
    if (y + 21 > BODY_BOTTOM) {
      y = drawItemsHeader(doc, continuationPage(doc, ctx));
    }
    y = drawItemRow(doc, y, i + 1, line);
  });

  // Deposit line.
  let depositBase = y + 23;
  if (d.deposit > 0) {
    if (depositBase > BODY_BOTTOM) depositBase = continuationPage(doc, ctx) + 10;
    at(doc, `A deposit of ${gbpShort(d.deposit)} is payable on signing this contract.`, L, depositBase, { size: 8.9 });
  }

  // Totals — sit at the reference's fixed position near the foot of the page,
  // pushed down (or onto a new page) only when the item list is long.
  let t = Math.max(667, depositBase + 45);
  if (t + 63 > 782) t = continuationPage(doc, ctx) + 40;
  const label = { font: FB, size: 11.5, color: MUTED, align: 'right' };
  const value = { font: FB, size: 11.5, color: CHARCOAL, align: 'right' };
  at(doc, 'TOTAL', 410, t, label);
  at(doc, gbpLong(d.total), R, t, value);
  at(doc, 'PAYMENT RECEIVED', 410, t + 23, label);
  at(doc, gbpLong(d.paid), R, t + 23, value);
  at(doc, 'REMAINING BALANCE', 410, t + 46, label);
  at(doc, gbpLong(d.balance), R, t + 46, value);
  at(doc, 'The remaining balance is payable no later than seven days before the event date.',
    R, t + 63, { size: 8.1, align: 'right' });

  at(doc, 'By signing this Agreement, the Client confirms acceptance of the agreed package and agrees to be bound by its Terms and Conditions.',
    PAGE_W / 2, 796, { size: 7.57, align: 'center' });
}

// ------------------------------------------------------ terms & conditions

/* Flow state for the T&C pages. Spacing reproduces the reference:
   body 8.2pt on a 13pt leading with 7pt between paragraphs; headings 11pt on
   15pt with 15.2pt above and 7.8pt below. */
function makeFlow(doc, ctx) {
  const f = { y: 0, afterPara: false };

  f.ensure = (h) => {
    if (f.y + h > BODY_BOTTOM) {
      f.y = detailsPage(doc, ctx);
      f.afterPara = false;
    }
  };
  f.para = (str, { size = 8.2, leading = 13, gap = 7 } = {}) => {
    const h = measure(doc, str, { size, leading });
    f.ensure(h);
    block(doc, str, BODY_X, f.y, { size, leading });
    f.y += h + gap;
    f.afterPara = true;
  };
  f.heading = (str) => {
    if (f.afterPara) f.y += 8.2;
    // Keep a heading with at least two lines of what follows it.
    f.ensure(15 + 7.8 + 26);
    block(doc, str, BODY_X, f.y, { font: FB, size: 11, color: CHARCOAL, leading: 15, width: 520 });
    f.y = doc.y + 7.8;
    f.afterPara = false;
  };
  return f;
}

const CANCELLATION_ROWS = [
  ['More than 8 months before event', '£1,000'],
  ['4–8 months before event', '50% of package price'],
  ['0–3 months before event', '100% of package price'],
];

function drawCancellationTable(doc, f) {
  const h = 29 + 30 * CANCELLATION_ROWS.length;
  f.ensure(h);
  const top = f.y;
  const x = BODY_X;
  const w = 495;

  doc.save().rect(x, top, w, 29).fill(CREAM).restore();
  at(doc, 'WHEN A CLIENT CANCELS', x + 13, top + 16.5, { size: 7.5 });
  at(doc, 'CANCELLATION CHARGE', x + 318, top + 16.5, { size: 7.5 });

  let y = top + 29;
  CANCELLATION_ROWS.forEach(([when, charge], i) => {
    if (i % 2 === 1) doc.save().rect(x, y, w, 30).fill(CREAM_LIGHT).restore();
    at(doc, when, x + 13, y + 17, { size: 8 });
    at(doc, charge, x + 318, y + 17, { size: 8 });
    y += 30;
    hline(doc, x, x + w, y, RULE_LIGHT, 0.4);
  });
  hline(doc, x, x + w, top + 29, RULE_LIGHT, 0.4);
  f.y = y + 10;
  f.afterPara = false;
}

function drawTerms(doc, f, { companyName: c, contactEmail }) {
  f.para(`Here’s the important stuff. These terms form part of your event booking agreement with ${c}.`, { size: 8.4 });

  f.heading('1. Definitions');
  f.para(`Price: the charges payable by the Client for the supply of the Services by ${c}, as set out in the Contract Details.`);
  f.para(`Event Details: the date, location in which ${c} will provide its Services, as set out in the Contract Details.`);
  f.para('Services: the DJ entertainment package and associated services as further described in the Contract Details.');

  f.heading('2. Package & Supply of Services');
  f.para(`2.1   ${c} shall perform the Services and provide the Package on Event Date for the duration of the Event Period.`);
  f.para(`2.2   In supplying the Services, ${c} shall perform the Services with reasonable care and skill.`);
  f.para(`2.3   ${c} does not warrant that the Services will be uninterrupted or error-free. There may be brief stoppages or technical issues during the Event and ${c} will use reasonable endeavours to rectify such issues.`);
  f.para(`2.4   The Client may request a date change prior to the Event Date or a variation to the Package. Such change may be subject to additional charges or Cancellation Costs (as set out at 5.7) if such date is not available. ${c} shall at their sole discretion confirm (in writing) if such change can be accommodated.`);

  f.heading("3. Client's Obligations");
  f.para(`3.1   The Client shall co-operate with ${c} in all matters relating to the Services.`);
  f.para(`3.2   If ${c}'s performance of its obligations under the Contract is prevented or delayed by any act or omission of the Client (or venue staff) ${c} shall: a) not be liable for any costs, charges or losses sustained or incurred by the Client that arise directly or indirectly from such prevention or delay; and b) be entitled to payment of the Charges despite any such prevention or delay.`);

  f.heading('4. Charges and Payment');
  f.para(`4.1   In consideration for the provision of the Services, the Client shall pay ${c} the Charges in accordance with the Contract Details.`);
  f.para(`4.2   The Deposit shall be deducted from the final payment. Once payment has been received, ${c}'s sole obligation is to provide the Services subject to the terms of this Contract.`);

  f.heading("5. Liability & Cancellation - Client's Attention Is Particularly Drawn to This Clause");
  f.para('5.1   Nothing in the Contract limits any liability where it is unlawful to do so.');
  f.para(`5.2   ${c} shall not be liable to the Client for any losses, damages, costs or expenses which are not reasonably foreseeable. Subject to 5.1, ${c}'s total liability to the Client shall be limited to 50% of the total Price payable under this Contract.`);
  f.para(`5.3   Client shall be responsible for any loss of or damage to any of ${c}'s equipment arising out of or in connection with any damage, misuse, theft, mishandling of ${c}'s equipment at the Event by the Client or their guests (unless such damage is caused by ${c}). The Client agrees to reimburse ${c} in full to remedy any such defects/damages to ensure that all ${c} equipment is in the same condition as it was prior to the Event.`);
  f.para(`5.4   ${c} may cancel the Contract with immediate effect if: (i) You fail to make any payments as specified in the Contract Details; or (ii) You commit a serious breach of any term of this Contract.`);
  f.para(`5.5   You may end your contract with us. However, your rights to any refund of the Price, or part thereof, will depend on when you decide to end your Contract or the reason in which the contract is ended. If you wish to cancel your Event, for whatever reason, you must contact us in writing${contactEmail ? ` (which can be by email to ${contactEmail})` : ''}. Unless we agree otherwise with you, your cancellation will come into effect on the date that we confirm receipt of your request to cancel.`);
  f.para('5.6   Except where we are at fault, if you cancel your Event or this Contract, you agree that the Cancellation Costs set out in the Cancellation Costs Table (below) will apply and you agree that they will be payable by you to us.');
  f.para('5.7   CANCELLATIONS COSTS TABLE - FOR CANCELLATIONS WHERE WE ARE NOT AT FAULT. The below Cancellation Costs have been carefully calculated as a pre-estimate only of our losses that directly result from your Event cancellation. This includes the costs of Services provided to you before cancellation, the unavoidable expenses we will incur and our direct loss of profit (including the value of your booked date and likelihood of us being able to rebook your cancelled Event).', { gap: 10 });
  drawCancellationTable(doc, f);
  f.para('For very late cancellations you may also be required to pay compensation for additional unavoidable costs we incur if our costs exceed the above cancellation costs, for example staffing or pre-purchased products.', { size: 7.5, leading: 11 });
  f.para('The above cancellation costs will not apply if you cancel because we have breached our own obligations to you under your Contract.', { size: 7.5, leading: 11 });

  f.heading('6. General');
  f.para('6.1   Force majeure. Neither party shall be in breach of the Contract nor liable for delay in performing, or failure to perform, any of its obligations under the Contract if such delay or failure result from events, circumstances or causes beyond its reasonable control. This includes but is not limited to any delay or failure to perform as a result of or in connection with acts of God (flood, drought, earthquake, other natural disaster, severe weather warning or adverse weather event); collapse of buildings, fire, explosion or accident; environmental issues which are not reasonably treatable/remediable; epidemic or pandemic; any law or any action taken by a government or public authority, including without limitation imposing an export or import restriction, quota or prohibition; and interruption or failure of utility service.');
  f.para(`6.2   ${c} Packages. Packages are subject to Venue restrictions on power supply, smoke alarms, capacity, timing and other Venue rules and regulations. We shall not be liable for any such issues arising out of or in connection with the same. Any additional costs charged by the Venue to ${c} will be passed to the Client. ${c} reserve the right to change the Package to enhance the look and performance at their sole discretion. Please note, Dry Ice Machine service is subject to pellets being available and not melted prior to Event. Glow sticks are subject to ordered supply. ${c} do not take responsibility for any faulty or defective products.`);
  f.para('6.3   Entire agreement. The Contract constitutes the entire agreement between the parties and supersedes and extinguishes all previous agreements, promises, assurances, warranties, representations and understandings between them, whether written or oral, relating to its subject matter.');
  f.para('6.4   Variation. No variation of the Contract shall be effective unless it is in writing and signed by the parties (or their authorised representatives).');
  f.para('6.5   Governing Law & Jurisdiction. The Contract, and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation, shall be governed by, and construed in accordance with, the law of England and Wales and each party irrevocably agrees that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with the Contract or its subject matter or formation.');
}

// ---------------------------------------------------------------- signatures

function drawSignatures(doc, f, d) {
  // Heading + note + table (header 33, names, signature row tall enough for
  // the signature image, date row).
  const tableH = 33 + 19.5 + 50 + 34 + 14.5;
  f.y += 40;
  f.afterPara = false;
  f.ensure(15 + 7.8 + 30 + tableH);
  f.heading('Let’s make it official');
  f.y -= 7.8 - 4;
  f.para('By signing below, both parties confirm the agreed package, payment schedule and the Terms and Conditions set out in this Contract.',
    { size: 7.5, leading: 11, gap: 8 });

  const top = f.y;
  const x = BODY_X;
  const cols = [x + 12, x + 259];
  doc.save().rect(x, top, 494, 33).fill(CREAM).restore();
  at(doc, 'CLIENT', cols[0], top + 18.5, { size: 7.5 });
  at(doc, d.companyName.toUpperCase(), cols[1], top + 18.5, { size: 7.5 });

  const nameB = top + 52.5;
  const sigB = nameB + 50;
  const dateB = sigB + 34;
  const ink = { size: 8.5, color: '#000000' };

  const people = [
    { name: d.clientName, sig: d.signature, date: d.signedDate },
    { name: d.companySigner, sig: d.adminSignature, date: d.signedDate },
  ];
  people.forEach((p, i) => {
    const cx = cols[i];
    at(doc, p.name, cx, nameB, ink);
    const sw = at(doc, 'Signature: __________________________', cx, sigB, ink);
    const labelW = (doc.font(F).fontSize(8.5), doc.widthOfString('Signature: '));
    if (p.sig) {
      try {
        doc.image(p.sig, cx + labelW, sigB - 42, { fit: [sw - labelW, 40], valign: 'bottom' });
      } catch (_) { /* bad image bytes — leave the line blank */ }
    }
    const dw = (doc.widthOfString('Date: '));
    at(doc, 'Date: ______________________________', cx, dateB, ink);
    if (p.date) at(doc, p.date, cx + dw + 4, dateB - 2.5, ink);
  });

  hline(doc, x, x + 494, dateB + 14.5, RULE_LIGHT, 0.5);
  f.y = dateB + 14.5;
}

// --------------------------------------------------------------------- entry

export default function renderContractPdf(doc, {
  event = {},
  user,
  company,
  logo,            // Buffer | null — company logo (see brandAssets.js)
  signature,       // Buffer | null — client's drawn signature
  adminSignature,  // Buffer | null — company's on-file signature
  signedAt,
} = {}) {
  Object.entries(FONT_FILES).forEach(([name, file]) => doc.registerFont(name, file));

  const companyName = company?.name || 'USR Music';
  const total = round2(event?.total_cost_for_equipment);
  const paid = round2((event?.event_payments || []).reduce((s, p) => s + round2(p?.amount), 0));

  const lines = Array.isArray(event?.event_package)
    ? event.event_package.map((p) => {
        const quantity = Number(p.quantity) > 0 ? Number(p.quantity) : 1;
        const totalPrice = p.total_price ?? round2(p.sell_price) * quantity;
        return {
          name: p.equipment?.name || 'Item',
          quantity,
          unit: p.sell_price ?? round2(totalPrice) / quantity,
          total: totalPrice,
        };
      })
    : [];

  const data = {
    logo,
    companyName,
    addr1: [company?.street, company?.city].filter(Boolean).join(', '),
    addr2: [company?.postal_code, company?.postal_code ? 'United Kingdom' : null].filter(Boolean).join(', '),
    contact: [company?.telephone_number && fmtPhone(company.telephone_number), company?.email]
      .filter(Boolean).join('  |  '),
    clientName: user?.name || event?.users_events_user_idTousers?.name || 'Client',
    eventDate: fmtDateLong(event?.date),
    venue: event?.venues?.venue || '',
    issued: fmtDateShort(signedAt || new Date()),
    lines,
    deposit: round2(event?.deposit_amount),
    total,
    paid,
    balance: round2(total - paid),
    signature,
    adminSignature,
    signedDate: fmtDateLong(signedAt || new Date()),
    companySigner: company?.contact_name || companyName,
  };

  const ctx = { page: 1, bank: bankLine(company, companyName) };

  drawPageOne(doc, ctx, data);

  const f = makeFlow(doc, ctx);
  f.y = detailsPage(doc, ctx);
  drawTerms(doc, f, { companyName, contactEmail: company?.email });
  drawSignatures(doc, f, data);

  return doc;
}
