import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";
import { toDbDate } from "../utils/dateUtils.js";
import sendEmail from "../utils/mail/resendClient.js";
import { getSignedGetUrl, uploadStreamToS3 } from "../utils/s3Client.js";
import generatePdfBufferFromHtml from "../utils/pdfGenerator.js";
import { marked } from 'marked';
import renderSendQuote from '../templates/sendQuoteTemplate.js';
import renderConfirmedEvent from '../templates/confirmedEventTemplate.js';
import eventNoteService from "../services/eventNoteService.js";
import microsoftGraph from "../utils/microsoftGraph.js";
import services from "../services/index.js";
import genPassword from "../utils/genPassword.js";
import userService from "../services/userService.js";
import bcrypt from "bcrypt";

const userSvc = services.get("user");
const venueSvc = services.get("venue");
const eventSvc = services.get("event");
const companySvc = services.get("CompanyName");

const createEnquiry = catchAsync(async (req, res) => {
  const data = req.body;
  let venue = null;
  let client = null;
  let event = null;
  console.log(data.new_venue_name);
  if (!data.venue_id && data.new_venue_name) {
    try {
      venue = await venueSvc.create({
        venue: data.new_venue_name,
        created_by: req.user?.id || null,
      });
    } catch (e) {
      console.log("[createEnquiry] create venue failed", e?.message || e);
    }
  }
  if (!data.venue_id && !venue)
    return res.status(400).json({ error: "venue cannot be created" });
  client = await userService.getUserByEmail(data.email);
  if (!client) {
    const plainPassword = req.body.password || genPassword();
    const hashed = await bcrypt.hash(plainPassword, 10);
    client = await userSvc.create({
      name: data.name || "Client",
      email: data.email,
      contact_number: data.contact_number || null,
      address: data.address || null,
      password: hashed,
      password_text: plainPassword,
      role_id: BigInt(4),
      created_by: req.user && req.user.id ? Number(req.user.id) : null,
    });
  }
  if (client && client.role_id !== BigInt(4)) {
    return res
      .status(400)
      .json({ error: "This email is already attached with Dj" });
  }
  if (client && client.deleted_at) {
    await userSvc.updateUser(client.id, { deleted_at: null });
  }
  // find the existing event by client, venue and date (open enquiries only)
  const eventDateDb = toDbDate(data.event_date);
  const eventDateObj = eventDateDb ? new Date(eventDateDb) : null;
  const toUtcDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [d, m, y] = String(dateStr).split("-").map(Number);
    const [hh, mm] = String(timeStr).split(":").map(Number);
    if ([d, m, y].some(isNaN) || [hh, mm].some(isNaN)) return null;
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0));
  };
  const startTimeObj = toUtcDateTime(data.event_date, data.start_time);
  const endTimeObj = toUtcDateTime(data.event_date, data.end_time);
  event = await prisma.event.findFirst({
    where: {
      date: eventDateObj,
      event_status_id: 1,
      AND: [
        {
          OR: [
            { user_id: Number(client.id) },
            { users_events_user_idTousers: { id: Number(client.id) } },
          ],
        },
        {
          OR: [
            { venue_id: Number(venue?.id || data.venue_id || 0) },
            { venues: { id: Number(venue?.id || data.venue_id || 0) } },
          ],
        },
      ],
    },
    include: { venues: true, users_events_user_idTousers: true },
  });
  // if found update the event with new data and connect with client and venue
  if (event) {
    await eventSvc.update(event.id, {
      date: eventDateObj,
      start_time: startTimeObj,
      end_time: endTimeObj,
      deposit_amount: data.deposit_amount != null ? data.deposit_amount : null,
      details: data.event_details || null,
      dj_package_name: data.dj_package_name || null,
      total_cost_for_equipment:
        data.total_cost != null ? String(data.total_cost) : null,
      dj_cost_price_for_event:
        data.dj_cost != null ? Number(data.dj_cost) : null,
    });
    // connect with client and venue if not connected already
    if (!event.venues.some((v) => v.id === (venue?.id || data.venue_id))) {
      await eventSvc.connectVenue(event.id, venue?.id || data.venue_id);
    }
    if (!event.users_events_user_idTousers.some((u) => u.id === client.id)) {
      await eventSvc.connectClient(event.id, client.id);
    }
    event = await eventSvc.getEventById(event.id);
    // add an update note for the event
    try {
      await eventNoteService.createNote(prisma, {
        eventId: Number(event.id),
        notes: "Updated as an enquiry",
        created_by: req.user?.id || null,
      });
    } catch (e) {}
  }
  // if not then create new event and connect with client and venue
  if (!event) {
    const createPayload = {
      date: eventDateObj,
      start_time: startTimeObj,
      end_time: endTimeObj,
      deposit_amount: data.deposit_amount != null ? data.deposit_amount : null,
      details: data.event_details || null,
      dj_package_name: data.dj_package_name || null,
      total_cost_for_equipment:
        data.total_cost != null ? String(data.total_cost) : null,
      dj_cost_price_for_event:
        data.dj_cost != null ? Number(data.dj_cost) : null,
      venue_id: venue?.id || (data.venue_id ? Number(data.venue_id) : null),
      user_id: Number(client.id),
      created_by: req.user && req.user.id ? Number(req.user.id) : null,
      contract_token: uuidv4(),
      event_status_id: 1,
    };
    event = await eventSvc.create(createPayload);
    // add initial note for newly created enquiry
    try {
      await eventNoteService.createNote(prisma, {
        eventId: Number(event.id),
        notes: "Created as an enquiry",
        created_by: req.user?.id || null,
      });
    } catch (e) {}
  }

  // Persist equipment/extra packages and apply rig notes (accept arrays or map form-data)
  const normalizeArrayField = (obj, keys) => {
    for (const k of keys) {
      const field = obj[k];
      if (Array.isArray(field)) return field;
      if (field && typeof field === "object")
        return Object.keys(field).map((i) => field[i]);
    }
    return [];
  };

  const equipmentArray = normalizeArrayField(data, [
    "equipmentData",
    "equipment_data",
  ]);
  const extraArray = normalizeArrayField(data, ["extraData", "extra_data"]);
  const rigNotesArray = normalizeArrayField(data, [
    "rigNotesData",
    "rig_notes_data",
    "rigNotes_data",
    "rig_notesData",
  ]);

  const makePackage = (p) => ({
    equipment_id: p.equipment_id ? Number(p.equipment_id) : null,
    equipment_order_id:
      p.equipment_order_id !== undefined ? Number(p.equipment_order_id) : null,
    event_id: Number(event.id),
    package_type_id:
      p.package_type_id !== undefined ? Number(p.package_type_id) : null,
    sell_price: p.sell_price != null ? Number(p.sell_price) : null,
    cost_price: p.cost_price != null ? Number(p.cost_price) : null,
    notes: p.notes || null,
    rig_notes: p.rig_notes ?? p.rigNotes ?? null,
    payment_send: p.payment_send || null,
    payment_date: p.payment_date ? new Date(p.payment_date) : null,
    quantity: p.quantity != null ? Number(p.quantity) : null,
    total_price: p.total_price != null ? Number(p.total_price) : null,
    price_added_to_bill:
      p.price_added_to_bill != null ? Number(p.price_added_to_bill) : null,
    created_at: new Date(),
  });

  try {
    for (const p of equipmentArray) {
      const pkg = makePackage(p);
      await prisma.eventPackage.create({ data: pkg }).catch(() => {});
    }
    for (const p of extraArray) {
      const pkg = makePackage(p);
      await prisma.eventPackage.create({ data: pkg }).catch(() => {});
    }

    // apply rig notes to matching event packages
    for (const r of rigNotesArray) {
      const equipId = r.equipment_id ?? r.equipmentId ?? r.equipment;
      const notes =
        r.rig_notes ?? r.rigNotes ?? r.rig_note ?? r.rigNote ?? null;
      if (!equipId) continue;
      await prisma.eventPackage
        .updateMany({
          where: { event_id: Number(event.id), equipment_id: Number(equipId) },
          data: { rig_notes: notes },
        })
        .catch(() => {});
    }
  } catch (e) {}
  //use resend to send email to admin where role id == 2
  const admins = await prisma.user.findMany({
    where: { role_id: BigInt(2), is_email_send: true },
  });
  const adminEmails = admins.map((a) => a.email);
  await sendEmail({
    to: adminEmails,
    subject: "New Enquiry Created",
    html: `A new enquiry has been created with the following details:<br>
    Name: ${client.name}<br>
    Email: ${client.email}<br>
    Contact Number: ${client.contact_number}<br>
    Address: ${client.address}<br>
    Event Date: ${data.event_date}<br>
    Start Time: ${data.start_time}<br>
    End Time: ${data.end_time}<br>
    Deposit Amount: ${data.deposit_amount}<br>
    Event Details: ${data.event_details}<br>
    DJ Name: ${data.dj_name}<br>
    DJ Package Name: ${data.dj_package_name}<br>
    Total Cost: ${data.total_cost}<br>
    DJ Cost: ${data.dj_cost}<br>
    Venue: ${venue ? venue.venue : "N/A"}<br>
    Client: ${client.name} (${client.email})<br>
    `,
  }).catch(() => {});
  res.status(201).json(serializeForJson({ event, client, venue }));
});

