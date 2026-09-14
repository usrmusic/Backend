import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import services from '../services/index.js';

const eventSvc = services.get('event');

const getCalenderEvents = catchAsync(async (req, res) => {
    const { year } = req.query || req.params || {};
    const today = new Date();
    // Compare only date portion, matching completeEventsJob.js's cutoff computation.
    const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const filter = { date: { gte: cutoff } };
    if (year) {
        // Additional constraint alongside the "not in the past" filter, so past
        // months within the selected year are excluded too (matches Laravel's
        // `upcomingEvents`, which never shows past events).
        filter.date = {
            gte: cutoff,
            lte: new Date(`${year}-12-31`),
        };
    }

    // Role-based scoping. Laravel's CalendarController::upcomingEvents() also
    // restricts role_id 3 (Staff/DJ) to events where dj_id is them; that is a
    // DELIBERATE divergence here — the client asked for Staff and Admin to
    // both see the whole calendar, since staff need visibility of the
    // company's other bookings to plan around them. Clients (role_id 4) are
    // still restricted to their own events, exactly as in Laravel.
    const roleId = Number(req.user?.role_id);
    const userId = req.user?.sub;
    if (roleId !== 1 && roleId !== 2 && roleId !== 3) {
        filter.user_id = userId;
    }

    const events = await eventSvc.list({
        // restrict to confirmed events only (match service implementation)
        filter: { ...filter, event_statuses: { status: { contains: 'confirm' } } },
        select: {
            id: true,
            date: true,
            start_time: true,
            end_time: true,
            user_id: true,
            venue_id: true,
            venues: {
                select: { id: true, venue: true, venue_address: true },
            },
            users_events_user_idTousers: {
                select: { id: true, name: true, profile_photo: true },
            },
            // The DJ drives the event's colour on the calendar, so the relation
            // has to come back here — previously only the client was selected.
            users_events_dj_idTousers: {
                select: { id: true, name: true, color: true },
            },
        },
        // No pagination cap — matches Laravel's unbounded `->get()`. A single
        // company's yearly (or forward-looking) confirmed-event count is not
        // large enough to warrant an artificial limit.
        perPage: null,
        sort: 'date:asc',
    });

    res.json(serializeForJson({ success: true, data: events }));
});

export default { getCalenderEvents };
