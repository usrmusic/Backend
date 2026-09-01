// Renders the signed contract HTML used for PDF generation.
// Mirrors the structure of resources/views/contracts/template_view.blade.php
// from the Laravel app — header / event details / terms / signatures.

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
}

function fmtMoney(n) {
  if (n == null || n === '') return '0.00';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toFixed(2);
}

const CANCELLATION_ROWS = [
  ['More than 8 months before Event Date', '£1000 Cancellation Charge'],
  ['4-8 months before Event Date', '50% of Price payable'],
  ['0-3 months before Event Date', '100% of Price payable'],
];

// Full "Agreed Terms and Conditions" section, mirroring the legacy Laravel
// contract (resources/views/contracts/template_view.blade.php) clauses 1-6:
// definitions, package/supply of services, client obligations, charges and
// payment, liability & cancellation (with the cancellation costs table),
// and the general clauses (force majeure, entire agreement, governing law).
function renderTermsAndConditions({ companyName, contactEmail }) {
  return `
    <h2>Agreed Terms and Conditions</h2>

    <h3>1. Definitions</h3>
    <p><strong>Price:</strong> the charges payable by the Client for the supply of the Services by ${companyName}, as set out in the Contract Details.</p>
    <p><strong>Event Details:</strong> the date, location in which ${companyName} will provide its Services, as set out in the Contract Details.</p>
    <p><strong>Services:</strong> the DJ entertainment package and associated services as further described in the Contract Details.</p>

    <h3>2. Package &amp; Supply of Services</h3>
    <p><strong>2.1</strong> ${companyName} shall perform the Services and provide the Package on Event Date for the duration of the Event Period.</p>
    <p><strong>2.2</strong> In supplying the Services, ${companyName} shall perform the Services with reasonable care and skill.</p>
    <p><strong>2.3</strong> ${companyName} does not warrant that the Services will be uninterrupted or error-free. There may be brief stoppages or technical issues during the Event and ${companyName} will use reasonable endeavours to rectify such issues.</p>
    <p><strong>2.4</strong> The Client may request a date change prior to the Event Date or a variation to the Package. Such change may be subject to additional charges or Cancellation Costs (as set out at 5.7) if such date is not available. ${companyName} shall at their sole discretion confirm (in writing) if such change can be accommodated.</p>

    <h3>3. Client's Obligations</h3>
    <p><strong>3.1</strong> The Client shall co-operate with ${companyName} in all matters relating to the Services.</p>
    <p><strong>3.2</strong> If ${companyName}'s performance of its obligations under the Contract is prevented or delayed by any act or omission of the Client (or venue staff) ${companyName} shall: a) not be liable for any costs, charges or losses sustained or incurred by the Client that arise directly or indirectly from such prevention or delay; and b) be entitled to payment of the Charges despite any such prevention or delay.</p>

    <h3>4. Charges and Payment</h3>
    <p><strong>4.1</strong> In consideration for the provision of the Services, the Client shall pay ${companyName} the Charges in accordance with the Contract Details.</p>
    <p><strong>4.2</strong> The Deposit shall be deducted from the final payment. Once payment has been received, ${companyName}'s sole obligation is to provide the Services subject to the terms of this Contract.</p>

    <h3>5. Liability &amp; Cancellation - <u>Client's Attention Is Particularly Drawn to This Clause</u></h3>
    <p><strong>5.1</strong> Nothing in the Contract limits any liability where it is unlawful to do so.</p>
    <p><strong>5.2</strong> ${companyName} shall not be liable to the Client for any losses, damages, costs or expenses which are not reasonably foreseeable. Subject to 5.1, ${companyName}'s total liability to the Client shall be limited to 50% of the total Price payable under this Contract.</p>
    <p><strong>5.3</strong> Client shall be responsible for any loss of or damage to any of ${companyName}'s equipment arising out of or in connection with any damage, misuse, theft, mishandling of ${companyName}'s equipment at the Event by the Client or their guests (unless such damage is caused by ${companyName}). The Client agrees to reimburse ${companyName} in full to remedy any such defects/damages to ensure that all ${companyName} equipment is in the same condition as it was prior to the Event.</p>
    <p><strong>5.4</strong> ${companyName} may cancel the Contract with immediate effect if:<br>
      (i) You fail to make any payments as specified in the Contract Details; or<br>
      (ii) You commit a serious breach of any term of this Contract.</p>
    <p><strong>5.5</strong> You may end your contract with us. However, your rights to any refund of the Price, or part thereof, will depend on when you decide to end your Contract or the reason in which the contract is ended. If you wish to cancel your Event, for whatever reason, you must contact us in writing${contactEmail ? ` (which can be by email to ${contactEmail})` : ''}. Unless we agree otherwise with you, your cancellation will come into effect on the date that we confirm receipt of your request to cancel.</p>
    <p><strong>5.6</strong> Except where we are at fault, if you cancel your Event or this Contract, you agree that the Cancellation Costs set out in the Cancellation Costs Table (below) will apply and you agree that they will be payable by you to us.</p>
    <p><strong>5.7</strong> <u><strong>CANCELLATIONS COSTS TABLE - FOR CANCELLATIONS WHERE WE ARE NOT AT FAULT</strong></u><br>
      The below Cancellation Costs have been carefully calculated as a pre-estimate only of our losses that directly result from your Event cancellation. This includes the costs of Services provided to you before cancellation, the unavoidable expenses we will incur and our direct loss of profit (including the value of your booked date and likelihood of us being able to rebook your cancelled Event).</p>
    <table>
      <thead>
        <tr>
          <th>Date of Client Cancellation</th>
          <th>Cancellation Costs calculated as a percentage (%) of the Price payable for the Event, as confirmed in the Contract Details.</th>
        </tr>
      </thead>
      <tbody>
        ${CANCELLATION_ROWS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('\n        ')}
        <tr><td colspan="2">Please Note: For very late cancellations you may also be required to pay compensation to us for additional unavoidable costs we incur as a result of your cancellation, if our costs exceed the above Cancellation Costs. For example, for staffing, pre-purchased products.</td></tr>
      </tbody>
    </table>
    <p>The above Cancellation Costs will not apply if you cancel because we have breached our own obligations to you under your Contract.</p>

    <h3>6. General</h3>
    <p><strong>6.1 Force majeure.</strong> Neither party shall be in breach of the Contract nor liable for delay in performing, or failure to perform, any of its obligations under the Contract if such delay or failure result from events, circumstances or causes beyond its reasonable control. This includes but is not limited to any delay or failure to perform as a result of or in connection with acts of God (flood, drought, earthquake, other natural disaster, severe weather warning or adverse weather event); collapse of buildings, fire, explosion or accident; environmental issues which are not reasonably treatable/remediable; epidemic or pandemic; any law or any action taken by a government or public authority, including without limitation imposing an export or import restriction, quota or prohibition; and interruption or failure of utility service.</p>
    <p><strong>6.2 ${companyName} Packages.</strong> Packages are subject to Venue restrictions on power supply, smoke alarms, capacity, timing and other Venue rules and regulations. We shall not be liable for any such issues arising out of or in connection with the same. Any additional costs charged by the Venue to ${companyName} will be passed to the Client. ${companyName} reserve the right to change the Package to enhance the look and performance at their sole discretion. Please note, Dry Ice Machine service is subject to pellets being available and not melted prior to Event. Glow sticks are subject to ordered supply. ${companyName} do not take responsibility for any faulty or defective products.</p>
    <p><strong>6.3 Entire agreement.</strong> The Contract constitutes the entire agreement between the parties and supersedes and extinguishes all previous agreements, promises, assurances, warranties, representations and understandings between them, whether written or oral, relating to its subject matter.</p>
    <p><strong>6.4 Variation.</strong> No variation of the Contract shall be effective unless it is in writing and signed by the parties (or their authorised representatives).</p>
    <p><strong>6.5 Governing Law &amp; Jurisdiction.</strong> The Contract, and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation, shall be governed by, and construed in accordance with the law of England and Wales and each party irrevocably agrees that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with the Contract or its subject matter or formation.</p>
  `;
}

