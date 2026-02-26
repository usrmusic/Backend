import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";
import { toDbDate } from '../utils/dateUtils.js';
import sendEmail from '../utils/mail/resendClient.js';
import eventNoteService from '../services/eventNoteService.js';

// Create enquiry (core fields + event packages + rig notes + initial note)
export const createEnquiry = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};

  // Accept either `dj_id`, legacy `user_id`, or `dj_name` from clients; normalize to `dj_id`
  if (!body.dj_id && body.user_id) body.dj_id = body.user_id;
  if (!body.dj_id && body.dj_name) body.dj_id = body.dj_name;
  if (body.dj_id) body.dj_id = Number(body.dj_id);
  // Note: request body is validated by Joi middleware (`req.validated`).

  // Client upsert: allow passing `client_id`, a `client` object, or client fields (email preferred)
  let client = null;
  if (body.client_id || (body.client && body.client.id)) {
    const id = body.client_id ? Number(body.client_id) : Number(body.client.id);
    client = await prisma.user.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: 'client_not_found' });
  } else if ((body.client && body.client.email) || body.email || body.name) {
    const email = body.client?.email ?? body.email ?? null;
    const name = body.client?.name ?? body.name ?? 'Client';
    const contact_number = body.client?.contact_number ?? body.contact_number ?? null;
    const address = body.client?.address ?? body.address ?? null;

    if (email) {
      const emailNorm = String(email).toLowerCase();
      client = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (client) {
        client = await prisma.user.update({ where: { id: client.id }, data: {
          name: name || client.name,
          contact_number: contact_number || client.contact_number,
          address: address || client.address,
        }});
      } else {
        client = await prisma.user.create({ data: {
          name: name || 'Client',
          email: emailNorm,
          contact_number: contact_number || null,
          address: address || null,
          role_id: 4,
        }});
      }
    } else {
      // No email provided: create minimal client record
      client = await prisma.user.create({ data: {
        name: name || 'Client',
        contact_number: contact_number || null,
        address: address || null,
        role_id: 4,
      }});
    }
  } else {
    return res.status(400).json({ error: 'client_required' });
  }

  // Parse date/time: assume `event_date` is d-m-Y and times are H:i (frontend)
  // Build UTC datetime strings
  const { event_date, start_time, end_time } = body;

  // Convert frontend `DD-MM-YYYY` + `HH:mm` into a UTC Date object
  const toUtcString = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [d, m, y] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0));
  };

  const start = toUtcString(event_date, start_time);
  const end = toUtcString(event_date, end_time);

  const contract_token = uuidv4();

  // coerce numeric ids safely
  const venueIdNum = Number(body.venue_id);
  const djIdNum = Number(body.dj_id);

  // Prepare event data
  const eventData = {
    contract_token,
    users_events_user_idTousers: { connect: { id: client.id } },
    ...(Number.isFinite(venueIdNum) && venueIdNum > 0 ? { venues: { connect: { id: venueIdNum } } } : {}),
    ...(Number.isFinite(djIdNum) && djIdNum > 0 ? { users_events_dj_idTousers: { connect: { id: djIdNum } } } : {}),
    dj_package_name: body.dj_package_name || null,
    event_statuses: { connect: { id: 1 } },
    // store simple date in DB format (YYYY-MM-DD)
    date: toDbDate(event_date),
    start_time: start || null,
    end_time: end || null,
    details: body.event_details || null,
    total_cost_for_equipment: body.totalCost != null ? Number(body.totalCost) : null,
    dj_cost_price_for_event: body.dj_cost_price != null ? Number(body.dj_cost_price) : null,
    is_vat_available_for_the_event: !!body.is_vat_available_for_the_event,
    created_by: req.user?.id || null,
    deposit_amount: body.deposit_amount != null ? Number(body.deposit_amount) : null,
  };

  // Transaction: create event, create event packages, add initial note
  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ data: eventData });

    const createdPackages = [];

    // Normalize bracketed form-data structures (equipmentData[0][...]) into arrays
    const normalizeArrayField = (field) => {
      if (Array.isArray(field)) return field;
      if (field && typeof field === 'object') return Object.keys(field).map(k => field[k]);
      return [];
    };

    const equipmentArray = normalizeArrayField(body.equipmentData);
    const extraArray = normalizeArrayField(body.extraData);
    const rigNotesArray = normalizeArrayField(body.rigNotesData);

    // helper to create packages array items
    const makePackage = (p) => ({
      equipment_id: p.equipment_id ? Number(p.equipment_id) : null,
      equipment_order_id: p.equipment_order_id !== undefined ? Number(p.equipment_order_id) : null,
      event_id: Number(event.id),
      package_type_id: p.package_type_id !== undefined ? Number(p.package_type_id) : null,
      sell_price: p.sell_price != null ? Number(p.sell_price) : null,
      cost_price: p.cost_price != null ? Number(p.cost_price) : null,
      notes: p.notes || null,
      rig_notes: p.rig_notes || null,
      payment_send: p.payment_send || null,
      payment_date: p.payment_date ? new Date(p.payment_date) : null,
      quantity: p.quantity != null ? Number(p.quantity) : null,
      total_price: p.total_price != null ? Number(p.total_price) : null,
      price_added_to_bill: p.price_added_to_bill != null ? Number(p.price_added_to_bill) : null,
      created_at: new Date(),
    });

    for (const p of equipmentArray) {
      const data = makePackage(p);
      const cp = await tx.eventPackage.create({ data });
      createdPackages.push(cp);
    }

    for (const p of extraArray) {
      const data = makePackage(p);
      const cp = await tx.eventPackage.create({ data });
      createdPackages.push(cp);
    }

    // Apply rig notes updates (if provided as rigNotesData: [{ equipment_id, rig_notes }])
    if (rigNotesArray.length) {
      for (const r of rigNotesArray) {
        await tx.eventPackage.updateMany({
          where: { event_id: Number(event.id), equipment_id: Number(r.equipment_id) },
          data: { rig_notes: r.rig_notes || null }
        });
      }
    }

    // Create initial event note
    // create initial event note (use `eventNote` client name)
    await tx.eventNote.create({ data: {
      event_id: Number(event.id),
      notes: 'Created as an enquiry',
      created_by: req.user?.id || null,
      created_at: new Date(),
    }}).catch(()=>{});

    return { event, event_packages: createdPackages, user: client };
  });

  res.status(201).json(serializeForJson(created));
});

