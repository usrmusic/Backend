// Simple helpers to parse filtering and sorting query parameters into Prisma options
export function parseFilterSort(q = {}) {
  const where = {};

  if (q.event_status_id) where.event_status_id = Number(q.event_status_id);
  if (q.venue_id) where.venue_id = Number(q.venue_id);
  if (q.dj_id) where.dj_id = Number(q.dj_id);
  if (q.user_id) where.user_id = Number(q.user_id);

  // date range: date_from, date_to (YYYY-MM-DD)
  if (q.date_from || q.date_to) {
    where.date = {};
    if (q.date_from) where.date.gte = new Date(q.date_from);
    if (q.date_to) where.date.lte = new Date(q.date_to);
  }

  // full-text-ish search on client name or venue
  if (q.q) {
    const s = String(q.q);
    where.OR = [
      { usr_name: { contains: s } },
      { 'users_events_user_idTousers': { is: { name: { contains: s } } } },
    ];
  }

  // sorting
  let orderBy = { date: 'asc' };
  if (q.sort_by) {
    const dir = (q.sort_dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    orderBy = { [q.sort_by]: dir };
  }

  const take = q.limit ? Number(q.limit) : undefined;
  const skip = q.skip ? Number(q.skip) : undefined;

  return { where, orderBy, take, skip };
}

export default { parseFilterSort };
