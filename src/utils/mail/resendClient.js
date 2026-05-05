
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY || null;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@usrmusic.com';


let client = null;
if (apiKey) client = new Resend(apiKey);

async function sendEmail({ to, subject, html, attachments }) {
  console.log(apiKey ? '[resendClient] initialized with API key' : '[resendClient] no API key, using fallback logging');
  if (!to) return Promise.reject(new Error('missing_to'));
  if (!client) {
    console.log('[resend-fallback] to=', to, 'subject=', subject, 'attachments=', Array.isArray(attachments) ? attachments.length : 0);
    return Promise.resolve({ ok: true, fallback: true });
  }

  const timeoutMs = Number(process.env.RESEND_SEND_TIMEOUT_MS) || 8000;
  const payload = { from: fromEmail, to, subject, html };
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  const sendPromise = client.emails.send(payload);

  try {
    const res = await Promise.race([
      sendPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('resend_timeout')), timeoutMs)),
    ]);
    return res;
  } catch (e) {
    console.error('[resend] send failed or timed out', e?.message || e);
    // Return a non-throwing result so callers that await won't hang the request
    return { ok: false, error: String(e?.message || e) };
  }
}

export default sendEmail;
