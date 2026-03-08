export default function renderConfirmedEvent({ first_name, body, companyDetails }) {
  const logoUrl = companyDetails?.company_logo
    ? `${process.env.APP_URL || ''}public/storage/images/${companyDetails.company_logo}`
    : null;
  const addrParts = [
    companyDetails?.address_name,
    companyDetails?.street,
    companyDetails?.city,
    companyDetails?.postal_code,
  ].filter(Boolean);
  const contactLines = [];
  if (companyDetails?.telephone_number) contactLines.push(`<strong>Telephone</strong> ${companyDetails.telephone_number}`);
  if (companyDetails?.email) contactLines.push(`<strong>Email</strong> <a href="mailto:${companyDetails.email}">${companyDetails.email}</a>`);
  if (companyDetails?.website) contactLines.push(`<strong>Website</strong> ${companyDetails.website}`);

  const safeBody = String(body || '').replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>USR Mail</title>
  <style>
    body { width:100% !important; height:100%; margin:0; background-color:#F2F4F6; color:#414141; font-family: 'Calibri Light', Arial, sans-serif; }
    .email-wrapper{ width:100%; background:#F2F4F6; padding:0; margin:0 }
    .email-body_inner{ width:600px; margin:0 auto; background:#fff }
    .pd-15{ padding:30px }
    .f-fallback td, .f-fallback th { font-family: 'Calibri Light', Arial, sans-serif; color:#424040 }
    img.logo{ max-width:100px; width:100%; display:block }
    @media only screen and (max-width:570px){ .email-body_inner{ width:100% !important } .pd-15{ padding:15px !important } }
  </style>
</head>
<body>
  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" role="presentation" bgcolor="#F2F4F6">
    <tr>
      <td align="center">
        <table class="email-content" width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td class="email-body" width="600">
              <table class="email-body_inner" align="center" width="600" cellpadding="0" cellspacing="0" role="presentation" bgcolor="#FFFFFF">
                <tr>
                  <td class="pd-15">
                    <div class="f-fallback">
                      <table width="100%" role="presentation">
                        <tr>
                          <td style="padding-bottom:15px;">
                            <div style="font-size:16px;line-height:22px;color:#424040">Hi ${first_name || 'Client'},</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-bottom:15px;color:#424040;line-height:22px">${safeBody}</td>
                        </tr>
                        ${logoUrl ? `<tr><td style="padding-bottom:15px"><img class="logo" src="${logoUrl}" alt="Logo"/></td></tr>` : ''}
                        <tr>
                          <td style="padding-bottom:15px;color:#424040;line-height:22px">
                            ${addrParts.length ? addrParts.join('<br/>') + '<br/>' : ''}
                            ${contactLines.length ? contactLines.join('<br/>') : ''}
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
