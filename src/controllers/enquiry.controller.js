import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";
import { toDbDate } from "../utils/dateUtils.js";
import sendEmail from "../utils/mail/resendClient.js";
import { getSignedGetUrl, uploadStreamToS3 } from "../utils/s3Client.js";
import { generateQuotePdf } from "../utils/pdfGenerator.js";
import { buildUsrLetterEmail } from "../utils/mail/templates/usrLetterShell.js";
import eventNoteService from "../services/eventNoteService.js";
import services from "../services/index.js";
import genPassword from "../utils/genPassword.js";
import userService from "../services/userService.js";
import bcrypt from "bcrypt";
import microsoftGraph from "../utils/microsoftGraph.js";
import { parseTimeToUtcDate, parsePaginationParams } from "../utils/helpers.js";
import { toMoney, round2, isFullyPaid } from "../utils/money.js";
import { logActivity } from "../utils/activityLogger.js";

const userSvc = services.get("user");
const venueSvc = services.get("venue");
const eventSvc = services.get("event");
const companySvc = services.get("CompanyName");

// Ensure the package_types FK rows exist (1=BASIC, 2=EXTRAS). Laravel seeds
// these via PackageTypeSeeder; guarantee parity so event_package inserts that
// set package_type_id can't fail the foreign key. Idempotent.
async function ensurePackageTypes(client) {
  try {
    const existing = await client.packageType.findMany({
      where: { id: { in: [BigInt(1), BigInt(2)] } },
      select: { id: true },
    });
    const have = new Set(existing.map((r) => Number(r.id)));
    if (!have.has(1))
      await client.packageType
        .create({ data: { id: BigInt(1), type: "BASIC", created_at: new Date() } })
        .catch(() => {});
    if (!have.has(2))
      await client.packageType
        .create({ data: { id: BigInt(2), type: "EXTRAS", created_at: new Date() } })
        .catch(() => {});
  } catch (e) {
    console.error("[ensurePackageTypes] failed", e?.code, e?.message);
  }
}

