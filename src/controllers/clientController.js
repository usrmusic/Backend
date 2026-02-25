import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";

function genPassword(len = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const listClients = catchAsync(async (req, res) => {
  const users = await prisma.user.findMany({ where: { deleted_at: null } });
  res.json(serializeForJson(users));
});

export const getClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json(serializeForJson(user));
});

export const createClient = catchAsync(async (req, res) => {
  const { name, email, contact_number, role_id, status, event_date, eventdates, address } = req.body || {};
  if (!email) return res.status(400).json({ error: "email_required" });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_taken" });

  const plainPassword = req.body.password || genPassword();
  const hashed = await bcrypt.hash(plainPassword, 10);

  let profilePhotoUrl = null;
  if (req.file) {
    try {
      const uploadRes = await uploadFile(req.file, {
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ],
        folder: 'profile',
      });
      if (uploadRes && uploadRes.url) profilePhotoUrl = uploadRes.url;
    } catch (err) {
      console.error('uploadFile error', err);
    }
  }

  // Map status to deleted_at: if status === 'inactive' we'll mark deleted_at
  const deletedAt = status === 'inactive' ? new Date() : null;

  const data = {
    role_id: role_id != null ? BigInt(role_id) : BigInt(1),
    name: name || null,
    email,
    password: hashed,
    password_text: plainPassword,
    contact_number: contact_number || "",
    address: address || null,
    is_email_send: false,
    profile_photo: profilePhotoUrl,
    deleted_at: deletedAt,
    created_by: null,
    updated_by: null,
  };

  let user;
  try {
    user = await prisma.user.create({ data });
  } catch (err) {
    console.error('prisma.user.create error', err);
    return res.status(500).json({ error: 'user_create_failed', details: err && err.message });
  }

  const safeUser = serializeForJson({ id: user.id, name: user.name, email: user.email, role_id: user.role_id, address: user.address, contact_number: user.contact_number });
  // Include event date(s) back in response for clients that submit them; actual event creation is deferred
  const resp = { user: safeUser, password: plainPassword };
  if (event_date) resp.event_dates = [event_date];
  else if (eventdates) resp.event_dates = Array.isArray(eventdates) ? eventdates : [eventdates];

  res.status(201).json(resp);
});

export const updateClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const allowed = ['name', 'contact_number', 'role_id', 'email', 'address', 'profile_photo', 'status', 'event_date', 'eventdates'];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      if (k === 'role_id') data[k] = BigInt(req.body[k]);
      else if (k === 'status') {
        // handle status specially below
      } else {
        data[k] = req.body[k];
      }
    }
  }

  // Handle status -> deleted_at mapping
  if ('status' in req.body) {
    if (req.body.status === 'active') data.deleted_at = null;
    else if (req.body.status === 'inactive') data.deleted_at = new Date();
  }

  data.updated_at = new Date();

  const user = await prisma.user.update({ where: { id }, data });

  // Attach event dates (not persisted here) to the returned object for client convenience
  const out = serializeForJson(user);
  if (req.body.event_date) out.event_dates = [req.body.event_date];
  else if (req.body.eventdates) out.event_dates = Array.isArray(req.body.eventdates) ? req.body.eventdates : [req.body.eventdates];

  res.json(out);
});

export const deleteClient = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  // Prevent deleting client if they have associated events (match Laravel behavior)
  const hasEvent = await prisma.event.findFirst({ where: { user_id: id } });
  if (hasEvent) return res.status(400).json({ error: 'client_has_events', message: 'Cannot delete client. Client has associated events.' });

  await prisma.user.update({ where: { id }, data: { deleted_at: new Date() } });
  res.json({ ok: true });
});

export const deleteManyClients = catchAsync(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids_required' });

  // Check events for each id
  for (const idRaw of ids) {
    const _id = Number(idRaw);
    const hasEvent = await prisma.event.findFirst({ where: { user_id: _id } });
    if (hasEvent) return res.status(400).json({ error: 'client_has_events', message: `Cannot delete client ${_id}. Client has associated events.` });
  }

  const now = new Date();
  const updates = await prisma.user.updateMany({ where: { id: { in: ids.map((i) => Number(i)) } }, data: { deleted_at: now } });
  res.json({ ok: true, count: updates.count });
});

export default { listClients, getClient, createClient, updateClient, deleteClient, deleteManyClients };
