import { brandAsset } from "../../brandAssets.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Mirrors the legacy Laravel CRM's forgot_password.blade.php exactly — same
// card shell, same copy, same "Reset Password" pill button — just pointed at
// the new frontend's reset-password page instead of Laravel's route.
export async function buildForgotPasswordEmail({ name, resetUrl }) {
  // Laravel's version showed a static USR logo above the greeting — inline
  // as a data URI since this email has no per-company context to source a
  // hosted logo URL from.
  const logoBuf = await brandAsset("usr-logo-dark.png").catch(() => null);
  const logoImg = logoBuf
    ? `<img src="data:image/png;base64,${logoBuf.toString("base64")}" alt="USR Music" style="max-height:48px; margin-bottom:16px;" />`
    : "";
  const html = `<!doctype html>
<html lang="en-US">
<head>
  <meta content="text/html; charset=utf-8" http-equiv="Content-Type" />
  <title>Reset Password Email Template</title>
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
              ${logoImg}
              <h1 style="color:#1e1e2d; font-weight:500; margin:0; font-size:24px;">Hi ${escapeHtml(name)},</h1>
              <span style="display:inline-block; margin:20px 0 26px; border-bottom:1px solid #cecece; width:100px;"></span>
              <p style="color:#455056; font-size:15px; line-height:24px; margin:0;">
                We are sending you this email because you have requested a password reset. Please click on the following link to reset your password:
              </p>
              <a href="${escapeHtml(resetUrl)}" style="background:#719984; text-decoration:none; display:inline-block; font-weight:600; margin-top:24px; color:#fff; text-transform:uppercase; font-size:14px; padding:11px 24px; border-radius:50px;">Reset Password</a>
              <p style="color:#455056; font-size:14px; line-height:24px; margin-top:20px;">
                If you didn't request a password reset, you can ignore this email. Your password will not be changed.
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

  return { subject: "Reset Password", html };
}