const createEnquiry = catchAsync(async (req, res) => {
  const data = req.body;
  let venue = null;
  let client = null;
  let event = null;
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
    return res.status(400).json({ error: "venue_required" });

  // Step 2: Resolve client by ID or create/find by email
  const isNewClientCreation = data.is_new_client === true || data.is_new_client === "true";
  const providedClientId = data.client_id ? Number(data.client_id) : null;

  // If client_id is provided, use that client directly
  if (providedClientId) {
    client = await prisma.user.findUnique({ where: { id: providedClientId } });
    if (!client) {
      return res.status(404).json({ error: "client_not_found" });
    }
    const isClientRole = client.role_id === BigInt(4) || String(client.role_id) === "4";
    if (!isClientRole) {
      return res.status(400).json({ error: "This email is already attached with Dj" });
    }
  } else {
    // If is_new_client = true, email must NOT exist
    const existingByEmail = await userService.getUserByEmail(data.email);
    
    if (isNewClientCreation) {
      if (existingByEmail) {
        return res.status(400).json({ error: "Email Is Already In Use" });
      }
      // Create new client
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
        created_by: req.user?.id || null,
      });
    } else {
      // If is_new_client = false, try to find/reuse existing or create if not found
      if (existingByEmail) {
        const isClientRole = existingByEmail.role_id === BigInt(4) || String(existingByEmail.role_id) === "4";
        
        if (!isClientRole) {
          return res.status(400).json({ error: "This email is already attached with Dj" });
        }
        
        // Restore deleted client or use existing active client
        if (existingByEmail.deleted_at) {
          await userSvc.updateUser(existingByEmail.id, { deleted_at: null });
        }
        client = existingByEmail;
      } else {
        // Create new client if not found
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
          created_by: req.user?.id || null,
        });
      }
    }
  }
  // find the existing event by client, venue and date (open enquiries only)
  const eventDateDb = toDbDate(data.event_date);
  const eventDateObj = eventDateDb ? new Date(eventDateDb) : null;
  const startTimeObj = parseTimeToUtcDate(eventDateObj, data.start_time);
  const endTimeObj = parseTimeToUtcDate(eventDateObj, data.end_time);
  // resolve DJ id from provided dj_name (or accept dj_id if provided)
  let djId = null;
  try {
    if (data.dj_id) {
      djId = Number(data.dj_id);
    } else if (data.dj_name) {
      const djUser = await prisma.user
        .findFirst({ where: { name: data.dj_name } })
        .catch(() => null);
      if (djUser && djUser.id) djId = Number(djUser.id);
    }
  } catch (e) {
    djId = null;
  }
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
      event_type: data.event_type || null,
      dj_id: djId != null ? djId : undefined,
      is_vat_available_for_the_event: true,
      // round2 defends against float drift accumulated by the frontend's
      // unrounded running-total sum (unit*qty added across every line item) —
      // without it, a value like 129.99999999999997 gets written verbatim to
      // this VARCHAR column and later printed on an invoice.
      total_cost_for_equipment:
        data.total_cost != null ? String(round2(data.total_cost)) : null,
      dj_cost_price_for_event:
        data.dj_cost != null ? round2(data.dj_cost) : null,
      no_of_guests:
        data.no_of_guests != null ? String(data.no_of_guests) : null,
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
      event_type: data.event_type || null,
      dj_id: djId != null ? djId : null,
      is_vat_available_for_the_event: true,
      total_cost_for_equipment:
        data.total_cost != null ? String(round2(data.total_cost)) : null,
      dj_cost_price_for_event:
        data.dj_cost != null ? round2(data.dj_cost) : null,
      venue_id: venue?.id || (data.venue_id ? Number(data.venue_id) : null),
      user_id: Number(client.id),
      created_by: req.user && req.user.id ? Number(req.user.id) : null,
      contract_token: uuidv4(),
      event_status_id: 1,
      no_of_guests:
        data.guestCount != null
          ? String(data.guestCount)
          : data.no_of_guests != null
            ? String(data.no_of_guests)
            : null,
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

  // packageTypeId: 1 = basics, 2 = extras (matches Laravel NewEnquiryController::store).
  // Derived from which array the item came from — never from the payload.
  // package_type_id and equipment_id are BigInt FKs in the schema → pass BigInt.
  const makePackage = (p, packageTypeId) => ({
    equipment_id: p.equipment_id != null ? BigInt(Number(p.equipment_id)) : null,
    equipment_order_id:
      p.equipment_order_id !== undefined ? Number(p.equipment_order_id) : null,
    event_id: Number(event.id),
    package_type_id: packageTypeId != null ? BigInt(packageTypeId) : null,
    // round2 on every price field for the same reason as updateEnquiry's
    // makePackage — frontend-supplied per-line-item prices feed straight into
    // invoices and dashboard aggregation.
    sell_price: p.sell_price != null ? round2(p.sell_price) : null,
    cost_price: p.cost_price != null ? round2(p.cost_price) : null,
    notes: packageTypeId === 2 ? (p.notes?.toString().trim() || null) : null,
    rig_notes: (p.rig_notes ?? p.rigNotes)?.toString().trim() || null,
    payment_send: p.payment_send || null,
    payment_date: p.payment_date ? new Date(p.payment_date) : null,
    quantity: p.quantity != null ? Number(p.quantity) : null,
    total_price: p.total_price != null ? round2(p.total_price) : null,
    price_added_to_bill:
      p.price_added_to_bill != null ? round2(p.price_added_to_bill) : null,
    created_at: new Date(),
  });

  try {
    // Ensure the package_types FK rows (1=BASIC, 2=EXTRAS) exist so inserts
    // that set package_type_id can't fail the foreign key. Idempotent.
    await ensurePackageTypes(prisma);

    // remove existing event packages before recreating — without this,
    // resubmitting the same enquiry form (which re-enters the "update
    // existing open enquiry" branch above) doubles every equipment/extra
    // line item on each resubmission. Matches updateEnquiry's
    // delete-before-recreate pattern. Safe no-op for newly-created events.
    await prisma.eventPackage
      .deleteMany({ where: { event_id: Number(event.id) } })
      .catch(() => {});

    const insertedEquipIds = new Set();
    for (const p of equipmentArray) {
      const pkg = makePackage(p, 1); // basics → package_type_id 1
      if (pkg.equipment_id == null) continue;
      try {
        await prisma.eventPackage.create({ data: pkg });
        insertedEquipIds.add(Number(pkg.equipment_id));
      } catch (e) {
        console.error(
          "[createEnquiry] basic package insert failed",
          e?.code,
          e?.message,
        );
      }
    }
    for (const p of extraArray) {
      const pkg = makePackage(p, 2); // extras → package_type_id 2
      if (pkg.equipment_id == null) continue;
      try {
        await prisma.eventPackage.create({ data: pkg });
        insertedEquipIds.add(Number(pkg.equipment_id));
      } catch (e) {
        console.error(
          "[createEnquiry] extra package insert failed",
          e?.code,
          e?.message,
        );
      }
    }

    // apply rig notes — only to rows we just created this request
    for (const r of rigNotesArray) {
      const equipId = Number(r.equipment_id ?? r.equipmentId ?? r.equipment);
      const notes =
        (r.rig_notes ?? r.rigNotes ?? r.rig_note ?? r.rigNote)
          ?.toString()
          .trim() || null;
      if (!Number.isFinite(equipId) || !insertedEquipIds.has(equipId)) continue;
      await prisma.eventPackage
        .updateMany({
          where: { event_id: Number(event.id), equipment_id: BigInt(equipId) },
          data: { rig_notes: notes },
        })
        .catch((e) =>
          console.error("[createEnquiry] rig_notes update failed", e?.code, e?.message),
        );
    }
  } catch (e) {
    console.error("[createEnquiry] package persistence error", e?.code, e?.message);
  }

  await logActivity(prisma, {
    log_name: "enquiry created",
    description: `Enquiry created for event #${Number(event.id)}`,
    subject_type: "Event",
    subject_id: Number(event.id),
    causer_id: req.user?.id || null,
    properties: {
      client_name: client?.name || null,
      venue_id: venue?.id != null ? Number(venue.id) : data.venue_id != null ? Number(data.venue_id) : null,
      ...(djId != null ? { dj_id: Number(djId) } : {}),
      total_cost: data.total_cost != null ? data.total_cost : null,
    },
  });

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
  const wantsAll =
    String(req.query.perPage || "").toLowerCase() === "all" ||
    String(req.query.limit || "").toLowerCase() === "all";
  // parsePaginationParams caps at 100 (the sane default for every other
  // list endpoint) — bypass it here only when the frontend's "All" option
  // was explicitly chosen, capped at 1000 as a backstop against an
  // unbounded query.
  const { page, limit: perPage } = wantsAll
    ? { page: 1, limit: 1000 }
    : parsePaginationParams({
        page: req.query.page || req.query.p,
        perPage: req.query.perPage || req.query.per_page || req.query.limit,
        limit: req.query.limit,
      });
  const skip = (page - 1) * perPage;

  // Use validated query params (Joi middleware) for sorting; Joi enforces allowed values
  const q = req.query || {};
  const sortField = q.sortBy || q.sort || "date";
  const sortOrder =
    String(q.sortOrder || q.order || q.sort_order || "asc").toLowerCase() ===
    "desc"
      ? "desc"
      : "asc";
  const search = String(q.search || "").trim();
  // base where (open enquiries)
  const where = { event_status_id: 1 };
  if (search) {
    // search event usr_name, venue name, event details, and linked user
    // fields (name/email/contact_number) — the frontend's placeholder promises
    // "name, mobile, or event details", so `details` has to be in this OR too.
    where.OR = [
      { usr_name: { contains: search } },
      { details: { contains: search } },
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

  // Status filter — "status" isn't a stored column on this page (every row is
  // event_status_id=1); it's derived from the called/quoted flags, same
  // derivation the frontend's Status column uses. Translated into a real
  // where-clause here so filtering happens in SQL, not by fetching everything
  // and filtering in JS.
  const statusFilter = String(q.status || "").trim().toLowerCase();
  // `called`/`quoted` are nullable booleans — 19 of 22 real rows are NULL, not
  // false, and Prisma's `{ not: true }` compiles to SQL `<> true`, which never
  // matches NULL (SQL comparisons against NULL are neither true nor false).
  // Verified live: that naive form returned 0 rows for "new" instead of the
  // real 19. `OR` has to sit at the where-clause level as a sibling condition
  // (a nested `{ quoted: { OR: [...] } }` isn't valid Prisma), so "not
  // quoted"/"not called" are appended to `where.AND` instead of assigned
  // directly to `where.quoted`/`where.called`.
  const notTrue = (field) => ({ OR: [{ [field]: null }, { [field]: false }] });
  const statusAnd = [];
  if (statusFilter === "quoted") {
    where.quoted = true;
  } else if (statusFilter === "open") {
    where.called = true;
    statusAnd.push(notTrue("quoted"));
  } else if (statusFilter === "new") {
    statusAnd.push(notTrue("called"), notTrue("quoted"));
  }
  if (statusAnd.length) {
    where.AND = [...(where.AND || []), ...statusAnd];
  }

  // Event Type filter — dj_package_name is a real, already-selected column;
  // exact match against one of the distinct values the frontend already shows.
  const eventType = String(q.event_type || "").trim();
  if (eventType) {
    where.dj_package_name = eventType;
  }

  // Staff/DJ only sees enquiries they're assigned to or created — the
  // Node app's own addition, not present in the legacy Laravel CRM (its
  // OpenEnquiryService returns every event unscoped, verified against
  // OpenEnquiryService.php). Admin/Super Admin still sees everything.
  {
    const sub = req.user && (req.user.sub || req.user.id || req.user.email);
    let requesterId = null;
    if (typeof sub === "number" || /^[0-9]+$/.test(String(sub))) requesterId = Number(sub);
    if (!requesterId && req.user && req.user.email) {
      const uu = await prisma.user.findUnique({ where: { email: String(req.user.email) }, select: { id: true } });
      if (uu) requesterId = Number(uu.id);
    }
    if (requesterId) {
      const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { role_id: true } });
      if (requester && Number(requester.role_id) === 3) {
        where.AND = [...(where.AND || []), { OR: [{ dj_id: requesterId }, { created_by: requesterId }] }];
      }
    }
  }

  const events = await eventSvc.list({
    filter: where,
    sort: `${sortField}:${sortOrder}`,
    page,
    perPage,
    select: {
      id: true,
      details: true,
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
      // Needed for the Open Enquiry redesign's Package column and
      // Amount/Payment-status panel section — both genuinely stored fields,
      // just not previously selected here.
      dj_package_name: true,
      event_type: true,
      deposit_amount: true,
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
      // event_packages: evPackages,
      event_notes: evNotes,
      last_note: evNotes.length ? evNotes[0] : null,
    };
  });

  res.json(
    serializeForJson({ success: true, data, meta: { page, perPage, total } }),
  );
});

