import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listVenues = catchAsync(async (req, res) => {
  const venues = await prisma.venue.findMany();
  res.json(serializeForJson(venues));
});

export const getVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const venue = await prisma.venue.findUnique({ where: { id } });
  if (!venue) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(venue));
});

export const createVenue = catchAsync(async (req, res) => {
  const {
    venue, stage, power, access, smoke_haze, rigging_point, venue_address, attachment, notes, created_by
  } = req.body || {};

  const data = {
    venue: venue || null,
    stage: stage || null,
    power: power || null,
    access: access || null,
    smoke_haze: smoke_haze || null,
    rigging_point: rigging_point || null,
    venue_address: venue_address || null,
    attachment: attachment || null,
    notes: notes || null,
    created_by: created_by ? Number(created_by) : null,
  };

  let created;
  try {
    created = await prisma.venue.create({ data });
  } catch (err) {
    console.error('prisma.venue.create error', err);
    return res.status(500).json({ error: 'venue_create_failed', details: err && err.message });
  }

  res.status(201).json(serializeForJson(created));
});

export const updateVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const allowed = ['venue','stage','power','access','smoke_haze','rigging_point','venue_address','attachment','notes','updated_by'];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      data[k] = k === 'updated_by' ? Number(req.body[k]) : req.body[k];
    }
  }
  data.updated_at = new Date();

  const updated = await prisma.venue.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteVenue = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  try {
    await prisma.venue.delete({ where: { id } });
  } catch (err) {
    console.error('prisma.venue.delete error', err);
    return res.status(500).json({ error: 'venue_delete_failed', details: err && err.message });
  }

  res.json({ ok: true });
});

export default { listVenues, getVenue, createVenue, updateVenue, deleteVenue };
