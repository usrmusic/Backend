import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';

export const rigListEvent = catchAsync(async (req, res) => {
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);

  const events = await prisma.event.findMany({
    where: {
      date: { gte: new Date(isoDate) },
      event_status_id: 2,
    },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      user_id: true,
      venue_id: true,
      access_time: true,
      venues: { select: { id: true, venue: true } },
      users_events_user_idTousers: { select: { id: true, name: true } },
    },
  });

  // Return JSON list (frontend can render a view)
  res.json({ data: events });
});

export const getEvent = catchAsync(async (req, res) => {
  const eventId = req.query.event_id ? Number(req.query.event_id) : null;
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

  res.json({ event, packages });
});

export const StoreRigListNotes = catchAsync(async (req, res) => {
  const { id, notes, van, crew } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id_required' });

  const existing = await prisma.event.findUnique({ where: { id: Number(id) } });
  if (!existing) return res.status(404).json({ error: 'event_not_found' });

  const extra = { van: van || null, crew: crew || null };

  await prisma.event.update({
    where: { id: Number(id) },
    data: {
      rigList_event_notes: notes || null,
      extra_data_rigList: JSON.stringify(extra),
      updated_at: new Date(),
    },
  });

  res.json({ success: true });
});

export default { rigListEvent, getEvent, StoreRigListNotes };
