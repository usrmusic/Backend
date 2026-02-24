import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";

export const listTodos = catchAsync(async (req, res) => {
  const { assigned_to, created_by, event_id } = req.query || {};
  const where = {};
  if (assigned_to) where.assigned_to = Number(assigned_to);
  if (created_by) where.created_by = Number(created_by);
  if (event_id) where.event_id = Number(event_id);

  const todos = await prisma.todos.findMany({ where, orderBy: { id: 'asc' } });
  res.json(serializeForJson(todos));
});

export const listCompletedTodos = catchAsync(async (req, res) => {
  const todos = await prisma.todos.findMany({ where: { complete: true }, orderBy: { id: 'asc' } });
  res.json(serializeForJson(todos));
});

export const getEvents = catchAsync(async (req, res) => {
  const rows = await prisma.todos.findMany({ where: { event_id: { not: null } }, select: { event_id: true } });
  const ids = Array.from(new Set(rows.map((r) => Number(r.event_id)))).filter(Boolean);
  const events = ids.length ? await prisma.event.findMany({ where: { id: { in: ids } } }) : [];
  res.json(serializeForJson(events));
});

export const getCreatedBy = catchAsync(async (req, res) => {
  const rows = await prisma.todos.findMany({ where: { created_by: { not: null } }, select: { created_by: true } });
  const ids = Array.from(new Set(rows.map((r) => Number(r.created_by)))).filter(Boolean);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  res.json(serializeForJson(users));
});

export const createTodo = catchAsync(async (req, res) => {
  const body = req.body || {};
  if (body.assigned_to == null || body.action == null) return res.status(400).json({ error: 'assigned_to_and_action_required' });
  const createdBy = req.user && (req.user.id || req.user.sub) ? Number(req.user.id || req.user.sub) : null;

  const data = {
    event_id: body.event_id != null ? Number(body.event_id) : null,
    assigned_to: Number(body.assigned_to),
    action: String(body.action),
    deadline: body.deadline ? new Date(body.deadline) : null,
    comment: body.comment || null,
    complete: body.complete != null ? Boolean(body.complete) : false,
    created_by: createdBy,
    created_at: new Date(),
  };

  const created = await prisma.todos.create({ data });
  res.status(201).json(serializeForJson(created));
});

export const updateTodo = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};
  const data = {};
  if (body.assigned_to != null) data.assigned_to = Number(body.assigned_to);
  if (body.action != null) data.action = String(body.action);
  if (body.deadline != null) data.deadline = new Date(body.deadline);
  if (body.comment != null) data.comment = body.comment;
  if (body.complete != null) data.complete = Boolean(body.complete);
  data.updated_at = new Date();
  if (body.updated_by != null) data.updated_by = Number(body.updated_by);

  const updated = await prisma.todos.update({ where: { id }, data });
  res.json(serializeForJson(updated));
});

export const deleteTodos = catchAsync(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids_required' });
  await prisma.todos.deleteMany({ where: { id: { in: ids.map((i) => Number(i)) } } });
  res.json({ ok: true, ids });
});

export const getAssignedTo = catchAsync(async (req, res) => {
  const users = await prisma.user.findMany({ where: { deleted_at: null }, select: { id: true, name: true, email: true } });
  res.json(serializeForJson(users));
});

export const getClientsForTodo = catchAsync(async (req, res) => {
  // assume clients have role_id = 1
  const clients = await prisma.user.findMany({ where: { role_id: BigInt(1) }, select: { id: true, name: true, email: true } });
  res.json(serializeForJson(clients));
});

export default {
  listTodos,
  listCompletedTodos,
  getEvents,
  getCreatedBy,
  createTodo,
  updateTodo,
  deleteTodos,
  getAssignedTo,
  getClientsForTodo,
};
