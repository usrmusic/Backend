import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listPackageUsers = catchAsync(async (req, res) => {
  const items = await prisma.package_users.findMany({ include: { package_user_properties: true } });
  res.json(serializeForJson(items));
});

export const getPackageUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const item = await prisma.package_users.findUnique({ where: { id }, include: { package_user_properties: true } });
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(item));
});

export const createPackageUser = catchAsync(async (req, res) => {
  const { user_id, package_type_id, package_name, cost_price, sell_price, price, start_date, end_date, properties } = req.body || {};
  if (!user_id || (!package_name && !package_type_id)) return res.status(400).json({ error: 'user_and_package_name_required' });

  let finalPackageName = package_name || null;
  if (package_type_id && !finalPackageName) {
    const pt = await prisma.packageType.findUnique({ where: { id: Number(package_type_id) } });
    if (pt) finalPackageName = pt.type || String(pt.id);
  }

  const cp = cost_price != null ? Number(cost_price) : (sell_price != null ? Number(sell_price) : (price != null ? Number(price) : 0));
  const sp = sell_price != null ? Number(sell_price) : (price != null ? Number(price) : cp);

  const data = {
    package_name: finalPackageName,
    cost_price: cp,
    sell_price: sp,
    status: 'ACTIVE',
  };

  // connect existing user by id
  if (user_id) data.users = { connect: { id: Number(user_id) } };

  // attach nested properties if provided
  if (Array.isArray(properties) && properties.length) {
    data.package_user_properties = {
      create: properties.map(p => ({ property_id: Number(p.property_id), value: String(p.value) }))
    };
  }

  const created = await prisma.package_users.create({ data, include: { package_user_properties: true } });
  res.status(201).json(serializeForJson(created));
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
