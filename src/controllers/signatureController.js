import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import uploadFile from "../utils/uploadHelper.js";

export const listSignatures = catchAsync(async (req, res) => {
  const contract_id = req.query.contract_id ? Number(req.query.contract_id) : undefined;
  const where = contract_id ? { where: { contract_id } } : {};
  const rows = await prisma.signature.findMany({ ...(where.where ? where : {}), orderBy: { id: 'asc' } });
  res.json(serializeForJson(rows));
});

export const getSignature = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const s = await prisma.signature.findUnique({ where: { id } });
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(s));
});

export const createSignature = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (body.contract_id == null || body.user_id == null) return res.status(400).json({ error: 'contract_id_and_user_id_required' });

  // Determine signature source: multipart file (req.file) or base64 in body.signature_base64 or direct signature_path
  let signaturePath = null;

  if (req.file) {
    // upload via helper (S3 or local depending on FILE_STORAGE)
    const result = await uploadFile(req.file, { folder: 'signatures' });
    signaturePath = result && (result.key || result.url) ? (result.key || result.url) : null;
  } else if (body.signature_base64) {
    // data URL: data:[<mediatype>][;base64],<data>
    const m = String(body.signature_base64).match(/^data:(.+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid_base64' });
    const mime = m[1] || 'image/png';
    const b64 = m[2] || '';
    const buffer = Buffer.from(b64, 'base64');
    const fileObj = { buffer, originalname: `signature-${Date.now()}.png`, mimetype: mime };
    const result = await uploadFile(fileObj, { folder: 'signatures' });
    signaturePath = result && (result.key || result.url) ? (result.key || result.url) : null;
  } else if (body.signature_path) {
    signaturePath = body.signature_path;
  } else {
    return res.status(400).json({ error: 'signature_required' });
  }

  const data = {
    contract_id: Number(body.contract_id),
    user_id: Number(body.user_id),
    signature_path: signaturePath,
    ip_address: req.ip || null,
    user_agent: req.headers['user-agent'] || null,
    created_at: new Date(),
  };

  const created = await prisma.signature.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const deleteSignature = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.signature.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listSignatures, getSignature, createSignature, deleteSignature };
