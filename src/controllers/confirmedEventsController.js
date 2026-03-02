import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import sendEmail from '../utils/mail/resendClient.js';
import eventNoteService from '../services/eventNoteService.js';
import { logActivity } from '../utils/activityLogger.js';
import { parseFilterSort } from '../utils/queryHelpers.js';
import microsoftGraph from '../utils/microsoftGraph.js';

export const getConfirmedEvents = catchAsync(async (req, res) => {
  const logged = req.user || {};
  // normalize id and role from token (some tokens use `sub`, others `id`)
  const userId = Number(logged.id ?? logged.sub ?? logged.user_id ?? null);
  const roleId = Number(logged.role_id ?? logged.role ?? logged.roleId ?? null);
  // Use parseFilterSort to allow filtering/sorting via query parameters
  const opts = parseFilterSort(req.query || {});
  // ensure we only fetch confirmed events by default
  opts.where = { ...(opts.where || {}), event_status_id: 2 };

  // Debug mode: return user info and counts to help diagnose empty results
//   if (req.query.debug === '1' || req.query._debug === '1') {
//     const total = await prisma.event.count({ where: { event_status_id: 2 } });
//     const djCount = userId ? await prisma.event.count({ where: { event_status_id: 2, dj_id: userId } }) : 0;
//     const userCount = userId ? await prisma.event.count({ where: { event_status_id: 2, user_id: userId } }) : 0;
//     return res.json(serializeForJson({ success: true, debug: { user: logged, userId, roleId, totalConfirmedEvents: total, djMatchCount: djCount, userMatchCount: userCount } }));
//   }

  // fetch events based on role
  let dates = [];
  if ([1,2,5].includes(roleId)) {
    dates = await prisma.event.findMany({ where: opts.where, orderBy: opts.orderBy, take: opts.take, skip: opts.skip });
  } else if (roleId === 3) {
    dates = await prisma.event.findMany({ where: { ...(opts.where || {}), dj_id: userId }, orderBy: opts.orderBy, take: opts.take, skip: opts.skip });
  } else {
    dates = await prisma.event.findMany({ where: { ...(opts.where || {}), user_id: userId }, orderBy: opts.orderBy, take: opts.take, skip: opts.skip });
  }

  const events = [];
  for (const d of dates) {
    const user = d.user_id ? await prisma.user.findUnique({ where: { id: d.user_id } }) : null;
    const dj = d.dj_id ? await prisma.user.findUnique({ where: { id: d.dj_id } }) : null;
    const venue = d.venue_id ? await prisma.venue.findUnique({ where: { id: d.venue_id } }) : null;
    events.push({
      id: d.id,
      date: d.date,
      venue: venue?.venue || null,
      name: user?.name || null,
      email: user?.email || null,
      venue_id: d.venue_id,
      user_id: d.user_id,
      role_id: user?.role_id || null,
      dj_id: d.dj_id,
      dj_name: dj?.name || null,
    });
  }

  res.json(serializeForJson(events));
});

export const showEvent = catchAsync(async (req, res) => {
  const id = Number(req.query.id || req.params.id || req.body.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      users_events_user_idTousers: true,
      users_events_dj_idTousers: true,
      venues: { select: { id: true, venue: true } },
      event_package: true,
      event_payments: { include: { payment_methods: true } },
      file_uploads: true,
      contracts: true,
    }
  });

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const packages_user = await prisma.package_users.findMany({ select: { user_id: true, sell_price: true } }).catch(()=>[]);

  // merge global files
  const globalFiles = await prisma.fileUpload.findMany({ where: { event_id: null, general: true } }).catch(()=>[]);
  event.uploadFileData = (event.file_uploads || []).concat(globalFiles || []);

  // attach company name if available
  if (event.names_id) {
    try { event.company = await prisma.companyName.findUnique({ where: { id: Number(event.names_id) } }); } catch(e) { event.company = null; }
  } else {
    event.company = null;
  }

  // dj info
  const dj = users.find(u => u.id === event.dj_id);
  const dj_id = (packages_user || []).find(p => p.user_id === event.dj_id);
  event.dj_sell_price = dj_id ? dj_id.sell_price : null;
  event.dj_name = dj ? dj.name : null;

  res.json(serializeForJson({ events_details: [event], users, packages_user }));
});