// Open enquiry: list open enquiries (event_status_id = 1)
const listOpenEnquiries = catchAsync(async (req, res) => {
  // find events with status = 1 (open enquiries)
  const page = Number(req.query.page || req.query.p || 1) || 1;
  const perPage =
    Number(req.query.perPage || req.query.per_page || req.query.limit || 25) ||
    25;
  const skip = (page - 1) * perPage;

  // Use validated query params (Joi middleware) for sorting; Joi enforces allowed values
  const q = req.query || {};
  const sortField = q.sortBy || q.sort || 'date';
  const sortOrder = String(q.sortOrder || q.order || q.sort_order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const search = String(q.search || '').trim();
  // base where (open enquiries)
  const where = { event_status_id: 1 };
  if (search) {
    // search event usr_name, venue name, and linked user fields (name/email/contact_number)
    where.OR = [
      { usr_name: { contains: search } },
      // `venues` is a singular relation on Event — use `is` relation filter
      { venues: { is: { venue: { contains: search } } } },
      // `users_events_user_idTousers` is a singular relation on Event — use `is`
      {
        users_events_user_idTousers: {
          is: {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { contact_number: { contains: search } },
            ],
          },
        },
      },
    ];
  }
  const events = await eventSvc.list({
    filter: where,
    sort: `${sortField}:${sortOrder}`,
    page,
    perPage,
    select: {
      id: true,
      date: true,
      usr_name: true,
      brochure_emailed: true,
      called: true,
      send_media: true,
      quoted: true,
      venue_id: true,
      user_id: true,
      names_id: true,
      event_status_id: true,
      venues: { select: { id: true, venue: true } },
      users_events_user_idTousers: {
        select: { id: true, name: true, email: true, contact_number: true },
      },
    },
  });

  const eventIds = events.map((e) => e.id);

  // total count for pagination (use same where filter)
  const total = await eventSvc.model.count({ where });

  // bulk fetch packages and notes for those events
  const packages = eventIds.length
    ? await prisma.eventPackage.findMany({
        where: { event_id: { in: eventIds } },
        include: { equipment: true, package_types: true },
      })
    : [];
  const notes = eventIds.length
    ? await prisma.eventNote.findMany({
        where: { event_id: { in: eventIds } },
        orderBy: { id: "desc" },
      })
    : [];

  // attach packages and latest note
  const data = events.map((ev) => {
    const evPackages = packages.filter(
      (p) => Number(p.event_id) === Number(ev.id),
    );
    const evNotes = notes.filter((n) => Number(n.event_id) === Number(ev.id));
    return {
      ...ev,
      event_packages: evPackages,
      event_notes: evNotes,
      last_note: evNotes.length ? evNotes[0] : null,
    };
  });

  res.json(serializeForJson({ success: true, data, meta: { page, perPage, total } }));
});

