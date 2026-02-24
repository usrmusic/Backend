import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listEventPayments = catchAsync(async (req, res) => {
  const event_id = req.query.event_id ? Number(req.query.event_id) : undefined;
  const where = event_id ? { where: { event_id } } : {};
  const payments = await prisma.eventPayment.findMany({ ...(where.where ? where : {}), orderBy: { date: 'asc' } });
  res.json(serializeForJson(payments));
});

export const getEventPayment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const p = await prisma.eventPayment.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(p));
});

export const createEventPayment = catchAsync(async (req, res) => {
  const body = req.body || {};
  const required = ['event_id', 'payment_method_id', 'amount'];
  for (const f of required) if (body[f] == null) return res.status(400).json({ error: `${f}_required` });

  const data = {
    event_id: Number(body.event_id),
    payment_method_id: Number(body.payment_method_id),
    date: body.date ? new Date(body.date) : new Date(),
    amount: Number(body.amount),
    created_at: new Date(),
  };

  const created = await prisma.eventPayment.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const updateEventPayment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {};
  if (body.payment_method_id != null) data.payment_method_id = Number(body.payment_method_id);
  if (body.date != null) data.date = new Date(body.date);
  if (body.amount != null) data.amount = Number(body.amount);

  const updated = await prisma.eventPayment.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteEventPayment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.eventPayment.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listEventPayments, getEventPayment, createEventPayment, updateEventPayment, deleteEventPayment };