/* Event counts grouped by event_status_id. Backs the Open Enquiry page's KPI
   cards (Total / Open / Closed). Real status ids (event_statuses table):
   1 OPEN, 2 CONFIRMED, 3 COMPLETED, 4 CANCELLED.

   Open = OPEN only — this has to match the row count of the open-enquiry
   list rendered directly under these cards (which only ever queries
   event_status_id=1), or the "Open: 3" card sitting over a 1-row table
   looks broken. Closed = CONFIRMED + COMPLETED + CANCELLED (anything that's
   moved on from being an open enquiry, whether that ended in a booking or
   not). Open + closed always equals total. */
const getStatusCounts = catchAsync(async (req, res) => {
  // Scope the same way listOpenEnquiries does — Staff only counts events
  // they're assigned to or created, Client only counts their own events,
  // Admin/Super Admin still see the global totals.
  let where = {};
  const sub = req.user && (req.user.sub || req.user.id || req.user.email);
  let requesterId = null;
  if (typeof sub === "number" || /^[0-9]+$/.test(String(sub))) requesterId = Number(sub);
  if (!requesterId && req.user && req.user.email) {
    const uu = await prisma.user.findUnique({ where: { email: String(req.user.email) }, select: { id: true } });
    if (uu) requesterId = Number(uu.id);
  }
  if (requesterId) {
    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { role_id: true } });
    const roleId = requester ? Number(requester.role_id) : null;
    if (roleId === 3) {
      where = { OR: [{ dj_id: requesterId }, { created_by: requesterId }] };
    } else if (roleId === 4) {
      where = { OR: [{ user_id: requesterId }, { dj_id: requesterId }, { created_by: requesterId }] };
    }
  }

  const grouped = await prisma.event.groupBy({
    by: ["event_status_id"],
    where,
    _count: { _all: true },
  });

  const countFor = (id) =>
    grouped.find((g) => Number(g.event_status_id) === id)?._count?._all ?? 0;

  const openEnquiry = countFor(1);
  const confirmed = countFor(2);
  const completed = countFor(3);
  const cancelled = countFor(4);
  const total = openEnquiry + confirmed + completed + cancelled;

  res.json(
    serializeForJson({
      total,
      open: openEnquiry,
      closed: confirmed + completed + cancelled,
    }),
  );
});

