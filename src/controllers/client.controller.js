import prisma from "../utils/prismaClient.js";
import services from "../services/index.js";
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import genPassword from "../utils/genPassword.js";
import { toDbDate } from "../utils/dateUtils.js";
import userService from "../services/userService.js";
import { logActivity } from "../utils/activityLogger.js";
import eventNoteService from "../services/eventNoteService.js";
import { loadPermissionsForUserId } from "../middleware/authorize.js";

// `force: true` on delete endpoints bypasses referential-integrity guards
// (e.g. "client has events") entirely. That is only safe in the hands of a
// Super Admin / Admin (role_id 1 or 2) or someone holding the manage_all /
// super_admin bypass permission — the same check used by requireAdmin in
// middleware/authorize.js. Anyone else's `force` flag is silently ignored
// (falls through to the normal guarded delete) rather than erroring.
async function isForceDeleteAllowed(req) {
  try {
    if (!req.user) return false;
    const sub = req.user.sub || req.user.id || req.user.email;
    let userId = null;
    if (typeof sub === "number" || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
    if (!userId) {
      const email = req.user.email;
      if (!email) return false;
      const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
      if (!u) return false;
      userId = Number(u.id);
    }

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role_id: true } });
    const roleId = u?.role_id != null ? Number(u.role_id) : null;
    if (roleId === 1 || roleId === 2) return true;

    const perms = await loadPermissionsForUserId(userId);
    return perms.has("manage_all") || perms.has("super_admin");
  } catch (err) {
    console.error("isForceDeleteAllowed error", err);
    return false;
  }
}

const userSvc = services.get("user");
const eventSvc = services.get("event");
export const createClient = catchAsync(async (req, res) => {
  const { name, email, contact_number, status, event_date, address } =
    req.body || {};
  // Normalize and require email
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (!normalizedEmail)
    return res.status(400).json({ error: "email_required" });

  // Check uniqueness
  const existing = await userService.getUserByEmail(normalizedEmail);
  if (existing) return res.status(409).json({ error: "email_taken" });

  const plainPassword = req.body.password || genPassword();
  const hashed = await bcrypt.hash(plainPassword, 10);

  let profilePhotoUrl = null;
  if (req.file) {
    try {
      const uploadRes = await uploadFile(req.file, {
        allowedMimeTypes: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/svg+xml",
        ],
        folder: "profile",
      });
      if (uploadRes && uploadRes.url) profilePhotoUrl = uploadRes.url;
    } catch (err) {
      console.error("uploadFile error", err);
    }
  }

  // Map status to deleted_at: if status === 'inactive' we'll mark deleted_at
  const deletedAt = status === "inactive" ? new Date() : null;

  const data = {
    name: name || null,
    role_id: BigInt(4),
    email: normalizedEmail,
    password: hashed,
    password_text: plainPassword,
    contact_number: contact_number || "",
    address: address || null,
    // is_email_send: false,
    profile_photo: profilePhotoUrl,
    deleted_at: deletedAt,
    created_by: req.user && req.user.id ? Number(req.user.id) : null,
    updated_by: null,
  };
  let user;
  try {
    user = await userSvc.create(data);
  } catch (err) {
    console.error("userSvc.create error", err);
    return res
      .status(500)
      .json({ error: "user_create_failed", details: err && err.message });
  }

  // If event date(s) provided, create simple event records linked to this user.
  const createdEvents = [];
  const dates = [];
  if (event_date) dates.push(event_date);
  // support `eventdates` plural from older clients
  if (req.body.eventdates) {
    if (Array.isArray(req.body.eventdates)) dates.push(...req.body.eventdates);
    else dates.push(req.body.eventdates);
  }
  for (const d of dates) {
    try {
      const ev = await eventSvc.create({
        data: {
          date: toDbDate(String(d)),
          event_status_id: 1,
          user_id: Number(user.id),
          created_by: req.user ? Number(req.user.id) : null,
        },
      });
      createdEvents.push(ev);

      // Notes added for enquiry create (matches Laravel ClientController@store)
      try {
        await eventNoteService.createNote(prisma, {
          eventId: Number(ev.id),
          notes: "Created as an enquiry",
          created_by: req.user?.id || null,
        });
      } catch (e) {}

      // Activity log for creating an open enquiry
      await logActivity(prisma, {
        log_name: "a open Enquiry",
        description: `Enquiry created for event #${Number(ev.id)}`,
        subject_type: "Event",
        subject_id: Number(ev.id),
        causer_id: req.user?.id || null,
        properties: { attributes: serializeForJson(ev) },
      });
    } catch (e) {
      console.error("createClient: failed to create event for date", d, e);
    }
  }

  await logActivity(prisma, {
    log_name: "client created",
    description: `Client ${user.id} created`,
    subject_type: "Client",
    subject_id: Number(user.id),
    causer_id: req.user?.id || null,
    properties: { name: user.name, email: user.email },
  });

  const safeUser = serializeForJson({
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
    address: user.address,
    contact_number: user.contact_number,
  });
  // Include event date(s) back in response for clients that submit them; actual event creation is deferred
  const resp = { user: safeUser, password: plainPassword };
  if (createdEvents.length) {
    resp.event_dates = createdEvents.map((e) => e.date);
    resp.event_ids = createdEvents.map((e) => e.id);
  } else if (event_date) resp.event_dates = [event_date];
  else if (req.body.eventdates)
    resp.event_dates = Array.isArray(req.body.eventdates)
      ? req.body.eventdates
      : [req.body.eventdates];

  res.status(201).json(resp);
});

