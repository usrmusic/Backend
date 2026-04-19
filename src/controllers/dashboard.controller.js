import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import dashboardService from '../services/dashboard.service.js';

const getEventsDropDown = catchAsync(async (req, res) => {
    const rawSearch = req.params?.search ?? req.query?.search ?? null;
    const search = rawSearch ? String(rawSearch).trim() : null;

    if (!search) return res.json([]);

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

    const events = await prisma.event.findMany({
        where: { OR: or },
        orderBy: { date: 'desc' },
        // no `take` - return all matches per request
        select: {
            id: true,
            event_status_id: true,
            couple_name: true,
            users_events_user_idTousers: { select: { id: true, name: true, } },
        },

    });

    // Map to a compact response expected by the frontend
    const out = events.map((e) => ({
        id: e.id,
        status: e.event_status_id,
        couple_name: e.couple_name,
        client: e.users_events_user_idTousers ? { id: e.users_events_user_idTousers.id, name: e.users_events_user_idTousers.name } : null,
    }));

    res.json(serializeForJson(out));
});

const getDashboardStats = catchAsync(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : null;
    const stats = await dashboardService.getDashboardStats({ year });
    res.json(serializeForJson(stats));
});

const recalculateProfits = catchAsync(async (req, res) => {
    const force = Boolean(req.body?.force);
    const result = await dashboardService.recalculateProfits({ force });
    res.json({ ok: true, updated: result.updated });
});

export default { getDashboardStats, getEventsDropDown, recalculateProfits };