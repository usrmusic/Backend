import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const packageUserSvc = services.get("package_users");
const packageTypeSvc = services.get("PackageType");

const listPackages = catchAsync(async (req, res) => {
  const q = req.query || {};
  const page = q.page ? Math.max(1, Number(q.page)) : 1;
  const limit = q.perPage
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
  if (q.package_type_id) where.package_type_id = Number(q.package_type_id);

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
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
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

  const cp =
    cost_price != null
      ? Number(cost_price)
      : sell_price != null
        ? Number(sell_price)
        : price != null
          ? Number(price)
          : 0;
  const sp =
    sell_price != null
      ? Number(sell_price)
      : price != null
        ? Number(price)
        : cp;

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
    // package_type_id,
    package_name,
    cost_price,
    sell_price,
    price,
    // properties,
  } = body;

  const existing = await packageUserSvc.model.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "package_not_found" });

  const finalPackageName = package_name || existing.package_name || null;
  const cp =
    cost_price != null
      ? Number(cost_price)
      : sell_price != null
        ? Number(sell_price)
        : price != null
          ? Number(price)
          : existing.cost_price;
  const sp =
    sell_price != null
      ? Number(sell_price)
      : price != null
        ? Number(price)
        : existing.sell_price;

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

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPkg = await tx.package_users.update({
      where: { id },
      data: {
        package_name: finalPackageName,
        cost_price: cp,
        sell_price: sp,
        user_id: user_id != null ? Number(user_id) : existing.user_id,
        package_type_id:
          package_type_id != null
            ? Number(package_type_id)
            : existing.package_type_id,
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
      if (priceChanged) eventUpdateData.dj_cost_price_for_event = sp;
      if (Object.keys(eventUpdateData).length) {
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
  await packageUserSvc.delete(id);
  res.json({ ok: true });
});

const deleteManyPackages = catchAsync(async (req, res) => {
  const idsParam = req.params.ids;
  if (!idsParam) return res.status(400).json({ error: "ids_required" });
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: "invalid_ids" });
  const force = req.body && req.body.force === true;
  await prisma.$transaction(async (tx) => {
    await tx.package_user_equipment.deleteMany({ where: { package_user_id: { in: ids } } });
    await tx.package_user_properties.deleteMany({ where: { package_users_id: { in: ids } } });
    // Now safe to delete package_users within the same transaction using tx
    if (force) {
      return tx.package_users.deleteMany({ where: { id: { in: ids } } });
    }
    // package_users model doesn't have `deleted_at` in schema, so fallback to hard delete
    return tx.package_users.deleteMany({ where: { id: { in: ids } } });
  });
  res.json({ ok: true });
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
