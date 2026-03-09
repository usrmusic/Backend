export default function renderInvoice({ event = {}, companyDetails = {}, rawBody = '', enrichedDetails = [] }) {
  const logoUrl = companyDetails.company_logo ? `${process.env.APP_URL || ''}public/storage/images/${companyDetails.company_logo}` : null;
  const formatDate = (d) => {
    try {
      const dt = new Date(d);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = dt.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    } catch (e) { return ''; }
  };

  const eventDate = event?.date ? formatDate(event.date) : '';
  const clientName = event?.users_events_user_idTousers?.name || 'Client';
  const invoiceNumber = event?.invoice || '';

  // Build line items similar to Laravel invoice table
  let itemsHtml = '';
  if (Array.isArray(enrichedDetails) && enrichedDetails.length) {
    itemsHtml += `<table width="100%" style="border-collapse:collapse;font-size:11px;">`;
    for (const d of enrichedDetails) {
      const name = (d.equipment && d.equipment.name) || d.package_name || 'Item';
      const qty = d.quantity || '';
      const price = d.sell_price != null ? d.sell_price : '';
      itemsHtml += `<tr><td style="padding:4px 0">${name}</td><td style="text-align:right;padding:4px 0">${qty}</td><td style="text-align:right;padding:4px 0">${price}</td></tr>`;
    }
    itemsHtml += `</table>`;
  }

  const totalPrice = event?.total_cost_for_equipment || '';
  const deposit = (Array.isArray(event?.event_payments) && event.event_payments.length) ? event.event_payments.reduce((s,p)=>s+Number(p.amount||0),0) : 0;
  const vatValue = event?.vat_value || '';
  const eventAmountWithoutVat = event?.event_amount_without_vat || '';

  const html = `<!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8" />
  <style>
    body{font-family: sans-serif; color:#333;}
    header{border-bottom:1px solid #000;padding:10px 0;display:flex;justify-content:space-between}
    .logo img{max-width:120px}
    .client-details{margin:18px 0}
    .table{width:100%;border-collapse:collapse}
    .table td{padding:4px 6px}
    .right{text-align:right}
    footer{border-top:1px solid #ccc;padding-top:8px;margin-top:16px;font-size:12px;color:#666}
  </style>
  </head>
  <body>
    <header>
      <div class="logo">${logoUrl ? `<img src="${logoUrl}" alt="logo"/>` : ''}</div>
      <div class="meta">
        <div><strong>Invoice</strong></div>
        <div>Invoice #: ${invoiceNumber}</div>
        <div>Date: ${formatDate(new Date())}</div>
      </div>
    </header>

    <div class="client-details">
      <table class="table">
        <tr><td>Name</td><td class="right">: ${clientName}</td></tr>
        <tr><td>Date</td><td class="right">: ${eventDate}</td></tr>
        <tr><td>Venue</td><td class="right">: ${event?.venues?.venue || ''}</td></tr>
      </table>
    </div>

    <div class="items">
      ${itemsHtml}
    </div>

    <div style="margin-top:12px">
      <table style="width:100%">
        <tr><td style="width:70%"></td><td style="text-align:right">Total: £${totalPrice}</td></tr>
        <tr><td></td><td style="text-align:right">Payment Received: £${deposit}</td></tr>
        <tr><td></td><td style="text-align:right">VAT: £${vatValue}</td></tr>
      </table>
    </div>

    <footer>
      Payment details - ${companyDetails.bank_name || 'Starling Bank'}, Name: ${companyDetails.name || 'USR Holdings Ltd'}, Account No: ${companyDetails.account_number || '12345678'}, Sort Code: ${companyDetails.sort_code || '12-34-56'}
    </footer>
  </body>
  </html>`;

  return html;
}