export const updateEvent = catchAsync(async (req, res) => {
  const id = Number(req.body.id || req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });

  const payload = req.body || {};
  // normalize and parse date/time fields
  const dateVal = payload.date ? new Date(payload.date) : undefined;
  const startTime = payload.start_time ? payload.start_time : null;
  const endTime = payload.end_time ? payload.end_time : null;
  const accessTime = payload.access_time ?? payload.accessTime ?? null;

  const data = { ...payload };
  if (dateVal) data.date = dateVal;
  if (startTime) data.start_time = startTime;
  if (endTime) data.end_time = endTime;
  data.access_time = accessTime;

  // ensure numeric conversions where appropriate
  if (data.venue_id) data.venue_id = Number(data.venue_id);
  if (data.user_id) data.user_id = Number(data.user_id);
  if (data.dj_id) data.dj_id = Number(data.dj_id);

  const updated = await prisma.event.update({ where: { id }, data });

  try { await logActivity(prisma, { log_name: 'events', description: 'Updated event', subject_type: 'Event', subject_id: updated.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  // attempt to propagate update to Microsoft Graph if an external calendar id exists
  try {
    const note = await prisma.eventNote.findFirst({ where: { event_id: updated.id, notes: { contains: 'CalendarEventId:' } }, orderBy: { id: 'desc' } });
    if (note && note.notes) {
      const m = note.notes.match(/CalendarEventId:\s*(\S+)/);
      const graphId = m ? m[1] : null;
      if (graphId) {
        const startIso = updated.start_time ? new Date(updated.start_time).toISOString() : (updated.date ? new Date(updated.date).toISOString() : null);
        const endIso = updated.end_time ? new Date(updated.end_time).toISOString() : (updated.date ? new Date(updated.date).toISOString() : null);
        await microsoftGraph.updateEvent(graphId, { subject: `USRMusic Event #${updated.id}`, content: updated.details || '', startIso, endIso, location: null }).catch(()=>null);
      }
    }
  } catch (e) {
    console.error('[confirmedEventsController] propagate update to Microsoft Graph failed', e?.message || e);
  }

  res.json(serializeForJson({ success: true, data: updated }));
});

export const confirmedEventAutoSave = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.body.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });
  const payload = req.body || {};

  const data = {};
  // accept a small subset of updatable fields for autosave
  if (payload.date) data.date = new Date(payload.date);
  if (payload.start_time) data.start_time = payload.start_time;
  if (payload.end_time) data.end_time = payload.end_time;
  if (payload.access_time) data.access_time = payload.access_time;
  if (payload.details) data.details = payload.details;
  if (payload.total_cost_for_equipment) data.total_cost_for_equipment = payload.total_cost_for_equipment;

  const updated = await prisma.event.update({ where: { id }, data });
  try { await logActivity(prisma, { log_name: 'events', description: 'Auto-saved event', subject_type: 'Event', subject_id: updated.id, causer_id: req.user?.id || null, properties: data }); } catch(e){}
  res.json(serializeForJson({ success: true, data: updated }));
});

export const sendConfirmedEventMail = catchAsync(async (req, res) => {
  const userId = Number(req.body.id || req.body.userId);
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const mailDetails = { first_name: user.name, email: user.email, body: req.body.body, subject: req.body.subject };
  const details = req.body.selectedEvent || {};
  const companyDetails = details.company_names || null;

  await sendEmail({ to: user.email, subject: mailDetails.subject, html: String(mailDetails.body).replace(/\n/g,'<br>') }).catch(()=>{});

  // add note
  const noteText = `Email Sent - ${companyDetails?.name || ''}`;
  await eventNoteService.createNote(prisma, { eventId: details.id, notes: noteText, created_by: req.user?.id || null }).catch(()=>{});
  const event = await prisma.event.findUnique({ where: { id: details.id }, include: { event_notes: true } });
  const latestNote = event?.event_notes?.length ? event.event_notes.sort((a,b)=>b.id-a.id)[0] : null;
  try { await logActivity(prisma, { log_name: 'emails', description: 'Sent event email', subject_type: 'Event', subject_id: details.id, causer_id: req.user?.id || null, properties: { to: user.email, subject: mailDetails.subject } }); } catch(e){}

  res.json(serializeForJson({ success: true, data: user, eventNotes: latestNote }));
});

export const sendInvoiceMail = catchAsync(async (req, res) => {
  // similar to sendConfirmedEventMail but can include invoice details
  await sendConfirmedEventMail(req, res);
});

