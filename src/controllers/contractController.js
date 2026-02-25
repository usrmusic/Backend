import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

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
  res.json(serializeForJson(updated));
});

export const deleteContract = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.contract.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listContracts, getContract, createContract, updateContract, deleteContract };