// Open enquiry: list open enquiries (event_status_id = 1)
export const getOpenEnquiry = catchAsync(async (req, res) => {
  // find events with status = 1 (open enquiries)
  const events = await prisma.event.findMany({
    where: { event_status_id: 1 },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      usr_name: true,
      usr_date: true,
      brochure_emailed: true,
      called: true,
      send_media: true,
      quoted: true,
      venue_id: true,
      user_id: true,
      names_id: true,
      venues: { select: { id: true, venue: true } },
      users_events_user_idTousers: { select: { id: true, name: true, email: true } },
    },
  });

  const eventIds = events.map(e => e.id);

  // bulk fetch packages and notes for those events
  const packages = eventIds.length ? await prisma.eventPackage.findMany({ where: { event_id: { in: eventIds } }, include: { equipment: true, package_types: true } }) : [];
  const notes = eventIds.length ? await prisma.eventNote.findMany({ where: { event_id: { in: eventIds } }, orderBy: { id: 'desc' } }) : [];

  // attach packages and latest note
  const data = events.map(ev => {
    const evPackages = packages.filter(p => Number(p.event_id) === Number(ev.id));
    const evNotes = notes.filter(n => Number(n.event_id) === Number(ev.id));
    return { ...ev, event_packages: evPackages, last_note: evNotes.length ? evNotes[0] : null };
  });

  res.json(serializeForJson({ success: true, data }));
});

