import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listPaymentMethods = catchAsync(async (req, res) => {
  const methods = await prisma.paymentMethod.findMany({ orderBy: { id: 'asc' } });
  res.json(serializeForJson(methods));
});

export const getPaymentMethod = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const m = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!m) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(m));
});

export const createPaymentMethod = catchAsync(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const created = await prisma.paymentMethod.create({ data: { name } });
  res.status(201).json(serializeForJson(created));
});

export const updatePaymentMethod = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { name } = req.body || {};
  const updated = await prisma.paymentMethod.update({ where: { id }, data: { name } });
  res.json(serializeForJson(updated));
});

export const deletePaymentMethod = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.paymentMethod.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listPaymentMethods, getPaymentMethod, createPaymentMethod, updatePaymentMethod, deletePaymentMethod };
