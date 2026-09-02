import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";
import { logActivity } from "../utils/activityLogger.js";

const packageUserSvc = services.get("package_users");
const packageTypeSvc = services.get("PackageType");

const listPackages = catchAsync(async (req, res) => {
  const q = req.query || {};
  // perPage="all" shows every package on one page (matches Laravel's
  // bootstrap-table config for this list — no server pagination there).
  const showAll = q.perPage === "all";
  const page = showAll ? undefined : q.page ? Math.max(1, Number(q.page)) : 1;
  const limit = showAll
    ? undefined
    : q.perPage
    ? Math.min(100, Number(q.perPage))
    : q.limit
    ? Math.min(100, Number(q.limit))
    : 10;
  const sortBy = q.sortBy || "created_at";
  const sortOrder = q.sortOrder === "desc" ? "desc" : "asc";

  const where = {};
  const s = String(q.search ?? '').trim();
  if (s.length) {
    where.OR = [
      { package_name: { contains: s } },
      { users: { is: { name: { contains: s } } } },
    ];
  }
  if (q.user_id) where.user_id = Number(q.user_id);
  if (q.status) where.status = q.status;

  const total = await packageUserSvc.model.count({ where });

  const items = await packageUserSvc.list({
    filter: where,
    page,
    perPage: limit,
    sort: `${sortBy}:${sortOrder}`,
    include: {
      users: { select: { id: true, name: true, email: true } },
    },
  });

  res.json(
    serializeForJson({
      data: items,
      meta: { total, page, limit, totalPages: showAll ? 1 : Math.ceil(total / limit) },
    }),
  );
});

const createPackage = catchAsync(async (req, res) => {
  const body = req.body || {};
  const {
    user_id,
    package_type_id,
    package_name,
    cost_price,
    sell_price,
    // price,
    // properties,
  } = body;
  if (!user_id || (!package_name && !package_type_id))
    return res.status(400).json({ error: "user_and_package_name_required" });

  let finalPackageName = package_name || null;
  if (package_type_id && !finalPackageName) {
    const pt = await packageTypeSvc.findById(Number(package_type_id));
    if (pt) finalPackageName = pt.type || String(pt.id);
  }

  // Matches Laravel's StoreStaffsRequest: package_name must be unique per DJ
  // (user_id). Duplicate names for one DJ would make the events-cascade
  // logic (keyed on dj_id + dj_package_name) ambiguous.
  if (finalPackageName) {
    const dup = await packageUserSvc.model.findFirst({
      where: { user_id: Number(user_id), package_name: finalPackageName },
    });
    if (dup) {
      return res.status(409).json({
        error: "duplicate_package_name",
        message: "This DJ already has a package with this name.",
      });
    }
  }

  const cp = cost_price != null ? Number(cost_price) : sell_price != null ? Number(sell_price) : 0;
  const sp = sell_price != null ? Number(sell_price) : cp;

  const equipmentsInput = Array.isArray(body.equipments) ? body.equipments : [];

  const equipmentLines = [];
  for (let i = 0; i < equipmentsInput.length; i++) {
    const item = equipmentsInput[i];
    if (!item || item.equipment_id == null) {
      return res.status(400).json({ error: "invalid_equipment_item" });
    }
    equipmentLines.push({
      equipment_id: Number(item.equipment_id),
      quantity: item.quantity != null ? Number(item.quantity) : null,
      equipment_order_id:
        item.equipment_order_id != null
          ? Number(item.equipment_order_id)
          : null,
    });
  }

//   const propertyLines = Array.isArray(properties)
//     ? properties.map((p) => ({
//         property_id: Number(p.property_id),
//         value: p.value == null ? "" : String(p.value),
//       }))
//     : [];

  const created = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package_users.create({
      data: {
        package_name: finalPackageName,
        cost_price: cp,
        sell_price: sp,
        status: "ACTIVE",
        users: { connect: { id: Number(user_id) } },
      },
    });

    // if (propertyLines.length) {
    //   const props = propertyLines.map((pl) => ({
    //     ...pl,
    //     package_users_id: pkg.id,
    //   }));
    //   await tx.package_user_properties.createMany({ data: props });
    // }

    if (equipmentLines.length) {
      const pue = equipmentLines.map((el) => ({
        package_user_id: pkg.id,
        equipment_id: el.equipment_id,
        equipment_order_id: el.equipment_order_id ?? null,
        quantity: el.quantity ?? null,
      }));
      await tx.package_user_equipment.createMany({ data: pue });
    }

    return pkg;
  });

  await logActivity(prisma, {
    log_name: "package created",
    description: `Package #${Number(created.id)} created`,
    subject_type: "PackageUser",
    subject_id: Number(created.id),
    causer_id: req.user?.id || null,
    properties: {
      package_name: finalPackageName,
      cost_price: cp,
      sell_price: sp,
    },
  });

  // Fetch main package record without including `package_user_equipment` to avoid
  // Prisma attempting to select a non-existent `id` column on that table.
  const base = await packageUserSvc.model.findUnique({
    where: { id: created.id },
    include: {
      package_user_properties: true,
      users: { select: { id: true, name: true, email: true } },
    },
  });

  // Load equipment lines via raw SQL and join to `equipment` table. This avoids
  // relying on Prisma's model mapping for `package_user_equipment` which may be
  // out-of-sync with the production schema.
  const equipmentRows = await prisma.$queryRaw`
    SELECT p.package_user_id, p.equipment_id, p.equipment_order_id, p.quantity,
           e.id AS equipment_id, e.name AS equipment_name, e.cost_price AS equipment_cost_price, e.sell_price AS equipment_sell_price
    FROM package_user_equipment p
    LEFT JOIN equipment e ON e.id = p.equipment_id
    WHERE p.package_user_id = ${Number(created.id)}
  `;

  const result = {
    ...base,
    package_user_equipment: (equipmentRows || []).map((r) => ({
      package_user_id: r.package_user_id,
      equipment_id: r.equipment_id,
      equipment_order_id: r.equipment_order_id,
      quantity: r.quantity,
      equipment: r.equipment_id
        ? {
            id: Number(r.equipment_id),
            name: r.equipment_name,
            cost_price: r.equipment_cost_price,
            sell_price: r.equipment_sell_price,
          }
        : null,
    })),
  };

  res.status(201).json(serializeForJson(result));
});