export const updateOpenEnquiry = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const id = Number(body.id || body.eventId || req.body.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id_required' });

  const update = {};
  ['brochure_emailed','called','send_media','quoted'].forEach(k => {
    if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = !!body[k];
  });

  const updated = await prisma.event.update({ where: { id }, data: update });
  res.json(serializeForJson({ success: true, data: updated }));
});

// use shared service for creating notes (accepts tx or global prisma)
// note: pass the transaction client when calling inside a transaction
// e.g. await eventNoteService.createNote(tx, { eventId, notes, created_by })

export const sendUsrBrochure = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  const eventId = Number(body.eventId || body.event_id || body.id);
  const companyId = body.companyNameId || body.companyId || null;
  const companyName = body.companyName || null;
  // use email template if available (EMAIL BROCHURE id = 1)
  const template = await prisma.emailContent.findUnique({ where: { id: 1 } });
  const subject = body.subject || template?.subject || 'Brochure';
  const raw = body.body || template?.body || `Brochure for event ${eventId}`;
  const html = String(raw).replace(/\n/g, '<br>');

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const to = user?.email || body.email;

  // send email (Resend helper falls back to logging if not configured)
  await sendEmail({ to, subject, html }).catch(() => {});

  // create note and attach company name if provided
  const noteText = `Brochure Email Sent - ${companyName || ''}`;
  const created = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, { eventId, notes: noteText, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: 'Brochure Email sent', event: created }));
});

export const sendUsrUpdateEmail = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  const eventId = Number(body.eventId || body.event_id || body.id);
  const companyName = body.companyName || null;
  // use email template if available (EMAIL FOR UPDATE id = 2)
  const template = await prisma.emailContent.findUnique({ where: { id: 2 } });
  const subject = body.subject || template?.subject || 'Update';
  const raw = body.body || template?.body || `Update for event ${eventId}`;
  const html = String(raw).replace(/\n/g, '<br>');

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const to = user?.email || body.email;

  await sendEmail({ to, subject, html }).catch(() => {});

  const noteText = `Update Email Sent - ${companyName || ''}`;
  const created = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, { eventId, notes: noteText, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: 'Update Email sent', event: created }));
});

export const sendQuote = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  const details = Array.isArray(body.details) ? body.details : [];
  if (!details.length) return res.status(400).json({ error: 'details_required' });

  const eventId = Number(details[0].id);
  const companyId = Number(body.companyNameId || body.companyId || 0) || null;

  // fetch event VAT/amount fields
  const event = await prisma.event.findUnique({ where: { id: eventId } });

  // attach VAT and totals into the details as Laravel does
  const enrichedDetails = details.map(d => ({ ...d, is_vat_available_for_the_event: event?.is_vat_available_for_the_event, event_amount_without_vat: event?.event_amount_without_vat, vat_value: event?.vat_value, total_cost_for_equipment: event?.total_cost_for_equipment }));

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const to = user?.email || body.email;
  const company = companyId ? await prisma.companyName.findUnique({ where: { id: companyId } }) : null;
  const companyName = company?.name || body.companyName || '';

  // use email template for quote if available (SEND QUOTE-OPEN id = 3)
  const template = await prisma.emailContent.findUnique({ where: { id: 3 } });
  const subject = body.subject || template?.subject || 'Quote';
  let raw = body.body || template?.body || `Quote for event ${eventId}`;
  // replace placeholder amount if provided
  if (raw && body.amount) raw = String(raw).replace('{--amount--}', String(body.amount));
  const html = `${String(raw).replace(/\n/g, '<br>')}<hr/><pre>${JSON.stringify(enrichedDetails, null, 2)}</pre>`;

  // update names_id on event if company provided and send email
  const result = await prisma.$transaction(async (tx) => {
    if (companyId) await tx.event.update({ where: { id: eventId }, data: { names_id: companyId } });
    await sendEmail({ to, subject, html }).catch(() => {});
    await eventNoteService.createNote(tx, { eventId, notes: `Quote sent - ${companyName}`, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: 'Quote sent', event: result }));
});

