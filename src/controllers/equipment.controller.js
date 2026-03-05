import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const equipmentSvc = services.get("equipment");
const supplierSvc = services.get("supplier");

const listEquipment = catchAsync(async (req, res) => {
  // Support `filter` (JSON), `search`/`q`, pagination and sorting query params
  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined);

  let filter = {};
  if (req.query.filter) {
    try {
      filter =
        typeof req.query.filter === "string"
          ? JSON.parse(req.query.filter)
          : req.query.filter;
    } catch (e) {
      // ignore invalid JSON filter
    }
  }

  const q = req.query.search || req.query.q;
  if (q && String(q).trim().length) {
    filter.name = { contains: String(q).trim() };
  }

  // Support supplier_id filter (single id or CSV)
  if (req.query.supplier_id) {
    const raw = String(req.query.supplier_id).trim();
    if (raw.includes(",")) {
      const ids = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      if (ids.length) filter.supplier_id = { in: ids };
    } else {
      const sid = Number(raw);
      if (!Number.isNaN(sid)) filter.supplier_id = sid;
    }
  }

  const items = await equipmentSvc.list({ filter, perPage, page, sort });
  const total = await equipmentSvc.model
    .count({ where: filter })
    .catch(() => 0);
  res.json({ data: serializeForJson(items), meta: { total, page, perPage } });
});

const getEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const item = await equipmentSvc.getById(id);
  if (!item) return res.status(404).json({ error: "not_found" });
  res.json(serializeForJson(item));
});

const createEquipment = catchAsync(async (req, res) => {
  const body = req.body || {};

  // If client provided a supplier_name (inline creation), create supplier and use its id.
  if (!body.supplier_id && body.supplier_name) {
    const createdSupplier = await supplierSvc.create({ name: String(body.supplier_name).trim() });
    if (createdSupplier && createdSupplier.id) body.supplier_id = Number(createdSupplier.id);
  }

  // If supplier_id was provided, ensure it exists to avoid FK violations
  if (body.supplier_id) {
    const sid = Number(body.supplier_id);
    if (Number.isNaN(sid)) return res.status(400).json({ error: 'invalid_supplier_id' });
    const existingSupplier = await supplierSvc.getById(sid).catch(() => null);
    if (!existingSupplier) return res.status(400).json({ error: 'supplier_not_found' });
    body.supplier_id = sid;
  }

  const data = {
    supplier_id: body.supplier_id ? Number(body.supplier_id) : undefined,
    name: body.name,
    cost_price: body.cost_price != null ? Number(body.cost_price) : undefined,
    sell_price: Number(body.sell_price),
    status: body.status || "ACTIVE",
    quantity: body.quantity != null ? Number(body.quantity) : undefined,
    pricing_guide: body.pricing_guide,
    is_availabilty_check:
      body.is_availabilty_check != null
        ? Boolean(body.is_availabilty_check)
        : undefined,
    rig_notes: body.rig_notes,
    created_by: body.created_by ? Number(body.created_by) : undefined,
    updated_by: body.updated_by ? Number(body.updated_by) : undefined,
  };

  const created = await equipmentSvc.create(data);
  res.status(201).json(serializeForJson(created));
});

const updateEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const body = req.body || {};

  // Inline create supplier if supplier_name provided and supplier_id not present
  if (!body.supplier_id && body.supplier_name) {
    const createdSupplier = await supplierSvc.create({ name: String(body.supplier_name).trim() });
    if (createdSupplier && createdSupplier.id) body.supplier_id = Number(createdSupplier.id);
  }

  // If supplier_id provided for update, ensure it exists
  if (body.supplier_id) {
    const sid = Number(body.supplier_id);
    if (Number.isNaN(sid)) return res.status(400).json({ error: 'invalid_supplier_id' });
    const existingSupplier = await supplierSvc.getById(sid).catch(() => null);
    if (!existingSupplier) return res.status(400).json({ error: 'supplier_not_found' });
    body.supplier_id = sid;
  }
  const data = {
    supplier_id: body.supplier_id ? Number(body.supplier_id) : undefined,
    name: body.name,
    cost_price: body.cost_price != null ? Number(body.cost_price) : undefined,
    sell_price: body.sell_price != null ? Number(body.sell_price) : undefined,
    status: body.status,
    quantity: body.quantity != null ? Number(body.quantity) : undefined,
    pricing_guide: body.pricing_guide,
    is_availabilty_check:
      body.is_availabilty_check != null
        ? Boolean(body.is_availabilty_check)
        : undefined,
    rig_notes: body.rig_notes,
    updated_by: body.updated_by ? Number(body.updated_by) : undefined,
  };

  const updated = await equipmentSvc.update(id, data);
  res.json(serializeForJson(updated));
});

const deleteEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  await equipmentSvc.delete(id);
  res.json({ ok: true });
});

const deleteManyEquipment = catchAsync(async (req, res) => {
  const idsParam = req.params.ids;
  if (!idsParam) return res.status(400).json({ error: "ids_required" });
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: "invalid_ids" });
  await equipmentSvc.deleteMany(ids);
  res.json({ ok: true });
});

export default {
  listEquipment,
  getEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  deleteManyEquipment,
};
