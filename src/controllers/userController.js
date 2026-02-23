import prisma from '../utils/prismaClient.js';
import services from '../services/index.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';

export async function listUsers(req, res) {
  const users = await prisma.user.findMany({ take: 100 });
  res.json(users);
}

export const updateUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_user_id' });

  const allowed = ['name', 'contact_number', 'role_id', 'email', 'address', 'profile_photo'];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      data[k] = k === 'role_id' ? BigInt(req.body[k]) : req.body[k];
    }
  }

  data.updated_at = new Date();

  const user = await prisma.user.update({ where: { id }, data });
  res.json(serializeForJson(user));
});

export const deleteUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_user_id' });

  // Soft delete: set deleted_at
  await prisma.user.update({ where: { id }, data: { deleted_at: new Date() } });
  res.json({ ok: true });
});

export const deleteManyUsers = catchAsync(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids_required' });
  const now = new Date();
  const updates = await prisma.user.updateMany({ where: { id: { in: ids.map((i) => Number(i)) } }, data: { deleted_at: now } });
  res.json({ ok: true, count: updates.count });
});

export const listRoles = catchAsync(async (req, res) => {
  // Return all roles without applying filters from query string.
  const roles = await services.roles.list();

  res.json(serializeForJson(roles));
});

export default { listUsers, listRoles, updateUser, deleteUser, deleteManyUsers };
