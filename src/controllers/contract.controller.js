import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import { getSignedGetUrl, deleteObjectFromS3 } from '../utils/s3Client.js';
import sendEmail from '../utils/mail/resendClient.js';
import { signContractForEvent } from '../services/contractSign.service.js';
import { randomUUID } from 'crypto';

// Public: load the event for signing using the contract_token UUID.
// Mirrors Laravel SignatureController::showContractForm.
const showContractByToken = catchAsync(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token_required' });

  const event = await prisma.event.findUnique({
    where: { contract_token: token },
    include: {
      users_events_user_idTousers: {
        select: { id: true, name: true, email: true, contact_number: true },
      },
      venues: { select: { id: true, venue: true, venue_address: true } },
      event_package: { include: { equipment: true } },
      contracts: {
        include: { signatures: true },
        orderBy: { id: 'desc' },
        take: 1,
      },
    },
  });
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  let company = null;
  if (event.names_id) {
    company = await prisma.companyName
      .findUnique({ where: { id: BigInt(event.names_id) } })
      .catch(() => null);
    if (company?.admin_signature) {
      try {
        company.admin_signature_url = await getSignedGetUrl(String(company.admin_signature));
      } catch {
        company.admin_signature_url = null;
      }
    }
  }

  const latestContract = Array.isArray(event.contracts) ? event.contracts[0] : null;
  const alreadySigned = !!event.contract_signed_at || latestContract?.status === 'signed';

  let signedPdfUrl = null;
  if (alreadySigned) {
    if (latestContract?.signed_pdf_path) {
      try {
        signedPdfUrl = await getSignedGetUrl(String(latestContract.signed_pdf_path));
      } catch {
        signedPdfUrl = null;
      }
    } else if (event.contract_pdf_url) {
      try {
        const u = new URL(String(event.contract_pdf_url));
        signedPdfUrl = await getSignedGetUrl(u.pathname.replace(/^\//, ''));
      } catch {
        signedPdfUrl = String(event.contract_pdf_url);
      }
    }
  }

  return res.json(
    serializeForJson({
      success: true,
      data: {
        event,
        company,
        already_signed: alreadySigned,
        signed_pdf_url: signedPdfUrl,
      },
    }),
  );
});

// Public: accept the drawn signature, store the rendered PDF on S3, persist
// Contract + Signature rows, and notify both client and admins by email.
// Mirrors Laravel SignatureController::saveSignatureNew.
const signContractByToken = catchAsync(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token_required' });

  const body = req.body || {};
  const signatureDataUri = body.signature_image || body.signatureImage;
  if (!signatureDataUri || typeof signatureDataUri !== 'string' || !signatureDataUri.startsWith('data:image/')) {
    return res.status(400).json({ error: 'signature_image_required' });
  }

  const event = await prisma.event.findUnique({
    where: { contract_token: token },
    select: { id: true, user_id: true, contract_signed_at: true },
  });
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  if (event.contract_signed_at) {
    return res.status(409).json({ error: 'contract_already_signed' });
  }

  try {
    const result = await signContractForEvent({
      eventId: event.id,
      signatureDataUri,
      acting_user_id: event.user_id,
      ip: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      userAgent: req.headers['user-agent']?.toString().slice(0, 250) || null,
    });
    return res.json(serializeForJson({ success: true, data: result }));
  } catch (e) {
    if (e?.code === 'event_not_found') return res.status(404).json({ error: 'event_not_found' });
    if (e?.code === 'already_signed') return res.status(409).json({ error: 'contract_already_signed' });
    if (e?.code === 'pdf_generation_failed') return res.status(500).json({ error: 'pdf_generation_failed' });
    if (e?.code === 'pdf_upload_failed') return res.status(500).json({ error: 'pdf_upload_failed' });
    throw e;
  }
});

// Authenticated: ensure the event has a contract_token (creating one on
// demand) and return a public signing URL the admin can share with the client.
const ensureContractTokenForEvent = catchAsync(async (req, res) => {
  const eventId = Number(req.params.id);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  let event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  if (!event.contract_token) {
    const token = randomUUID();
    event = await prisma.event.update({
      where: { id: eventId },
      data: { contract_token: token },
    });
  }

  const base = (process.env.PUBLIC_FRONTEND_URL || '').replace(/\/$/, '');
  const signing_url = base ? `${base}/contract/${event.contract_token}` : null;

  return res.json(
    serializeForJson({
      success: true,
      data: {
        event_id: event.id,
        contract_token: event.contract_token,
        signing_url,
        already_signed: !!event.contract_signed_at,
      },
    }),
  );
});

