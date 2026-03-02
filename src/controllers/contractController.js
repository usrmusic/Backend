import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { getDownloadUrl } from '../utils/uploadHelper.js';
import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import uploadFile from '../utils/uploadHelper.js';
import fs from 'fs';
import path from 'path';
import { logActivity } from '../utils/activityLogger.js';

function getUploadsDir() {
  if (process.env.PERSISTENT_UPLOADS_DIR && process.env.PERSISTENT_UPLOADS_DIR.length) return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), 'uploads');
}

export const listContracts = catchAsync(async (req, res) => {
  const event_id = req.query.event_id ? Number(req.query.event_id) : undefined;
  const where = event_id ? { where: { event_id } } : {};
  const contracts = await prisma.contract.findMany({ ...(where.where ? where : {}), orderBy: { id: 'asc' } });
  res.json(serializeForJson(contracts));
});

export const getContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const c = await prisma.contract.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(c));
});

export const createContract = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (body.user_id == null || body.event_id == null) return res.status(400).json({ error: 'user_id_and_event_id_required' });

  const data = {
    user_id: Number(body.user_id),
    event_id: Number(body.event_id),
    signed_pdf_path: body.signed_pdf_path || null,
    amount: body.amount != null ? Number(body.amount) : null,
    status: body.status || undefined,
    content: body.content || null,
    sent_at: body.sent_at ? new Date(body.sent_at) : null,
    signed_at: body.signed_at ? new Date(body.signed_at) : null,
    created_at: new Date(),
  };
  const created = await prisma.contract.create({ data });
  try { await logActivity(prisma, { log_name: 'contracts', description: 'Created contract', subject_type: 'Contract', subject_id: created.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  res.status(201).json(serializeForJson(created));
});

export const updateContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {};
  if (body.signed_pdf_path != null) data.signed_pdf_path = body.signed_pdf_path;
  if (body.amount != null) data.amount = Number(body.amount);
  if (body.status != null) data.status = body.status;
  if (body.content != null) data.content = body.content;
  if (body.sent_at != null) data.sent_at = new Date(body.sent_at);
  if (body.signed_at != null) data.signed_at = new Date(body.signed_at);
  data.updated_at = new Date();

  const updated = await prisma.contract.update({ where: { id }, data });
  try { await logActivity(prisma, { log_name: 'contracts', description: 'Updated contract', subject_type: 'Contract', subject_id: updated.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  res.json(serializeForJson(updated));
});

export const deleteContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.contract.delete({ where: { id } });
  try { await logActivity(prisma, { log_name: 'contracts', description: 'Deleted contract', subject_type: 'Contract', subject_id: id, causer_id: req.user?.id || null }); } catch(e){}
  res.json({ ok: true });
});

export const downloadContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const c = await prisma.contract.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ error: 'not_found' });
  if (!c.signed_pdf_path) return res.status(404).json({ error: 'no_signed_pdf' });

  const url = await getDownloadUrl(c.signed_pdf_path).catch(() => null);
  if (!url) return res.status(500).json({ error: 'download_url_error' });
  res.json(serializeForJson({ url }));
});