const updateOpenEnquiry = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const id = Number(body.id || body.eventId || req.body.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "id_required" });

  const update = {};
  ["brochure_emailed", "called", "send_media", "quoted"].forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = !!body[k];
  });

  const updated = await prisma.event.update({ where: { id }, data: update });
  res.json(serializeForJson({ success: true, data: updated }));
});

// const sendQuote = catchAsync(async (req, res) => {
//   const body = req.validated || req.body || {};
//   const userId = Number(body.id || body.userId);
//   const details = Array.isArray(body.details) ? body.details : [];
//   if (!details.length)
//     return res.status(400).json({ error: "details_required" });

//   const eventId = Number(details[0].id);
//   const companyId = Number(body.companyNameId || body.companyId || 0) || null;

//   // fetch event VAT/amount fields
//   const event = await prisma.event.findUnique({ where: { id: eventId } });

//   // attach VAT and totals into the details as Laravel does
//   const enrichedDetails = details.map((d) => ({
//     ...d,
//     is_vat_available_for_the_event: event?.is_vat_available_for_the_event,
//     event_amount_without_vat: event?.event_amount_without_vat,
//     vat_value: event?.vat_value,
//     total_cost_for_equipment: event?.total_cost_for_equipment,
//   }));

//   const user = userId
//     ? await prisma.user.findUnique({ where: { id: userId } })
//     : null;
//   const to = user?.email || body.email;
//   const company = companyId
//     ? await prisma.companyName.findUnique({ where: { id: companyId } })
//     : null;
//   const companyName = company?.name || body.companyName || "";

//   // use email template for quote if available (SEND QUOTE-OPEN id = 3)
//   const template = await prisma.emailContent.findUnique({ where: { id: 3 } });
//   const subject = body.subject || template?.subject || "Quote";
//   let raw = body.body || template?.body || `Quote for event ${eventId}`;
//   // replace placeholder amount if provided
//   if (raw && body.amount)
//     raw = String(raw).replace("{--amount--}", String(body.amount));
//   const html = `${String(raw).replace(/\n/g, "<br>")}<hr/><pre>${JSON.stringify(enrichedDetails, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2)}</pre>`;

//   // update names_id on event if company provided and send email
//   const result = await prisma.$transaction(async (tx) => {
//     if (companyId)
//       await tx.event.update({
//         where: { id: eventId },
//         data: { names_id: companyId },
//       });
//     await sendEmail({ to, subject, html }).catch(() => {});
//     await eventNoteService.createNote(tx, {
//       eventId,
//       notes: `Quote sent - ${companyName}`,
//       created_by: req.user?.id || null,
//     });
//     return await tx.event.findUnique({ where: { id: eventId } });
//   });

//   res.json(serializeForJson({ message: "Quote sent", event: result }));
// });

const sendInvoice = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  const details = Array.isArray(body.details) ? body.details : [];
  if (!details.length)
    return res.status(400).json({ error: "details_required" });

  const eventId = Number(details[0].id);
  const companyId = Number(body.companyNameId || body.companyId || 0) || null;

  const event = await prisma.event.findUnique({ where: { id: eventId } });

  const enrichedDetails = details.map((d) => ({
    ...d,
    is_vat_available_for_the_event: event?.is_vat_available_for_the_event,
    event_amount_without_vat: event?.event_amount_without_vat,
    vat_value: event?.vat_value,
    total_cost_for_equipment: event?.total_cost_for_equipment,
  }));

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  const to = user?.email || body.email;
  const company = companyId
    ? await prisma.companyName.findUnique({ where: { id: companyId } })
    : null;
  const companyName = company?.name || body.companyName || "";

  // use email template for invoice if available (SEND INVOICE-OPEN id = 4)
  const template = await prisma.emailContent.findUnique({ where: { id: 4 } });
  const subject = body.subject || template?.subject || "Invoice";
  let raw = body.body || template?.body || `Invoice for event ${eventId}`;
  if (raw && body.amount)
    raw = String(raw).replace("{--amount--}", String(body.amount));
  const html = `${String(raw).replace(/\n/g, "<br>")}<hr/><pre>${JSON.stringify(enrichedDetails, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2)}</pre>`;

  const result = await prisma.$transaction(async (tx) => {
    if (companyId)
      await tx.event.update({
        where: { id: eventId },
        data: { names_id: companyId },
      });
    await sendEmail({ to, subject, html }).catch(() => {});
    await eventNoteService.createNote(tx, {
      eventId,
      notes: `Invoice Sent - ${companyName}`,
      created_by: req.user?.id || null,
    });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: "Invoice sent", event: result }));
});

