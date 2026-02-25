import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listEventPackages = catchAsync(async (req, res) => {
  const eventId = req.query.event_id ? Number(req.query.event_id) : undefined;
  const where = eventId ? { where: { event_id: eventId } } : {};
  const items = await prisma.eventPackage.findMany({ ...(where.where ? where : {}), orderBy: { id: 'asc' } });
  res.json(serializeForJson(items));
});

export const getEventPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const item = await prisma.eventPackage.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(item));
});

export const createEventPackage = catchAsync(async (req, res) => {
  const body = req.body || {};
  const required = ['event_id', 'equipment_id'];
  for (const f of required) if (!body[f]) return res.status(400).json({ error: `${f}_required` });

  const data = {
    equipment_id: body.equipment_id,
    equipment_order_id: body.equipment_order_id,
    event_id: body.event_id,
    package_type_id: body.package_type_id,
    sell_price: body.sell_price,
    cost_price: body.cost_price,
    notes: body.notes,
    rig_notes: body.rig_notes,
    payment_send: body.payment_send,
    payment_date: body.payment_date ? new Date(body.payment_date) : undefined,
    quantity: body.quantity,
    total_price: body.total_price,
    price_added_to_bill: body.price_added_to_bill,
  };

  const created = await prisma.eventPackage.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const updateEventPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {
    equipment_id: body.equipment_id,
    equipment_order_id: body.equipment_order_id,
    package_type_id: body.package_type_id,
    sell_price: body.sell_price,
    cost_price: body.cost_price,
    notes: body.notes,
    rig_notes: body.rig_notes,
    payment_send: body.payment_send,
    payment_date: body.payment_date ? new Date(body.payment_date) : undefined,
    quantity: body.quantity,
    total_price: body.total_price,
    price_added_to_bill: body.price_added_to_bill,
  };
  const updated = await prisma.eventPackage.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteEventPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.eventPackage.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listEventPackages, getEventPackage, createEventPackage, updateEventPackage, deleteEventPackage };
