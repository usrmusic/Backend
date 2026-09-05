import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";
import { logActivity } from "../utils/activityLogger.js";

const equipmentSvc = services.get("equipment");
const supplierSvc = services.get("supplier");

// Same status id used by completeEventsJob.js — the numeric id for "Confirmed".
const CONFIRMED_STATUS_ID = Number(process.env.CONFIRMED_STATUS_ID || 2);



const listEquipment = catchAsync(async (req, res) => {
  // Support `filter` (JSON), `search`/`q`, pagination and sorting query params.
  // perPage="all" (used by the packages page's Equipment tab, which shows the
  // whole list on one page) skips pagination entirely rather than capping at
  // an arbitrary large number.
  const showAll = req.query.perPage === "all" || req.params.perPage === "all";
  const perPage = showAll
    ? undefined
    : Number(req.query.perPage || req.query.limit || req.params.perPage || req.params.limit || 25);
  const page = showAll ? undefined : Number(req.query.page || req.params.page || 1);
  // Ties on sort_order (rows never dragged, all default 0) fall back to name
  // so the list doesn't look randomly shuffled before anyone reorders it.
  const sort =
    req.query.sort ||
    (req.query.sort_by ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}` : undefined)
    || (req.params.sort_by ? `${req.params.sort_by}:${req.params.sort_dir || "asc"}` : undefined)
    || "sort_order:asc,name:asc";

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
  // Equipment.id is a BigInt column — querying with a plain Number throws a
  // Prisma type-mismatch error.
  if (equipmentSvc && typeof equipmentSvc.getById === "function") {
    const item = await equipmentSvc.getById(BigInt(id)).catch(() => null);
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
      const supplierPayload = { company_name: String(body.supplier_name) };
      const supplier = await supplierSvc.create(supplierPayload).catch((e) => { throw e; });
      if (supplier && supplier.id) {
        body.supplier_id = supplier.id;
        await logActivity(null, {
          log_name: "supplier created",
          description: `Supplier #${supplier.id} created`,
          subject_type: "Supplier",
          subject_id: Number(supplier.id),
          causer_id: req.user?.id || null,
          properties: { company_name: supplier.company_name || null },
        });
      }
      // remove supplier_name so Prisma won't try to write an unknown column
      delete body.supplier_name;
    }
    const created = await equipmentSvc.create(body).catch((e) => { throw e; });

    await logActivity(null, {
      log_name: "equipment created",
      description: `Equipment #${created?.id} created`,
      subject_type: "Equipment",
      subject_id: created?.id != null ? Number(created.id) : null,
      causer_id: req.user?.id || null,
      properties: {
        name: created?.name || null,
        cost_price: created?.cost_price != null ? Number(created.cost_price) : null,
        sell_price: created?.sell_price != null ? Number(created.sell_price) : null,
      },
    });

    return res.status(201).json(serializeForJson(created));
  }
  res.status(501).json({ error: "not_implemented" });
});

const updateEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  // Equipment.id (and EventPackage.equipment_id below) are BigInt columns.
  const idBig = BigInt(id);
  const body = req.body || {};
  // If supplier_name provided (and no supplier_id), create supplier and set supplier_id
  if (!body.supplier_id && body.supplier_name && supplierSvc && typeof supplierSvc.create === 'function') {
    const supplierPayload = { company_name: String(body.supplier_name) };
    const supplier = await supplierSvc.create(supplierPayload).catch((e) => { throw e; });
    if (supplier && supplier.id) {
      body.supplier_id = supplier.id;
      await logActivity(null, {
        log_name: "supplier created",
        description: `Supplier #${supplier.id} created`,
        subject_type: "Supplier",
        subject_id: Number(supplier.id),
        causer_id: req.user?.id || null,
        properties: { company_name: supplier.company_name || null },
      });
    }
    delete body.supplier_name;
  }

  if (equipmentSvc && typeof equipmentSvc.update === "function") {
    const existingEquipment = await equipmentSvc.getById(idBig).catch(() => null);
    const updated = await equipmentSvc.update(idBig, body).catch((e) => { throw e; });

    // Laravel parity: when cost_price changes, cascade the new cost_price to
    // event_package rows for every currently Confirmed event using this
    // equipment, so supplier-report totals don't go stale.
    const oldCostPrice =
      existingEquipment?.cost_price != null ? Number(existingEquipment.cost_price) : null;
    const newCostPrice = updated?.cost_price != null ? Number(updated.cost_price) : null;
    if (newCostPrice != null && newCostPrice !== oldCostPrice) {
      const affectedEvents = await prisma.event.findMany({
        where: {
          event_status_id: CONFIRMED_STATUS_ID,
          event_package: { some: { equipment_id: idBig } },
        },
        select: { id: true },
      });
      if (affectedEvents.length) {
        await prisma.event_package.updateMany({
          where: {
            equipment_id: idBig,
            event_id: { in: affectedEvents.map((e) => Number(e.id)) },
          },
          data: { cost_price: newCostPrice },
        });
      }
    }

    await logActivity(null, {
      log_name: "equipment updated",
      description: `Equipment #${id} updated`,
      subject_type: "Equipment",
      subject_id: id,
      causer_id: req.user?.id || null,
      properties: {
        old: existingEquipment
          ? {
              cost_price: existingEquipment.cost_price != null ? Number(existingEquipment.cost_price) : null,
              sell_price: existingEquipment.sell_price != null ? Number(existingEquipment.sell_price) : null,
            }
          : null,
        new: {
          cost_price: updated?.cost_price != null ? Number(updated.cost_price) : null,
          sell_price: updated?.sell_price != null ? Number(updated.sell_price) : null,
        },
      },
    });

    return res.json(serializeForJson(updated));
  }
  res.status(501).json({ error: "not_implemented" });
});

const deleteEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  // Equipment.id and package_user_equipment.equipment_id are BigInt columns.
  const idBig = BigInt(id);
  if (equipmentSvc && typeof equipmentSvc.delete === "function") {
    // Laravel parity: block deletion while this equipment is bundled into a
    // DJ package (package_user_equipment) — those rows would otherwise be
    // cascade-deleted along with the equipment.
    const inUse = await prisma.package_user_equipment.findFirst({
      where: { equipment_id: idBig },
      select: { id: true },
    });
    if (inUse) {
      return res.status(400).json({
        error: "equipment_in_use",
        message: "This equipment cannot be deleted while it is part of a DJ package.",
      });
    }

    const equipmentBeforeDelete = await equipmentSvc.getById(idBig).catch(() => null);
    await equipmentSvc.delete(idBig);

    await logActivity(null, {
      log_name: "equipment deleted",
      description: `Equipment #${id} deleted`,
      subject_type: "Equipment",
      subject_id: id,
      causer_id: req.user?.id || null,
      properties: { name: equipmentBeforeDelete?.name || null },
    });

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
  // Equipment.id and package_user_equipment.equipment_id are BigInt columns.
  const idsBig = ids.map((n) => BigInt(n));
  if (equipmentSvc && typeof equipmentSvc.deleteMany === "function") {
    // Laravel parity: block deletion of any equipment still bundled into a
    // DJ package (package_user_equipment) — those rows would otherwise be
    // cascade-deleted along with the equipment.
    const inUseRows = await prisma.package_user_equipment.findMany({
      where: { equipment_id: { in: idsBig } },
      select: { equipment_id: true },
      distinct: ["equipment_id"],
    });
    const blockedIds = inUseRows.map((r) => Number(r.equipment_id));
    const deletableIds = ids.filter((id) => !blockedIds.includes(id));
    const deletableIdsBig = deletableIds.map((n) => BigInt(n));

    if (deletableIds.length) {
      // Perform a hard delete for delete-many requests
      // CoreCrudService.deleteMany accepts an opts.force flag to force permanent deletion
      try {
        await equipmentSvc.deleteMany(deletableIdsBig, { force: true });
      } catch (err) {
        // Fallback to forceDeleteMany if available
        if (equipmentSvc && typeof equipmentSvc.forceDeleteMany === 'function') {
          await equipmentSvc.forceDeleteMany(deletableIdsBig);
        } else {
          throw err;
        }
      }

      await logActivity(null, {
        log_name: "equipment bulk deleted",
        description: `${deletableIds.length} equipment item(s) deleted`,
        subject_type: "Equipment",
        subject_id: null,
        causer_id: req.user?.id || null,
        properties: { ids: deletableIds, count: deletableIds.length },
      });
    }

    if (blockedIds.length) {
      return res.status(deletableIds.length ? 207 : 400).json({
        ok: deletableIds.length > 0,
        error: blockedIds.length ? "equipment_in_use" : undefined,
        message: "Some equipment could not be deleted while it is part of a DJ package.",
        deletedIds: deletableIds,
        notDeletedIds: blockedIds,
      });
    }

    return res.json({ ok: true, deletedIds: deletableIds, notDeletedIds: [] });
  }
  res.status(501).json({ error: "not_implemented" });
});

const reorderEquipment = catchAsync(async (req, res) => {
  const body = req.body || {};
  const idsInput = Array.isArray(body.ids) ? body.ids : null;
  if (!idsInput || !idsInput.length)
    return res.status(400).json({ error: "ids_required" });

  const ids = idsInput.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (ids.length !== idsInput.length)
    return res.status(400).json({ error: "invalid_ids" });

  // Equipment.id is a BigInt column.
  await prisma.$transaction(
    ids.map((id, index) =>
      equipmentSvc.model.update({
        where: { id: BigInt(id) },
        data: { sort_order: index },
      }),
    ),
  );

  await logActivity(null, {
    log_name: "equipment reordered",
    description: "Equipment display order changed",
    subject_type: "Equipment",
    subject_id: null,
    causer_id: req.user?.id || null,
    properties: { ids },
  });

  res.json({ ok: true });
});

const getEquipmentDropdown = catchAsync(async (req, res) => {
  const items = await equipmentSvc.model
    .findMany({
      select: {
        id: true,
        name: true,
      },
      where: { status: "ACTIVE" },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
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
  reorderEquipment,
  getEquipmentDropdown,
};
