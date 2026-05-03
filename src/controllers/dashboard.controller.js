import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import dashboardService from '../services/dashboard.service.js';
import service from '../services/index.js';
import { loadPermissionsForUserId } from '../middleware/authorize.js';

const userSvc = service.get('user');

// Build allowed status filters from permissions, tolerant to naming variations
const buildAllowedStatusFiltersFromPerms = (perms) => {
    const allowed = [];
    try {
        const pArr = perms ? Array.from(perms).map((p) => String(p).toLowerCase()) : [];
        const has = (kw) => pArr.some((p) => p.includes(kw));
        if (has('open') || has('enquir')) {
            allowed.push('enquir');
            allowed.push('open');
        }
        if (has('confirm')) allowed.push('confirm');
        if (has('complete')) allowed.push('complete');
        if (has('cancel')) allowed.push('cancel');
    } catch (e) {
        // ignore
    }
    return allowed;
};

const getEventsDropDown = catchAsync(async (req, res) => {
    const rawSearch = req.params?.search ?? req.query?.search ?? null;
    const search = rawSearch ? String(rawSearch).trim() : null;

    if (!search) return res.json([]);

    // determine requesting user and scope so clients only see their events
    if (!req.user) return res.status(401).json({ error: 'missing_token' });
    const sub = req.user.sub || req.user.id || req.user.email;
    let userId = null;
    if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
    if (!userId) {
        const email = req.user.email;
        if (!email) return res.status(401).json({ error: 'missing_user_identity' });
        const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true, role_id: true } });
        if (!u) return res.status(404).json({ error: 'user_not_found' });
        userId = Number(u.id);
    }
    const user = await userSvc.getById(userId);
    const perms = await loadPermissionsForUserId(userId);
    let scope = 'team';
    if (perms && (perms.has('manage_all') || perms.has('super_admin'))) scope = 'admin';
    if (user && user.role_id && Number(user.role_id) === 4) scope = 'personal';

        // Build allowed status filters from granular permissions (robust)
        const allowedStatusFilters = buildAllowedStatusFiltersFromPerms(perms);

    // build OR conditions: id (numeric), couple_name, venue name, client name or email
    const or = [];
    if (/^\d+$/.test(search)) or.push({ id: Number(search) });
    // couple name contains
    or.push({ couple_name: { contains: search } });
    // venue name
    or.push({ venues: { venue: { contains: search } } });
    // client name / email
    or.push({ users_events_user_idTousers: { name: { contains: search } } });
    or.push({ users_events_user_idTousers: { email: { contains: search } } });

    // apply scope restrictions
    const where = { OR: or };
    if (scope === 'personal') {
        // clients only see events where they are the client/user
        where.users_events_user_idTousers = { id: userId };
    } else if (scope === 'team') {
        // team users see events they are involved in (dj or creator) or where they are assigned
        where.OR = [ ...(where.OR || []), { dj_id: userId }, { created_by: userId }, { users_events_dj_idTousers: { id: userId } }, { users_events_user_idTousers: { id: userId } } ];
    }
        // If team scope and granular permissions provided, only include allowed statuses
        if (scope === 'team') {
            if (allowedStatusFilters.length) {
                // build OR of contains clauses
                const statusOr = allowedStatusFilters.map((s) => ({ event_statuses: { status: { contains: s } } }));
                where.AND = where.AND ? [...(where.AND || []), { OR: statusOr }] : [{ OR: statusOr }];
            } else {
                // default: exclude completed events
                where.NOT = { event_statuses: { status: { contains: 'complete' } } };
            }
        }

    let events = await prisma.event.findMany({
        where,
        orderBy: { date: 'desc' },
        // limit results to a reasonable number
        take: 50,
        select: {
            id: true,
            event_status_id: true,
            event_statuses: { select: { status: true } },
            couple_name: true,
            users_events_user_idTousers: { select: { id: true, name: true, } },
        },

    });

    // Map to a compact response expected by the frontend
    // Server-side safety: ensure team users only receive allowed statuses
    if (scope === 'team') {
        if (Array.isArray(allowedStatusFilters) && allowedStatusFilters.length) {
            const af = allowedStatusFilters.map((s) => String(s).toLowerCase());
            events = events.filter((e) => {
                const st = (e.event_statuses && e.event_statuses.status) ? String(e.event_statuses.status).toLowerCase() : '';
                return af.some((f) => st.includes(f));
            });
        } else {
            // default: exclude completed
            events = events.filter((e) => {
                const st = (e.event_statuses && e.event_statuses.status) ? String(e.event_statuses.status).toLowerCase() : '';
                return !st.includes('complete');
            });
        }
    }

    const out = events.map((e) => ({
        id: e.id,
        status: e.event_status_id,
        couple_name: e.couple_name,
        client: e.users_events_user_idTousers ? { id: e.users_events_user_idTousers.id, name: e.users_events_user_idTousers.name } : null,
    }));

    // For non-admins exclude events whose status name indicates internal/private
    if (scope !== 'admin') {
        const filtered = events.filter((e) => {
            const st = e.event_statuses?.status || '';
            if (!st) return true;
            const lower = String(st).toLowerCase();
            // exclude explicit private/internal statuses
            if (lower.includes('private') || lower.includes('internal') || lower.includes('staff-only')) return false;
            return true;
        });
        const out2 = filtered.map((e) => ({ id: e.id, status: e.event_status_id, couple_name: e.couple_name, client: e.users_events_user_idTousers ? { id: e.users_events_user_idTousers.id, name: e.users_events_user_idTousers.name } : null }));
        return res.json(serializeForJson(out2));
    }

    res.json(serializeForJson(out));
});