// Authenticated: send the signing link to the client by email.
const sendContractLinkEmail = catchAsync(async (req, res) => {
  const eventId = Number(req.params.id);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  let event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: true },
  });
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  if (!event.contract_token) {
    const token = randomUUID();
    event = await prisma.event.update({
      where: { id: eventId },
      data: { contract_token: token },
      include: { users_events_user_idTousers: true },
    });
  }

  const user = event.users_events_user_idTousers;
  if (!user?.email) return res.status(400).json({ error: 'client_email_missing' });

  const base = (process.env.PUBLIC_FRONTEND_URL || '').replace(/\/$/, '');
  const signing_url = base ? `${base}/contract/${event.contract_token}` : null;

  if (!signing_url) {
    return res.status(500).json({ error: 'public_frontend_url_not_configured' });
  }

  await sendEmail({
    to: [user.email],
    subject: `Please sign your contract — Event #${event.id}`,
    html: `<p>Hi ${user.name || ''},</p>
           <p>Please review and sign your contract using the secure link below:</p>
           <p><a href="${signing_url}">Sign your contract</a></p>
           <p>If you have any questions, just reply to this email.</p>`,
  }).catch((e) => {
    console.error('[contract.sendLink] sendEmail failed', e?.message || e);
  });

  await prisma.event
    .update({
      where: { id: eventId },
      data: { contract_emailed_at: new Date() },
    })
    .catch(() => {});

  return res.json(
    serializeForJson({
      success: true,
      data: { event_id: event.id, signing_url },
    }),
  );
});

// Admin: list every Contract row associated with an event (newest first).
// Each row is augmented with a presigned `view_url` (inline) and `download_url`
// (forces attachment via Content-Disposition). Mirrors Laravel
// ContractController::getContract scoped to an event.
const listContractsForEvent = catchAsync(async (req, res) => {
  const eventId = Number(req.params.id);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  const rows = await prisma.contract.findMany({
    where: { event_id: eventId },
    orderBy: { signed_at: 'desc' },
    include: {
      signatures: {
        select: { id: true, ip_address: true, user_agent: true, created_at: true },
      },
    },
  });

  const enriched = await Promise.all(
    rows.map(async (row) => {
      let view_url = null;
      let download_url = null;
      if (row.signed_pdf_path) {
        try {
          view_url = await getSignedGetUrl(String(row.signed_pdf_path));
        } catch {
          view_url = null;
        }
        try {
          download_url = await getSignedGetUrl(
            String(row.signed_pdf_path),
            60 * 60 * 24 * 7,
            `contract_${row.id}.pdf`,
          );
        } catch {
          download_url = null;
        }
      }
      const filename = row.signed_pdf_path
        ? String(row.signed_pdf_path).split('/').pop()
        : null;
      return { ...row, filename, view_url, download_url };
    }),
  );

  return res.json(serializeForJson({ success: true, data: enriched }));
});

// Admin: redirect to a presigned URL that forces a PDF download. Cleaner
// than streaming through Node and matches Laravel's Storage::download().
const downloadContract = catchAsync(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'id_required' });

  const row = await prisma.contract.findUnique({ where: { id: BigInt(id) } });
  if (!row || !row.signed_pdf_path) {
    return res.status(404).json({ error: 'contract_not_found' });
  }
  const url = await getSignedGetUrl(
    String(row.signed_pdf_path),
    60 * 5,
    `contract_${row.id}.pdf`,
  );
  return res.redirect(303, url);
});

// Admin: delete a Contract row, its Signature rows and the underlying S3
// objects. If the deleted row was the latest one for its event, also clear
// `event.contract_signed_at` / `contract_pdf_url` / `contract_emailed_at` so
// the admin can issue a fresh signing link.
const deleteContract = catchAsync(async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'id_required' });

  const row = await prisma.contract.findUnique({
    where: { id: BigInt(id) },
    include: { signatures: true },
  });
  if (!row) return res.status(404).json({ error: 'contract_not_found' });

  // Best-effort S3 cleanup — failures are logged but do not block the DB delete.
  if (row.signed_pdf_path) {
    await deleteObjectFromS3(String(row.signed_pdf_path)).catch((e) =>
      console.error('[contract.delete] s3 pdf delete failed', e?.message || e),
    );
  }
  for (const sig of row.signatures || []) {
    if (sig.signature_path) {
      await deleteObjectFromS3(String(sig.signature_path)).catch((e) =>
        console.error('[contract.delete] s3 sig delete failed', e?.message || e),
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.signature.deleteMany({ where: { contract_id: row.id } });
    await tx.contract.delete({ where: { id: row.id } });

    // If this was the latest contract for the event, clear the badge fields
    // so the UI flips back to "no signature yet" and the admin can resend.
    const remaining = await tx.contract.findFirst({
      where: { event_id: row.event_id },
      orderBy: { signed_at: 'desc' },
    });
    if (!remaining) {
      await tx.event
        .update({
          where: { id: row.event_id },
          data: {
            contract_signed_at: null,
            contract_pdf_url: null,
            contract_emailed_at: null,
          },
        })
        .catch(() => {});
    }
  });

  return res.json({ success: true });
});

export default {
  showContractByToken,
  signContractByToken,
  ensureContractTokenForEvent,
  sendContractLinkEmail,
  listContractsForEvent,
  downloadContract,
  deleteContract,
};
