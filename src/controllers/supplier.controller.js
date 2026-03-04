import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const supplierSvc = services.get("supplier");

export const listSuppliers = catchAsync(async (req, res) => {
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
      // ignore invalid filter JSON and fall back to empty filter
    }
  }

  // Optional text search across common fields
  const q = req.query.search || req.query.q;
  if (q && String(q).trim().length) {
    const s = String(q).trim();
    filter.OR = [
      { name: { contains: s } },
      { company_name: { contains: s } },
      { email: { contains: s } },
      { contact_number: { contains: s } },
    ];
  }

  const users = await supplierSvc.list({ filter, perPage, page, sort });
  const total = await supplierSvc.model.count({ where: filter }).catch(() => 0);

  res.json({ data: serializeForJson(users), meta: { total, page, perPage } });
});

export const getSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const supplier = await supplierSvc.getById(id);
  if (!supplier) return res.status(404).json({ error: "not_found" });
  res.json(serializeForJson(supplier));
});

export const createSupplier = catchAsync(async (req, res) => {
  const {
    name,
    company_name,
    email,
    contact_number,
    industry,
    notes,
    created_by,
  } = req.body || {};

  const data = {
    name: name || null,
    company_name: company_name || null,
    email: email || null,
    contact_number: contact_number || null,
    industry: industry || null,
    notes: notes || null,
    created_by: created_by ? Number(created_by) : null,
  };

  let created;
  try {
    created = await supplierSvc.create(data);
  } catch (err) {
    console.error("supplierSvc.create error", err);
    return res
      .status(500)
      .json({ error: "supplier_create_failed", details: err && err.message });
  }

  res.status(201).json(serializeForJson(created));
});

export const updateSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const data = req.body ? { ...req.body } : {};
  data.updated_at = new Date();
  const updated = await supplierSvc.update(id, data);
  res.json(serializeForJson(updated));
});

export const deleteSupplier = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  await supplierSvc.delete(id);
  res.json({ ok: true });
});

const deleteManySuppliers = catchAsync(async (req, res) => {
  // Expect ids in req.params.ids (e.g. "1,2,3" or JSON array string)
  let ids = req.params && req.params.ids ? req.params.ids : undefined;
  if (!ids) return res.status(400).json({ error: 'invalid_ids' });

  if (typeof ids === 'string') {
    const raw = ids.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed;
      else ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    } catch (e) {
      ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  ids = Array.isArray(ids) ? ids.map((v) => Number(v)).filter((n) => !Number.isNaN(n)) : [];
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'invalid_ids' });

  // Accept force flag from query or body
  let force = false;
  if (req.query && typeof req.query.force !== 'undefined') force = req.query.force === 'true' || req.query.force === true;
  else if (req.body && typeof req.body.force !== 'undefined') force = !!req.body.force;

  await supplierSvc.deleteMany(ids, { force });
  res.json({ ok: true });
});

const listSupplierDropdown = catchAsync(async (req, res) => {
  const suppliers = await supplierSvc.list({select: { id: true, name: true, company_name: true } });
  res.json(serializeForJson(suppliers));
});

export default {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  deleteManySuppliers,
  listSupplierDropdown,
};