export default function renderContract({
  event,
  user,
  company,
  signatureDataUri,
  adminSignatureDataUri,
  signedAt,
}) {
  const userName = user?.name || event?.users_events_user_idTousers?.name || 'Client';
  const venue = event?.venues?.venue || '';
  const eventDate = fmtDate(event?.date);
  const total = fmtMoney(event?.total_cost_for_equipment);
  const deposit = fmtMoney(event?.deposit_amount);
  const invoice = event?.invoice ?? '';
  const companyName = company?.name || 'USR Music';
  const companyAddress = [company?.address_name, company?.street, company?.city, company?.postal_code]
    .filter(Boolean)
    .join(', ');
  const companyContact = [
    company?.telephone_number ? `Tel: ${company.telephone_number}` : null,
    company?.email ? `Email: ${company.email}` : null,
    company?.website ? `Web: ${company.website}` : null,
  ]
    .filter(Boolean)
    .join(' &nbsp;|&nbsp; ');

  const bankParts = [
    company?.bank_name && `Bank Name: ${company.bank_name}`,
    company?.name && `Account Name: ${company.name}`,
    company?.account_number && `Account No: ${company.account_number}`,
    company?.sort_code && `Sort Code: ${company.sort_code}`,
  ].filter(Boolean);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Contract - Event #${event?.id ?? ''}</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 12px; padding: 28px; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      h2 { font-size: 14px; margin: 18px 0 6px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
      .meta { text-align: right; font-size: 11px; color: #555; }
      .row { display: flex; gap: 24px; margin: 6px 0; }
      .row > div { flex: 1; }
      .box { border: 1px solid #ddd; padding: 10px 14px; margin: 12px 0; border-radius: 4px; }
      .label { color: #666; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f6f6f6; }
      .signatures { display: flex; gap: 32px; margin-top: 36px; }
      .sig-box { flex: 1; border-top: 1px solid #333; padding-top: 6px; min-height: 80px; }
      .sig-img { max-width: 220px; max-height: 90px; }
      .terms { white-space: pre-wrap; font-size: 11px; line-height: 1.5; color: #333; }
      .payment-line { font-size: 11px; margin: 10px 0 4px; }
      .payment-line.bank { color: #cc0000; }
      .page-break { page-break-before: always; }
      .terms-conditions h2 { font-size: 15px; margin: 0 0 10px; }
      .terms-conditions h3 { font-size: 12px; margin: 16px 0 6px; }
      .terms-conditions p { font-size: 10.5px; line-height: 1.5; color: #333; margin: 6px 0; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <h1>Performance Contract</h1>
        <div class="label">${companyName}</div>
        ${companyAddress ? `<div>${companyAddress}</div>` : ''}
        ${companyContact ? `<div>${companyContact}</div>` : ''}
      </div>
      <div class="meta">
        <div>Invoice #${invoice}</div>
        <div>Date: ${fmtDate(signedAt || new Date())}</div>
      </div>
    </div>

    <div class="box">
      <div class="row">
        <div><div class="label">Client</div><div><strong>${userName}</strong></div></div>
        <div><div class="label">Event date</div><div>${eventDate}</div></div>
      </div>
      <div class="row">
        <div><div class="label">Venue</div><div>${venue}</div></div>
        <div><div class="label">Package price</div><div>£${total}</div></div>
      </div>
      <div class="row">
        <div><div class="label">Deposit</div><div>£${deposit}</div></div>
        <div><div class="label">Event ID</div><div>#${event?.id ?? ''}</div></div>
      </div>
    </div>

    <p class="payment-line">Deposit payable £${deposit} on signature of Contract. Remaining balance of price payable 1 week before ${eventDate}.</p>
    ${bankParts.length ? `<p class="payment-line bank">Please make payment to: ${bankParts.join(', ')}</p>` : ''}

    <div class="signatures">
      <div class="sig-box">
        <div class="label">Client signature</div>
        ${signatureDataUri ? `<img class="sig-img" src="${signatureDataUri}" alt="Client signature" />` : '<div style="color:#888">(unsigned)</div>'}
        <div style="margin-top:6px">${userName}</div>
        <div class="label">Signed: ${fmtDate(signedAt || new Date())}</div>
      </div>
      <div class="sig-box">
        <div class="label">${companyName}</div>
        ${adminSignatureDataUri ? `<img class="sig-img" src="${adminSignatureDataUri}" alt="Company signature" />` : ''}
        <div style="margin-top:6px">${company?.contact_name || companyName}</div>
      </div>
    </div>

    <div class="terms-conditions page-break">
      ${renderTermsAndConditions({ companyName, contactEmail: company?.email })}
    </div>
  </body>
</html>`;
}
