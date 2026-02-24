import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listEventNotes = catchAsync(async (req, res) => {
  const event_id = req.query.event_id ? Number(req.query.event_id) : undefined;
  const where = event_id ? { where: { event_id } } : {};
  const notes = await prisma.eventNote.findMany({ ...(where.where ? where : {}), orderBy: { id: 'asc' } });
  res.json(serializeForJson(notes));
});

export const getEventNote = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const note = await prisma.eventNote.findUnique({ where: { id } });
  if (!note) return res.status(404).json({ error: 'not_found' });
  res.json(serializeForJson(note));
});

export const createEventNote = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (body.event_id == null || body.notes == null) return res.status(400).json({ error: 'event_id_and_notes_required' });

  const data = {
    event_id: Number(body.event_id),
    notes: String(body.notes),
    created_at: new Date(),
  };
  if (body.created_by != null) data.created_by = Number(body.created_by);

  const created = await prisma.eventNote.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const updateEventNote = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {};
  if (body.notes != null) data.notes = String(body.notes);
  if (body.updated_by != null) data.updated_by = Number(body.updated_by);
  data.updated_at = new Date();

  const updated = await prisma.eventNote.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteEventNote = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  await prisma.eventNote.delete({ where: { id } });
  res.json({ ok: true });
});

export default { listEventNotes, getEventNote, createEventNote, updateEventNote, deleteEventNote };
