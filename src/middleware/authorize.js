import prisma from '../utils/prismaClient.js';

// Simple in-memory permission cache. Replace with Redis in production.
const PERM_CACHE_TTL = parseInt(process.env.PERM_CACHE_TTL_SEC || '60', 10) * 1000;
const permCache = new Map();

function setCache(key, value) {
  const expires = Date.now() + PERM_CACHE_TTL;
  permCache.set(key, { value, expires });
}

function getCache(key) {
  const e = permCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    permCache.delete(key);
    return null;
  }
  return e.value;
}

async function loadPermissionsForUserId(userId) {
  const cacheKey = `perms:${userId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // ensure numeric
  const uid = Number(userId);
  if (!uid) return new Set();

  // load role_id
  const u = await prisma.user.findUnique({ where: { id: uid }, select: { role_id: true, email: true, name: true } });
  if (!u) return new Set();

  const roleId = u.role_id;

  // role-based permissions
  const rolePermRows = await prisma.role_has_permissions.findMany({ where: { role_id: roleId }, include: { permissions: true } });
  const rolePerms = rolePermRows.map((r) => r.permissions && r.permissions.name).filter(Boolean);

  // model-specific permissions assigned directly to user
  const modelPermRows = await prisma.model_has_permissions.findMany({ where: { model_type: 'User', model_id: BigInt(uid) }, include: { permissions: true } });
  const modelPerms = modelPermRows.map((r) => r.permissions && r.permissions.name).filter(Boolean);

  // permissions from model_has_roles (roles assigned to this specific user)
  const modelRoleRows = await prisma.model_has_roles.findMany({ where: { model_type: 'User', model_id: BigInt(uid) } });
  const modelRoleIds = modelRoleRows.map((r) => r.role_id).filter(Boolean);
  let modelRolePerms = [];
  if (modelRoleIds.length > 0) {
    const mrp = await prisma.role_has_permissions.findMany({ where: { role_id: { in: modelRoleIds } }, include: { permissions: true } });
    modelRolePerms = mrp.map((r) => r.permissions && r.permissions.name).filter(Boolean);
  }

  const rawPerms = [...rolePerms, ...modelPerms, ...modelRolePerms].filter(Boolean).map(String);

  // Normalize permissions to be forgiving about spaces vs underscores and case.
  // e.g. 'manage all' <-> 'manage_all', and lowercase variants.
  const perms = new Set();
  for (const p of rawPerms) {
    const lower = p.toLowerCase();
    perms.add(p);
    perms.add(lower);
    perms.add(lower.replace(/\s+/g, '_'));
    perms.add(lower.replace(/_/g, ' '));
  }

  setCache(cacheKey, perms);
  return perms;
}

// Export helper for diagnostics
export { loadPermissionsForUserId };

export function checkPermission(permissionName) {
  return async function (req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'missing_token' });

      // prefer numeric subject id from token
      const sub = req.user.sub || req.user.id || req.user.email;
      let userId = null;
      if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);

      if (!userId) {
        // fallback to email lookup (legacy tokens)
        const email = req.user.email || req.user['https://example.com/email'];
        if (!email) return res.status(401).json({ error: 'missing_user_identity' });
        const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
        if (!u) return res.status(403).json({ error: 'user_not_found' });
        userId = Number(u.id);
      }

      const perms = await loadPermissionsForUserId(userId);

      // Debug: attach perms to request for inspection if needed
      if (process.env.DEBUG_PERMS === 'true') {
        try {
          console.debug('Authorization check for user', userId, 'perms=', Array.from(perms));
        } catch (e) {
          // ignore logging errors
        }
      }

      // super role bypass by permission name or role name mapped to a permission
      if (perms.has('manage_all') || perms.has('super_admin')) return next();

      if (!permissionName) return next();
      if (perms.has(permissionName)) return next();

      return res.status(403).json({ error: 'forbidden', details: 'missing_permission' });
    } catch (err) {
      console.error('Authorization error', err);
      return res.status(500).json({ error: 'authorization_error' });
    }
  };
}

export function allowOwnerOr(permissionName, param = 'id') {
  return async function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'missing_token' });
    const sub = req.user.sub || req.user.id;
    const userId = sub ? Number(sub) : null;
    const targetId = req.params && req.params[param] ? Number(req.params[param]) : null;
    if (userId && targetId && userId === targetId) return next();
    return checkPermission(permissionName)(req, res, next);
  };
}

export async function ensureSuperAdmin(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'missing_token' });
    const sub = req.user.sub || req.user.id || req.user.email;
    let userId = null;
    if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
    if (!userId) {
      const email = req.user.email || req.user['https://example.com/email'];
      if (!email) return res.status(401).json({ error: 'missing_user_identity' });
      const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
      if (!u) return res.status(403).json({ error: 'user_not_found' });
      userId = Number(u.id);
    }

    const perms = await loadPermissionsForUserId(userId);
    if (perms.has('manage_all') || perms.has('super_admin')) return next();
    return res.status(403).json({ error: 'forbidden', details: 'requires_super_admin' });
  } catch (err) {
    console.error('ensureSuperAdmin error', err);
    return res.status(500).json({ error: 'authorization_error' });
  }
}

export default checkPermission;
