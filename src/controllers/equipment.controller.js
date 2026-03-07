import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const equipmentSvc = services.get("equipment");
const supplierSvc = services.get("supplier");



const listEquipment = catchAsync(async (req, res) => {
  if (equipmentSvc && typeof equipmentSvc.list === "function") {
    const items = await equipmentSvc.list({});
    const total = equipmentSvc.model && typeof equipmentSvc.model.count === "function"
      ? await equipmentSvc.model.count().catch(() => 0)
      : (Array.isArray(items) ? items.length : 0);
    return res.json({ data: serializeForJson(items), meta: { total, page: 1, perPage: items.length || 0 } });
  }
  res.status(501).json({ error: "not_implemented" });
});

const getEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  if (equipmentSvc && typeof equipmentSvc.getById === "function") {
    const item = await equipmentSvc.getById(id).catch(() => null);
    if (!item) return res.status(404).json({ error: "not_found" });
    return res.json(serializeForJson(item));
  }
  res.status(501).json({ error: "not_implemented" });
});

const createEquipment = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (equipmentSvc && typeof equipmentSvc.create === "function") {
    const created = await equipmentSvc.create(body).catch((e) => { throw e; });
    return res.status(201).json(serializeForJson(created));
  }
  res.status(501).json({ error: "not_implemented" });
});

const updateEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const body = req.body || {};
  if (equipmentSvc && typeof equipmentSvc.update === "function") {
    const updated = await equipmentSvc.update(id, body).catch((e) => { throw e; });
    return res.json(serializeForJson(updated));
  }
  res.status(501).json({ error: "not_implemented" });
});

const deleteEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  if (equipmentSvc && typeof equipmentSvc.delete === "function") {
    await equipmentSvc.delete(id);
    return res.json({ ok: true });
  }
  res.status(501).json({ error: "not_implemented" });
});

const deleteManyEquipment = catchAsync(async (req, res) => {
  const idsParam = req.params.ids;
  if (!idsParam) return res.status(400).json({ error: "ids_required" });
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: "invalid_ids" });
  if (equipmentSvc && typeof equipmentSvc.deleteMany === "function") {
    await equipmentSvc.deleteMany(ids);
    return res.json({ ok: true });
  }
  res.status(501).json({ error: "not_implemented" });
});

export default {
  listEquipment,
  getEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  deleteManyEquipment,
};