const deleteOpenEnquiry = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number)
    : body.ids
      ? [Number(body.ids)]
      : [];
  const userId = Number(body.userId || body.user_id || 0) || null;
  if (!ids.length) return res.status(400).json({ error: "ids_required" });

  const result = await prisma.$transaction(async (tx) => {
    // remove activity_log entries if table exists — use raw SQL safely
    try {
      await tx.$executeRaw`DELETE FROM activity_log WHERE subject_id IN (${ids.join(",")}) AND log_name = 'a notes'`;
    } catch (e) {}

    const user = userId
      ? await tx.user.findUnique({ where: { id: userId } })
      : null;
    const userEventCount = user
      ? await tx.event.count({ where: { user_id: userId } })
      : 0;

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


const staffEquipment = catchAsync(async (req, res) => {
  // Accept staff/package/date from query, body or params for flexibility
  const staffId = Number(req.query.staff || req.body.staff || req.params.staff);
  const pkgName =
    req.query.package_name ||
    req.body.package_name ||
    req.params.package_name ||
    null;
  const eventDateRaw =
    req.query.event_date ||
    req.body.event_date ||
    req.params.event_date ||
    null;

  let checkDjAvailability = false;
  try {
    const eventSvc = services.get("event");
    const packageUserSvc = services.get("package_users");
    const equipmentSvc = services.get("equipment");

    if (staffId && pkgName && eventDateRaw) {
      const parts = String(eventDateRaw).split("-").map(Number);
      if (parts.length === 3) {
        const [d, m, y] = parts;
        const dateObj = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        const exists = await eventSvc.model.findFirst({
          where: {
            event_status_id: { in: [1, 2] },
            dj_id: staffId,
            dj_package_name: pkgName,
            date: dateObj,
          },
        });
        checkDjAvailability = !!exists;
      }
    }

    // Fetch package definition for this user/package via core CRUD
    var equipments = await packageUserSvc.model
      .findFirst({
        where: {
          user_id: staffId || undefined,
          package_name: pkgName || undefined,
        },
        include: {
          users: { select: { id: true, name: true, email: true } },
          package_user_properties: true,
          package_user_equipment: {
            include: {
              equipment: {
                include: {
                  equipment_properties: { include: { properties: true } },
                },
              },
            },
          },
        },
      })
      .catch(() => null);

    // compute equipment ids present in the package
    const equipmentIds =
      equipments && Array.isArray(equipments.package_user_equipment)
        ? equipments.package_user_equipment
            .map((p) => (p?.equipment?.id ? Number(p.equipment.id) : null))
            .filter(Boolean)
        : [];

    // extras = all active equipment not in package equipment list
    var extras = [];
    if (equipmentIds.length) {
      extras = await equipmentSvc.model
        .findMany({
          where: { id: { notIn: equipmentIds }, status: "ACTIVE" },
          include: { equipment_properties: { include: { properties: true } } },
          orderBy: { name: "asc" },
        })
        .catch(() => []);
    } else {
      extras = await equipmentSvc.model
        .findMany({
          where: { status: "ACTIVE" },
          include: { equipment_properties: { include: { properties: true } } },
          orderBy: { name: "asc" },
        })
        .catch(() => []);
    }
  } catch (e) {
    console.error(
      "[enquiryController] staffEquipment check failed",
      e?.message || e,
    );
  }

  res.json(
    serializeForJson({
      success: true,
      data: { equipments, extras, checkDjAvailability },
    }),
  );
});

const addNote = catchAsync(async (req, res) => {
  const event_id = req.params?.id
    ? Number(req.params.id)
    : req.query?.id
    ? Number(req.query.id)
    : req.query?.enquiry_id
    ? Number(req.query.enquiry_id)
    : req.body?.event_id
    ? Number(req.body.event_id)
    : req.body?.eventId
    ? Number(req.body.eventId)
    : null;
  const notes = req.body.note || req.body.notes || null;
  if (!event_id || !notes)
    return res.status(400).json({ error: "event id and note is required " });
  const created = await eventNoteService.createNote(prisma, {
    eventId: event_id,
    notes,
    created_by: req.user?.id || null,
  });
  res.json(serializeForJson({ success: true, data: created }));
});


const getEmail = catchAsync(async (req, res) => {
  const q = req.validated || req.query || req.body || {};
  const email_name = q.email_name || req.params?.email_name || null;
  const event_id = Number(q.event_id || q.id || req.params?.event_id || req.params?.id) || null;
  if (!email_name || !event_id) return res.status(400).json({ error: "email_name and event_id are required" });

  const [email, companies] = await Promise.all([
    prisma.emailContent.findFirst({ where: { email_name } }),
    companySvc.list({ select: { id: true, name: true } }),
  ]);

  if (!email) return res.status(404).json({ error: "Email not found" });

  res.json(serializeForJson({ success: true, data: { email, companies } }));
});

const sendBrochure = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const eventId = Number(body.eventId || body.event_id || body.id || req.query.event_id || req.params.id) || null;
  const companyIdRaw = body.companyNameId || body.companyId || body.company_name_id || null;

  if (!eventId) return res.status(400).json({ error: 'event_id_required' });

  // fetch event + client email
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: { select: { email: true } } },
  });

  const clientEmail = event?.users_events_user_idTousers?.email || body.email;
  if (!clientEmail) return res.status(400).json({ error: 'client_email_not_found' });

  // resolve company (provided id preferred, else event.names_id)
  let company = null;
  const cid = companyIdRaw != null ? Number(companyIdRaw) : null;
  if (cid) {
    try {
      company = await prisma.companyName.findUnique({ where: { id: BigInt(cid) } });
    } catch (e) {
      company = null;
    }
  }
  if (!company && event?.names_id) {
    try {
      company = await prisma.companyName.findUnique({ where: { id: BigInt(Number(event.names_id)) } });
    } catch (e) {
      company = null;
    }
  }
  if (!company) return res.status(400).json({ error: 'company_not_found' });

  // prepare email (prefer request body, fall back to EMAIL BROCHURE template id=1)
  const template = await prisma.emailContent.findFirst({ where: { email_name: "EMAIL BROCHURE" } }).catch(() => null);
  const subject = body.subject || template?.subject || 'Brochure';
  const raw = body.body || template?.body || '';
  let brochureUrl = null;
  if (company.brochure) {
    try {
      brochureUrl = await getSignedGetUrl(String(company.brochure));
    } catch (e) {
      brochureUrl = null;
    }
  }

  const htmlParts = [];
  if (raw) htmlParts.push(String(raw).replace(/\n/g, '<br>'));
  if (brochureUrl) htmlParts.push(`<p><a href="${brochureUrl}">Download Brochure</a></p>`);
  const html = htmlParts.join('\n\n') || `Brochure for event ${eventId}`;

  await sendEmail({ to: clientEmail, subject, html }).catch((e) => {
    console.error('[sendBrochure] sendEmail failed', e?.message || e);
  });

  const noteText = `Brochure Email Sent - ${company?.name || ''}`;
  const createdEvent = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, { eventId, notes: noteText, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  const latestNote = await prisma.eventNote.findFirst({ where: { event_id: eventId }, orderBy: { id: 'desc' } });

  res.json(serializeForJson({ message: 'Brochure Email sent', event: createdEvent, eventNote: latestNote || null }));
});

