import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import services from "../services/index.js";

const venueSvc = services.get("venue");

const listVenues = catchAsync(async (req, res) => {
  // Build filter from query params (match client/users approach)
  // let filter = { deleted_at: null };
  let filter = {};
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
  if (req.query.search) filter.venue = { contains: req.query.search };

  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined);

  const venues = await venueSvc.list({ filter, perPage, page, sort });
  const count = await venueSvc.model.count({ where: filter });
  const totalPages = perPage > 0 ? Math.ceil(count / perPage) : 1;
  res.json({
    data: serializeForJson(venues),
    meta: { total: count, perPage, page, totalPages },
  });
});

const getVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const venue = await prisma.venue.findUnique({ where: { id } });
  if (!venue) return res.status(404).json({ error: "not_found" });
  res.json(serializeForJson(venue));
});

const createVenue = catchAsync(async (req, res) => {
  const {
    venue,
    stage,
    power,
    access,
    smoke_haze,
    rigging_point,
    venue_address,
    notes,
    created_by,
  } = req.body || {};

  // handle uploaded attachment (pdf/image) if present
  let attachmentUrl = null;
  if (req.file) {
    try {
      const upl = await uploadFile(req.file, {
        allowedMimeTypes: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/svg+xml",
        ],
        folder: "venue_attachments",
      });
      if (upl && upl.url) attachmentUrl = upl.url;
    } catch (e) {
      console.error("createVenue uploadFile error", e);
    }
  }

  const data = {
    venue: venue || null,
    stage: stage || null,
    power: power || null,
    access: access || null,
    smoke_haze: smoke_haze || null,
    rigging_point: rigging_point || null,
    venue_address: venue_address || null,
    attachment: attachmentUrl || null,
    notes: notes || null,
    created_by: created_by ? Number(created_by) : null,
  };

  let created;
  try {
    created = await venueSvc.create(data);
  } catch (err) {
    console.error("venueSvc.create error", err);
    return res
      .status(500)
      .json({ error: "venue_create_failed", details: err && err.message });
  }

  res.status(201).json(serializeForJson(created));
});

const updateVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const allowed = [
    "venue",
    "stage",
    "power",
    "access",
    "smoke_haze",
    "rigging_point",
    "venue_address",
    "attachment",
    "notes",
    "updated_by",
  ];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      data[k] = k === "updated_by" ? Number(req.body[k]) : req.body[k];
    }
  }
  data.updated_at = new Date();

  // handle uploaded attachment if present
  if (req.file) {
    try {
      const upl = await uploadFile(req.file, {
        allowedMimeTypes: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/svg+xml",
        ],
        folder: "venue_attachments",
      });
      if (upl && upl.url) data.attachment = upl.url;
    } catch (e) {
      console.error("updateVenue uploadFile error", e);
    }
  }

  const updated = await venueSvc.update(id, data);
  res.json(serializeForJson(updated));
});

const deleteVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  const forceVal = (req.params && req.params.force !== undefined ? req.params.force : req.query && req.query.force !== undefined ? req.query.force : req.body && req.body.force !== undefined ? req.body.force : undefined);
  const force = (forceVal === true || forceVal === 'true' || forceVal === '1');

  if (force) {
    try {
      await venueSvc.delete(id, { force: true });
      return res.json({ ok: true, forced: true });
    } catch (err) {
      console.error("venueSvc.delete (force) error", err);
      return res.status(500).json({ error: "venue_delete_failed", details: err && err.message });
    }
  }

  // Prevent deleting if venue has events (keeps Laravel parity)
  const hasEvent = await prisma.event.findFirst({ where: { venue_id: id } });
  if (hasEvent)
    return res
      .status(400)
      .json({
        error: "venue_has_events",
        message: "Cannot delete venue. Venue has associated events.",
      });

  try {
    await venueSvc.delete(id);
  } catch (err) {
    console.error("venueSvc.delete error", err);
    return res
      .status(500)
      .json({ error: "venue_delete_failed", details: err && err.message });
  }

  res.json({ ok: true, softDeleted: true });
});
const deleteManyVenues = catchAsync(async (req, res) => {
  // Accept ids from params (CSV), body (array or CSV string), or query (CSV)
  let ids = [];
  if (req.params && req.params.ids)
    ids = String(req.params.ids)
      .split(",")
      .map((s) => s.trim());
  else if (Array.isArray(req.body && req.body.ids)) ids = req.body.ids;
  else if (req.body && typeof req.body.ids === "string")
    ids = req.body.ids.split(",").map((s) => s.trim());
  else if (req.query && req.query.ids)
    ids = String(req.query.ids)
      .split(",")
      .map((s) => s.trim());

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "invalid_ids" });

  const numericIds = ids.map((i) => Number(i)).filter((n) => !Number.isNaN(n));
  if (numericIds.length === 0)
    return res.status(400).json({ error: "invalid_ids" });

  // Prevent deleting venue if it has associated events (match Laravel behavior)
  for (const _id of numericIds) {
    const hasEvent = await prisma.event.findFirst({ where: { venue_id: _id } });
    if (hasEvent)
      return res
        .status(400)
        .json({
          error: "venue_has_events",
          message: `Cannot delete venue ${_id}. Venue has associated events.`,
        });
  }

  // Support force delete via body.force or query.force (true/'true'/'1')
  const force =
    (req.body &&
      (req.body.force === true ||
        req.body.force === "true" ||
        req.body.force === "1")) ||
    (req.query && (req.query.force === "true" || req.query.force === "1")) ||
    (req.params && (req.params.force === "true" || req.params.force === "1"));

  if (force) {
    const del = await venueSvc.forceDeleteMany(numericIds);
    return res.json({ ok: true, count: del.count, forced: true });
  }

  const updates = await venueSvc.deleteMany(numericIds);
  return res.json({ ok: true, count: updates.count, forced: false });
});

const listVenueDropdown = catchAsync(async (req, res) => {
  const venues = await venueSvc.list({ select: { id: true, venue: true } });
  res.json(serializeForJson(venues));
});

export default {
  listVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
  deleteManyVenues,
  listVenueDropdown,
};