export const sendQuoteMail = catchAsync(async (req, res) => {
  await sendConfirmedEventMail(req, res);
});

export const confirmedEventNotes = catchAsync(async (req, res) => {
  const notes = req.body.notes;
  const event_id = Number(req.body.id || req.body.event_id);
  if (!event_id) return res.status(400).json({ error: 'id_required' });
  const created = await prisma.eventNote.create({ data: { event_id, notes, created_by: req.user?.id || null, created_at: new Date() } });
  try { await logActivity(prisma, { log_name: 'event_notes', description: 'Added event note', subject_type: 'EventNote', subject_id: created.id, causer_id: req.user?.id || null, properties: { event_id } }); } catch(e){}
  res.json(serializeForJson({ success: true, data: created }));
});

export const confirmedEventPayments = catchAsync(async (req, res) => {
  const data = req.body;
  const payment = await prisma.eventPayment.create({ data: { event_id: Number(data.event_id), payment_method_id: Number(data.payment_method_id), date: data.date ? new Date(data.date) : new Date(), amount: Number(data.amount), created_at: new Date() } });
  const totalCost = await prisma.event.findUnique({ where: { id: Number(data.event_id) }, select: { total_cost_for_equipment: true } });
  const totalPayment = await prisma.eventPayment.aggregate({ where: { event_id: Number(data.event_id) }, _sum: { amount: true } });
  const paymentSent = (Number(totalPayment._sum.amount || 0) === Number(totalCost?.total_cost_for_equipment || 0)) ? true : false;
  await prisma.event.update({ where: { id: Number(data.event_id) }, data: { is_event_payment_fully_paid: paymentSent } });
  const pm = await prisma.eventPayment.findUnique({ where: { id: payment.id }, include: { payment_methods: true } }).catch(()=>null);
  try { await logActivity(prisma, { log_name: 'payments', description: 'Added payment', subject_type: 'EventPayment', subject_id: payment.id, causer_id: req.user?.id || null, properties: { event_id: payment.event_id, amount: payment.amount } }); } catch(e){}
  res.json(serializeForJson({ success: true, data: { id: payment.id, event_id: payment.event_id, payment_method: pm?.payment_methods?.name || null, date: payment.date, amount: payment.amount } }));
});

export const djAvailabilityCheck = catchAsync(async (req, res) => {
  const eventDate = req.body.date || req.query.date;
  const djId = Number(req.body.dj_id || req.query.dj_id || req.body.djId || req.query.djId);
  if (!eventDate || !djId) return res.status(400).json({ error: 'date_and_dj_required' });
  const eventDateIso = new Date(eventDate);
  const check = await prisma.event.findFirst({ where: { event_status_id: 2, dj_id: djId, date: eventDateIso } });
  res.json(serializeForJson({ success: true, data: { checkDjAvailability: !!check } }));
});

export const cancelledEvent = catchAsync(async (req, res) => {
  const data = req.body || {};
  const eventId = Number(data.event_id || data.id || data.eventId);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { refund_amount: true } });
  const prev = ev && ev.refund_amount ? Number(ev.refund_amount) : 0;
  const add = data.refund_amount ? Number(data.refund_amount) : 0;
  const newRefund = prev + add;

  const setStatus = Number(data.event_status_id || data.status || 4); // default to 4 (cancelled)

  const updated = await prisma.event.update({ where: { id: eventId }, data: { event_status_id: setStatus, refund_amount: newRefund } });

  // If we have a linked calendar event id, try to delete it from Microsoft Graph
  try {
    const note = await prisma.eventNote.findFirst({ where: { event_id: eventId, notes: { contains: 'CalendarEventId:' } }, orderBy: { id: 'desc' } });
    if (note && note.notes) {
      const m = note.notes.match(/CalendarEventId:\s*(\S+)/);
      const graphId = m ? m[1] : null;
      if (graphId) {
        await microsoftGraph.deleteEvent(graphId).catch(()=>null);
        await eventNoteService.createNote(prisma, { eventId, notes: `CalendarEventDeleted: ${graphId}`, created_by: req.user?.id || null }).catch(()=>{});
      }
    }
  } catch (e) {
    console.error('[confirmedEventsController] failed to remove calendar event', e?.message || e);
  }

  try { await logActivity(prisma, { log_name: 'events', description: 'Cancelled event', subject_type: 'Event', subject_id: updated.id, causer_id: req.user?.id || null, properties: { status: setStatus, refund_amount: newRefund } }); } catch(e){}
  res.json(serializeForJson({ success: true, data: updated }));
});