export const generateContractPdf = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.body.id || req.query.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const c = await prisma.contract.findUnique({ where: { id }, include: { user: true, event: true } }).catch(()=>null);
  if (!c) return res.status(404).json({ error: 'not_found' });

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(18).text('Contract', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Contract ID: ${c.id}`);
  doc.text(`Event ID: ${c.event_id || ''}`);
  doc.text(`Client ID: ${c.user_id || ''} ${c.user?.name || ''}`);
  doc.moveDown();
  doc.text('Content:', { underline: true });
  doc.moveDown();
  doc.fontSize(10).text(c.content || 'No content provided', { align: 'left' });
  doc.moveDown();
  if (c.amount != null) doc.text(`Amount: ${c.amount}`);
  doc.end();

  const pdfBuffer = await getStream.buffer(doc);
  const fileObj = { buffer: pdfBuffer, originalname: `contract-${id}.pdf`, mimetype: 'application/pdf' };
  const uploaded = await uploadFile(fileObj, { folder: 'contracts' }).catch(()=>null);
  if (!uploaded) return res.status(500).json({ error: 'upload_failed' });
  const key = uploaded.key || uploaded.url || uploaded;
  // create fileUpload record
  try { await prisma.fileUpload.create({ data: { file_name: key, file_type: 'application/pdf', event_id: c.event_id || null, created_by: req.user?.id || null } }); } catch(e){}
  try { await logActivity(prisma, { log_name: 'contracts', description: 'Generated contract PDF', subject_type: 'Contract', subject_id: id, causer_id: req.user?.id || null, properties: { file_key: key } }); } catch(e){}
  const url = await getDownloadUrl(key).catch(()=>null);
  res.status(201).json(serializeForJson({ url, key }));
});

export const signContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.body.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const c = await prisma.contract.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ error: 'not_found' });

  // Accept signature via base64, signature_path, or existing signature_id
  const body = req.body || {};
  let sigBuffer = null;
  if (body.signature_base64) {
    const m = String(body.signature_base64).match(/^data:(.+);base64,(.+)$/);
    const b64 = m ? m[2] : body.signature_base64;
    sigBuffer = Buffer.from(b64, 'base64');
  } else if (body.signature_path) {
    // try to read local uploads dir if the signature_path is a relative key
    try {
      const uploadsDir = getUploadsDir();
      const candidate = path.join(uploadsDir, String(body.signature_path));
      if (fs.existsSync(candidate)) {
        sigBuffer = await fs.promises.readFile(candidate);
      } else {
        // also try without folder prefix (maybe stored as folder/file)
        const alt = path.join(uploadsDir, path.basename(String(body.signature_path)));
        if (fs.existsSync(alt)) sigBuffer = await fs.promises.readFile(alt);
      }
    } catch (e) {
      // ignore and continue — we'll embed path text instead
    }
  } else if (body.signature_id) {
    const s = await prisma.signature.findUnique({ where: { id: Number(body.signature_id) } }).catch(()=>null);
    if (s && s.signature_path && (s.signature_path.startsWith('http') || s.signature_path.startsWith(process.env.BASE_URL || ''))) {
      // leave as URL - pdfkit can accept buffer only; we'll not attempt remote fetch here
    }
  }

  // create a signed PDF by generating contract content and placing signature image at bottom if available
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(18).text('Signed Contract', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Contract ID: ${c.id}`);
  doc.moveDown();
  doc.fontSize(10).text(c.content || 'No content provided');
  doc.moveDown(2);
  if (sigBuffer) {
    try {
      doc.image(sigBuffer, { fit: [250, 100], align: 'left' });
    } catch(e) {}
  } else if (body.signature_path) {
    // embed path as text if we cannot fetch
    doc.fontSize(9).text(`Signature file: ${body.signature_path}`);
  }
  doc.moveDown();
  doc.text(`Signed At: ${new Date().toISOString()}`);
  doc.end();

  const pdfBuffer = await getStream.buffer(doc);
  const fileObj = { buffer: pdfBuffer, originalname: `contract-signed-${id}.pdf`, mimetype: 'application/pdf' };
  const uploaded = await uploadFile(fileObj, { folder: 'contracts' }).catch(()=>null);
  if (!uploaded) return res.status(500).json({ error: 'upload_failed' });
  const key = uploaded.key || uploaded.url || uploaded;

  // update contract signed path and signed_at
  const updated = await prisma.contract.update({ where: { id }, data: { signed_pdf_path: key, signed_at: new Date(), status: 'SIGNED' } }).catch(()=>null);

  // create signature record if buffer available
  if (sigBuffer) {
    try { await prisma.signature.create({ data: { contract_id: id, user_id: req.user?.id || null, signature_path: key, created_at: new Date() } }); } catch(e) {}
  }

  try { await logActivity(prisma, { log_name: 'contracts', description: 'Signed contract', subject_type: 'Contract', subject_id: id, causer_id: req.user?.id || null, properties: { signed_key: key } }); } catch(e){}

  const url = await getDownloadUrl(key).catch(()=>null);
  res.json(serializeForJson({ url, key, contract: updated }));
});

export default { listContracts, getContract, createContract, updateContract, deleteContract, downloadContract, generateContractPdf, signContract };
