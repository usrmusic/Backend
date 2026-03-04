import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

export const listPackageUsers = catchAsync(async (req, res) => {
  const q = req.query || {};
  const page = q.page ? Math.max(1, Number(q.page)) : 1;
  const limit = q.limit ? Math.min(100, Number(q.limit)) : 10;
  const skip = (page - 1) * limit;
  const sortBy = q.sortBy || 'created_at';
  const sortOrder = q.sortOrder === 'desc' ? 'desc' : 'asc';

  const where = {};

  // search across package_name and user name
  if (q.search) {
    const s = String(q.search).trim();
    where.OR = [
      { package_name: { contains: s, mode: 'insensitive' } },
      { users: { is: { name: { contains: s, mode: 'insensitive' } } } },
    ];
  }

  if (q.user_id) where.user_id = Number(q.user_id);
  if (q.status) where.status = q.status;
  if (q.package_type_id) where.package_type_id = Number(q.package_type_id);

  const svc = services.package_users;
  const total = await svc.model.count({ where });

  const items = await svc.list({
    filter: where,
    page,
    perPage: limit,
    include: {
      package_user_properties: true,
      package_user_equipment: {
        include: { equipment: { include: { equipment_properties: true } } },
      },
      users: { select: { id: true, name: true, email: true } },
    },
    sort: `${sortBy}:${sortOrder}`,
  });

  res.json(
    serializeForJson({
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }),
  );
});

export const getPackageUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const svc = services.package_users;
  const item = await svc.getById(id, { include: { package_user_properties: true } });
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(item));
});

export const createPackageUser = catchAsync(async (req, res) => {
  const body = req.body || {};
  const { user_id, package_type_id, package_name, cost_price, sell_price, price, properties } = body;
  if (!user_id || (!package_name && !package_type_id)) return res.status(400).json({ error: 'user_and_package_name_required' });

  let finalPackageName = package_name || null;
  if (package_type_id && !finalPackageName) {
    const pt = await prisma.packageType.findUnique({ where: { id: Number(package_type_id) } });
    if (pt) finalPackageName = pt.type || String(pt.id);
  }

  const cp = cost_price != null ? Number(cost_price) : (sell_price != null ? Number(sell_price) : (price != null ? Number(price) : 0));
  const sp = sell_price != null ? Number(sell_price) : (price != null ? Number(price) : cp);

  // build equipment lines from either new style (array of objects/ids) or legacy parallel arrays
  const equipmentsInput = Array.isArray(body.equipments) ? body.equipments : [];
  const legacyQty = Array.isArray(body['equipment-quantity']) ? body['equipment-quantity'] : [];
  const legacyOrder = Array.isArray(body['equipment-order']) ? body['equipment-order'] : [];

  const equipmentLines = [];
  for (let i = 0; i < equipmentsInput.length; i++) {
    const item = equipmentsInput[i];
    if (typeof item === 'number') {
      equipmentLines.push({
        equipment_id: Number(item),
        quantity: legacyQty[i] != null ? Number(legacyQty[i]) : null,
        equipment_order_id: legacyOrder[i] != null ? Number(legacyOrder[i]) : null,
      });
    } else if (item && typeof item === 'object') {
      equipmentLines.push({
        equipment_id: Number(item.equipment_id),
        quantity: item.quantity != null ? Number(item.quantity) : null,
        equipment_order_id: item.equipment_order_id != null ? Number(item.equipment_order_id) : null,
      });
    }
  }

  // fallback: if legacy arrays provided but equipmentsInput empty, try to map from equipments indexes
  if (equipmentLines.length === 0 && Array.isArray(body.equipments) && body.equipments.length && legacyQty.length) {
    for (let i = 0; i < body.equipments.length; i++) {
      equipmentLines.push({
        equipment_id: Number(body.equipments[i]),
        quantity: legacyQty[i] != null ? Number(legacyQty[i]) : null,
        equipment_order_id: legacyOrder[i] != null ? Number(legacyOrder[i]) : null,
      });
    }
  }

  // properties lines
  const propertyLines = Array.isArray(properties) ? properties.map(p => ({ property_id: Number(p.property_id), value: p.value == null ? '' : String(p.value) })) : [];

  // transaction: create package header, then create properties and equipment lines
  const created = await prisma.$transaction(async (tx) => {
    const pkg = await tx.package_users.create({ data: {
      package_name: finalPackageName,
      cost_price: cp,
      sell_price: sp,
      status: 'ACTIVE',
      users: { connect: { id: Number(user_id) } },
    }});

    if (propertyLines.length) {
      const props = propertyLines.map(pl => ({ ...pl, package_users_id: pkg.id }));
      await tx.package_user_properties.createMany({ data: props });
    }

    if (equipmentLines.length) {
      const pue = equipmentLines.map(el => ({
        package_user_id: pkg.id,
        equipment_id: el.equipment_id,
        equipment_order_id: el.equipment_order_id ?? null,
        quantity: el.quantity ?? null,
      }));
      await tx.package_user_equipment.createMany({ data: pue });
    }

    return pkg;
  });

  const svc2 = services.package_users;
  const result = await svc2.getById(created.id, { include: {
    package_user_properties: true,
    package_user_equipment: { include: { equipment: true } },
    users: { select: { id: true, name: true, email: true } },
  }});

  res.status(201).json(serializeForJson(result));
});

export const updatePackageUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const allowed = ['user_id','package_name','cost_price','sell_price','status'];
  const data = {};
  for (const k of allowed) if (k in req.body) {
    if (k === 'user_id') {
      data.users = { connect: { id: Number(req.body[k]) } };
    } else {
      data[k] = req.body[k];
    }
  }
  data.updated_at = new Date();
  const updated = await prisma.package_users.update({ where: { id }, data, include: { package_user_properties: true } });
  res.json(serializeForJson(updated));
});

export const deletePackageUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.package_users.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listPackageUsers, getPackageUser, createPackageUser, updatePackageUser, deletePackageUser };
