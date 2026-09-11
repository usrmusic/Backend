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
// (mirrors Laravel's EventBooked -> SendCredentialsToClient listener, but
// with the client-requested "thank you for your booking" wording and the
// admin's actual signature image instead of a plain credentials notice).
export function buildUserCredentialEmail({
  name,
  email,
  password,
  loginUrl,
  logoUrl,
  signatureUrl,
}) {
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
              <p style="color:#455056; font-size:18px; line-height:20px; margin:0; font-weight:500; text-align:left;">
                <strong style="display:block; font-size:13px; margin:0 0 4px; color:rgba(0,0,0,.64); font-weight:normal;">URL</strong>${escapeHtml("www.usrmusic.com")}
                <strong style="display:block; font-size:13px; margin:24px 0 4px; color:rgba(0,0,0,.64); font-weight:normal;">Username</strong>${escapeHtml(email)}
                <strong style="display:block; font-size:13px; margin:24px 0 4px; color:rgba(0,0,0,.64); font-weight:normal;">Password</strong>${escapeHtml(password)}
              </p>
              <a href="${escapeHtml(loginUrl)}" style="background:#719984; text-decoration:none; display:inline-block; font-weight:600; margin-top:24px; color:#fff; text-transform:uppercase; font-size:14px; padding:11px 24px; border-radius:50px;">Login to your Account</a>
              <p style="font-size:14px; color:#455056; margin:24px 0 0; line-height:22px; text-align:left;">
                You can also download our app (coming soon).
              </p>
              <p style="font-size:15px; color:#455056; margin:20px 0 0; line-height:24px; text-align:left;">
                Thank you again :)
              </p>
              ${signatureUrl
                ? `<p style="margin:16px 0 0; text-align:left;"><img src="${escapeHtml(signatureUrl)}" alt="Signature" height="60" style="display:inline-block;" /></p>`
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
