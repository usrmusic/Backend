import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

// List equipment for a package_user (query: package_user_id)
export const listPackageUserEquipment = catchAsync(async (req, res) => {
  const packageUserId = req.query.package_user_id ? Number(req.query.package_user_id) : undefined;
  if (!packageUserId) return res.status(400).json({ error: 'package_user_id_required' });

  const rows = await prisma.$queryRaw`
    SELECT pue.package_user_id, pue.equipment_id, pue.equipment_order_id, pue.quantity, pue.created_at, pue.created_by, e.name AS equipment_name
    FROM package_user_equipment pue
    LEFT JOIN equipment e ON pue.equipment_id = e.id
    WHERE pue.package_user_id = ${packageUserId}
    ORDER BY pue.equipment_order_id ASC`;

  res.json(serializeForJson(rows));
});

// Get single record by package_user_id + equipment_id
export const getPackageUserEquipment = catchAsync(async (req, res) => {
  const packageUserId = Number(req.params.package_user_id);
  const equipmentId = Number(req.params.equipment_id);
  if (!packageUserId || !equipmentId) return res.status(400).json({ error: 'invalid_ids' });

  const rows = await prisma.$queryRaw`
    SELECT * FROM package_user_equipment WHERE package_user_id = ${packageUserId} AND equipment_id = ${equipmentId} LIMIT 1`;
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(row));
});

// Create mapping
export const createPackageUserEquipment = catchAsync(async (req, res) => {
  const body = req.body || {};
  const package_user_id = body.package_user_id ? Number(body.package_user_id) : undefined;
  const equipment_id = body.equipment_id ? Number(body.equipment_id) : undefined;
  if (!package_user_id || !equipment_id) return res.status(400).json({ error: 'package_user_id_and_equipment_id_required' });

  const equipment_order_id = body.equipment_order_id ? Number(body.equipment_order_id) : null;
  const quantity = body.quantity ? Number(body.quantity) : null;
  const created_by = body.created_by ? Number(body.created_by) : null;

  await prisma.$executeRaw`
    INSERT INTO package_user_equipment (package_user_id, equipment_id, equipment_order_id, quantity, created_by, created_at)
    VALUES (${package_user_id}, ${equipment_id}, ${equipment_order_id}, ${quantity}, ${created_by}, NOW())`;

  const rows = await prisma.$queryRaw`
    SELECT * FROM package_user_equipment WHERE package_user_id = ${package_user_id} AND equipment_id = ${equipment_id} LIMIT 1`;

  res.status(201).json(serializeForJson(rows[0] || {}));
});

// Update mapping (by package_user_id + equipment_id)
export const updatePackageUserEquipment = catchAsync(async (req, res) => {
  const package_user_id = Number(req.params.package_user_id);
  const equipment_id = Number(req.params.equipment_id);
  if (!package_user_id || !equipment_id) return res.status(400).json({ error: 'invalid_ids' });

  const body = req.body || {};
  const equipment_order_id = body.equipment_order_id !== undefined ? Number(body.equipment_order_id) : null;
  const quantity = body.quantity !== undefined ? Number(body.quantity) : null;
  const updated_by = body.updated_by ? Number(body.updated_by) : null;

  await prisma.$executeRaw`
    UPDATE package_user_equipment
    SET equipment_order_id = ${equipment_order_id}, quantity = ${quantity}, updated_by = ${updated_by}, updated_at = NOW()
    WHERE package_user_id = ${package_user_id} AND equipment_id = ${equipment_id}`;

  const rows = await prisma.$queryRaw`
    SELECT * FROM package_user_equipment WHERE package_user_id = ${package_user_id} AND equipment_id = ${equipment_id} LIMIT 1`;

  res.json(serializeForJson(rows[0] || {}));
});

// Delete mapping
export const deletePackageUserEquipment = catchAsync(async (req, res) => {
  const package_user_id = Number(req.params.package_user_id);
  const equipment_id = Number(req.params.equipment_id);
  if (!package_user_id || !equipment_id) return res.status(400).json({ error: 'invalid_ids' });

  await prisma.$executeRaw`
    DELETE FROM package_user_equipment WHERE package_user_id = ${package_user_id} AND equipment_id = ${equipment_id}`;

  res.json({ ok: true });
});

// --- id-based handlers (useful when table has surrogate `id`) ---
export const getPackageUserEquipmentById = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const rows = await prisma.$queryRaw`
    SELECT * FROM package_user_equipment WHERE id = ${id} LIMIT 1`;
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(row));
});

export const updatePackageUserEquipmentById = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const body = req.body || {};
  const equipment_order_id = body.equipment_order_id !== undefined ? Number(body.equipment_order_id) : null;
  const quantity = body.quantity !== undefined ? Number(body.quantity) : null;
  const updated_by = body.updated_by ? Number(body.updated_by) : null;

  await prisma.$executeRaw`
    UPDATE package_user_equipment
    SET equipment_order_id = ${equipment_order_id}, quantity = ${quantity}, updated_by = ${updated_by}, updated_at = NOW()
    WHERE id = ${id}`;

  const rows = await prisma.$queryRaw`
    SELECT * FROM package_user_equipment WHERE id = ${id} LIMIT 1`;
  res.json(serializeForJson(rows[0] || {}));
});

export const deletePackageUserEquipmentById = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  await prisma.$executeRaw`
    DELETE FROM package_user_equipment WHERE id = ${id}`;

  res.json({ ok: true });
});

export default {
  listPackageUserEquipment,
  getPackageUserEquipment,
  createPackageUserEquipment,
  updatePackageUserEquipment,
  deletePackageUserEquipment,
  getPackageUserEquipmentById,
  updatePackageUserEquipmentById,
  deletePackageUserEquipmentById,
};
