import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { toDbDate } from '../utils/dateUtils.js';

// GET /new-enquiry/equipment-availability?equipment_id=123&date=2026-02-28&exclude_event_id=12
export const getEquipmentAvailability = catchAsync(async (req, res) => {
  const equipmentId = Number(req.query.equipment_id || req.query.id);
  const dateRaw = req.query.date;
  const excludeEventId = req.query.exclude_event_id ? Number(req.query.exclude_event_id) : null;
  if (!equipmentId || !dateRaw) return res.status(400).json({ error: 'equipment_id_and_date_required' });

  const date = toDbDate(dateRaw);
  if (!date) return res.status(400).json({ error: 'invalid_date' });

  const equipment = await prisma.equipment.findUnique({ where: { id: BigInt(equipmentId) } }).catch(() => null);
  const totalQty = equipment && equipment.quantity != null ? Number(equipment.quantity) : 0;

  // Sum quantities reserved for that equipment on the same date (consider open + confirmed events)
  const where = {
    equipment_id: equipmentId,
    event: { date, event_status_id: { in: [1, 2] } },
  };
  if (excludeEventId) where.event_id = { not: excludeEventId };

  const reservedAgg = await prisma.eventPackage.aggregate({ where, _sum: { quantity: true } }).catch(() => ({ _sum: { quantity: 0 } }));
  const reserved = Number(reservedAgg._sum.quantity || 0);
  const available = Math.max(0, totalQty - reserved);

  res.json(serializeForJson({ equipment_id: equipmentId, date, total_quantity: totalQty, reserved_quantity: reserved, available }));
});

// GET /new-enquiry/check-quantity?equipment_id=123&date=2026-02-28&required=2
export const checkQuantity = catchAsync(async (req, res) => {
  const equipmentId = Number(req.query.equipment_id || req.query.id);
  const dateRaw = req.query.date;
  const required = Number(req.query.required || req.query.qty || 0);
  if (!equipmentId || !dateRaw || !required) return res.status(400).json({ error: 'equipment_id_date_and_required_qty_required' });

  const date = toDbDate(dateRaw);
  if (!date) return res.status(400).json({ error: 'invalid_date' });

  const availability = await getAvailabilityFor(equipmentId, date);
  const ok = availability.available >= required;
  res.json(serializeForJson({ equipment_id: equipmentId, date, required, ok, availability }));
});

async function getAvailabilityFor(equipmentId, date, excludeEventId = null) {
  const equipment = await prisma.equipment.findUnique({ where: { id: BigInt(equipmentId) } }).catch(() => null);
  const totalQty = equipment && equipment.quantity != null ? Number(equipment.quantity) : 0;
  const where = { equipment_id: equipmentId, event: { date, event_status_id: { in: [1, 2] } } };
  if (excludeEventId) where.event_id = { not: excludeEventId };
  const reservedAgg = await prisma.eventPackage.aggregate({ where, _sum: { quantity: true } }).catch(() => ({ _sum: { quantity: 0 } }));
  const reserved = Number(reservedAgg._sum.quantity || 0);
  return { total_quantity: totalQty, reserved_quantity: reserved, available: Math.max(0, totalQty - reserved) };
}

// GET /new-enquiry/package/:id  -> package user with mapped equipment rows
export const getPackageWithEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const pkg = await prisma.package_users.findUnique({ where: { id }, include: { package_user_properties: true } });
  if (!pkg) return res.status(404).json({ error: 'not_found' });

  const equipmentRows = await prisma.$queryRaw`
    SELECT pue.package_user_id, pue.equipment_id, pue.equipment_order_id, pue.quantity, pue.created_at, pue.created_by, e.name AS equipment_name
    FROM package_user_equipment pue
    LEFT JOIN equipment e ON pue.equipment_id = e.id
    WHERE pue.package_user_id = ${id}
    ORDER BY pue.equipment_order_id ASC`;

  res.json(serializeForJson({ package: pkg, equipment: equipmentRows }));
});

export default { getEquipmentAvailability, checkQuantity, getPackageWithEquipment };