const sendUpdateEmail = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const eventId = Number(body.eventId || body.event_id || body.id || req.query.event_id || req.params.id) || null;
  const companyIdRaw = body.companyNameId || body.companyId || body.company_name_id || null;
  if (!eventId) return res.status(400).json({ error: 'event_id_required' });
  if (!companyIdRaw) return res.status(400).json({ error: 'company_id_required' });
  // fetch event + client email
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: { select: { email: true } } },
  });
  const clientEmail = event?.users_events_user_idTousers?.email || body.email;
  if (!clientEmail) return res.status(400).json({ error: 'client_email_not_found' });

  // resolve company
  let company = null;
  const cid = Number(companyIdRaw) || null;
  if (cid) {
    try {
      company = await prisma.companyName.findUnique({ where: { id: BigInt(cid) } });
    } catch (e) {
      company = null;
    }
  }
  if (!company && event?.names_id) {
    try {
      company = await prisma.companyName.findUnique({ where: { id: BigInt(Number(event.names_id)) } });
    } catch (e) {
      company = null;
    }
  }
  if (!company) return res.status(400).json({ error: 'company_not_found' });

  // prepare email (prefer provided body.body, fallback to template id=2)
  const template = await prisma.emailContent.findUnique({ where: { email_name: "EMAIL FOR UPDATE" } }).catch(() => null);
  const subject = body.subject || template?.subject || 'Update';
  const raw = body.body || template?.body || `Update for event ${eventId}`;
  const html = String(raw).replace(/\n/g, '<br>');

  await sendEmail({ to: clientEmail, subject, html }).catch((e) => {
    console.error('[sendUpdateEmail] sendEmail failed', e?.message || e);
  });

  const noteText = `Update Email Sent - ${company?.name || ''}`;
  const createdEvent = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, { eventId, notes: noteText, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  const latestNote = await prisma.eventNote.findFirst({ where: { event_id: eventId }, orderBy: { id: 'desc' } });

  res.json(serializeForJson({ message: 'Update Email sent', event: createdEvent, eventNote: latestNote || null }));
});