const updatePackage = catchAsync(async (req, res) => {
  const id = Number(req.params?.id || req.body?.id);
  if (!id) return res.status(400).json({ error: "id_required" });

  const body = req.body || {};
  const {
    user_id,
    package_name,
    cost_price,
    sell_price,
  } = body;

  const existing = await packageUserSvc.model.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "package_not_found" });

  const status =
    body.status === "ACTIVE" || body.status === "INACTIVE"
      ? body.status
      : existing.status;

  const finalPackageName = package_name || existing.package_name || null;

  // Matches Laravel's per-DJ uniqueness rule for package_name (see createPackage).
  // Exclude this package's own id so renaming to the same name is a no-op.
  if (finalPackageName) {
    const targetUserId = user_id != null ? Number(user_id) : existing.user_id;
    const dup = await packageUserSvc.model.findFirst({
      where: {
        user_id: targetUserId,
        package_name: finalPackageName,
        id: { not: id },
      },
    });
    if (dup) {
      return res.status(409).json({
        error: "duplicate_package_name",
        message: "This DJ already has a package with this name.",
      });
    }
  }

  const cp = cost_price != null ? Number(cost_price) : sell_price != null ? Number(sell_price) : existing.cost_price;
  const sp = sell_price != null ? Number(sell_price) : existing.sell_price;

  const equipmentsInput = Array.isArray(body.equipments) ? body.equipments : [];
  const equipmentLines = [];
  for (let i = 0; i < equipmentsInput.length; i++) {
    const item = equipmentsInput[i];
    if (!item || item.equipment_id == null)
      return res.status(400).json({ error: "invalid_equipment_item" });
    equipmentLines.push({
      equipment_id: Number(item.equipment_id),
      quantity: item.quantity != null ? Number(item.quantity) : null,
      equipment_order_id:
        item.equipment_order_id != null
          ? Number(item.equipment_order_id)
          : null,
    });
  }

