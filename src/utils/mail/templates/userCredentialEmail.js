function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Sent when a client's deposit is accepted and their event is confirmed
// (mirrors Laravel's EventBooked -> SendCredentialsToClient listener, with
// the client-requested "thank you for your booking" wording). Signs off with
// a typed signature block (company contact details), matching every other
// client-facing email (usrLetterShell.js) — a scanned/handwritten signature
// image looked unprofessional and nobody actually signs emails that way.
export function buildUserCredentialEmail({
  name,
  email,
  password,
  loginUrl,
  logoUrl,
  company,
}) {
  const signatureLines = [];
  if (company?.contact_name) {
    signatureLines.push(
      `<span style="color:#1e1e2d; font-weight:600;">${escapeHtml(company.contact_name)}</span><br />`,
    );
  }
  if (company?.telephone_number) signatureLines.push(`${escapeHtml(company.telephone_number)}<br />`);
  if (company?.email) {
    signatureLines.push(
      `<a href="mailto:${escapeHtml(company.email)}" style="color:#719984;">${escapeHtml(company.email)}</a><br />`,
    );
  }
  if (company?.website) signatureLines.push(`${escapeHtml(company.website)}<br />`);
  const html = `<!doctype html>
<html lang="en-US">
<head>
  <meta content="text/html; charset=utf-8" http-equiv="Content-Type" />
  <title>Booking Confirmation</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f3f8;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f3f8" style="font-family:'Open Sans', Arial, sans-serif;">
    <tr><td style="height:40px;">&nbsp;</td></tr>
    ${logoUrl
      ? `<tr><td style="text-align:center;"><img src="${escapeHtml(logoUrl)}" alt="USR logo" width="90" style="display:inline-block;" /></td></tr>
    <tr><td style="height:20px;">&nbsp;</td></tr>`
      : ""}
    <tr>
      <td>
        <table width="95%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#fff; border-radius:8px; text-align:center; box-shadow:0 6px 18px 0 rgba(0,0,0,.06);">
          <tr><td style="height:40px;">&nbsp;</td></tr>
          <tr>
            <td style="padding:0 35px;">
              <h1 style="color:#1e1e2d; font-weight:500; margin:0; font-size:28px;">Hi ${escapeHtml(name)},</h1>
              <p style="font-size:15px; color:#455056; margin:16px 0 0; line-height:24px; text-align:left;">
                Firstly, thank you very much for your booking. We look forward to working with you!
              </p>
              <p style="font-size:15px; color:#455056; margin:16px 0 0; line-height:24px; text-align:left;">
                Please find attached below, your login details to access our CRM portal where you can fill in anything event related... key timings, music and other information. You can also download, upload files via the platform too.
              </p>
              <span style="display:inline-block; margin:20px 0 26px; border-bottom:1px solid #cecece; width:100px;"></span>
              <!-- Explicit <br/> between label and value, and a <p> (not just
                   display:block on <strong>) between groups — Outlook's HTML
                   renderer ignores display:block on inline elements like
                   <strong>, which previously ran "URL" straight into the
                   value on the same line with no visible gap at all. -->
              <p style="color:#455056; font-size:18px; line-height:20px; margin:0; font-weight:500; text-align:left;">
                <strong style="font-size:13px; color:rgba(0,0,0,.64); font-weight:normal;">URL</strong><br/>${escapeHtml("www.usrmusic.com")}
              </p>
              <p style="color:#455056; font-size:18px; line-height:20px; margin:20px 0 0; font-weight:500; text-align:left;">
                <strong style="font-size:13px; color:rgba(0,0,0,.64); font-weight:normal;">Username</strong><br/>${escapeHtml(email)}
              </p>
              <p style="color:#455056; font-size:18px; line-height:20px; margin:20px 0 0; font-weight:500; text-align:left;">
                <strong style="font-size:13px; color:rgba(0,0,0,.64); font-weight:normal;">Password</strong><br/>${escapeHtml(password)}
              </p>
              <a href="${escapeHtml(loginUrl)}" style="background:#719984; text-decoration:none; display:inline-block; font-weight:600; margin-top:24px; color:#fff; text-transform:uppercase; font-size:14px; padding:11px 24px; border-radius:50px;">Login to your Account</a>
              <p style="font-size:14px; color:#455056; margin:24px 0 0; line-height:22px; text-align:left;">
                You can also download our app (coming soon).
              </p>
              <p style="font-size:15px; color:#455056; margin:20px 0 0; line-height:24px; text-align:left;">
                Thank you again :)
              </p>
              ${signatureLines.length
                ? `<p style="font-size:14px; line-height:20px; margin:16px 0 0; text-align:left;">${signatureLines.join("")}</p>`
                : ""}
            </td>
          </tr>
          <tr><td style="height:40px;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>
    <tr><td style="height:40px;">&nbsp;</td></tr>
  </table>
</body>
</html>`;

  return { subject: "Thank You For Your Booking", html };
}