const getDashboardStats = catchAsync(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : null;

    if (!req.user) return res.status(401).json({ error: 'missing_token' });
    const sub = req.user.sub || req.user.id || req.user.email;
    let userId = null;
    if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
    if (!userId) {
        const email = req.user.email;
        if (!email) return res.status(401).json({ error: 'missing_user_identity' });
        const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
        if (!u) return res.status(404).json({ error: 'user_not_found' });
        userId = Number(u.id);
    }

    const user = await userSvc.getById(userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const perms = await loadPermissionsForUserId(userId);
    let scope = 'team';
    if (perms && (perms.has('manage_all') || perms.has('super_admin'))) scope = 'admin';
    // role_id 4 = client (personal)
    if (user.role_id && Number(user.role_id) === 4) scope = 'personal';

    const stats = await dashboardService.getDashboardStats({ year, userId, scope, userRoleId: user.role_id });
    // apply visibility rules:
    // - admin: full data
    // - team: no money-related fields or pending payments
    // - personal: their own money/pendingPayments are shown
    const outStats = { ...stats };
    if (scope === 'team') {
        delete outStats.totalTurnover;
        delete outStats.totalProfit;
        if (outStats.monthly) delete outStats.monthly.turnover;
        delete outStats.salesAnalytics;
        delete outStats.pendingPayments;
    }

    res.json(serializeForJson({ scope, ...outStats }));
});

const recalculateProfits = catchAsync(async (req, res) => {
    const force = Boolean(req.body?.force);
    const result = await dashboardService.recalculateProfits({ force });
    res.json({ ok: true, updated: result.updated });
});


const getUpcomingEvents = catchAsync(async (req, res) => {
    const rawSearch = req.query?.search ?? null;
    const search = rawSearch ? String(rawSearch).trim() : null;

    if (!req.user) return res.status(401).json({ error: 'missing_token' });
    const sub = req.user.sub || req.user.id || req.user.email;
    let userId = null;
    if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
    if (!userId) {
        const email = req.user.email;
        if (!email) return res.status(401).json({ error: 'missing_user_identity' });
        const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
        if (!u) return res.status(404).json({ error: 'user_not_found' });
        userId = Number(u.id);
    }

    const user = await userSvc.getById(userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const perms = await loadPermissionsForUserId(userId);
    let scope = 'team';
    if (perms && (perms.has('manage_all') || perms.has('super_admin'))) scope = 'admin';
    if (user.role_id && Number(user.role_id) === 4) scope = 'personal';
    const allowedStatusFilters = buildAllowedStatusFiltersFromPerms(perms);

    const events = await dashboardService.getUpcomingEvents({ search, userId, scope, userRoleId: user.role_id, allowedStatusFilters });
    res.json(serializeForJson({ scope, events }));
});
export default { getDashboardStats, getEventsDropDown, recalculateProfits, getUpcomingEvents };