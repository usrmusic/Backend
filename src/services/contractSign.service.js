import prisma from '../utils/prismaClient.js';
import { uploadStreamToS3, getSignedGetUrl, getObjectBuffer } from '../utils/s3Client.js';
import { generateContractPdf } from '../utils/pdfGenerator.js';
import sendEmail from '../utils/mail/resendClient.js';
import { buildContractSignedEmail } from '../utils/mail/templates/contractSignedEmail.js';

// The PDFKit renderer takes image Buffers directly (doc.image() doesn't
// accept a URL), so the admin signature is fetched as bytes rather than the
// data-URI round-trip the old HTML renderer needed.
async function fetchAsBuffer(key) {
  if (!key) return null;
  try {
    return await getObjectBuffer(String(key));
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

  const adminSignatureBuf = company?.admin_signature
    ? await fetchAsBuffer(company.admin_signature)
    : null;

  // signatureDataUri arrives from the client's signing canvas as a base64
  // data URI; PDFKit needs the raw bytes.
  const sigBase64ForPdf = signatureDataUri.replace(/^data:image\/[^;]+;base64,/, '');
  const signatureBuf = Buffer.from(sigBase64ForPdf, 'base64');

  const signedAt = new Date();

  let pdfBuffer;
  try {
    pdfBuffer = await generateContractPdf({
      event,
      user,
      company,
      signature: signatureBuf,
      adminSignature: adminSignatureBuf,
      signedAt,
    });
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

  // Store the raw signature PNG independently of the PDF — reuses the same
  // bytes already decoded above for the PDF itself.
  const sigKey = `signatures/event_${event.id}_${Date.now()}.png`;
  try {
    await uploadStreamToS3(signatureBuf, sigKey, 'image/png');
  } catch (e) {
    console.error('[contractSign] signature upload failed', e?.message || e);
  }

  const ownerUserId = user?.id ? Number(user.id) : event.user_id ?? 0;
  const signerUserId = acting_user_id ? Number(acting_user_id) : ownerUserId;

  // Sequential writes — no transaction to avoid P2028 pool exhaustion
  const created = await prisma.contract.create({
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

  await prisma.signature.create({
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

  await prisma.event.update({
    where: { id: event.id },
    data: {
      contract_pdf_url: pdfKey,
      contract_signed_at: signedAt,
      contract_emailed_at: signedAt,
    },
  });

  const contract = created;

  let signedUrl = null;
  try {
    signedUrl = await getSignedGetUrl(pdfKey);
  } catch {}

  if (notify) {
    if (user?.email && signedUrl) {
      const logoUrl = company?.company_logo
        ? await getSignedGetUrl(company.company_logo).catch(() => null)
        : null;
      const { subject, html } = buildContractSignedEmail({
        name: user.name || '',
        signedUrl,
        company,
        logoUrl,
      });
      // One email, admin genuinely CC'd (visible in the headers) rather than
      // a second, separate email — the client asked for a real CC here.
      sendEmail({
        to: [user.email],
        cc: ['info@usrmusic.co.uk'],
        subject,
        html,
        attachments: pdfBuffer
          ? [{ filename: `contract_${event.id}.pdf`, content: pdfBuffer }]
          : undefined,
      }).catch((e) => {
        console.error('[contractSign] send failed', e?.message || e);
      });
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