const sendQuote = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId);
  let details = Array.isArray(body.details) ? body.details : [];
  const event_id = body.event_id;
  const company_id = body.company_name_id;
  // if (!details.length) return res.status(400).json({ error: "details_required" });

  const eventId = Number(event_id);
  const companyId = Number(company_id) || null;

  // fetch event VAT/amount fields
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  // if details not provided, load event packages for the event and build details
  if (!details.length) {
    try {
      const pkgs = await prisma.eventPackage.findMany({
        where: { event_id: eventId },
        include: { equipment: true, package_types: true },
      });
      details = pkgs.map((p) => ({
        id: eventId,
        event_package_id: p.id,
        equipment_id: p.equipment_id,
        package_type_id: p.package_type_id,
        quantity: p.quantity || 1,
        sell_price: p.sell_price ?? p.total_price ?? null,
        total_price: p.total_price ?? null,
        notes: p.notes || null,
        rig_notes: p.rig_notes || null,
        equipment: p.equipment ? { id: p.equipment.id, name: p.equipment.name, sell_price: p.equipment.sell_price } : null,
        package_type: p.package_types ? { id: p.package_types.id, name: p.package_types.name } : null,
      }));
    } catch (e) {
      details = [];
    }
  }

  // attach VAT and totals into the details from the event record
  const enrichedDetails = details.map((d) => ({
    ...d,
    is_vat_available_for_the_event: event?.is_vat_available_for_the_event,
    event_amount_without_vat: event?.event_amount_without_vat,
    vat_value: event?.vat_value,
    total_cost_for_equipment: event?.total_cost_for_equipment,
  }));

  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const to = user?.email || body.email;
  const company = companyId ? await prisma.companyName.findUnique({ where: { id: companyId } }) : null;
  const companyName = company?.name || body.companyName || "";

  // use email template for quote if available (SEND QUOTE-OPEN id = 3)
  const template = await prisma.emailContent.findFirst({ where: { email_name: "SEND QUOTE-OPEN" } }).catch(() => null);
  const subject = body.subject || template?.subject || "Quote";
  let raw = body.body || template?.body || `Quote for event ${eventId}`;
  if (raw && event.deposit_amount) raw = String(raw).replace("{--amount--}", String(event.deposit_amount));

  // fetch full event details for parity with Laravel email
  const fullEvent = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: true, venues: true },
  }).catch(() => null);

  const first_name = (details[0]?.user?.name) || fullEvent?.users_events_user_idTousers?.name || "Client";
  const contract_token = details[0]?.contract_token || fullEvent?.contract_token || null;

  const companyDetails = {
    company_logo: company?.company_logo || company?.logo || company?.brochure || null,
    name: company?.name || "",
    vat: company?.vat ?? null,
    vat_percentage: company?.vat_percentage ?? null,
    contact_name: company?.contact_name || company?.contact || null,
    address_name: company?.address_name || null,
    street: company?.street || null,
    city: company?.city || null,
    postal_code: company?.postal_code || null,
    telephone_number: company?.telephone_number || company?.telephone || null,
    email: company?.email || null,
    website: company?.website || null,
    instagram: company?.instagram || null,
    facebook: company?.facebook || null,
  };

  // format event date for subject similar to Laravel
  const eventDateRaw = details[0]?.date || fullEvent?.date || null;
  let eventDateFormatted = "";
  try {
    if (eventDateRaw) {
      const d = new Date(eventDateRaw);
      eventDateFormatted = `${d.getDate()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}`;
    }
  } catch (e) {}
  const finalSubject = body.subject || template?.subject || `Quote : ${eventDateFormatted || ''}`;

  // Render using the Laravel Blade HTML structure translated to Node
  const renderedBodyHtml = raw ? (function(){ try { return marked(String(raw)); } catch(e){ return String(raw).replace(/\n/g, '<br>'); } })() : '';
  const emailHtml = renderSendQuote({ first_name, body: raw || renderedBodyHtml, companyDetails, contract_token, enrichedDetails, event });
  // Build emailHtml and printable HTML for PDF (already rendered above)
  const subjectToUse = finalSubject;

  // generate PDF buffer from the same HTML (print-friendly)
  let pdfBuffer = null;
  try {
    pdfBuffer = await generatePdfBufferFromHtml(emailHtml);
  } catch (e) {
    console.error('[sendQuote] PDF generation failed', e?.message || e);
  }

  // upload PDF to S3 and get signed link
  let pdfKey = null;
  let pdfUrl = null;
  if (pdfBuffer) {
    const key = `quotes/${eventId}-${Date.now()}.pdf`;
    try {
      await uploadStreamToS3(pdfBuffer, key, 'application/pdf');
      pdfKey = key;
      pdfUrl = await getSignedGetUrl(key);
    } catch (e) {
      console.error('[sendQuote] PDF upload failed', e?.message || e);
      pdfBuffer = null;
    }
  }

  // update names_id on event if company provided, send email with link
  const result = await prisma.$transaction(async (tx) => {
    if (companyId)
      await tx.event.update({ where: { id: eventId }, data: { names_id: companyId, contract_pdf_url: pdfUrl || undefined } });
    const finalHtml = pdfUrl ? `${emailHtml}<p><a href="${pdfUrl}">Download Quote (PDF)</a></p>` : emailHtml;
    if (to) await sendEmail({ to, subject: subjectToUse, html: finalHtml }).catch(() => {});
    await eventNoteService.createNote(tx, { eventId, notes: `Quote sent - ${companyName}`, created_by: req.user?.id || null });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ message: "Quote sent", event: result, pdfUrl: pdfUrl || null }));
});