const updateEnquiry = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.query.id || req.body.id);
  const body = req.validated || req.body || {};
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "id_required" });

  // quick flags update if only simple flags provided — keep backwards compatible
  const flagKeys = ["brochure_emailed", "called", "send_media", "quoted"];
  const hasOnlyFlags = Object.keys(body).every(
    (k) => flagKeys.includes(k) || k === "id",
  );
  if (hasOnlyFlags) {
    const update = {};
    flagKeys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(body, k)) update[k] = !!body[k];
    });
    const updated = await prisma.event.update({ where: { id }, data: update });
    return res.json(serializeForJson({ success: true, data: updated }));
  }

  // full update parity with Laravel NewEnquiryController@update
  const toUtcDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [d, m, y] = String(dateStr).split("-").map(Number);
    const [hh, mm] = String(timeStr).split(":").map(Number);
    if ([d, m, y].some(isNaN) || [hh, mm].some(isNaN)) return null;
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0));
  };

  const normalizeArrayField = (obj, keys) => {
    for (const k of keys) {
      const field = obj[k];
      if (Array.isArray(field)) return field;
      if (field && typeof field === "object")
        return Object.keys(field).map((i) => field[i]);
    }
    return [];
  };

  const equipmentArray = normalizeArrayField(body, [
    "equipmentData",
    "equipment_data",
  ]);
  const extraArray = normalizeArrayField(body, ["extraData", "extra_data"]);
  const rigNotesArray = normalizeArrayField(body, [
    "rigNotesData",
    "rig_notes_data",
    "rigNotes_data",
    "rig_notesData",
  ]);

  // packageTypeId: 1 = basics, 2 = extras (matches Laravel). Derived from the
  // source array, never the payload. package_type_id and equipment_id are
  // BigInt FKs in the schema → pass BigInt.
  const makePackage = (p, eventId, packageTypeId) => {
    const equipNum =
      p.equipment_id != null
        ? Number(p.equipment_id)
        : p.equipment && p.equipment.id != null
          ? Number(p.equipment.id)
          : p.id != null
            ? Number(p.id)
            : null;
    return {
      equipment_id:
        equipNum != null && Number.isFinite(equipNum) ? BigInt(equipNum) : null,
      equipment_order_id:
        p.equipment_order_id !== undefined ? Number(p.equipment_order_id) : null,
      event_id: Number(eventId),
      package_type_id: packageTypeId != null ? BigInt(packageTypeId) : null,
      // round2 on every price field — these are frontend-supplied per line
      // item and feed straight into invoices/dashboard aggregation, so any
      // float drift here propagates everywhere downstream.
      sell_price: p.sell_price != null ? round2(p.sell_price) : null,
    cost_price: p.cost_price != null ? round2(p.cost_price) : null,
    notes: packageTypeId === 2 ? (p.notes?.toString().trim() || null) : null,
    rig_notes: (p.rig_notes ?? p.rigNotes)?.toString().trim() || null,
    payment_send: p.payment_send || null,
    payment_date: p.payment_date ? new Date(p.payment_date) : null,
    quantity: p.quantity != null ? Number(p.quantity) : null,
    total_price: p.total_price != null ? round2(p.total_price) : null,
    price_added_to_bill:
      p.price_added_to_bill != null ? round2(p.price_added_to_bill) : null,
    created_at: new Date(),
    };
  };

  const existingEvent = await prisma.event
    .findUnique({ where: { id } })
    .catch(() => null);
  if (!existingEvent) return res.status(404).json({ error: "event_not_found" });

  // replicate Laravel update email uniqueness checks (uses previous user email as `userEmail`)
  if (body.userEmail && body.email && body.userEmail !== body.email) {
    const existingUserIdRow = await prisma.user
      .findUnique({ where: { email: body.userEmail } })
      .catch(() => null);
    const existingUserId = existingUserIdRow
      ? Number(existingUserIdRow.id)
      : null;

    const existingUserConflict = await prisma.user
      .findFirst({
        where: {
          email: body.email,
          ...(existingUserId ? { id: { not: existingUserId } } : {}),
          role_id: { notIn: [BigInt(1), BigInt(2), BigInt(3)] },
        },
      })
      .catch(() => null);

    if (existingUserConflict) {
      return res
        .status(402)
        .json({
          message:
            "you are trying to use another user mail ,pleace check your mail",
        });
    }
  }

  // also disallow assigning an email that belongs to a non-client user
  if (body.email) {
    const userByEmail = await prisma.user
      .findUnique({ where: { email: body.email } })
      .catch(() => null);
    if (
      userByEmail &&
      Number(userByEmail.id) !== Number(existingEvent.user_id)
    ) {
      const roleIdVal = (() => {
        try {
          return userByEmail.role_id;
        } catch (e) {
          return null;
        }
      })();
      if (roleIdVal && roleIdVal !== BigInt(4) && String(roleIdVal) !== "4") {
        return res
          .status(400)
          .json({ error: "This email is already attached with Dj" });
      }
    }
  }

  const eventDateDb = toDbDate(
    body.event_date || body.date || existingEvent.date,
  );
  const eventDateObj = eventDateDb ? new Date(eventDateDb) : existingEvent.date;
  const startTimeObj =
    toUtcDateTime(
      body.event_date || body.date || eventDateDb,
      body.start_time || body.start_time_input || body.startTime || null,
    ) || existingEvent.start_time;
  const endTimeObj =
    toUtcDateTime(
      body.event_date || body.date || eventDateDb,
      body.end_time || body.end_time_input || body.endTime || null,
    ) || existingEvent.end_time;

  let resolvedDjId =
    existingEvent.dj_id != null ? Number(existingEvent.dj_id) : null;
  if (body.dj_id !== undefined) {
    const parsed =
      body.dj_id === null || body.dj_id === "" ? null : Number(body.dj_id);
    resolvedDjId = Number.isFinite(parsed) ? parsed : null;
  } else if (body.dj_name !== undefined) {
    const parsed =
      body.dj_name === null || body.dj_name === ""
        ? null
        : Number(body.dj_name);
    if (Number.isFinite(parsed)) {
      resolvedDjId = parsed;
    } else if (body.dj_name) {
      const djUser = await prisma.user
        .findFirst({ where: { name: body.dj_name } })
        .catch(() => null);
      resolvedDjId = djUser && djUser.id ? Number(djUser.id) : null;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // reset contract if dj/package/date changed
    const shouldResetContract =
      ((body.dj_id !== undefined || body.dj_name !== undefined) &&
        Number(resolvedDjId ?? 0) !== Number(existingEvent.dj_id ?? 0)) ||
      (body.dj_package_name &&
        body.dj_package_name !== existingEvent.dj_package_name) ||
      (eventDateObj &&
        existingEvent.date &&
        new Date(existingEvent.date).toISOString() !==
          new Date(eventDateObj).toISOString());
    if (shouldResetContract) {
      try {
        await tx.event.update({
          where: { id },
          data: { contract_signed_at: null },
        });
      } catch (e) {}
    }

    // update event
    const evUpdateData = {};
    if (body.dj_id !== undefined || body.dj_name !== undefined) {
      evUpdateData.dj_id = resolvedDjId;
    }
    if (body.dj_package_name !== undefined)
      evUpdateData.dj_package_name = body.dj_package_name || null;
    if (body.event_type !== undefined)
      evUpdateData.event_type = body.event_type || null;
    if (eventDateObj) evUpdateData.date = eventDateObj;
    if (startTimeObj) evUpdateData.start_time = startTimeObj;
    if (endTimeObj) evUpdateData.end_time = endTimeObj;
    if (body.event_details !== undefined)
      evUpdateData.details = body.event_details || null;
    if (body.venue_id !== undefined)
      evUpdateData.venue_id = body.new_venue_id
        ? Number(body.new_venue_id)
        : body.venue_id
          ? Number(body.venue_id)
          : null;
    if (
      body.total_cost_for_equipment !== undefined ||
      body.total_cost !== undefined
    )
      evUpdateData.total_cost_for_equipment =
        (body.total_cost_for_equipment ?? body.total_cost) != null
          ? String(round2(body.total_cost_for_equipment ?? body.total_cost))
          : null;
    if (body.dj_cost_price !== undefined || body.dj_cost !== undefined)
      evUpdateData.dj_cost_price_for_event =
        (body.dj_cost_price ?? body.dj_cost) != null
          ? Number(body.dj_cost_price ?? body.dj_cost)
          : null;
    if (body.deposit_amount !== undefined)
      evUpdateData.deposit_amount =
        body.deposit_amount != null ? body.deposit_amount : null;
    if (body.no_of_guests !== undefined || body.guestCount !== undefined) {
      evUpdateData.no_of_guests =
        body.guestCount != null
          ? String(body.guestCount)
          : body.no_of_guests != null
            ? String(body.no_of_guests)
            : null;
    }

    const updatedEvent = await tx.event.update({
      where: { id },
      data: evUpdateData,
    });

    // update user fields (client)
    try {
      const userId = Number(updatedEvent.user_id || existingEvent.user_id);
      if (
        userId &&
        (body.name !== undefined ||
          body.email !== undefined ||
          body.contact_number !== undefined ||
          body.address !== undefined)
      ) {
        const udata = {};
        if (body.name !== undefined) udata.name = body.name;
        if (body.email !== undefined) udata.email = body.email;
        if (body.contact_number !== undefined)
          udata.contact_number = body.contact_number || null;
        if (body.address !== undefined) udata.address = body.address || null;
        await tx.user
          .update({ where: { id: userId }, data: udata })
          .catch(() => {});
      }
    } catch (e) {}

    // ensure FK rows for package_type_id exist (1=BASIC, 2=EXTRAS)
    await ensurePackageTypes(tx);

    // Snapshot the package rows as they stood before this edit — the only way
    // to reconstruct "what changed" afterwards, since the rows below get
    // wiped and recreated wholesale rather than diffed.
    const previousPackages = (
      await tx.eventPackage
        .findMany({
          where: { event_id: Number(id) },
          select: { equipment_id: true, package_type_id: true, sell_price: true, quantity: true },
        })
        .catch(() => [])
    ).map((p) => ({
      // BigInt fields don't survive JSON.stringify (used by logActivity) —
      // must convert before they ever reach that call.
      equipment_id: p.equipment_id != null ? Number(p.equipment_id) : null,
      package_type_id: p.package_type_id != null ? Number(p.package_type_id) : null,
      sell_price: p.sell_price,
      quantity: p.quantity,
    }));

    // remove existing event packages and recreate
    try {
      await tx.eventPackage.deleteMany({ where: { event_id: Number(id) } });
    } catch (e) {}

    const insertedEquipIds = new Set();
    for (const p of equipmentArray) {
      const pkg = makePackage(p, id, 1); // basics → package_type_id 1
      if (pkg.equipment_id == null) continue;
      try {
        await tx.eventPackage.create({ data: pkg });
        insertedEquipIds.add(Number(pkg.equipment_id));
      } catch (e) {
        console.error("[updateEnquiry] basic package insert failed", e?.code, e?.message);
      }
    }
    for (const p of extraArray) {
      const pkg = makePackage(p, id, 2); // extras → package_type_id 2
      if (pkg.equipment_id == null) continue;
      try {
        await tx.eventPackage.create({ data: pkg });
        insertedEquipIds.add(Number(pkg.equipment_id));
      } catch (e) {
        console.error("[updateEnquiry] extra package insert failed", e?.code, e?.message);
      }
    }

    // apply rig notes — only to rows we just created this request
    for (const r of rigNotesArray) {
      const equipId = Number(r.equipment_id ?? r.equipmentId ?? r.equipment);
      const notes =
        (r.rig_notes ?? r.rigNotes ?? r.rig_note ?? r.rigNote)
          ?.toString()
          .trim() || null;
      if (!Number.isFinite(equipId) || !insertedEquipIds.has(equipId)) continue;
      try {
        await tx.eventPackage.updateMany({
          where: { event_id: Number(id), equipment_id: BigInt(equipId) },
          data: { rig_notes: notes },
        });
      } catch (e) {
        console.error("[updateEnquiry] rig_notes update failed", e?.code, e?.message);
      }
    }

    // VAT handling
    try {
      if (updatedEvent.names_id) {
        const company = await tx.companyName
          .findUnique({ where: { id: BigInt(Number(updatedEvent.names_id)) } })
          .catch(() => null);
        if (
          company &&
          company.vat != null &&
          updatedEvent.is_vat_available_for_the_event === true
        ) {
          const vatPercentage = (company.vat_percentage || 0) / 100;
          const eventTotalWithoutVat = round2(
            body.total_cost_for_equipment ??
              updatedEvent.total_cost_for_equipment ??
              0,
          );
          // Same bug as confirmEvents.controller.js's confirmEvent, fixed there
          // earlier: unrounded multiplication (e.g. 100*1.175 =
          // 117.49999999999999) written verbatim into a VARCHAR column breaks
          // every later fully-paid/equality comparison for that event.
          const vatValue = round2(eventTotalWithoutVat * vatPercentage);
          const totalWithVat = round2(eventTotalWithoutVat * (1 + vatPercentage));
          await tx.event
            .update({
              where: { id },
              data: {
                total_cost_for_equipment: String(totalWithVat),
                event_amount_without_vat: String(eventTotalWithoutVat),
                vat_value: String(vatValue),
              },
            })
            .catch(() => {});
        }
      }
    } catch (e) {}

    // payment status
    try {
      const totalCostRow = await tx.event
        .findUnique({
          where: { id },
          select: { total_cost_for_equipment: true },
        })
        .catch(() => null);
      const paymentAgg = await tx.eventPayment
        .aggregate({ where: { event_id: Number(id) }, _sum: { amount: true } })
        .catch(() => ({ _sum: { amount: 0 } }));
      const totalPayment = toMoney(paymentAgg._sum.amount);
      // >= not === (overpayment / float drift), and safe parse of the VARCHAR.
      const paymentSent = isFullyPaid(totalPayment, totalCostRow?.total_cost_for_equipment) ? 1 : 0;
      await tx.event
        .update({
          where: { id },
          data: { is_event_payment_fully_paid: paymentSent },
        })
        .catch(() => {});
    } catch (e) {}

    // create an update note for the event
    await eventNoteService
      .createNote(tx, {
        eventId: Number(id),
        notes: "Updated as an enquiry",
        created_by: req.user?.id || null,
      })
      .catch(() => {});

    // Audit the package/pricing change — without this there was no way to
    // trace a total_cost_for_equipment jump back to which equipment/extras
    // were actually ticked in a given edit (had to be reconstructed by hand
    // from raw DB state for a real client pricing complaint).
    await logActivity(tx, {
      log_name: "event package updated",
      description: `Event #${id} package/pricing updated`,
      subject_type: "Event",
      subject_id: Number(id),
      causer_id: req.user?.id || null,
      properties: {
        old_total_cost_for_equipment: existingEvent.total_cost_for_equipment,
        new_total_cost_for_equipment:
          body.total_cost_for_equipment ?? body.total_cost ?? updatedEvent.total_cost_for_equipment,
        old_packages: previousPackages,
        new_packages: [
          ...equipmentArray.map((p) => ({
            equipment_id: p.equipment_id ?? p.equipment?.id ?? p.id ?? null,
            package_type_id: 1,
            sell_price: p.sell_price ?? null,
            quantity: p.quantity ?? null,
          })),
          ...extraArray.map((p) => ({
            equipment_id: p.equipment_id ?? p.equipment?.id ?? p.id ?? null,
            package_type_id: 2,
            sell_price: p.sell_price ?? null,
            quantity: p.quantity ?? null,
          })),
        ],
      },
    });

    return await tx.event.findUnique({ where: { id } });
  });

  // Microsoft calendar sync (best-effort) — mirror Laravel EventUpdate dispatch
  try {
    const me = await prisma.microsoftEvent
      .findFirst({ where: { event_id: BigInt(id) } })
      .catch(() => null);
    if (me && me.microsoft_event_id) {
      const startIso = result?.start_time
        ? new Date(result.start_time).toISOString()
        : result?.date
          ? new Date(result.date).toISOString()
          : null;
      const endIso = result?.end_time
        ? new Date(result.end_time).toISOString()
        : null;
      // `result` (from the transaction's plain findUnique) doesn't carry the
      // client/DJ/venue relations the calendar entry needs — re-fetch with
      // them, same as the other two Graph sync call sites.
      const fresh = await prisma.event.findUnique({
        where: { id },
        include: { users_events_user_idTousers: true, users_events_dj_idTousers: true, venues: true },
      }).catch(() => null);
      const eventPackages = await prisma.eventPackage.findMany({
        where: { event_id: id, package_type_id: { in: [1, 2] } },
        select: { quantity: true, notes: true, equipment: { select: { name: true } } },
      }).catch(() => []);
      const { subject, content, location } = microsoftGraph.buildEventCalendarContent({
        event: fresh || result,
        eventPackages,
      });
      await microsoftGraph
        .updateEvent(me.microsoft_event_id, { subject, content, startIso, endIso, location })
        .catch(() => null);
    }
  } catch (e) {}

  res.json(serializeForJson({ success: true, data: result }));
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
  // Matches Laravel's send_invoice.blade.php shell — was previously dumping
  // the raw enrichedDetails JSON straight into the email body.
  const logoUrl = company?.company_logo
    ? await getSignedGetUrl(String(company.company_logo)).catch(() => null)
    : null;
  const html = buildUsrLetterEmail({
    name: user?.name || "Client",
    bodyHtml: String(raw).replace(/\n/g, "<br/>"),
    company,
    logoUrl,
  });

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

