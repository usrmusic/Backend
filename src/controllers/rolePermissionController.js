import prisma from '../utils/prismaClient.js';
import services from '../services/index.js';
import { serializeForJson } from '../utils/serialize.js';

export async function index(req, res) {
  // Return roles and permissions for admin UI
  const rolesSvc = services.get('roles');
  const permsSvc = services.get('permissions');

  const [roles, permissions] = await Promise.all([
    rolesSvc.list({ perPage: 1000 }),
    permsSvc.list({ perPage: 1000 }),
  ]);

  return res.json({ roles: serializeForJson(roles), permissions: serializeForJson(permissions) });
}

export async function storeRole(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const rolesSvc = services.get('roles');
  // Some Prisma schemas (from Laravel style RBAC) require `guard_name`.
  const guard_name = req.body.guard_name || 'web';
  const role = await rolesSvc.create({ name, guard_name });
  res.status(201).json(serializeForJson(role));
}

export async function updateRole(req, res) {
  const roleId = Number(req.params.role);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  const { name } = req.body || {};
  const rolesSvc = services.get('roles');
  const role = await rolesSvc.update(roleId, { name });
  res.json(serializeForJson(role));
}

export async function destroyRole(req, res) {
  const roleId = Number(req.params.role);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  const rolesSvc = services.get('roles');
  await rolesSvc.delete(roleId);
  res.json({ ok: true });
}

export async function storePermission(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const permsSvc = services.get('permissions');
  const guard_name = req.body.guard_name || 'web';
  const perm = await permsSvc.create({ name, guard_name });
  res.status(201).json(serializeForJson(perm));
}

export async function updatePermission(req, res) {
  const permissionId = Number(req.params.permission);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  const { name } = req.body || {};
  const permsSvc = services.get('permissions');
  const perm = await permsSvc.update(permissionId, { name });
  res.json(serializeForJson(perm));
}

export async function destroyPermission(req, res) {
  const permissionId = Number(req.params.permission);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  const permsSvc = services.get('permissions');
  await permsSvc.delete(permissionId);
  res.json({ ok: true });
}

export async function assignPermissions(req, res) {
  // body: { roleId, permissionIds: [1,2,3] }
  const { roleId, permissionIds } = req.body || {};
  if (!roleId || !Array.isArray(permissionIds)) return res.status(400).json({ error: 'roleId_and_permissionIds_required' });

  const rid = Number(roleId);
  const pids = permissionIds.map((p) => Number(p)).filter(Boolean);

  // Replace assignments: remove existing and add provided list
  await prisma.role_has_permissions.deleteMany({ where: { role_id: rid } });

  if (pids.length > 0) {
    const createData = pids.map((pid) => ({ role_id: rid, permission_id: pid }));
    // createMany with skipDuplicates if available
    await prisma.role_has_permissions.createMany({ data: createData, skipDuplicates: true }).catch(async () => {
      // fallback to looped create
      for (const d of createData) {
        await prisma.role_has_permissions.create({ data: d }).catch(() => {});
      }
    });
  }

  res.json({ ok: true });
}

export async function getRolePermissions(req, res) {
  const roleId = Number(req.params.role);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });

  const rows = await prisma.role_has_permissions.findMany({ where: { role_id: roleId }, include: { permissions: true } });
  const permissions = rows.map((r) => r.permissions).filter(Boolean);
  res.json(serializeForJson(permissions));
}

export default {
  index,
  storeRole,
  updateRole,
  destroyRole,
  storePermission,
  updatePermission,
  destroyPermission,
  assignPermissions,
  getRolePermissions,
};
