import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { logActivity } from '../utils/activityLogger.js';

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
  // enforce availability checks when equipment requires it
  const equipmentId = Number(body.equipment_id);
  const eventId = Number(body.event_id);
  if (equipmentId) {
    const equipment = await prisma.equipment.findUnique({ where: { id: BigInt(equipmentId) } }).catch(()=>null);
    if (equipment && equipment.is_availabilty_check) {
      // determine event date
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true } }).catch(()=>null);
      const evDate = ev && ev.date ? ev.date : null;
      if (!evDate) return res.status(400).json({ error: 'event_date_required_for_availability' });
      // sum reserved quantities for this equipment on the date (open + confirmed)
      const agg = await prisma.eventPackage.aggregate({ where: { equipment_id: equipmentId, event: { date: evDate, event_status_id: { in: [1,2] } } }, _sum: { quantity: true } }).catch(()=>({ _sum: { quantity: 0 } }));
      const reserved = Number(agg._sum.quantity || 0);
      const totalQty = equipment.quantity != null ? Number(equipment.quantity) : 0;
      const requiredQty = body.quantity != null ? Number(body.quantity) : 0;
      if (requiredQty > Math.max(0, totalQty - reserved)) return res.status(400).json({ error: 'insufficient_equipment_quantity' });
    }
  }

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
  // activity log
  try { await logActivity(prisma, { log_name: 'event_packages', description: 'Created event package', subject_type: 'EventPackage', subject_id: created.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  res.status(201).json(serializeForJson(created));
});

export const updateEventPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  // enforce availability checks when equipment requires it (exclude this package)
  const data = {};
  const existing = await prisma.eventPackage.findUnique({ where: { id } }).catch(()=>null);
  const equipmentId = body.equipment_id ? Number(body.equipment_id) : (existing ? Number(existing.equipment_id) : null);
  const eventId = existing ? Number(existing.event_id) : (body.event_id ? Number(body.event_id) : null);
  if (equipmentId) {
    const equipment = await prisma.equipment.findUnique({ where: { id: BigInt(equipmentId) } }).catch(()=>null);
    if (equipment && equipment.is_availabilty_check) {
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true } }).catch(()=>null);
      const evDate = ev && ev.date ? ev.date : null;
      if (!evDate) return res.status(400).json({ error: 'event_date_required_for_availability' });
      const agg = await prisma.eventPackage.aggregate({ where: { equipment_id: equipmentId, event: { date: evDate, event_status_id: { in: [1,2] } }, id: { not: id } }, _sum: { quantity: true } }).catch(()=>({ _sum: { quantity: 0 } }));
      const reserved = Number(agg._sum.quantity || 0);
      const totalQty = equipment.quantity != null ? Number(equipment.quantity) : 0;
      const newQty = body.quantity != null ? Number(body.quantity) : (existing ? Number(existing.quantity || 0) : 0);
      if (newQty > Math.max(0, totalQty - reserved)) return res.status(400).json({ error: 'insufficient_equipment_quantity' });
    }
  }

  // apply allowed fields
  {
    if (body.equipment_id !== undefined) data.equipment_id = body.equipment_id;
    if (body.equipment_order_id !== undefined) data.equipment_order_id = body.equipment_order_id;
    if (body.package_type_id !== undefined) data.package_type_id = body.package_type_id;
    if (body.sell_price !== undefined) data.sell_price = body.sell_price;
    if (body.cost_price !== undefined) data.cost_price = body.cost_price;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.rig_notes !== undefined) data.rig_notes = body.rig_notes;
    if (body.payment_send !== undefined) data.payment_send = body.payment_send;
    if (body.payment_date !== undefined) data.payment_date = body.payment_date ? new Date(body.payment_date) : null;
    if (body.quantity !== undefined) data.quantity = body.quantity;
    if (body.total_price !== undefined) data.total_price = body.total_price;
    if (body.price_added_to_bill !== undefined) data.price_added_to_bill = body.price_added_to_bill;
  }
  const updated = await prisma.eventPackage.update({ where: { id }, data });
  try { await logActivity(prisma, { log_name: 'event_packages', description: 'Updated event package', subject_type: 'EventPackage', subject_id: updated.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  res.json(serializeForJson(updated));
});

export const deleteEventPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.eventPackage.delete({ where: { id } });
  try { await logActivity(prisma, { log_name: 'event_packages', description: 'Deleted event package', subject_type: 'EventPackage', subject_id: id, causer_id: req.user?.id || null }); } catch(e){}
  res.json({ ok: true });
});

export default { listEventPackages, getEventPackage, createEventPackage, updateEventPackage, deleteEventPackage };