// const deleteEnquiry = catchAsync(async (req, res) => {
//   const body = req.validated || req.body || {};
//   const ids = Array.isArray(body.ids)
//     ? body.ids.map(Number)
//     : body.ids
//       ? [Number(body.ids)]
//       : [];
//   const userId = Number(body.userId || body.user_id || 0) || null;
//   if (!ids.length) return res.status(400).json({ error: "ids_required" });

//   const result = await prisma.$transaction(async (tx) => {
//     // remove activity_log entries if table exists — use raw SQL safely
//     try {
//       await tx.$executeRaw`DELETE FROM activity_log WHERE subject_id IN (${ids.join(",")}) AND log_name = 'a notes'`;
//     } catch (e) {}

//     const user = userId
//       ? await tx.user.findUnique({ where: { id: userId } })
//       : null;
//     const userEventCount = user
//       ? await tx.event.count({ where: { user_id: userId } })
//       : 0;

//     if (user && userEventCount === ids.length) {
//       await tx.user.delete({ where: { id: userId } });
//       await tx.event.deleteMany({ where: { id: { in: ids } } });
//       return { success: true, id: userId };
//     } else {
//       await tx.event.deleteMany({ where: { id: { in: ids } } });
//       return { success: true, ids };
//     }
//   });

//   res.json(serializeForJson(result));
// });

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
    // Load base package without `package_user_equipment` relation because
    // some environments (production DB) may not expose the expected relation
    // columns — querying it directly can raise ``column does not exist``.
    var equipments = await packageUserSvc.model
      .findFirst({
        where: {
          user_id: staffId || undefined,
          package_name: pkgName || undefined,
        },
        include: {
          users: { select: { id: true, name: true, email: true } },
          package_user_properties: true,
          // intentionally omit package_user_equipment to avoid schema mismatch
        },
      })
      .catch(() => null);

    // If we found a package, always load equipment lines via raw SQL to avoid
    // Prisma relation mapping issues (parity with package.controller.js).
    if (equipments && equipments.id) {
      try {
        const equipmentRows = await prisma.$queryRaw`
              SELECT p.package_user_id, p.equipment_id, p.equipment_order_id, p.quantity,
                     e.id AS equipment_id, e.name AS equipment_name, e.cost_price AS equipment_cost_price, e.sell_price AS equipment_sell_price, e.rig_notes AS equipment_rig_notes
              FROM package_user_equipment p
              LEFT JOIN equipment e ON e.id = p.equipment_id
              WHERE p.package_user_id = ${Number(equipments.id)}
            `;

        equipments.package_user_equipment = (equipmentRows || []).map((r) => ({
          package_user_id: r.package_user_id,
          equipment_id: r.equipment_id,
          equipment_order_id: r.equipment_order_id,
          quantity: r.quantity,
          equipment: r.equipment_id
            ? {
                id: Number(r.equipment_id),
                name: r.equipment_name,
                cost_price: r.equipment_cost_price,
                sell_price: r.equipment_sell_price,
                rig_notes: r.equipment_rig_notes ?? null,
              }
            : null,
        }));
      } catch (e) {
        // leave package_user_equipment undefined on failure
      }
    }

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
          orderBy: [{ sort_order: "asc" }, { name: "asc" }],
        })
        .catch(() => []);
    } else {
      extras = await equipmentSvc.model
        .findMany({
          where: { status: "ACTIVE" },
          include: { equipment_properties: { include: { properties: true } } },
          orderBy: [{ sort_order: "asc" }, { name: "asc" }],
        })
        .catch(() => []);
    }

    // normalize package payload for frontend parity
    // frontend expects `package_user_equipments` (plural) and `user` (singular)
    if (equipments) {
      // If Prisma relation mapping is out-of-sync the nested `equipment` may be null.
      // In that case, load equipment lines via raw SQL (same approach used in package.controller).
      const needsRawLoad =
        !Array.isArray(equipments.package_user_equipment) ||
        equipments.package_user_equipment.some(
          (p) => !p || !p.equipment || !p.equipment.id,
        );

      if (needsRawLoad) {
        try {
          const equipmentRows = await prisma.$queryRaw`
            SELECT p.package_user_id, p.equipment_id, p.equipment_order_id, p.quantity,
                   e.id AS equipment_id, e.name AS equipment_name, e.cost_price AS equipment_cost_price, e.sell_price AS equipment_sell_price, e.rig_notes AS equipment_rig_notes
            FROM package_user_equipment p
            LEFT JOIN equipment e ON e.id = p.equipment_id
            WHERE p.package_user_id = ${Number(equipments.id)}
          `;

          equipments.package_user_equipment = (equipmentRows || []).map(
            (r) => ({
              package_user_id: r.package_user_id,
              equipment_id: r.equipment_id,
              equipment_order_id: r.equipment_order_id,
              quantity: r.quantity,
              equipment: r.equipment_id
                ? {
                    id: Number(r.equipment_id),
                    name: r.equipment_name,
                    cost_price: r.equipment_cost_price,
                    sell_price: r.equipment_sell_price,
                    rig_notes: r.equipment_rig_notes ?? null,
                  }
                : null,
            }),
          );
        } catch (e) {
          // if raw query fails, leave package_user_equipment as-is
        }
      }

      if (
        Array.isArray(equipments.package_user_equipment) &&
        !Array.isArray(equipments.package_user_equipments)
      ) {
        equipments.package_user_equipments = equipments.package_user_equipment;
      }
      if (equipments.users && !equipments.user) {
        equipments.user = equipments.users;
      }
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

const getEnquiryWithDetails = catchAsync(async (req, res) => {
  const eventId = Number(
    req.params?.eventId ||
      req.params?.id ||
      req.query?.id ||
      req.query?.event_id,
  );
  if (!Number.isFinite(eventId))
    return res.status(400).json({ error: "event_id_required" });

  // Include the DJ relation (not just the raw dj_id FK) so the edit form can
  // always render the assigned DJ's name even if that user was later
  // soft-deleted and no longer appears in the active /user/get-dropdown list
  // — otherwise the Select DJ field silently renders blank on edit for any
  // enquiry whose DJ has since left.
  const event = await eventSvc
    .getById(Number(eventId), {
      include: {
        users_events_dj_idTousers: {
          select: {
            id: true,
            name: true,
            package_users: { select: { id: true, package_name: true } },
          },
        },
      },
    })
    .catch(() => null);
  if (!event) return res.status(404).json({ error: "event_not_found" });

  const packages = await prisma.eventPackage
    .findMany({
      where: { event_id: eventId },
      include: { equipment: true, package_types: true },
    })
    .catch(() => []);

  const notes = await prisma.eventNote
    .findMany({ where: { event_id: eventId }, orderBy: { id: "desc" } })
    .catch(() => []);

  res.json(
    serializeForJson({
      success: true,
      data: { ...event, event_packages: packages, event_notes: notes },
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

  await logActivity(prisma, {
    log_name: "event note added",
    description: `Note added to event #${event_id}`,
    subject_type: "Event",
    subject_id: Number(event_id),
    causer_id: req.user?.id || null,
    properties: { notes },
  });

  res.json(serializeForJson({ success: true, data: created }));
});

const getEmail = catchAsync(async (req, res) => {
  const q = req.validated || req.query || req.body || {};
  const email_name = q.email_name || req.params?.email_name || null;
  const event_id =
    Number(q.event_id || q.id || req.params?.event_id || req.params?.id) ||
    null;
  if (!email_name || !event_id)
    return res
      .status(400)
      .json({ error: "email_name and event_id are required" });

  const [email, companies] = await Promise.all([
    prisma.emailContent.findFirst({ where: { email_name } }),
    companySvc.list({ select: { id: true, name: true } }),
  ]);

  if (!email) return res.status(404).json({ error: "Email not found" });

  res.json(serializeForJson({ success: true, data: { email, companies } }));
});

const sendBrochure = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const eventId =
    Number(
      body.eventId ||
        body.event_id ||
        body.id ||
        req.query.event_id ||
        req.params.id,
    ) || null;
  const companyIdRaw =
    body.companyNameId || body.companyId || body.company_name_id || null;

  if (!eventId) return res.status(400).json({ error: "event_id_required" });

  // fetch event + client email
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: { select: { name: true, email: true } } },
  });

  const clientEmail = event?.users_events_user_idTousers?.email || body.email;
  if (!clientEmail)
    return res.status(400).json({ error: "client_email_not_found" });

  // resolve company (provided id preferred, else event.names_id)
  let company = null;
  const cid = companyIdRaw != null ? Number(companyIdRaw) : null;
  if (cid) {
    try {
      company = await prisma.companyName.findUnique({
        where: { id: BigInt(cid) },
      });
    } catch (e) {
      company = null;
    }
  }
  if (!company && event?.names_id) {
    try {
      company = await prisma.companyName.findUnique({
        where: { id: BigInt(Number(event.names_id)) },
      });
    } catch (e) {
      company = null;
    }
  }
  if (!company) return res.status(400).json({ error: "company_not_found" });

  // prepare email (prefer request body, fall back to EMAIL BROCHURE template id=1)
  const template = await prisma.emailContent
    .findFirst({ where: { email_name: "EMAIL BROCHURE" } })
    .catch(() => null);
  const subject = body.subject || template?.subject || "Brochure";
  const raw = body.body || template?.body || "";
  let brochureUrl = null;
  if (company.brochure) {
    try {
      brochureUrl = await getSignedGetUrl(String(company.brochure));
    } catch (e) {
      brochureUrl = null;
    }
  }

  // Matches Laravel's usr_brochure.blade.php shell.
  const bodyHtml = `${raw ? String(raw).replace(/\n/g, "<br/>") : ""}${
    brochureUrl ? `<p><a href="${brochureUrl}">Download Brochure</a></p>` : ""
  }`;
  const logoUrl = company.company_logo
    ? await getSignedGetUrl(String(company.company_logo)).catch(() => null)
    : null;
  const html = buildUsrLetterEmail({
    name: event?.users_events_user_idTousers?.name || "Client",
    bodyHtml,
    company,
    logoUrl,
  });

  await sendEmail({ to: clientEmail, subject, html }).catch((e) => {
    console.error("[sendBrochure] sendEmail failed", e?.message || e);
  });

  const noteText = `Brochure Email Sent - ${company?.name || ""}`;
  const createdEvent = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, {
      eventId,
      notes: noteText,
      created_by: req.user?.id || null,
    });
    await logActivity(tx, {
      log_name: "brochure sent",
      description: `Brochure emailed for event #${eventId}`,
      subject_type: "Event",
      subject_id: Number(eventId),
      causer_id: req.user?.id || null,
      properties: { to: clientEmail, company_id: company?.id != null ? Number(company.id) : null },
    });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  const latestNote = await prisma.eventNote.findFirst({
    where: { event_id: eventId },
    orderBy: { id: "desc" },
  });

  res.json(
    serializeForJson({
      message: "Brochure Email sent",
      event: createdEvent,
      eventNote: latestNote || null,
    }),
  );
});

