import prisma from '../utils/prismaClient.js';
import services from '../services/index.js';
import { serializeForJson } from '../utils/serialize.js';


const rolesSvc = services.get('roles');
const permsSvc = services.get('permissions');

async function index(req, res) {
  const [roles, permissions] = await Promise.all([
    rolesSvc.list({ perPage: 1000 }),
    permsSvc.list({ perPage: 1000 }),
  ]);

  return res.json({ roles: serializeForJson(roles), permissions: serializeForJson(permissions) });
}

async function storeRole(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  // Some Prisma schemas (from Laravel style RBAC) require `guard_name`.
  const guard_name = req.body.guard_name || 'web';
  const role = await rolesSvc.create({ name, guard_name });
  res.status(201).json(serializeForJson(role));
}

async function updateRole(req, res) {
  const roleId = Number(req.params.id);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  const { name } = req.body || {};
  const role = await rolesSvc.update(roleId, { name });
  res.json(serializeForJson(role));
}

async function destroyRole(req, res) {
  const roleId = Number(req.params.id);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  await rolesSvc.delete(roleId);
  res.json({ ok: true });
}

async function storePermission(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const guard_name = req.body.guard_name || 'web';
  const perm = await permsSvc.create({ name, guard_name });
  res.status(201).json(serializeForJson(perm));
}

async function updatePermission(req, res) {
  const permissionId = Number(req.params.id);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  const { name } = req.body || {};
  const perm = await permsSvc.update(permissionId, { name });
  res.json(serializeForJson(perm));
}

async function destroyPermission(req, res) {
  const permissionId = Number(req.params.id);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  await permsSvc.delete(permissionId);
  res.json({ ok: true });
}

async function assignPermissions(req, res) {
  const { roleId, permissionIds } = req.body || {};
  if (!roleId || !Array.isArray(permissionIds)) return res.status(400).json({ error: 'roleId_and_permissionIds_required' });

  const rid = Number(roleId);
  const pids = permissionIds.map((p) => Number(p)).filter(Boolean);

  // Replace assignments: remove existing and add provided list
  const relSvc = services.get('role_has_permissions');
  // use the underlying Prisma model on the CoreCrudService to perform non-id-based ops
  await relSvc.model.deleteMany({ where: { role_id: rid } });

  if (pids.length > 0) {
    const createData = pids.map((pid) => ({ role_id: rid, permission_id: pid }));
    // createMany with skipDuplicates if available
    await relSvc.model.createMany({ data: createData, skipDuplicates: true }).catch(async () => {
      // fallback to looped create
      for (const d of createData) {
        await relSvc.model.create({ data: d }).catch(() => {});
      }
    });
  }

  res.json({ ok: true });
}

async function getRolePermissions(req, res) {
  const roleId = Number(req.params.id);
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
