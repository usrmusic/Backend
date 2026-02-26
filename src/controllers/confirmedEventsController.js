import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import sendEmail from '../utils/mail/resendClient.js';
import eventNoteService from '../services/eventNoteService.js';

export const getConfirmedEvents = catchAsync(async (req, res) => {
  const logged = req.user || {};
  // normalize id and role from token (some tokens use `sub`, others `id`)
  const userId = Number(logged.id ?? logged.sub ?? logged.user_id ?? null);
  const roleId = Number(logged.role_id ?? logged.role ?? logged.roleId ?? null);
  let query = { where: { event_status_id: 2 }, orderBy: { date: 'asc' } };

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
    dates = await prisma.event.findMany(query);
  } else if (roleId === 3) {
    dates = await prisma.event.findMany({ where: { event_status_id: 2, dj_id: userId }, orderBy: { date: 'asc' } });
  } else {
    dates = await prisma.event.findMany({ where: { event_status_id: 2, user_id: userId }, orderBy: { date: 'asc' } });
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

export default { getConfirmedEvents, showEvent, sendConfirmedEventMail, sendInvoiceMail, sendQuoteMail, confirmedEventNotes, confirmedEventPayments, djAvailabilityCheck };