export const eventRefund = catchAsync(async (req, res) => {
  const data = req.body || {};
  const eventId = Number(data.event_id || data.id || data.eventId);
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });
  const add = data.refund_amount ? Number(data.refund_amount) : 0;

  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { refund_amount: true } });
  const prev = ev && ev.refund_amount ? Number(ev.refund_amount) : 0;
  const newRefund = prev + add;

  const updated = await prisma.event.update({ where: { id: eventId }, data: { refund_amount: newRefund } });

  try { await logActivity(prisma, { log_name: 'events', description: 'Refund applied', subject_type: 'Event', subject_id: updated.id, causer_id: req.user?.id || null, properties: { refund_amount: newRefund } }); } catch(e){}
  res.json(serializeForJson({ success: true, data: updated }));
});

export const getEventPlanForm = catchAsync(async (req, res) => {
  // return a compact payload used by the frontend event-plan form
  const events = await prisma.event.findMany({ where: { event_status_id: 2 }, include: { event_notes: true, event_payments: true } });
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, contact_number: true } });
  const packages_user = await prisma.package_users.findMany({ select: { user_id: true, sell_price: true } }).catch(()=>[]);
  const contracts = await prisma.contract.findMany().catch(()=>[]);

  const mergedEvents = events.map(e => {
    const dj = users.find(u => u.id === e.dj_id);
    const created_by = users.find(u => u.id === e.created_by);
    const dj_id = packages_user.find(p => p.user_id === e.dj_id);
    return { ...e, dj_sell_price: dj_id ? dj_id.sell_price : null, dj_name: dj ? dj.name : null, created_by_name: created_by ? created_by.name : null, contracts: contracts.filter(c => c.event_id === e.id) };
  });

  res.json(serializeForJson({ events_details: mergedEvents, users, packages_user, contracts }));
});

export const getVenueDropdown = catchAsync(async (req, res) => {
  const venue_list = await prisma.venue.findMany({ select: { id: true, venue: true } });
  res.json({ venue: venue_list });
});

export const getDjDropdown = catchAsync(async (req, res) => {
  const activeDjs = await prisma.package_users.findMany({ where: { status: 'ACTIVE' }, include: { users: { select: { id: true, name: true } } } }).catch(()=>[]);
  res.json({ activeDjs });
});

export const getEventPaymentMethods = catchAsync(async (req, res) => {
  const payment_method = await prisma.paymentMethod.findMany();
  res.json({ success: true, data: payment_method });
});

export const getEnquiryWithDetails = catchAsync(async (req, res) => {
  const eventId = Number(req.params.eventId || req.query.eventId || req.body.eventId);
  if (!eventId) return res.status(400).json({ error: 'id_required' });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      users_events_user_idTousers: true,
      users_events_dj_idTousers: true,
      venues: { select: { id: true, venue: true } },
      event_package: { include: { equipment: true } },
      event_payments: { include: { payment_methods: true } },
      event_notes: true,
      file_uploads: true,
      contracts: true,
      package_user: true,
    }
  }).catch(()=>null);

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const packages_user = await prisma.package_users.findMany({ select: { user_id: true, sell_price: true } }).catch(()=>[]);

  if (!event) return res.status(404).json({ error: 'not_found' });

  // merge global files
  const globalFiles = await prisma.fileUpload.findMany({ where: { event_id: null, general: true } }).catch(()=>[]);
  event.uploadFileData = (event.file_uploads || []).concat(globalFiles || []);

  // attach dj details
  const dj = users.find(u => u.id === event.dj_id);
  const dj_id = (packages_user || []).find(p => p.user_id === event.dj_id);
  event.dj_sell_price = dj_id ? dj_id.sell_price : null;
  event.dj_name = dj ? dj.name : null;

  res.json(serializeForJson({ success: true, data: event }));
});

export default {
  getConfirmedEvents,
  showEvent,
  updateEvent,
  confirmedEventAutoSave,
  sendConfirmedEventMail,
  sendInvoiceMail,
  sendQuoteMail,
  confirmedEventNotes,
  confirmedEventPayments,
  djAvailabilityCheck,
  cancelledEvent,
  eventRefund,
  getEventPlanForm,
  getVenueDropdown,
  getDjDropdown,
  getEventPaymentMethods,
  getEnquiryWithDetails
};
