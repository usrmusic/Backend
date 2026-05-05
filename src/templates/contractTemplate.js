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

    <h2>Terms &amp; Conditions</h2>
    <div class="terms">By signing this contract you agree to the standard ${companyName} performance terms: deposit is non-refundable, the balance is due no later than 14 days before the event date, and ${companyName} will provide the equipment and services described above. Cancellations made less than 30 days before the event are subject to the full balance. Any changes to the event date, venue or package must be agreed in writing.</div>

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
  </body>
</html>`;
}