export const listClients = catchAsync(async (req, res) => {
  // Build filter from query params
  let filter = { deleted_at: null, role_id: BigInt(4) };
  if (req.query.filter || req.params.filter) {
    try {
      const parsed =
        typeof req.query.filter === "string"
          ? JSON.parse(req.query.filter)
          : req.query.filter;
      filter = { ...filter, ...parsed };
    } catch (e) {
      // ignore invalid JSON filter
    }
  }
  if(req.params.search || req.query.search) {
    const search = req.params.search || req.query.search;
    filter = {
      ...filter,
      OR: [
        { name: { contains: search } },
        { email: { contains: search } },
      ],
    };
  }

  const perPage = Number(req.query.perPage || req.query.limit || req.params.perPage || req.params.limit || 10);
  const page = Number(req.query.page || req.params.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined) ||
    req.params.sort ||
    (req.params.sort_by
      ? `${req.params.sort_by}:${req.params.sort_dir || "asc"}`
      : undefined) ||
    "name:asc";

  const users = await userSvc.list({ filter, perPage, page, sort });
  const count = await userSvc.model.count({ where: filter });
  const totalPages = perPage > 0 ? Math.ceil(count / perPage) : 1;
  res.json({
    data: serializeForJson(users),
    meta: {
      total: count,
      perPage,
      page,
      totalPages,
    },
  });
});

export const getClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const user = await userSvc.getById(id);
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json(serializeForJson(user));
});

export const updateClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const allowed = [
    "name",
    "contact_number",
    "role_id",
    "email",
    "address",
    "profile_photo",
    "status",
    // do not pass event date(s) through to user update (handled separately below)
  ];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      if (k === "role_id") data[k] = BigInt(req.body[k]);
      else if (k === "status") {
        // handle status specially below
      } else {
        data[k] = req.body[k];
      }
    }
  }

  // Handle status -> deleted_at mapping
  if ("status" in req.body) {
    if (req.body.status === "active") data.deleted_at = null;
    else if (req.body.status === "inactive") data.deleted_at = new Date();
  }

  data.updated_at = new Date();

  // Check email uniqueness if changed
  if (data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, id: { not: id } },
    });
    if (existing) return res.status(409).json({ error: "email_taken" });
  }

  // Handle profile photo upload (if present)
  if (req.file) {
    try {
      const uploadRes = await uploadFile(req.file, {
        allowedMimeTypes: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/svg+xml",
        ],
        folder: "profile",
      });
      if (uploadRes && uploadRes.url) data.profile_photo = uploadRes.url;
    } catch (err) {
      console.error("updateClient uploadFile error", err);
    }
  }

  // set updater
  data.updated_by = req.user ? Number(req.user.id) : null;

  // Capture pre-update values for the audit log
  const existingClient = await userSvc.getById(id);

  // Use service layer so soft-delete/other hooks are honored
  const user = await userSvc.update(id, data);

  await logActivity(prisma, {
    log_name: "client updated",
    description: `Client ${id} updated`,
    subject_type: "Client",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: {
      old: {
        name: existingClient?.name,
        email: existingClient?.email,
        contact_number: existingClient?.contact_number,
      },
      new: {
        name: user.name,
        email: user.email,
        contact_number: user.contact_number,
      },
    },
  });

  // Note: updateClient must only ever update the client's own user-row
  // fields, matching Laravel's ClientController@update exactly. No event
  // creation happens here — that would risk spawning duplicate open
  // enquiries whenever a client is re-saved with an event_date present.
  const out = serializeForJson(user);

  res.json(out);
});

