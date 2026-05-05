import prisma from '../utils/prismaClient.js';
import { uploadStreamToS3, getSignedGetUrl } from '../utils/s3Client.js';
import generatePdfBufferFromHtml from '../utils/pdfGenerator.js';
import renderContract from '../templates/contractTemplate.js';
import sendEmail from '../utils/mail/resendClient.js';

// Fetch an S3 object via its presigned URL and return a base64 data URI.
// We embed the bytes directly into the PDF so the renderer never has to make
// a network request to S3 at PDF-generation time (matches the Laravel
// file_get_contents + base64_encode pattern in template_view.blade.php).
async function fetchAsDataUri(key) {
  if (!key) return null;
  try {
    const url = await getSignedGetUrl(String(key));
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = resp.headers.get('content-type') || 'image/png';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// Sign a contract for an event. Used by both the public token-based signing
// route and the authenticated update-event flow.
//
// Throws an Error with `code` set to one of:
//   - 'event_not_found'
//   - 'already_signed'
//   - 'pdf_generation_failed'
//   - 'pdf_upload_failed'
export async function signContractForEvent({
  eventId,
  signatureDataUri,
  acting_user_id,
  ip,
  userAgent,
  notify = true,
}) {
  if (!signatureDataUri || !signatureDataUri.startsWith('data:image/')) {
    const err = new Error('signature_image_required');
    err.code = 'signature_image_required';
    throw err;
  }

  const event = await prisma.event.findUnique({
    where: { id: Number(eventId) },
    include: {
      users_events_user_idTousers: true,
      venues: true,
      event_package: { include: { equipment: true } },
    },
  });
  if (!event) {
    const err = new Error('event_not_found');
    err.code = 'event_not_found';
    throw err;
  }
  if (event.contract_signed_at) {
    const err = new Error('contract_already_signed');
    err.code = 'already_signed';
    throw err;
  }

  const user = event.users_events_user_idTousers;

  let company = null;
  if (event.names_id) {
    company = await prisma.companyName
      .findUnique({ where: { id: BigInt(event.names_id) } })
      .catch(() => null);
  }

  // Embed admin signature bytes directly so the PDF renderer doesn't depend
  // on S3 fetches at render time.
  const adminSignatureDataUri = company?.admin_signature
    ? await fetchAsDataUri(company.admin_signature)
    : null;

  const signedAt = new Date();
  const html = renderContract({
    event,
    user,
    company,
    signatureDataUri,
    adminSignatureDataUri,
    signedAt,
  });

  let pdfBuffer;
  try {
    pdfBuffer = await generatePdfBufferFromHtml(html);
  } catch (e) {
    console.error('[contractSign] pdf generation failed', e?.message || e);
    const err = new Error('pdf_generation_failed');
    err.code = 'pdf_generation_failed';
    throw err;
  }

  const pdfKey = `contracts/event_${event.id}_contract_${Date.now()}.pdf`;
  try {
    await uploadStreamToS3(pdfBuffer, pdfKey, 'application/pdf');
  } catch (e) {
    console.error('[contractSign] pdf upload failed', e?.message || e);
    const err = new Error('pdf_upload_failed');
    err.code = 'pdf_upload_failed';
    throw err;
  }

  // Store the raw signature PNG independently of the PDF.
  const sigBase64 = signatureDataUri.replace(/^data:image\/[^;]+;base64,/, '');
  const sigBuffer = Buffer.from(sigBase64, 'base64');
  const sigKey = `signatures/event_${event.id}_${Date.now()}.png`;
  try {
    await uploadStreamToS3(sigBuffer, sigKey, 'image/png');
  } catch (e) {
    console.error('[contractSign] signature upload failed', e?.message || e);
  }

  const ownerUserId = user?.id ? Number(user.id) : event.user_id ?? 0;
  const signerUserId = acting_user_id ? Number(acting_user_id) : ownerUserId;

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        user_id: ownerUserId,
        event_id: Number(event.id),
        signed_pdf_path: pdfKey,
        amount: event.total_cost_for_equipment
          ? Math.round(Number(event.total_cost_for_equipment))
          : null,
        status: 'signed',
        signed_at: signedAt,
        sent_at: signedAt,
        created_at: signedAt,
        updated_at: signedAt,
      },
    });

    await tx.signature.create({
      data: {
        user_id: signerUserId,
        contract_id: created.id,
        signature_path: sigKey,
        ip_address: ip || null,
        user_agent: userAgent || null,
        created_at: signedAt,
        updated_at: signedAt,
      },
    });

    await tx.event.update({
      where: { id: event.id },
      data: {
        contract_pdf_url: pdfKey,
        contract_signed_at: signedAt,
        contract_emailed_at: signedAt,
      },
    });

    return created;
  });

  let signedUrl = null;
  try {
    signedUrl = await getSignedGetUrl(pdfKey);
  } catch {}

  if (notify) {
    if (user?.email && signedUrl) {
      sendEmail({
        to: [user.email],
        subject: `Your signed contract — ${company?.name || 'USR Music'}`,
        html: `<p>Hi ${user.name || ''},</p>
               <p>Thanks for signing your contract. A copy is attached, and you can also download it here:</p>
               <p><a href="${signedUrl}">Download signed contract (PDF)</a></p>`,
        attachments: pdfBuffer
          ? [{ filename: `contract_${event.id}.pdf`, content: pdfBuffer }]
          : undefined,
      }).catch(() => {});
    }

    try {
      const admins = await prisma.user.findMany({
        where: { role_id: BigInt(2), is_email_send: true },
        select: { email: true },
      });
      const adminEmails = admins.map((a) => a.email).filter(Boolean);
      if (adminEmails.length && signedUrl) {
        sendEmail({
          to: adminEmails,
          subject: `Contract signed — Event #${event.id}`,
          html: `<p>${user?.name || 'A client'} just signed the contract for event #${event.id}.</p>
                 <p><a href="${signedUrl}">View signed contract</a></p>`,
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[contractSign] admin notify failed', e?.message || e);
    }
  }

  return {
    contract_id: contract.id,
    event_id: event.id,
    signed_pdf_path: pdfKey,
    signed_pdf_url: signedUrl,
    signed_at: signedAt,
  };
}

export default { signContractForEvent };
