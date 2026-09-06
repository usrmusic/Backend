import microsoftGraph from '../microsoftGraph.js';

// Drop-in replacement for resendClient.js's sendEmail(), backed by
// Microsoft Graph (Mail.Send) instead of Resend — same mailbox used for
// calendar sync (AZURE_CALENDAR_USER_ID), matching Laravel's MAIL_MAILER=graph.
// Every caller uses catchAsync/`.catch(() => {})` around this already, so it
// mirrors resendClient's non-throwing-on-failure behavior: log and return a
// { ok:false } result rather than rejecting, so a mail failure never blocks
// the request it was triggered from.
async function sendEmail({ to, cc, subject, html, attachments }) {
  if (!to) return Promise.reject(new Error('missing_to'));
  try {
    return await microsoftGraph.sendMail({ to, cc, subject, html, attachments });
  } catch (e) {
    console.error('[graphMailClient] send failed', e?.response?.data || e?.message || e);
    return { ok: false, error: String(e?.response?.data?.error?.message || e?.message || e) };
  }
}

export default sendEmail;