const sendUpdateEmail = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const eventId =
    Number(
      body.eventId ||
        body.event_id ||
        body.id ||
        req.query.event_id ||
        req.params.id,
    ) || null;
  const companyIdRaw =
    body.companyNameId || body.companyId || body.company_name_id || null;
  if (!eventId) return res.status(400).json({ error: "event_id_required" });
  if (!companyIdRaw)
    return res.status(400).json({ error: "company_id_required" });
  // fetch event + client email
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { users_events_user_idTousers: { select: { name: true, email: true } } },
  });
  const clientEmail = event?.users_events_user_idTousers?.email || body.email;
  if (!clientEmail)
    return res.status(400).json({ error: "client_email_not_found" });

  // resolve company
  let company = null;
  const cid = Number(companyIdRaw) || null;
  if (cid) {
    try {
      company = await prisma.companyName.findUnique({
        where: { id: BigInt(cid) },
      });
    } catch (e) {
      company = null;
    }
  }
  if (!company && event?.names_id) {
    try {
      company = await prisma.companyName.findUnique({
        where: { id: BigInt(Number(event.names_id)) },
      });
    } catch (e) {
      company = null;
    }
  }
  if (!company) return res.status(400).json({ error: "company_not_found" });

  // prepare email (prefer provided body.body, fallback to template id=2)
  // `email_name` has no unique constraint in the schema — findUnique on it
  // throws a Prisma validation error (silently swallowed by .catch below),
  // so this template was NEVER actually loaded; every send fell through to
  // the hardcoded "Update"/"Update for event #{id}" fallback regardless of
  // what was saved in the admin's Email Content screen.
  const template = await prisma.emailContent
    .findFirst({ where: { email_name: "EMAIL FOR UPDATE" } })
    .catch(() => null);
  const subject = body.subject || template?.subject || "Update";
  const raw = body.body || template?.body || `Update for event ${eventId}`;
  // Matches Laravel's usr_update.blade.php shell.
  const logoUrl = company.company_logo
    ? await getSignedGetUrl(String(company.company_logo)).catch(() => null)
    : null;
  const html = buildUsrLetterEmail({
    name: event?.users_events_user_idTousers?.name || "Client",
    bodyHtml: String(raw).replace(/\n/g, "<br/>"),
    company,
    logoUrl,
  });

  await sendEmail({ to: clientEmail, subject, html }).catch((e) => {
    console.error("[sendUpdateEmail] sendEmail failed", e?.message || e);
  });

  const noteText = `Update Email Sent - ${company?.name || ""}`;
  const createdEvent = await prisma.$transaction(async (tx) => {
    await eventNoteService.createNote(tx, {
      eventId,
      notes: noteText,
      created_by: req.user?.id || null,
    });
    await logActivity(tx, {
      log_name: "update email sent",
      description: `Update email sent for event #${eventId}`,
      subject_type: "Event",
      subject_id: Number(eventId),
      causer_id: req.user?.id || null,
      properties: { to: clientEmail, company_id: company?.id != null ? Number(company.id) : null },
    });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  const latestNote = await prisma.eventNote.findFirst({
    where: { event_id: eventId },
    orderBy: { id: "desc" },
  });

  res.json(
    serializeForJson({
      message: "Update Email sent",
      event: createdEvent,
      eventNote: latestNote || null,
    }),
  );
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
        equipment: p.equipment
          ? {
              id: p.equipment.id,
              name: p.equipment.name,
              sell_price: p.equipment.sell_price,
            }
          : null,
        package_type: p.package_types
          ? { id: p.package_types.id, name: p.package_types.name }
          : null,
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

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  const to = user?.email || body.email;
  const company = companyId
    ? await prisma.companyName.findUnique({ where: { id: companyId } })
    : null;
  const companyName = company?.name || body.companyName || "";

  // use email template for quote if available (SEND QUOTE-OPEN id = 3)
  const template = await prisma.emailContent
    .findFirst({ where: { email_name: "SEND QUOTE-OPEN" } })
    .catch(() => null);
  const subject = body.subject || template?.subject || "Quote";
  let raw = body.body || template?.body || `Quote for event ${eventId}`;
  if (raw && event.deposit_amount)
    raw = String(raw).replace("{--amount--}", String(event.deposit_amount));

  // fetch full event details for parity with Laravel email
  const fullEvent = await prisma.event
    .findUnique({
      where: { id: eventId },
      include: { users_events_user_idTousers: true, venues: true },
    })
    .catch(() => null);

  const first_name =
    details[0]?.user?.name ||
    fullEvent?.users_events_user_idTousers?.name ||
    "Client";
  const contract_token =
    details[0]?.contract_token || fullEvent?.contract_token || null;

  const companyDetails = {
    company_logo:
      company?.company_logo || company?.logo || company?.brochure || null,
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
      eventDateFormatted = `${d.getDate()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getFullYear()).slice(-2)}`;
    }
  } catch (e) {}
  const finalSubject =
    body.subject || template?.subject || `Quote : ${eventDateFormatted || ""}`;

  // Matches Laravel's open_enquiry_send_quote.blade.php exactly: the shared
  // USR letter shell (greeting/body/logo/company block) plus the
  // sign-your-contract paragraph — no itemised pricing table, which Node's
  // old renderSendQuote invented and Laravel's template never had.
  const contractSignUrl = contract_token
    ? `${String(process.env.PUBLIC_FRONTEND_URL || "https://www.usrmusic.com").replace(/\/$/, "")}/contract/${contract_token}`
    : null;
  const bodyHtml = `${raw ? String(raw).replace(/\n/g, "<br/>") : ""}${
    contractSignUrl
      ? `<p style="margin-top:15px;">Before signing, please make sure to read and agree to all terms and conditions. You can sign your contract here: <a style="color:blue;" href="${contractSignUrl}">signature link</a><br/>This will also be available on the portal once you have your login details.</p>`
      : ""
  }`;
  const logoUrl = companyDetails.company_logo
    ? await getSignedGetUrl(String(companyDetails.company_logo)).catch(() => null)
    : null;
  const emailHtml = buildUsrLetterEmail({
    name: first_name,
    bodyHtml,
    company: companyDetails,
    logoUrl,
  });
  // Build emailHtml and printable HTML for PDF (already rendered above)
  const subjectToUse = finalSubject;

  // generate PDF buffer — PDFKit port of the old Laravel quote.blade.php
  // (see utils/pdfGenerator.js), rendered from the same event/company/
  // line-item data `emailHtml` above used for the email body.
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateQuotePdf({
      event: fullEvent || event,
      companyDetails,
      enrichedDetails,
      clientName: first_name,
    });
  } catch (e) {
    console.error("[sendQuote] PDF generation failed", e?.message || e);
  }

  // upload PDF to S3 and get signed link
  let pdfKey = null;
  let pdfUrl = null;
  if (pdfBuffer) {
    const key = `quotes/${eventId}-${Date.now()}.pdf`;
    try {
      await uploadStreamToS3(pdfBuffer, key, "application/pdf");
      pdfKey = key;
      pdfUrl = await getSignedGetUrl(key);
    } catch (e) {
      console.error("[sendQuote] PDF upload failed", e?.message || e);
      pdfBuffer = null;
    }
  }

  // update names_id on event if company provided, send email with link
  // store the S3 object key in the DB (do not persist presigned URLs)
  const result = await prisma.$transaction(async (tx) => {
    if (companyId)
      await tx.event.update({
        where: { id: eventId },
        data: { names_id: companyId, contract_pdf_url: pdfKey || undefined },
      });
    const finalHtml = pdfUrl
      ? `${emailHtml}<p><a href="${pdfUrl}">Download Quote (PDF)</a></p>`
      : emailHtml;
    if (to)
      await sendEmail({ to, subject: subjectToUse, html: finalHtml }).catch(
        () => {},
      );
    await eventNoteService.createNote(tx, {
      eventId,
      notes: `Quote sent - ${companyName}`,
      created_by: req.user?.id || null,
    });
    await logActivity(tx, {
      log_name: "quote sent",
      description: `Quote emailed for event #${eventId}`,
      subject_type: "Event",
      subject_id: Number(eventId),
      causer_id: req.user?.id || null,
      properties: { to: to || null, company_id: companyId != null ? Number(companyId) : null },
    });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(
    serializeForJson({
      message: "Quote sent",
      event: result,
      pdfUrl: pdfUrl || null,
    }),
  );
});

