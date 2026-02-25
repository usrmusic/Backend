
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY || null;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@example.com';

let client = null;
if (apiKey) client = new Resend(apiKey);

async function sendEmail({ to, subject, html }) {
  if (!to) return Promise.reject(new Error('missing_to'));
  if (!client) {
    console.log('[resend-fallback] to=', to, 'subject=', subject);
    return Promise.resolve({ ok: true, fallback: true });
  }

  return client.emails.send({
    from: fromEmail,
    to,
    subject,
    html,
  });
}

export default sendEmail;
