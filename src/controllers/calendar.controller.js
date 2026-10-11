import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import services from '../services/index.js';

const eventSvc = services.get('event');

const getCalenderEvents = catchAsync(async (req, res) => {
    // Every Confirmed and Completed event, past and future — a deliberate
    // divergence from Laravel's `upcomingEvents` (today onwards, Confirmed
    // only): the client wants to scroll back through past bookings, which the
    // nightly job has already moved to Completed. Cancelled events and open
    // enquiries stay off the calendar. A `year` query param is still accepted
    // by validation but no longer narrows the result.
    const filter = { event_status_id: { in: [2, 3] } };

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
        filter,
        // Only what the calendar renders — this now returns every past and
        // future booking, so unused fields would be pure payload.
        select: {
            id: true,
            date: true,
            start_time: true,
            end_time: true,
            venues: {
                select: { id: true, venue: true },
            },
            users_events_user_idTousers: {
                select: { id: true, name: true },
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