//   const propertyLines = Array.isArray(properties)
//     ? properties.map((p) => ({
//         property_id: Number(p.property_id),
//         value: p.value == null ? "" : String(p.value),
//       }))
//     : [];

  // Snapshot existing equipment lines before they are deleted/recreated, for audit trail.
  const oldEquipmentRows = await prisma.package_user_equipment.findMany({
    where: { package_user_id: id },
    select: { equipment_id: true, quantity: true },
  });
  const oldEquipmentSnapshot = oldEquipmentRows.map((r) => ({
    equipment_id: Number(r.equipment_id),
    quantity: r.quantity != null ? Number(r.quantity) : null,
  }));

  let affectedEventIds = [];

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPkg = await tx.package_users.update({
      where: { id },
      data: {
        package_name: finalPackageName,
        cost_price: cp,
        sell_price: sp,
        status,
        user_id: user_id != null ? Number(user_id) : existing.user_id,
      },
    });

    // replace properties
    await tx.package_user_properties.deleteMany({
      where: { package_users_id: id },
    });
    // if (propertyLines.length) {
    //   const props = propertyLines.map((pl) => ({
    //     ...pl,
    //     package_users_id: id,
    //   }));
    //   await tx.package_user_properties.createMany({ data: props });
    // }

    // replace equipment lines
    await tx.package_user_equipment.deleteMany({
      where: { package_user_id: id },
    });
    if (equipmentLines.length) {
      const pue = equipmentLines.map((el) => ({
        package_user_id: id,
        equipment_id: el.equipment_id,
        equipment_order_id: el.equipment_order_id ?? null,
        quantity: el.quantity ?? null,
      }));
      await tx.package_user_equipment.createMany({ data: pue });
    }

    // If package name or sell_price changed, update related Events (Laravel parity)
    const nameChanged = finalPackageName !== existing.package_name;
    const priceChanged =
      sp !== existing.sell_price || cp !== existing.cost_price;
    if ((nameChanged || priceChanged) && existing.user_id) {
      const eventUpdateData = {};
      if (nameChanged) eventUpdateData.dj_package_name = finalPackageName;
      if (priceChanged) eventUpdateData.dj_cost_price_for_event = cp;
      if (Object.keys(eventUpdateData).length) {
        const affectedEvents = await tx.event.findMany({
          where: {
            dj_id: existing.user_id,
            dj_package_name: existing.package_name,
          },
          select: { id: true },
        });
        affectedEventIds = affectedEvents.map((e) => Number(e.id));

        await tx.event.updateMany({
          where: {
            dj_id: existing.user_id,
            dj_package_name: existing.package_name,
          },
          data: eventUpdateData,
        });
      }
    }

    return updatedPkg;
  });

  await logActivity(prisma, {
    log_name: "package updated",
    description: `Package #${id} updated`,
    subject_type: "PackageUser",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: {
      old_cost_price: existing.cost_price != null ? Number(existing.cost_price) : null,
      new_cost_price: cp != null ? Number(cp) : null,
      old_sell_price: existing.sell_price != null ? Number(existing.sell_price) : null,
      new_sell_price: sp != null ? Number(sp) : null,
      old_equipment: oldEquipmentSnapshot,
      new_equipment: equipmentLines.map((el) => ({
        equipment_id: el.equipment_id,
        quantity: el.quantity,
      })),
      affected_event_ids: affectedEventIds,
    },
  });

  // Fetch updated package without including `package_user_equipment` and load
  // equipment lines separately via raw SQL to avoid schema mismatch issues.
  const base = await packageUserSvc.model.findUnique({
    where: { id: updated.id },
    include: {
      package_user_properties: true,
      users: { select: { id: true, name: true, email: true } },
    },
  });

  const equipmentRows = await prisma.$queryRaw`
    SELECT p.package_user_id, p.equipment_id, p.equipment_order_id, p.quantity,
           e.id AS equipment_id, e.name AS equipment_name, e.cost_price AS equipment_cost_price, e.sell_price AS equipment_sell_price
    FROM package_user_equipment p
    LEFT JOIN equipment e ON e.id = p.equipment_id
    WHERE p.package_user_id = ${Number(updated.id)}
  `;

  const result = {
    ...base,
    package_user_equipment: (equipmentRows || []).map((r) => ({
      package_user_id: r.package_user_id,
      equipment_id: r.equipment_id,
      equipment_order_id: r.equipment_order_id,
      quantity: r.quantity,
      equipment: r.equipment_id
        ? {
            id: Number(r.equipment_id),
            name: r.equipment_name,
            cost_price: r.equipment_cost_price,
            sell_price: r.equipment_sell_price,
          }
        : null,
    })),
  };

  res.json(serializeForJson(result));
});

const getPackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const base = await packageUserSvc.model.findUnique({
    where: { id },
    include: {
      package_user_properties: true,
      users: { select: { id: true, name: true, email: true } },
    },
  });
  if (!base) return res.status(404).json({ error: "package_not_found" });

  const equipmentRows = await prisma.$queryRaw`
    SELECT p.package_user_id, p.equipment_id, p.equipment_order_id, p.quantity,
           e.id AS equipment_id, e.name AS equipment_name, e.cost_price AS equipment_cost_price, e.sell_price AS equipment_sell_price
    FROM package_user_equipment p
    LEFT JOIN equipment e ON e.id = p.equipment_id
    WHERE p.package_user_id = ${Number(id)}
  `;

  const pkg = {
    ...base,
    package_user_equipment: (equipmentRows || []).map((r) => ({
      package_user_id: r.package_user_id,
      equipment_id: r.equipment_id,
      equipment_order_id: r.equipment_order_id,
      quantity: r.quantity,
      equipment: r.equipment_id
        ? {
            id: Number(r.equipment_id),
            name: r.equipment_name,
            cost_price: r.equipment_cost_price,
            sell_price: r.equipment_sell_price,
          }
        : null,
    })),
  };

  res.json(serializeForJson(pkg));
});

