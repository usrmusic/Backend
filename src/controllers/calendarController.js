import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';

export const calendarEvents = catchAsync(async (req, res) => {
  const start = req.query.start ? new Date(req.query.start) : null;
  const end = req.query.end ? new Date(req.query.end) : null;
  if (!start || !end) return res.status(400).json({ error: 'start_and_end_required' });

  const events = await prisma.event.findMany({ where: { event_status_id: 2, date: { gte: start, lte: end } }, orderBy: { date: 'asc' }, select: { id: true, date: true, user_id: true, dj_id: true, venue_id: true, usr_name: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

export const upcomingEvents = catchAsync(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const now = new Date();
  const events = await prisma.event.findMany({ where: { event_status_id: 2, date: { gte: now } }, orderBy: { date: 'asc' }, take: limit, include: { users_events_user_idTousers: true, venues: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

export const dateEvents = catchAsync(async (req, res) => {
  const d = req.query.date ? new Date(req.query.date) : null;
  if (!d) return res.status(400).json({ error: 'date_required' });
  const events = await prisma.event.findMany({ where: { event_status_id: 2, date: d }, include: { users_events_user_idTousers: true, venues: true } });
  res.json(serializeForJson({ success: true, data: events }));
});

export default { calendarEvents, upcomingEvents, dateEvents };