export const sendInvoice = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  const details = Array.isArray(body.details) ? body.details : [];
  if (!details.length) return res.status(400).json({ error: 'details_required' });

  const eventId = Number(details[0].id);
  const companyId = Number(body.companyNameId || body.companyId || 0) || null;

  const event = await prisma.event.findUnique({ where: { id: eventId } });

  const enrichedDetails = details.map(d => ({ ...d, is_vat_available_for_the_event: event?.is_vat_available_for_the_event, event_amount_without_vat: event?.event_amount_without_vat, vat_value: event?.vat_value, total_cost_for_equipment: event?.total_cost_for_equipment }));

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const to = user?.email || body.email;
  const company = companyId ? await prisma.companyName.findUnique({ where: { id: companyId } }) : null;
  const companyName = company?.name || body.companyName || '';

  // use email template for invoice if available (SEND INVOICE-OPEN id = 4)
  const template = await prisma.emailContent.findUnique({ where: { id: 4 } });
  const subject = body.subject || template?.subject || 'Invoice';
  let raw = body.body || template?.body || `Invoice for event ${eventId}`;
  if (raw && body.amount) raw = String(raw).replace('{--amount--}', String(body.amount));
  const html = `${String(raw).replace(/\n/g, '<br>')}<hr/><pre>${JSON.stringify(enrichedDetails, null, 2)}</pre>`;

  const result = await prisma.$transaction(async (tx) => {
    if (companyId) await tx.event.update({ where: { id: eventId }, data: { names_id: companyId } });
    await sendEmail({ to, subject, html }).catch(() => {});
    await eventNoteService.createNote(tx, { eventId, notes: `Invoice Sent - ${companyName}`, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: 'Invoice sent', event: result }));
});

export const deleteOpenEnquiry = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : (body.ids ? [Number(body.ids)] : []);
  const userId = Number(body.userId || body.user_id || 0) || null;
  if (!ids.length) return res.status(400).json({ error: 'ids_required' });

  const result = await prisma.$transaction(async (tx) => {
    // remove activity_log entries if table exists — use raw SQL safely
    try { await tx.$executeRaw`DELETE FROM activity_log WHERE subject_id IN (${ids.join(',')}) AND log_name = 'a notes'`; } catch(e) {}

    const user = userId ? await tx.user.findUnique({ where: { id: userId } }) : null;
    const userEventCount = user ? (await tx.event.count({ where: { user_id: userId } })) : 0;

    if (user && userEventCount === ids.length) {
      await tx.user.delete({ where: { id: userId } });
      await tx.event.deleteMany({ where: { id: { in: ids } } });
      return { success: true, id: userId };
    } else {
      await tx.event.deleteMany({ where: { id: { in: ids } } });
      return { success: true, ids };
    }
  });

  res.json(serializeForJson(result));
});

