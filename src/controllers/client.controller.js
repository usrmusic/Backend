import prisma from "../utils/prismaClient.js";
import services from "../services/index.js";
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import genPassword from "../utils/genPassword.js";
import { toDbDate } from "../utils/dateUtils.js";
import userService from "../services/userService.js";

const userSvc = services.get("user");
const eventSvc = services.get("event");
export const createClient = catchAsync(async (req, res) => {
  const { name, email, contact_number, status, event_date, address } =
    req.body || {};

    console.log("createClient received data", { name, email, contact_number, status, event_date, address });

  // Normalize and require email
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (!normalizedEmail) return res.status(400).json({ error: "email_required" });

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
    contact_number: contact_number || '',
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
    } catch (e) {
      console.error("createClient: failed to create event for date", d, e);
    }
  }

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
  if (req.query.filter) {
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
  if (req.query.name)
    filter.name = { contains: req.query.name, mode: "insensitive" };
  if (req.query.email)
    filter.email = { contains: req.query.email, mode: "insensitive" };
  if (req.query.role_id) filter.role_id = BigInt(req.query.role_id);

  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined);

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
    "event_date",
    "eventdates",
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
    if (existing)
      return res.status(409).json({ error: "email_taken" });
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

  // Use service layer so soft-delete/other hooks are honored
  const user = await userSvc.update(id, data);

  // If event date(s) provided, create simple event records linked to this user.
  const createdEvents = [];
  const dates = [];
  if (req.body.event_date) dates.push(req.body.event_date);
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
          user_id: Number(id),
          created_by: req.user ? Number(req.user.id) : null,
        },
      });
      createdEvents.push(ev);
    } catch (e) {
      console.error("updateClient: failed to create event for date", d, e);
    }
  }

  const out = serializeForJson(user);
  if (createdEvents.length) {
    out.event_dates = createdEvents.map((e) => e.date);
    out.event_ids = createdEvents.map((e) => e.id);
  } else if (req.body.event_date) out.event_dates = [req.body.event_date];
  else if (req.body.eventdates)
    out.event_dates = Array.isArray(req.body.eventdates)
      ? req.body.eventdates
      : [req.body.eventdates];

  res.json(out);
});

export const deleteClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  // Prevent deleting client if they have associated events (match Laravel behavior)
  const hasEvent = await prisma.event.findFirst({ where: { user_id: id } });
  if (hasEvent)
    return res.status(400).json({
      error: "client_has_events",
      message: "Cannot delete client. Client has associated events.",
    });

  await userSvc.update(id, { deleted_at: new Date() });
  res.json({ ok: true, softDeleted: true });
});

export const deleteManyClients = catchAsync(async (req, res) => {
  // Accept ids from body (array or CSV string), params (CSV), or query (CSV)
  let ids = [];
  if (Array.isArray(req.body && req.body.ids)) ids = req.body.ids;
  else if (req.body && typeof req.body.ids === "string")
    ids = req.body.ids.split(",").map((s) => s.trim());
  else if (req.params && req.params.ids) ids = String(req.params.ids).split(",").map((s) => s.trim());
  else if (req.query && req.query.ids) ids = String(req.query.ids).split(",").map((s) => s.trim());

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
  const force =
    (req.body && (req.body.force === true || req.body.force === "true" || req.body.force === "1")) ||
    (req.query && (req.query.force === "true" || req.query.force === "1"));

  if (force) {
    const del = await prisma.user.deleteMany({ where: { id: { in: numericIds } } });
    return res.json({ ok: true, count: del.count, forced: true });
  }

  const now = new Date();
  const updates = await prisma.user.updateMany({
    where: { id: { in: numericIds } },
    data: { deleted_at: now, updated_by: req.user ? Number(req.user.id) : null },
  });
  res.json({ ok: true, softDeleted: true, forced: false });
});

export const listclientdropdown = catchAsync(async (req, res) => {
  const clients = await userSvc.list({
    where: { deleted_at: null },
    select: { id: true, name: true },
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
