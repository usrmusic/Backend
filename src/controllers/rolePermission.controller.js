import prisma from '../utils/prismaClient.js';
import services from '../services/index.js';
import { serializeForJson } from '../utils/serialize.js';
import { logActivity } from '../utils/activityLogger.js';


const rolesSvc = services.get('roles');
const permsSvc = services.get('permissions');

const PROTECTED_ROLE_NAME = 'super admin';
const PROTECTED_PERMISSION_NAMES = new Set(['manage_all', 'super_admin']);

function normalizePermName(name) {
  return String(name || '').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

function isProtectedRoleName(name) {
  return String(name || '').trim().toLowerCase() === PROTECTED_ROLE_NAME;
}

function isProtectedPermissionName(name) {
  const normalized = normalizePermName(name).replace(/\s+/g, '_');
  return PROTECTED_PERMISSION_NAMES.has(normalized);
}

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
  await logActivity(prisma, {
    log_name: 'role created',
    description: `Role #${role.id} created`,
    subject_type: 'Role',
    subject_id: Number(role.id),
    causer_id: req.user?.id || null,
    properties: { name },
  });
  res.status(201).json(serializeForJson(role));
}

async function updateRole(req, res) {
  const roleId = Number(req.params.id);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  const { name } = req.body || {};
  const existing = await rolesSvc.getById ? await rolesSvc.getById(roleId).catch(() => null) : null;
  if (existing && isProtectedRoleName(existing.name)) {
    return res.status(403).json({ error: 'protected_role', message: 'The Super Admin role cannot be modified.' });
  }
  const role = await rolesSvc.update(roleId, { name });
  await logActivity(prisma, {
    log_name: 'role updated',
    description: `Role #${roleId} updated`,
    subject_type: 'Role',
    subject_id: roleId,
    causer_id: req.user?.id || null,
    properties: { old_name: existing?.name ?? null, new_name: name },
  });
  res.json(serializeForJson(role));
}

async function destroyRole(req, res) {
  const roleId = Number(req.params.id);
  if (!roleId) return res.status(400).json({ error: 'invalid_role_id' });
  const existing = await rolesSvc.getById ? await rolesSvc.getById(roleId).catch(() => null) : null;
  if (existing && isProtectedRoleName(existing.name)) {
    return res.status(403).json({ error: 'protected_role', message: 'The Super Admin role cannot be modified.' });
  }
  const userWithRole = await prisma.user.findFirst({ where: { role_id: roleId } });
  if (userWithRole) {
    return res.status(400).json({ error: 'role_in_use', message: 'This role cannot be deleted while users are assigned to it. Reassign them first.' });
  }
  await rolesSvc.delete(roleId);
  await logActivity(prisma, {
    log_name: 'role deleted',
    description: `Role #${roleId} deleted`,
    subject_type: 'Role',
    subject_id: roleId,
    causer_id: req.user?.id || null,
    properties: { name: existing?.name ?? null },
  });
  res.json({ ok: true });
}

async function storePermission(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const guard_name = req.body.guard_name || 'web';
  const normalizedNew = normalizePermName(name);
  const allPerms = await permsSvc.model.findMany({ select: { id: true, name: true } });
  const conflict = allPerms.find((p) => normalizePermName(p.name) === normalizedNew);
  if (conflict) {
    return res.status(409).json({ error: 'permission_name_conflict', message: 'A permission with an equivalent name already exists.' });
  }
  const perm = await permsSvc.create({ name, guard_name });
  await logActivity(prisma, {
    log_name: 'permission created',
    description: `Permission #${perm.id} created`,
    subject_type: 'Permission',
    subject_id: Number(perm.id),
    causer_id: req.user?.id || null,
    properties: { name },
  });
  res.status(201).json(serializeForJson(perm));
}

async function updatePermission(req, res) {
  const permissionId = Number(req.params.id);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  const { name } = req.body || {};
  const existing = await permsSvc.getById ? await permsSvc.getById(permissionId).catch(() => null) : null;
  if (existing && isProtectedPermissionName(existing.name)) {
    return res.status(403).json({ error: 'protected_permission', message: 'This permission cannot be modified.' });
  }
  if (name !== undefined) {
    const normalizedNew = normalizePermName(name);
    const allPerms = await permsSvc.model.findMany({ select: { id: true, name: true } });
    const conflict = allPerms.find((p) => Number(p.id) !== permissionId && normalizePermName(p.name) === normalizedNew);
    if (conflict) {
      return res.status(409).json({ error: 'permission_name_conflict', message: 'A permission with an equivalent name already exists.' });
    }
  }
  const perm = await permsSvc.update(permissionId, { name });
  await logActivity(prisma, {
    log_name: 'permission updated',
    description: `Permission #${permissionId} updated`,
    subject_type: 'Permission',
    subject_id: permissionId,
    causer_id: req.user?.id || null,
    properties: { old_name: existing?.name ?? null, new_name: name },
  });
  res.json(serializeForJson(perm));
}

async function destroyPermission(req, res) {
  const permissionId = Number(req.params.id);
  if (!permissionId) return res.status(400).json({ error: 'invalid_permission_id' });
  const existing = await permsSvc.getById ? await permsSvc.getById(permissionId).catch(() => null) : null;
  if (existing && isProtectedPermissionName(existing.name)) {
    return res.status(403).json({ error: 'protected_permission', message: 'This permission cannot be modified.' });
  }
  const roleUsingPermission = await prisma.role_has_permissions.findFirst({ where: { permission_id: permissionId } });
  if (roleUsingPermission) {
    return res.status(400).json({ error: 'permission_in_use', message: 'This permission cannot be deleted while it is assigned to a role. Unassign it first.' });
  }
  await permsSvc.delete(permissionId);
  await logActivity(prisma, {
    log_name: 'permission deleted',
    description: `Permission #${permissionId} deleted`,
    subject_type: 'Permission',
    subject_id: permissionId,
    causer_id: req.user?.id || null,
    properties: { name: existing?.name ?? null },
  });
  res.json({ ok: true });
}

async function assignPermissions(req, res) {
  const { roleId, permissionIds } = req.body || {};
  if (!roleId || !Array.isArray(permissionIds)) return res.status(400).json({ error: 'roleId_and_permissionIds_required' });

  const rid = Number(roleId);
  const pids = permissionIds.map((p) => Number(p)).filter(Boolean);

  const targetRole = await rolesSvc.getById ? await rolesSvc.getById(rid).catch(() => null) : null;
  if (targetRole && isProtectedRoleName(targetRole.name)) {
    return res.status(403).json({ error: 'protected_role', message: 'The Super Admin role cannot be modified.' });
  }

  // Replace assignments: remove existing and add provided list
  const relSvc = services.get('role_has_permissions');
  // use the underlying Prisma model on the CoreCrudService to perform non-id-based ops

  // Capture the previous permission set before it's replaced — once the
  // deleteMany below runs, the prior assignment is otherwise unrecoverable.
  const existingRows = await relSvc.model.findMany({ where: { role_id: rid }, select: { permission_id: true } });
  const oldPermissionIds = existingRows.map((r) => Number(r.permission_id));

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

  await logActivity(prisma, {
    log_name: 'role permissions assigned',
    description: `Permissions assigned to role #${rid}`,
    subject_type: 'Role',
    subject_id: rid,
    causer_id: req.user?.id || null,
    properties: { old_permission_ids: oldPermissionIds, new_permission_ids: pids },
  });

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
