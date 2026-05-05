import prisma from "../utils/prismaClient.js";
import { Prisma } from "@prisma/client";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";

const todoSvc = services.get("todos");

async function resolveAssignedTo(id) {
  const parsed = Number(id);
  if (!parsed) return null;
  const user = await prisma.user.findUnique({ where: { id: parsed } });
  return user ? parsed : null;
}

async function resolveEventId(id) {
  const parsed = Number(id);
  if (!parsed) return null;
  const event = await prisma.event.findUnique({ where: { id: parsed } });
  return event ? parsed : null;
}

const listTodo = catchAsync(async (req, res) => {
  const rawId = req.params?.id ?? req.query?.id ?? req.body?.id;
  const event_id = Number(rawId) || null;
  if (!event_id) return res.status(400).json({ error: 'event_id_required' });

  // Use core CRUD service `list` with a filter for event_id
  // Include related user records so frontend can display names instead of ids
  const todos = await todoSvc.list({
    filter: { event_id },
    include: {
      users_todos_assigned_toTousers: { select: { id: true, name: true, email: true } },
      users_todos_created_byTousers: { select: { id: true, name: true, email: true } },
    },
  });
  // attach simple name fields to make frontend rendering easier
  const enhanced = (Array.isArray(todos) ? todos : []).map((t) => {
    const tt = t || {};
    const assignedName = tt.users_todos_assigned_toTousers?.name || null;
    const createdName = tt.users_todos_created_byTousers?.name || null;
    return { ...tt, assigned_user_name: assignedName, created_user_name: createdName };
  });
  res.json(serializeForJson(enhanced));
});

const listAssignedTodos = catchAsync(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'missing_token' });
  const sub = req.user.sub || req.user.id || req.user.email;
  let userId = null;
  if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) userId = Number(sub);
  if (!userId) {
    const email = req.user.email;
    if (!email) return res.status(401).json({ error: 'missing_user_identity' });
    const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { id: true } });
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    userId = Number(u.id);
  }

  const todos = await todoSvc.list({
    filter: { assigned_to: userId },
    perPage: 50,
    include: {
      users_todos_assigned_toTousers: { select: { id: true, name: true, email: true } },
      users_todos_created_byTousers: { select: { id: true, name: true, email: true } },
    },
  });
  const enhanced = (Array.isArray(todos) ? todos : []).map((t) => {
    const tt = t || {};
    const assignedName = tt.users_todos_assigned_toTousers?.name || null;
    const createdName = tt.users_todos_created_byTousers?.name || null;
    return { ...tt, assigned_user_name: assignedName, created_user_name: createdName };
  });
  res.json(serializeForJson(enhanced));
});

const createTodo = catchAsync(async (req, res) => {
  const rawId = req.params?.id ?? req.query?.id ?? req.body?.id;
  const event_id = await resolveEventId(rawId);
  if (!event_id) return res.status(400).json({ error: 'event_not_found' });

  const assignedTo = await resolveAssignedTo(req.body.assigned_to);
  if (!assignedTo) return res.status(400).json({ error: 'user_not_found' });

  const todoData = {
    event_id,
    assigned_to: assignedTo,
    action: req.body.action,
    deadline: req.body.deadline,
    comment: req.body.comment,
    complete: req.body.complete,
  };

  const newTodo = await todoSvc.create(todoData);
  res.status(201).json(serializeForJson(newTodo));
});

const updateTodo = catchAsync(async (req, res) => {
  const eventId = await resolveEventId(req.params?.eventId || req.body?.event_id);
  const todoId = Number(req.params?.todoId || req.body?.todoId) || null;
  if (!eventId || !todoId) return res.status(400).json({ error: 'event_or_todo_id_required' });

  // verify todo exists and belongs to event
  const existing = await todoSvc.getById(todoId).catch(() => null);
  if (!existing) return res.status(404).json({ error: 'todo_not_found' });
  if (Number(existing.event_id) !== Number(eventId)) return res.status(400).json({ error: 'event_mismatch' });

  const assignedTo = await resolveAssignedTo(req.body.assigned_to);
  if (!assignedTo) return res.status(400).json({ error: 'invalid_assigned_to' });

  const updateData = {
    event_id: eventId,
    assigned_to: assignedTo,
    action: req.body.action,
    deadline: req.body.deadline,
    comment: req.body.comment,
    complete: req.body.complete,
  };

  const updated = await todoSvc.update(todoId, updateData);
  res.json(serializeForJson(updated));
});

// PATCH /todos/:eventId/:todoId/complete — admin OR the assigned user can flip
// the complete flag. Everyone else gets 403.
const toggleTodoComplete = catchAsync(async (req, res) => {
  const eventId = Number(req.params?.eventId) || null;
  const todoId = Number(req.params?.todoId) || null;
  if (!eventId || !todoId) return res.status(400).json({ error: 'event_or_todo_id_required' });

  const todo = await prisma.todos.findFirst({ where: { id: todoId, event_id: eventId } });
  if (!todo) return res.status(404).json({ error: 'todo_not_found' });

  const sub = req.user?.sub || req.user?.id || req.user?.email;
  let requesterId = null;
  if (typeof sub === 'number' || /^[0-9]+$/.test(String(sub))) requesterId = Number(sub);
  if (!requesterId && req.user?.email) {
    const uu = await prisma.user.findUnique({ where: { email: String(req.user.email) }, select: { id: true } });
    if (uu) requesterId = Number(uu.id);
  }

  let isAdmin = false;
  if (requesterId) {
    const u = await prisma.user.findUnique({ where: { id: requesterId }, select: { role_id: true } });
    const roleId = u?.role_id != null ? Number(u.role_id) : null;
    if (roleId === 1 || roleId === 2) isAdmin = true;
    if (!isAdmin) {
      // fall back to permission-based check
      const { loadPermissionsForUserId } = await import('../middleware/authorize.js');
      const perms = await loadPermissionsForUserId(requesterId);
      if (perms.has('manage_all') || perms.has('super_admin')) isAdmin = true;
    }
  }

  const isAssignee = requesterId && todo.assigned_to != null && Number(todo.assigned_to) === requesterId;
  if (!isAdmin && !isAssignee) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const updated = await prisma.todos.update({
    where: { id: todoId },
    data: { complete: !!req.body?.complete },
  });
  res.json(serializeForJson({ success: true, data: updated }));
});

const deleteTodo = catchAsync(async (req, res) => {
  const eventId = Number(req.params?.eventId || req.query?.eventId || req.body?.event_id) || null;
  const todoId = Number(req.params?.todoId || req.query?.todoId || req.body?.todoId) || null;
  if (!todoId) return res.status(400).json({ error: 'todo_id_required' });

  // optional: check event match
  if (eventId) {
    const existing = await todoSvc.getById(todoId).catch(() => null);
    if (!existing) return res.status(404).json({ error: 'todo_not_found' });
    if (Number(existing.event_id) !== Number(eventId)) return res.status(400).json({ error: 'event_mismatch' });
  }

  // determine force flag (query or body); accept 'true'|'1' string as well
  const forceRaw = (req.validated && (req.validated.query?.force ?? req.validated.body?.force)) ?? req.query?.force ?? req.body?.force;
  const force = forceRaw === true || forceRaw === 'true' || forceRaw === '1';

  const result = await todoSvc.delete(todoId, { force }).catch(() => null);
  res.json(serializeForJson({ success: true, deleted: result || null }));
});

export default {
  listTodo,
  listAssignedTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  toggleTodoComplete,
};