const deleteEnquiry = catchAsync(async (req, res) => {
  // Expect only `id` in params; fetch remaining data from DB
  const eventId = Number(req.params?.id);
  if (!Number.isFinite(eventId))
    return res.status(400).json({ error: "event_id_required" });

  // Feature flag: if true, soft-delete users by setting `deleted_at` instead of hard delete
  const useSoftDeleteForUsers =
    String(process.env.USE_SOFT_DELETE_FOR_USERS || "false").toLowerCase() ===
    "true";

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) return { success: false, error: "Event not found" };

    const userId = Number(event.user_id) || null;
    const user = userId
      ? await tx.user.findUnique({ where: { id: userId } })
      : null;
    const userEventCount = user
      ? await tx.event.count({ where: { user_id: userId } })
      : 0;

    if (
      user &&
      userEventCount === 1 &&
      Number(event.user_id) === Number(userId)
    ) {
      if (useSoftDeleteForUsers) {
        // If User model supports `deleted_at`, set it (soft-delete)
        try {
          await tx.user.update({
            where: { id: userId },
            data: { deleted_at: new Date() },
          });
        } catch (e) {
          // fallback to hard delete if update fails
          await tx.user.delete({ where: { id: userId } }).catch(() => {});
        }
      } else {
        await tx.user.delete({ where: { id: userId } }).catch(() => {});
      }
      await tx.event.delete({ where: { id: eventId } }).catch(() => {});
      await logActivity(tx, {
        log_name: "enquiry deleted",
        description: `Enquiry #${eventId} deleted`,
        subject_type: "Event",
        subject_id: Number(eventId),
        causer_id: req.user?.id || null,
        properties: { client_name: user?.name || null },
      });
      return { success: true, id: userId };
    } else {
      await tx.event.delete({ where: { id: eventId } }).catch(() => {});
      await logActivity(tx, {
        log_name: "enquiry deleted",
        description: `Enquiry #${eventId} deleted`,
        subject_type: "Event",
        subject_id: Number(eventId),
        causer_id: req.user?.id || null,
        properties: { client_name: user?.name || null },
      });
      return { success: true, id: eventId };
    }
  });

  res.json(serializeForJson(result));
});
const deleteManyEnquiries = catchAsync(async (req, res) => {
  const idsRaw = req.body.ids || req.query.ids || req.params.ids || null;
  if (!idsRaw) return res.status(400).json({ error: "ids_required" });

  // support multiple input shapes for `ids` param:
  // - array: [1,2]
  // - comma-separated string: "1,2,3"
  // - JSON array string: "[1,2,3]"
  const parseIds = (raw) => {
    if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
    if (raw == null) return [];
    if (typeof raw === "string") {
      const s = raw.trim();
      // try JSON array first
      if (s.startsWith("[") || s.startsWith('"')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed))
            return parsed.map(Number).filter(Number.isFinite);
        } catch (e) {}
      }
      // comma-separated values
      return s
        .split(",")
        .map((x) => Number(x.trim()))
        .filter(Number.isFinite);
    }
    // single numeric-like value
    const n = Number(raw);
    return Number.isFinite(n) ? [n] : [];
  };

  const ids = parseIds(idsRaw);
  if (!ids.length) return res.status(400).json({ error: "ids_required" });

  const useSoftDeleteForUsers =
    String(process.env.USE_SOFT_DELETE_FOR_USERS || "false").toLowerCase() ===
    "true";

  const result = await prisma.$transaction(async (tx) => {
    const events = await tx.event.findMany({ where: { id: { in: ids } } });
    const primaryUserId = events.length
      ? Number(events[0].user_id) || null
      : null;
    const user = primaryUserId
      ? await tx.user.findUnique({ where: { id: primaryUserId } })
      : null;
    const userEventCount = user
      ? await tx.event.count({ where: { user_id: primaryUserId } })
      : 0;

    if (user && userEventCount === ids.length) {
      if (useSoftDeleteForUsers) {
        try {
          await tx.user.update({
            where: { id: primaryUserId },
            data: { deleted_at: new Date() },
          });
        } catch (e) {
          await tx.user
            .delete({ where: { id: primaryUserId } })
            .catch(() => {});
        }
      } else {
        await tx.user.delete({ where: { id: primaryUserId } }).catch(() => {});
      }
      await tx.event.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
      await logActivity(tx, {
        log_name: "enquiries bulk deleted",
        description: `${ids.length} enquiries deleted`,
        subject_type: "Event",
        subject_id: null,
        causer_id: req.user?.id || null,
        properties: { ids, count: ids.length },
      });
      return { success: true, id: primaryUserId };
    } else {
      await tx.event.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
      await logActivity(tx, {
        log_name: "enquiries bulk deleted",
        description: `${ids.length} enquiries deleted`,
        subject_type: "Event",
        subject_id: null,
        causer_id: req.user?.id || null,
        properties: { ids, count: ids.length },
      });
      return { success: true, ids };
    }
  });
  res.json(serializeForJson(result));
});

export default {
  listOpenEnquiries,
  getStatusCounts,
  createEnquiry,
  updateEnquiry,
  sendQuote,
  sendInvoice,
  deleteEnquiry,
  deleteManyEnquiries,
  staffEquipment,
  addNote,
  getEnquiryWithDetails,
  getEmail,
  sendBrochure,
  sendUpdateEmail,
};