// Confirm open enquiry: create payment + invoice + set event as confirmed
export const addDepositStore = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const required = ['event_id','payment_method_id','amount','names_id','details'];
  for (const f of required) if (body[f] == null) return res.status(400).json({ error: `${f}_required` });

  const eventId = Number(body.event_id);
  const namesId = Number(body.names_id);
  const paymentData = {
    event_id: eventId,
    payment_method_id: Number(body.payment_method_id),
    date: body.date ? new Date(body.date) : new Date(),
    amount: Number(body.amount),
    created_at: new Date(),
  };

  const result = await prisma.$transaction(async (tx) => {
    // create payment
    const payment = await tx.eventPayment.create({ data: paymentData });

    // ensure unique invoice number
    let invoiceNumber;
    do {
      invoiceNumber = String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0');
      // check existing invoice (invoice stored as Int in DB)
      // parse to number for comparison
      // use findFirst to check existence
      var existing = await tx.event.findFirst({ where: { invoice: Number(invoiceNumber) } });
    } while (existing);

    // update event: set invoice, status=2
    await tx.event.update({ where: { id: eventId }, data: { invoice: Number(invoiceNumber), event_status_id: 2, names_id: namesId } });

    // load event packages similar to Laravel
    const eventPackages = await tx.eventPackage.findMany({
      where: { event_id: eventId, package_type_id: { in: [1,2] } },
      select: {
        id: true, event_id: true, equipment_id: true, package_type_id: true, sell_price: true, total_price: true, price_added_to_bill: true, quantity: true, notes: true,
        equipment: { select: { id: true, name: true, sell_price: true, equipment_properties: { include: { properties: true } } } },
      }
    });

    // VAT calculation based on CompanyName (namesId)
    const company = await tx.companyName.findUnique({ where: { id: BigInt(namesId) } }).catch(()=>null);
    // note: company model id is BigInt in prisma; guard absence
    if (company && company.vat != null) {
      const vatPercentage = company.vat_percentage ? (Number(company.vat_percentage) / 100.0) : 0;
      const totalCost = await tx.event.findUnique({ where: { id: eventId }, select: { total_cost_for_equipment: true } });
      const totalCostNum = totalCost && totalCost.total_cost_for_equipment ? Number(totalCost.total_cost_for_equipment) : 0;
      const totalWithVat = totalCostNum * (1 + vatPercentage);
      const vatValue = totalCostNum * vatPercentage;
      await tx.event.update({ where: { id: eventId }, data: { total_cost_for_equipment: String(totalWithVat), event_amount_without_vat: String(totalCostNum), vat_value: String(vatValue), is_vat_available_for_the_event: true } });
    } else {
      await tx.event.update({ where: { id: eventId }, data: { is_vat_available_for_the_event: false } });
    }

    // activity log placeholder: skipped (not present in Node)

    // create note 'Confirmed as an event'
    await eventNoteService.createNote(tx, { eventId, notes: 'Confirmed as an event', created_by: req.user?.id || null });

    // recalc payments and mark fully paid
    const totalPaymentRow = await tx.eventPayment.aggregate({ where: { event_id: eventId }, _sum: { amount: true } });
    const totalPayment = totalPaymentRow._sum.amount || 0;
    const totalCostRow = await tx.event.findUnique({ where: { id: eventId }, select: { total_cost_for_equipment: true } });
    const totalCostNum = totalCostRow && totalCostRow.total_cost_for_equipment ? Number(totalCostRow.total_cost_for_equipment) : 0;
    const paymentSent = (totalPayment === totalCostNum) ? true : false;
    await tx.event.update({ where: { id: eventId }, data: { is_event_payment_fully_paid: paymentSent } });

    // fetch payment method name
    const paymentWithMethod = await tx.eventPayment.findUnique({ where: { id: payment.id }, include: { payment_methods: true } });

    // fetch latest event note
    const eventNotes = await tx.eventNote.findMany({ where: { event_id: eventId }, orderBy: { id: 'desc' }, take: 1 });

    return {
      id: payment.id,
      event_id: payment.event_id,
      payment_method: paymentWithMethod?.payment_methods?.name || null,
      date: payment.date,
      amount: payment.amount,
      invoice_number: invoiceNumber,
      event_packages: eventPackages,
      names_id: namesId,
      eventNotes: eventNotes.length ? eventNotes[0] : null,
    };
  });

  res.json(serializeForJson({ success: true, data: result }));
});

export default { createEnquiry, getOpenEnquiry, updateOpenEnquiry, sendUsrBrochure, sendUsrUpdateEmail, sendQuote, sendInvoice, deleteOpenEnquiry, addDepositStore };
