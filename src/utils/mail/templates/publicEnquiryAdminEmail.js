function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Mirrors the legacy Laravel CRM's "USR Enquiry" admin notification
// (resources/views/email/contact_request_details.blade.php), plus two rows
// for the fields the new website form added (Event Type, Venue).
export function buildPublicEnquiryAdminEmail({
  name,
  email,
  contact_number,
  event_date,
  event_type,
  venue,
  event_details,
}) {
  const row = (label, value) =>
    `<tr><th>${label}:</th><td>${escapeHtml(value)}</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>User Details Notification</title>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style type="text/css">
    body { font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 50px auto auto; background-color: #fff; padding: 20px; box-shadow: 0 0 10px rgba(0, 0, 0, .2); border-radius: 4px; }
    table { width: 100%; margin-bottom: 20px; border-collapse: collapse; border-spacing: 0; }
    table th, table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    table th { background-color: #f2f2f2; font-weight: bold; color: #333; }
    .footer { text-align: center; color: #999999; font-size: 14px; line-height: 1.2; margin-top: 20px; border-top: 1px solid #dddddd; padding-top: 20px; }
    .footer p { margin: 0; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <table>
      ${row("Name", name)}
      ${row("Email", email)}
      ${row("Contact Number", contact_number)}
      ${row("Event Date", event_date)}
      ${row("Event Type", event_type || "N/A")}
      ${row("Venue", venue || "N/A")}
      ${row("Event Details", event_details || "N/A")}
    </table>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject: "USR Enquiry", html };
}