export const deleteClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const forceVal =
    req.params && req.params.force !== undefined
      ? req.params.force
      : req.query && req.query.force !== undefined
        ? req.query.force
        : req.body && req.body.force !== undefined
          ? req.body.force
          : undefined;
  const forceRequested = forceVal === true || forceVal === "true" || forceVal === "1";
  const force = forceRequested && (await isForceDeleteAllowed(req));

  const existingClient = await userSvc.getById(id);

  if (force) {
    // Force permanent delete
    await userSvc.delete(id, { force: true });

    await logActivity(prisma, {
      log_name: "client deleted",
      description: `Client ${id} deleted`,
      subject_type: "Client",
      subject_id: id,
      causer_id: req.user?.id || null,
      properties: { name: existingClient?.name || null, email: existingClient?.email || null },
    });

    return res.json({ ok: true, forced: true });
  }

  // Prevent deleting client if they have associated events (match Laravel behavior)
  const hasEvent = await prisma.event.findFirst({ where: { user_id: id } });
  if (hasEvent)
    return res.status(400).json({
      error: "client_has_events",
      message: "Cannot delete client. Client has associated events.",
    });

  await userSvc.update(id, { deleted_at: new Date() });

  await logActivity(prisma, {
    log_name: "client deleted",
    description: `Client ${id} deleted`,
    subject_type: "Client",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: { name: existingClient?.name || null, email: existingClient?.email || null },
  });

  res.json({ ok: true, softDeleted: true });
});

export const deleteManyClients = catchAsync(async (req, res) => {
  // Accept ids from body (array or CSV string), params (CSV), or query (CSV)
  let ids = [];
  if (Array.isArray(req.body && req.body.ids)) ids = req.body.ids;
  else if (req.body && typeof req.body.ids === "string")
    ids = req.body.ids.split(",").map((s) => s.trim());
  else if (req.params && req.params.ids)
    ids = String(req.params.ids)
      .split(",")
      .map((s) => s.trim());
  else if (req.query && req.query.ids)
    ids = String(req.query.ids)
      .split(",")
      .map((s) => s.trim());

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "ids_required" });

  const numericIds = ids.map((i) => Number(i)).filter((n) => !Number.isNaN(n));
  if (numericIds.length === 0)
    return res.status(400).json({ error: "ids_required" });

  // Check events for each id
  for (const _id of numericIds) {
    const hasEvent = await prisma.event.findFirst({ where: { user_id: _id } });
    if (hasEvent)
      return res.status(400).json({
        error: "client_has_events",
        message: `Cannot delete client ${_id}. Client has associated events.`,
      });
  }

  // Support force delete via body.force or query.force (true/"true"/"1")
  const forceRequested =
    (req.body &&
      (req.body.force === true ||
        req.body.force === "true" ||
        req.body.force === "1")) ||
    (req.query && (req.query.force === "true" || req.query.force === "1")) ||
    (req.params && (req.params.force === "true" || req.params.force === "1"));
  const force = forceRequested && (await isForceDeleteAllowed(req));

  if (force) {
    const del = await prisma.user.deleteMany({
      where: { id: { in: numericIds } },
    });

    await logActivity(prisma, {
      log_name: "clients bulk deleted",
      description: `${numericIds.length} clients bulk deleted`,
      subject_type: "Client",
      subject_id: null,
      causer_id: req.user?.id || null,
      properties: { ids: numericIds, count: del.count },
    });

    return res.json({ ok: true, count: del.count, forced: true });
  }

  const now = new Date();
  const updates = await prisma.user.updateMany({
    where: { id: { in: numericIds } },
    data: {
      deleted_at: now,
      updated_by: req.user ? Number(req.user.id) : null,
    },
  });

  await logActivity(prisma, {
    log_name: "clients bulk deleted",
    description: `${numericIds.length} clients bulk deleted`,
    subject_type: "Client",
    subject_id: null,
    causer_id: req.user?.id || null,
    properties: { ids: numericIds, count: updates.count },
  });

  res.json({
    ok: true,
    softDeleted: true,
    forced: false,
    count: updates.count,
  });
});

export const listclientdropdown = catchAsync(async (req, res) => {
  const clients = await userSvc.list({
    filter: { deleted_at: null, role_id: BigInt(4) },
    select: { id: true, name: true },
    // request no pagination so dropdown gets the full set
    perPage: null,
    sort: "name:asc",
  });
  res.json(serializeForJson(clients));
});

export default {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  deleteManyClients,
  listclientdropdown,
};