const deletePackage = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const existing = await packageUserSvc.model.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "package_not_found" });

  // Matches Laravel's PackageUserController::destroy guard: a package cannot
  // be deleted while its DJ (user_id) has any event at all.
  const djHasEvent = await prisma.event.findFirst({
    where: { dj_id: existing.user_id },
  });
  if (djHasEvent) {
    return res.status(400).json({
      error: "dj_has_events",
      message: "This package cannot be deleted while its DJ has events.",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.package_user_equipment.deleteMany({ where: { package_user_id: id } });
    await tx.package_user_properties.deleteMany({ where: { package_users_id: id } });
    await tx.package_users.delete({ where: { id } });
  });

  await logActivity(prisma, {
    log_name: "package deleted",
    description: `Package #${id} deleted`,
    subject_type: "PackageUser",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: { package_name: existing?.package_name ?? null },
  });

  res.json({ ok: true });
});

const deleteManyPackages = catchAsync(async (req, res) => {
  let idsParam = req.params?.ids ?? (req.body && req.body.ids);
  if (idsParam == null) return res.status(400).json({ error: "ids_required" });

  // Normalize the incoming `ids` which may be a string ("1,2,3"),
  // an array ([1,2,3]), a single number (1), or a JSON string ("[1,2]").
  let idsArray = [];
  if (Array.isArray(idsParam)) {
    idsArray = idsParam;
  } else if (typeof idsParam === "string") {
    const trimmed = idsParam.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) idsArray = parsed;
        else idsArray = [parsed];
      } catch (e) {
        // fallback to comma-split
        idsArray = trimmed.replace(/^\[|\]$/g, "").split(",");
      }
    } else {
      idsArray = trimmed.length ? trimmed.split(",") : [];
    }
  } else if (typeof idsParam === "number") {
    idsArray = [idsParam];
  } else if (typeof idsParam === "object" && idsParam !== null) {
    // If an object was passed (e.g., { ids: [...] }) try to extract array
    if (Array.isArray(idsParam.ids)) idsArray = idsParam.ids;
    else idsArray = [idsParam];
  }

  const ids = idsArray
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return res.status(400).json({ error: "invalid_ids" });

  // Matches Laravel's PackageUserController::destroy guard: a package cannot
  // be deleted while its DJ (user_id) has any event at all. Blocked ids are
  // skipped rather than failing the whole batch (same convention as
  // users.controller.js's bulk delete).
  const packages = await packageUserSvc.model.findMany({
    where: { id: { in: ids } },
    select: { id: true, user_id: true },
  });

  const djIdsWithEvents = new Set();
  const distinctDjIds = [...new Set(packages.map((p) => p.user_id).filter((v) => v != null))];
  if (distinctDjIds.length) {
    const eventsForDjs = await prisma.event.findMany({
      where: { dj_id: { in: distinctDjIds } },
      select: { dj_id: true },
    });
    eventsForDjs.forEach((e) => djIdsWithEvents.add(Number(e.dj_id)));
  }

  const blocked = [];
  const deletable = [];
  packages.forEach((p) => {
    if (p.user_id != null && djIdsWithEvents.has(Number(p.user_id))) {
      blocked.push({ id: p.id, reason: "dj_has_events" });
    } else {
      deletable.push(p.id);
    }
  });
  // ids that didn't match any existing package are simply ignored

  if (deletable.length) {
    await prisma.$transaction(async (tx) => {
      await tx.package_user_equipment.deleteMany({ where: { package_user_id: { in: deletable } } });
      await tx.package_user_properties.deleteMany({ where: { package_users_id: { in: deletable } } });
      // package_users model doesn't have `deleted_at` in schema, so always hard delete
      await tx.package_users.deleteMany({ where: { id: { in: deletable } } });
    });
  }

  await logActivity(prisma, {
    log_name: "packages bulk deleted",
    description: `${deletable.length} package(s) deleted${blocked.length ? `, ${blocked.length} blocked` : ""}`,
    subject_type: "PackageUser",
    subject_id: null,
    causer_id: req.user?.id || null,
    properties: { ids: deletable, blocked, count: deletable.length },
  });

  res.json({ ok: true, count: deletable.length, deleted: deletable, blocked });
});
const getPackageDropdown = catchAsync(async (req, res) => {
  const packages = await packageUserSvc.model.findMany({
    where: { status: 'ACTIVE' },
     select: {
      id: true,
      package_name: true,
      user_id: true,
      users: { select: { id: true, name: true } },
    },
    orderBy: { package_name: 'asc' },
  });
  res.json(serializeForJson(packages));
})
export default {
  listPackages,
  createPackage,
  updatePackage,
  getPackage,
  deletePackage,
  deleteManyPackages,
  getPackageDropdown
};
