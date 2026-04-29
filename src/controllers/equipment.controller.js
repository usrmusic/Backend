import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const equipmentSvc = services.get("equipment");
const supplierSvc = services.get("supplier");



const listEquipment = catchAsync(async (req, res) => {
  // Support `filter` (JSON), `search`/`q`, pagination and sorting query params
  const perPage = Number(req.query.perPage || req.query.limit || req.params.perPage || req.params.limit || 25);
  const page = Number(req.query.page || req.params.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}` : undefined)
    || (req.params.sort_by ? `${req.params.sort_by}:${req.params.sort_dir || "asc"}` : undefined);

  let filter = {};
  if (req.query.filter || req.params.filter) {
    try {
      const parsed =( typeof req.query.filter === "string" || typeof req.params.filter === "string") ? JSON.parse(req.query.filter || req.params.filter) : req.query.filter || req.params.filter;
      filter = { ...filter, ...parsed };
    } catch (e) {
      // ignore invalid filter JSON and fall back to empty filter
    }
  }

  // Optional text search across equipment name and linked supplier name
  const q = req.query.search || req.query.q || req.params.search || req.params.q;
  if (q && String(q).trim().length) {
    const s = String(q).trim();
    filter.OR = [
      { name: { contains: s } },
      { suppliers: { is: { name: { contains: s } } } },
    ];
  }

  if (equipmentSvc && typeof equipmentSvc.list === "function") {
    const items = await equipmentSvc.list({ filter, perPage, page, sort });
    const total =
      equipmentSvc.model && typeof equipmentSvc.model.count === "function"
        ? await equipmentSvc.model.count({ where: filter }).catch(() => 0)
        : (Array.isArray(items) ? items.length : 0);
    return res.json({ data: serializeForJson(items), meta: { total, page, perPage } });
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
    // Create supplier only if supplier_name provided and supplier_id not provided
    if (!body.supplier_id && body.supplier_name && supplierSvc && typeof supplierSvc.create === 'function') {
      const supplierPayload = { name: String(body.supplier_name) };
      const supplier = await supplierSvc.create(supplierPayload).catch((e) => { throw e; });
      if (supplier && supplier.id) {
        body.supplier_id = supplier.id;
      }
      // remove supplier_name so Prisma won't try to write an unknown column
      delete body.supplier_name;
    }
    const created = await equipmentSvc.create(body).catch((e) => { throw e; });
    return res.status(201).json(serializeForJson(created));
  }
  res.status(501).json({ error: "not_implemented" });
});

const updateEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const body = req.body || {};
  // If supplier_name provided (and no supplier_id), create supplier and set supplier_id
  if (!body.supplier_id && body.supplier_name && supplierSvc && typeof supplierSvc.create === 'function') {
    const supplierPayload = { name: String(body.supplier_name) };
    const supplier = await supplierSvc.create(supplierPayload).catch((e) => { throw e; });
    if (supplier && supplier.id) body.supplier_id = supplier.id;
    delete body.supplier_name;
  }

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

const getEquipmentDropdown = catchAsync(async (req, res) => {
  const items = await equipmentSvc.model
    .findMany({
      select: {
        id: true,
        name: true,
      },
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  res.json(serializeForJson(items));
});


export default {
  listEquipment,
  getEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  deleteManyEquipment,
  getEquipmentDropdown,
};
