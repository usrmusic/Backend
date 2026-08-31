function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Mirrors the legacy Laravel CRM's "New Account Email Template"
// (resources/views/email/user_credential_mail.blade.php), sent when a
// client's deposit is accepted and their event is confirmed (Laravel's
// EventBooked -> SendCredentialsToClient listener).
export function buildUserCredentialEmail({ name, email, password, loginUrl }) {
  const html = `<!doctype html>
<html lang="en-US">
<head>
  <meta content="text/html; charset=utf-8" http-equiv="Content-Type" />
  <title>New Account Email Template</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f3f8;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f3f8" style="font-family:'Open Sans', Arial, sans-serif;">
    <tr><td style="height:40px;">&nbsp;</td></tr>
    <tr>
      <td>
        <table width="95%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#fff; border-radius:8px; text-align:center; box-shadow:0 6px 18px 0 rgba(0,0,0,.06);">
          <tr><td style="height:40px;">&nbsp;</td></tr>
          <tr>
            <td style="padding:0 35px;">
              <h1 style="color:#1e1e2d; font-weight:500; margin:0; font-size:28px;">Hi ${escapeHtml(name)},</h1>
              <p style="font-size:15px; color:#455056; margin:8px 0 0; line-height:24px;">
                Your account has been created on the USR Music platform. Below are your login details.
              </p>
              <span style="display:inline-block; margin:20px 0 26px; border-bottom:1px solid #cecece; width:100px;"></span>
              <p style="color:#455056; font-size:18px; line-height:20px; margin:0; font-weight:500;">
                <strong style="display:block; font-size:13px; margin:0 0 4px; color:rgba(0,0,0,.64); font-weight:normal;">Email</strong>${escapeHtml(email)}
                <strong style="display:block; font-size:13px; margin:24px 0 4px; color:rgba(0,0,0,.64); font-weight:normal;">Password</strong>${escapeHtml(password)}
              </p>
              <a href="${escapeHtml(loginUrl)}" style="background:#719984; text-decoration:none; display:inline-block; font-weight:600; margin-top:24px; color:#fff; text-transform:uppercase; font-size:14px; padding:11px 24px; border-radius:50px;">Login to your Account</a>
              <p style="font-size:14px; color:#455056; margin:16px 0 0; line-height:24px;">
                Please keep these credentials safe and do not share them with anyone.
              </p>
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

  return { subject: "Login Credentials", html };
}
