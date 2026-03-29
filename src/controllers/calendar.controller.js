import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import services from '../services/index.js';

const eventSvc = services.get('event');

const getCalenderEvents = catchAsync(async (req, res) => {
    const { year } = req.query || req.params || {};
    const today = new Date();

    const filter = {};
    if (year) {
        filter.date = {
            gte: new Date(`${year}-01-01`),
            lte: new Date(`${year}-12-31`),
        };
    } else {
        filter.date = { gte: today };
    }

    const events = await eventSvc.list({
        filter,
        select: {
            id: true,
            date: true,
            user_id: true,
            venue_id: true,
            venues: {
                select: { id: true, venue: true },
            },
            users_events_user_idTousers: {
                select: { id: true, name: true, profile_photo: true },
            },
        },
        perPage: 1000,
        sort: 'date:asc',
    });

    res.json(serializeForJson({ success: true, data: events }));
});

export default { getCalenderEvents };