// Confirm open enquiry: create payment + invoice + set event as confirmed
const confirmEvent = catchAsync(async (req, res) => {
  console.log()
  const body = req.validated || req.body || {};
  const eventId = Number(req.params.id);
  // accept `company_name` (id) per new request shape, fall back to names_id
  const namesId = Number(body.company_name || body.names_id || 0) || null;
  const depositAmount = Number(body.deposit_amount ?? body.amount ?? 0) || 0;
  const paymentData = {
    event_id: eventId,
    payment_method_id: Number(body.payment_method_id),
    date: body.date ? new Date(body.date) : new Date(),
    amount: depositAmount,
    created_at: new Date(),
  };

  const result = await prisma.$transaction(async (tx) => {
    // create payment
    const payment = await tx.eventPayment.create({ data: paymentData });

    // ensure unique invoice number
    let invoiceNumber;
    do {
      invoiceNumber = String(Math.floor(Math.random() * 99999) + 1).padStart(
        5,
        "0",
      );
      // check existing invoice (invoice stored as Int in DB)
      // parse to number for comparison
      // use findFirst to check existence
      var existing = await tx.event.findFirst({
        where: { invoice: Number(invoiceNumber) },
      });
    } while (existing);

    // update event: set invoice, status=2, names_id and deposit if provided
    const eventUpdateData = {
      invoice: Number(invoiceNumber),
      event_status_id: 2,
    };
    if (namesId) eventUpdateData.names_id = namesId;
    if (depositAmount) eventUpdateData.deposit_amount = depositAmount;
    // if an event_date was provided, convert to DB date and set
    try {
      if (body.event_date) {
        const dt = toDbDate(body.event_date);
        if (dt) eventUpdateData.date = new Date(dt);
      }
    } catch (e) {}

    await tx.event.update({ where: { id: eventId }, data: eventUpdateData });

    // load event packages similar to Laravel
    const eventPackages = await tx.eventPackage.findMany({
      where: { event_id: eventId, package_type_id: { in: [1, 2] } },
      select: {
        id: true,
        event_id: true,
        equipment_id: true,
        package_type_id: true,
        sell_price: true,
        total_price: true,
        price_added_to_bill: true,
        quantity: true,
        notes: true,
        equipment: {
          select: {
            id: true,
            name: true,
            sell_price: true,
            equipment_properties: { include: { properties: true } },
          },
        },
      },
    });

    // VAT calculation based on CompanyName (namesId)
    const company = await tx.companyName
      .findUnique({ where: { id: BigInt(namesId) } })
      .catch(() => null);
    // note: company model id is BigInt in prisma; guard absence
    if (company && company.vat != null) {
      const vatPercentage = company.vat_percentage
        ? Number(company.vat_percentage) / 100.0
        : 0;
      const totalCost = await tx.event.findUnique({
        where: { id: eventId },
        select: { total_cost_for_equipment: true },
      });
      const totalCostNum =
        totalCost && totalCost.total_cost_for_equipment
          ? Number(totalCost.total_cost_for_equipment)
          : 0;
      const totalWithVat = totalCostNum * (1 + vatPercentage);
      const vatValue = totalCostNum * vatPercentage;
      await tx.event.update({
        where: { id: eventId },
        data: {
          total_cost_for_equipment: String(totalWithVat),
          event_amount_without_vat: String(totalCostNum),
          vat_value: String(vatValue),
          is_vat_available_for_the_event: true,
        },
      });
    } else {
      await tx.event.update({
        where: { id: eventId },
        data: { is_vat_available_for_the_event: false },
      });
    }

    // activity log placeholder: skipped (not present in Node)

    // create note 'Confirmed as an event'
    await eventNoteService.createNote(tx, {
      eventId,
      notes: "Confirmed as an event",
      created_by: req.user?.id || null,
    });

    // recalc payments and mark fully paid
    const totalPaymentRow = await tx.eventPayment.aggregate({
      where: { event_id: eventId },
      _sum: { amount: true },
    });
    const totalPayment = totalPaymentRow._sum.amount || 0;
    const totalCostRow = await tx.event.findUnique({
      where: { id: eventId },
      select: { total_cost_for_equipment: true },
    });
    const totalCostNum =
      totalCostRow && totalCostRow.total_cost_for_equipment
        ? Number(totalCostRow.total_cost_for_equipment)
        : 0;
    const paymentSent = totalPayment === totalCostNum ? true : false;
    await tx.event.update({
      where: { id: eventId },
      data: { is_event_payment_fully_paid: paymentSent },
    });

    // fetch payment method name
    const paymentWithMethod = await tx.eventPayment.findUnique({
      where: { id: payment.id },
      include: { payment_methods: true },
    });

    // fetch latest event note
    const eventNotes = await tx.eventNote.findMany({
      where: { event_id: eventId },
      orderBy: { id: "desc" },
      take: 1,
    });

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

  // Try to create a calendar event in Microsoft Graph (best-effort).
  try {
    // load event details
    const event = await prisma.event.findUnique({
      where: { id: Number(result.event_id) },
      include: { users_events_user_idTousers: true, venues: true },
    });
    if (event) {
      const startIso = event.start_time
        ? new Date(event.start_time).toISOString()
        : event.date
          ? new Date(event.date).toISOString()
          : null;
      const endIso = event.end_time
        ? new Date(event.end_time).toISOString()
        : event.date
          ? new Date(event.date).toISOString()
          : null;
      const subject = `USRMusic Event #${event.id} - ${event.users_events_user_idTousers?.name || "Client"}`;
      const content = event.details || "";
      const location = event.venues?.venue || "";

      const created = await microsoftGraph
        .createEvent({ subject, content, startIso, endIso, location })
        .catch(() => null);
      if (created && created.id) {
        // add an event note recording the external calendar id so we can find it later
        await eventNoteService
          .createNote(prisma, {
            eventId: event.id,
            notes: `CalendarEventId: ${created.id}`,
            created_by: req.user?.id || null,
          })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.error(
      "[enquiryController] microsoft graph create failed",
      e?.message || e,
    );
  }
  console.log("hello");
  // Send invoice/confirmation emails to client and admins (parity with Laravel)
  try {
    const event = await prisma.event.findUnique({
      where: { id: Number(result.event_id) },
      include: { users_events_user_idTousers: true, venues: true },
    });
    const user = event?.users_events_user_idTousers || null;

    // Load email template for confirmed invoice (fallback to generic)
    const template = await prisma.emailContent
      .findFirst({ where: { email_name: "SEND INVOICE-CONFIRMED" } })
      .catch(() => null);

    const subject = template?.subject || `Invoice for event #${event?.id}`;
    const bodyText = template?.body || `Your event has been confirmed.`;

    // company details
    let companyDetails = null;
    if (result.names_id) {
      companyDetails =
        (await prisma.companyName.findUnique({
          where: { id: BigInt(result.names_id) },
        }).catch(() => null)) || null;
    }

    const makeCompanyHtml = (c) => {
      if (!c) return "";
      const logo = c.company_logo
        ? `<img src="${process.env.APP_URL || ""}public/storage/images/${c.company_logo}" style="max-width:100px;" alt="Logo" />`
        : "";
      const addr = [c.address_name, c.street, c.city, c.postal_code]
        .filter(Boolean)
        .join("<br />");
      const contact = [];
      if (c.telephone_number) contact.push(`<strong>Telephone</strong> ${c.telephone_number}`);
      if (c.email) contact.push(`<strong>Email</strong> <a href="mailto:${c.email}">${c.email}</a>`);
      if (c.website) contact.push(`<strong>Website</strong> ${c.website}`);
      return `<div>${logo}<div>${addr}</div><div>${contact.join("<br />")}</div></div>`;
    };

    // render Blade-like HTML for client using renderer
    const firstName = user?.name || "Client";
    const clientHtml = renderConfirmedEvent({ first_name: firstName, body: bodyText, companyDetails: companyDetails || {} });
    if (user && user.email) {
      await sendEmail({ to: [user.email], subject, html: clientHtml }).catch(() => {});
    }

    // notify admins (role_id = 2) who have email enabled
    const admins = await prisma.user.findMany({
      where: { role_id: BigInt(2), is_email_send: true },
    });
    const adminEmails = admins.map((a) => a.email).filter(Boolean);
    if (adminEmails.length) {
      const adminHtml = `
        <p>Event #${event?.id} has been confirmed.</p>
        <p>Invoice: ${result.invoice_number || "N/A"}</p>
        <p>Amount Paid: ${result.amount || 0}</p>
      `;
      await sendEmail({
        to: adminEmails,
        subject: `Event Confirmed - #${event?.id}`,
        html: adminHtml,
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[enquiryController] send confirm emails failed", e?.message || e);
  }

  res.json(serializeForJson({ success: true, data: result }));
});

const sendEventConfirmationEmail = catchAsync(async (req, res) => {
  // payload may be nested under `body` when validated by Joi
  const payload = (req.validated && req.validated.body)
    ? req.validated.body
    : (req.body && req.body.body)
    ? req.body.body
    : req.body || {};

  const event_id = Number(payload.event_id || req.params.id || payload.id);
  const bodyText = String(payload.body || "");
  const subject = String(payload.subject || `Event #${event_id} Confirmation`);
  const companyId = payload.company_name_id ? Number(payload.company_name_id) : null;

  if (!event_id) return res.status(400).json({ error: "event_id_required" });

  const event = await prisma.event.findUnique({
    where: { id: event_id },
    include: { users_events_user_idTousers: true, venues: true },
  });

  if (!event) return res.status(404).json({ error: "event_not_found" });

  const user = event.users_events_user_idTousers || null;
  const to = user?.email || payload.email || null;

  let companyDetails = null;
  if (companyId) {
    companyDetails = await prisma.companyName.findUnique({ where: { id: BigInt(companyId) } }).catch(() => null);
  }

  const firstName = user?.name || "Client";
  const clientHtml = renderConfirmedEvent({ first_name: firstName, body: bodyText, companyDetails: companyDetails || {} });

  try {
    if (to) await sendEmail({ to: [to], subject, html: clientHtml }).catch(() => {});
  } catch (e) {
    console.error('[sendEventConfirmationEmail] sendEmail failed', e?.message || e);
  }

  // create store note
  await eventNoteService.createNote(prisma, {
    eventId: event_id,
    notes: `Email Sent - ${companyDetails?.name || ''}`,
    created_by: req.user?.id || null,
  }).catch(() => {});

  const latestNote = await prisma.eventNote.findFirst({ where: { event_id }, orderBy: { id: 'desc' } }).catch(() => null);

  const userData = user ? { name: user.name, email: user.email } : null;

  res.json(serializeForJson({ success: true, data: userData, eventNotes: latestNote || null }));
});


export default {
  listOpenEnquiries,
  createEnquiry,
  updateOpenEnquiry,
  sendQuote,
  sendInvoice,
  deleteOpenEnquiry,
  confirmEvent,
  staffEquipment,
  addNote,
  getEmail,
  sendBrochure,
  sendUpdateEmail,
  sendEventConfirmationEmail
};
