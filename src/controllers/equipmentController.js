import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listEquipment = catchAsync(async (req, res) => {
  const { q, supplier_id } = req.query;
  const where = {};
  if (supplier_id) where.supplier_id = Number(supplier_id);
  if (q) where.name = { contains: String(q) };

  const items = await prisma.equipment.findMany({ where, orderBy: { name: 'asc' } });
  res.json(serializeForJson(items));
});

export const getEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const item = await prisma.equipment.findUnique({ where: { id: BigInt(id) } });
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(item));
});

export const createEquipment = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'name_required' });
  if (body.sell_price == null) return res.status(400).json({ error: 'sell_price_required' });

  const data = {
    supplier_id: body.supplier_id ? Number(body.supplier_id) : undefined,
    name: body.name,
    cost_price: body.cost_price != null ? Number(body.cost_price) : undefined,
    sell_price: Number(body.sell_price),
    status: body.status || 'ACTIVE',
    quantity: body.quantity != null ? Number(body.quantity) : undefined,
    pricing_guide: body.pricing_guide,
    is_availabilty_check: body.is_availabilty_check != null ? Boolean(body.is_availabilty_check) : undefined,
    rig_notes: body.rig_notes,
    created_by: body.created_by ? Number(body.created_by) : undefined,
    updated_by: body.updated_by ? Number(body.updated_by) : undefined,
  };

  const created = await prisma.equipment.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const updateEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {
    supplier_id: body.supplier_id ? Number(body.supplier_id) : undefined,
    name: body.name,
    cost_price: body.cost_price != null ? Number(body.cost_price) : undefined,
    sell_price: body.sell_price != null ? Number(body.sell_price) : undefined,
    status: body.status,
    quantity: body.quantity != null ? Number(body.quantity) : undefined,
    pricing_guide: body.pricing_guide,
    is_availabilty_check: body.is_availabilty_check != null ? Boolean(body.is_availabilty_check) : undefined,
    rig_notes: body.rig_notes,
    updated_by: body.updated_by ? Number(body.updated_by) : undefined,
  };

  const updated = await prisma.equipment.update({ where: { id: BigInt(id) }, data });
  res.json(serializeForJson(updated));
});

export const deleteEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.equipment.delete({ where: { id: BigInt(id) } });
  res.json({ ok: true });
});

export default { listEquipment, getEquipment, createEquipment, updateEquipment, deleteEquipment };
