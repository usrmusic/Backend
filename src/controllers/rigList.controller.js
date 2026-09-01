import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { parseFilterSort } from '../utils/queryHelpers.js';
import { serializeForJson } from '../utils/serialize.js';
import { logActivity } from '../utils/activityLogger.js';

export const listEvents = catchAsync(async (req, res) => {
  const opts = parseFilterSort(req.query || {});
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  let where = { ...(opts.where || {}), event_status_id: 2, date: { gte: new Date(isoDate) } };

  // Staff only rigs their own events — Client can never reach this route
  // (blocked by `blockClient`), Admin/Super Admin still see everything.
  const sub = req.user && (req.user.sub || req.user.id || req.user.email);
  let requesterId = null;
  if (typeof sub === "number" || /^[0-9]+$/.test(String(sub))) requesterId = Number(sub);
  if (!requesterId && req.user && req.user.email) {
    const uu = await prisma.user.findUnique({ where: { email: String(req.user.email) }, select: { id: true } });
    if (uu) requesterId = Number(uu.id);
  }
  if (requesterId) {
    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { role_id: true } });
    if (requester && Number(requester.role_id) === 3) {
      where = { ...where, dj_id: requesterId };
    }
  }

  const events = await prisma.event.findMany({
    where,
    orderBy: opts.orderBy || { date: 'asc' },
    take: opts.take,
    skip: opts.skip,
    select: {
      id: true,
      date: true,
      venues: { select: { id: true, venue: true } },
      users_events_user_idTousers: { select: { id: true, name: true } },
    },
  });

  // Return JSON list (frontend can render a view)
  res.json(serializeForJson({ data: events }));
});

export const getEvent = catchAsync(async (req, res) => {
  const eventId = req.query.id ? Number(req.query.id) : null;
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      date: true,
      venue_id: true,
      dj_id: true,
      start_time: true,
      end_time: true,
      access_time: true,
      rigList_event_notes: true,
      extra_data_rigList: true,
      venues: { select: { id: true, venue: true } },
      users_events_dj_idTousers: { select: { id: true, name: true, email: true } },
    },
  });

  if (!event) return res.status(404).json({ error: 'not_found' });

  const packages = await prisma.eventPackage.findMany({
    where: { event_id: eventId },
    include: { equipment: true },
  });

  res.json(serializeForJson({ event, packages }));
});

export const StoreRigListNotes = catchAsync(async (req, res) => {
  const id = req.params && req.params.id ? Number(req.params.id) : req.query && req.query.id ? Number(req.query.id) : null;
  const { note, notes, van, crew } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id_required' });

  const existing = await prisma.event.findUnique({ where: { id: Number(id) } });
  if (!existing) return res.status(404).json({ error: 'event_not_found' });

  const extra = { van: van || null, crew: crew || null };

  await prisma.event.update({
    where: { id: Number(id) },
    data: {
      rigList_event_notes: notes || note || null,
      extra_data_rigList: JSON.stringify(extra),
      updated_at: new Date(),
    },
  });

  await logActivity(prisma, {
    log_name: "rig list updated",
    description: `Rig list notes updated for event #${id}`,
    subject_type: "Event",
    subject_id: Number(id),
    causer_id: req.user?.id || null,
    properties: {
      old_rigList_event_notes: existing.rigList_event_notes,
      new_rigList_event_notes: notes || note || null,
      old_extra_data_rigList: existing.extra_data_rigList,
      new_extra_data_rigList: extra,
    },
  });

  res.json({ success: true });
});

export default { listEvents, getEvent, StoreRigListNotes };
