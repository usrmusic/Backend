function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

const row = (content) => `<tr><td align="left" style="word-break: break-word; font-family:'Calibri Light',serif, 'EmojiFont', sans-serif; color: #424040;font-size:16px;line-height: 22px;font-weight: normal; padding-bottom: 15px;">${content}</td></tr>`;

// Mirrors the legacy Laravel CRM's client-facing "Your Signed Contract" email
// (resources/views/email/contract_signed.blade.php) almost line for line —
// same greeting/copy, same company logo + address + contact block order.
export function buildContractSignedEmail({ name, signedUrl, company, logoUrl }) {
  const addressLines = [];
  if (company?.contact_name) {
    addressLines.push(
      `<span style="color: #000; font-family:'Calibri Light',serif, 'EmojiFont', sans-serif; font-size:16px;line-height: 22px;font-weight:800;">${escapeHtml(company.contact_name)}</span><br />`,
    );
  }
  if (company?.address_name) addressLines.push(`${escapeHtml(company.address_name)},<br />`);
  if (company?.street) addressLines.push(`${escapeHtml(company.street)},<br />`);
  if (company?.city) addressLines.push(`${escapeHtml(company.city)},<br />`);
  if (company?.postal_code) addressLines.push(`${escapeHtml(company.postal_code)}<br />`);

  const contactLines = [];
  const labelValue = (label, value, href) =>
    `<span style="color: #000; font-family:'Calibri Light',serif, 'EmojiFont', sans-serif; font-size:16px; line-height: 22px; font-weight:bold;">${label}</span> ${
      href ? `<a style="color:blue;" href="${href}" target="_blank">${escapeHtml(value)}</a>` : escapeHtml(value)
    }<br />`;
  if (company?.telephone_number) contactLines.push(labelValue("Telephone", company.telephone_number));
  if (company?.email) contactLines.push(labelValue("Email", company.email, `mailto:${company.email}`));
  if (company?.website) contactLines.push(labelValue("Website", company.website));
  if (company?.instagram) contactLines.push(labelValue("Instagram", company.instagram));
  if (company?.facebook) contactLines.push(labelValue("Facebook", company.facebook));

  const html = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Your Signed Contract</title>
</head>
<body style="width: 100% !important; height: 100%; -webkit-text-size-adjust: none; font-family: Helvetica, Arial, sans-serif; background-color: #F2F4F6; color: #51545E; margin: 0;" bgcolor="#F2F4F6">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #F2F4F6; margin: 0; padding: 0;" bgcolor="#F2F4F6">
    <tr>
      <td align="center" style="word-break: break-word; font-family: Helvetica, Arial, sans-serif; font-size: 16px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width: 600px; background-color: #FFFFFF; margin: 0 auto; padding: 0;" bgcolor="#FFFFFF">
          <tr>
            <td style="word-break: break-word; font-family: Georgia, serif; font-size: 16px; background-color: #fff; padding: 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                ${row(`Hi ${escapeHtml(name)},`)}
                ${row(`<p>Please sign attached a copy of your signed contract</p><p>We look forward to working with you :)</p><p>You can also download the contract from this link: <a style="color:blue;" href="${escapeHtml(signedUrl)}">Download Contract</a></p>`)}
                ${logoUrl ? row(`<img src="${escapeHtml(logoUrl)}" style="max-width: 100px; width: 100%; display: block;" alt="Logo" />`) : ""}
                ${addressLines.length ? row(addressLines.join("")) : ""}
                ${contactLines.length ? row(contactLines.join("")) : ""}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: "Your Signed Contract", html };
}
