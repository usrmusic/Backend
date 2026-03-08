export default function renderSendQuote({ first_name, body, companyDetails, contract_token, enrichedDetails, event }) {
  const bodyHtml = body ? String(body).replace(/\n/g, '<br/>') : '';
  const logoUrl = companyDetails && companyDetails.company_logo ? `${process.env.APP_URL || ''}public/storage/images/${companyDetails.company_logo}` : '';

  // build details table
  let itemsHtml = '';
  if (Array.isArray(enrichedDetails) && enrichedDetails.length) {
    itemsHtml += `<table style="width:100%; border-collapse:collapse;">`;
    itemsHtml += `<thead><tr>`;
    itemsHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:left">Item</th>`;
    itemsHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:right">Qty</th>`;
    itemsHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:right">Unit</th>`;
    itemsHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:right">Total</th>`;
    itemsHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:left">Notes</th>`;
    itemsHtml += `</tr></thead><tbody>`;
    for (const d of enrichedDetails) {
      const itemName = (d.equipment && d.equipment.name) || (d.package_type && d.package_type.name) || d.event_package_id || 'Item';
      const qty = d.quantity != null ? d.quantity : '';
      const unit = d.sell_price != null ? (typeof d.sell_price === 'bigint' ? d.sell_price.toString() : d.sell_price) : '';
      const tot = d.total_price != null ? (typeof d.total_price === 'bigint' ? d.total_price.toString() : d.total_price) : '';
      const notesCell = d.notes || d.rig_notes || '';
      itemsHtml += `<tr>`;
      itemsHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top">${String(itemName)}</td>`;
      itemsHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top;text-align:right">${String(qty)}</td>`;
      itemsHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top;text-align:right">${String(unit)}</td>`;
      itemsHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top;text-align:right">${String(tot)}</td>`;
      itemsHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top">${String(notesCell)}</td>`;
      itemsHtml += `</tr>`;
    }
    itemsHtml += `</tbody></table>`;

    if (event && event.total_cost_for_equipment) {
      const total = typeof event.total_cost_for_equipment === 'bigint' ? event.total_cost_for_equipment.toString() : event.total_cost_for_equipment;
      itemsHtml += `<p style="text-align:right;font-weight:bold;margin-top:8px">Total: ${String(total)}</p>`;
    }
  } else {
    itemsHtml = `<p>No line items</p>`;
  }

  // Inline the Blade template structure (simplified) but preserving CSS and content
  const html = `<!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { width:100% !important; height:100%; margin:0; background-color:#F2F4F6; color:#414141; font-family: 'Calibri Light', serif, 'EmojiFont', sans-serif; }
    td, th { font-size:16px; }
    .email-body_inner { width:600px; margin:0 auto; background-color:#FFFFFF; }
  </style>
  </head>
  <body style="background-color:#F2F4F6;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td align="center">
  <table width="600" class="email-body_inner" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td style="padding:30px; background-color:#fff;">
  <div>
    <table width="100%"><tr><td style="font-size:16px;color:#424040;line-height:22px;padding-bottom:15px;">Hi ${String(first_name)},</td></tr>
    <tr><td style="font-size:16px;color:#424040;line-height:22px;padding-bottom:15px;">${bodyHtml}</td></tr>
    <tr><td style="padding-bottom:15px;">${ logoUrl ? `<img src="${logoUrl}" style="max-width:100px;width:100%;display:block;" alt="Logo"/>` : '' }</td></tr>
    <tr><td style="font-size:16px;color:#424040;line-height:22px;">${companyDetails.contact_name ? `<strong>${companyDetails.contact_name}</strong><br/>` : ''}${companyDetails.address_name ? `${companyDetails.address_name},<br/>` : ''}${companyDetails.street ? `${companyDetails.street},<br/>` : ''}${companyDetails.city ? `${companyDetails.city},<br/>` : ''}${companyDetails.postal_code ? `${companyDetails.postal_code}<br/>` : ''}</td></tr>
    <tr><td style="font-size:16px;color:#424040;line-height:22px;">${companyDetails.telephone_number ? `<strong>Telephone</strong> ${companyDetails.telephone_number}<br/>` : ''}${companyDetails.email ? `<strong>Email</strong> <a href="mailto:${companyDetails.email}">${companyDetails.email}</a><br/>` : ''}${companyDetails.website ? `<strong>Website</strong> ${companyDetails.website}<br/>` : ''}</td></tr>
    <tr><td style="padding-top:12px;">${ contract_token ? `<p><a href="${process.env.APP_URL || ''}contract/${contract_token}">View Contract</a></p>` : '' }</td></tr>
    <tr><td>${itemsHtml}</td></tr>
    </table>
  </div>
  </td></tr>
  </table>
  </td></tr>
  </table>
  </body>
  </html>`;

  return html;
}
