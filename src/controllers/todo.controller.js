import prisma from "../utils/prismaClient.js";
import { Prisma } from "@prisma/client";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import services from "../services/index.js";
import { logActivity } from "../utils/activityLogger.js";
import { buildUsrLetterEmail } from "../utils/mail/templates/usrLetterShell.js";
import { buildTodoAssignedEmailBody, TODO_ASSIGNED_EMAIL_SUBJECT } from "../utils/mail/templates/todoAssignedEmail.js";
import sendEmail from "../utils/mail/resendClient.js";

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

  // Authorization: todos are internal staff tasks. Without this any logged-in
  // user (incl. a role-4 Client) could iterate event ids and read every event's
  // task assignments, deadlines and staff emails (IDOR). Allow admin/staff
  // (roles 1/2/3) freely; a Client may only see todos for their own event.
  if (!req.user) return res.status(401).json({ error: 'missing_token' });
  const sub = req.user.sub || req.user.id || req.user.email;
  let userId = /^[0-9]+$/.test(String(sub)) ? Number(sub) : null;
  if (!userId && req.user.email) {
    const u = await prisma.user.findUnique({ where: { email: String(req.user.email) }, select: { id: true } });
    userId = u ? Number(u.id) : null;
  }
  const [me, ev] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { role_id: true } }) : null,
    prisma.event.findUnique({ where: { id: event_id }, select: { user_id: true, dj_id: true } }),
  ]);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const roleId = me?.role_id != null ? Number(me.role_id) : null;
  const isStaff = roleId === 1 || roleId === 2 || roleId === 3;
  const isOwnEvent = userId != null && (Number(ev.user_id) === userId || Number(ev.dj_id) === userId);
  if (!isStaff && !isOwnEvent) {
    return res.status(403).json({ error: 'forbidden' });
  }

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

  // Mirrors Laravel's TodoService::getTodos()/getCompletedTodos(): admins/super
  // admins (role_id 1/2) see every todo, Staff/Client (role_id 3/4) only see
  // todos assigned to them or belonging to an event they own. Both branches
  // default to incomplete todos, with `?complete=true` opting into Laravel's
  // separate getCompletedTodos() view.
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role_id: true } });
  const roleId = me?.role_id != null ? Number(me.role_id) : null;
  const complete = req.query?.complete === 'true' || req.query?.complete === true;

  const filter = { complete };
  if (roleId !== 1 && roleId !== 2) {
    filter.OR = [{ assigned_to: userId }, { events: { user_id: userId } }];
  }

  const todos = await todoSvc.list({
    filter,
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

  await logActivity(prisma, {
    log_name: "todo created",
    description: `Todo #${Number(newTodo.id)} created`,
    subject_type: "Todo",
    subject_id: Number(newTodo.id),
    causer_id: req.user?.id || null,
    properties: {
      event_id: Number(event_id),
      action: todoData.action,
      assigned_to: Number(assignedTo),
    },
  });

  // Notify the assigned staff member — matches Laravel's TodoController::store(),
  // which emails the assignee on every todo creation and only logs (never fails
  // the request) if the send errors out.
  notifyAssignedTodo(newTodo, assignedTo, req.user).catch((e) => {
    console.error("[todoController] notifyAssignedTodo failed", e?.message || e);
  });

  res.status(201).json(serializeForJson(newTodo));
});

async function notifyAssignedTodo(todo, assignedToId, requester) {
  const [assignedUser, event] = await Promise.all([
    prisma.user.findUnique({ where: { id: assignedToId }, select: { name: true, email: true } }),
    prisma.event.findUnique({
      where: { id: Number(todo.event_id) },
      include: { users_events_user_idTousers: { select: { name: true } } },
    }).catch(() => null),
  ]);
  if (!assignedUser?.email) return;

  let createdPersonName = requester?.name || null;
  if (!createdPersonName) {
    const creatorId = Number(requester?.sub || requester?.id) || null;
    if (creatorId) {
      const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { name: true } }).catch(() => null);
      createdPersonName = creator?.name || null;
    }
  }

  const eventLabel = event
    ? [event.date ? new Date(event.date).toLocaleDateString("en-GB") : null, event.users_events_user_idTousers?.name || null]
        .filter(Boolean)
        .join(" ")
    : null;
  const deadlineLabel = todo.deadline ? new Date(todo.deadline).toLocaleDateString("en-GB") : null;

  const bodyHtml = buildTodoAssignedEmailBody({
    createdPersonName,
    action: todo.action,
    eventLabel,
    deadlineLabel,
    comment: todo.comment,
  });

  const html = buildUsrLetterEmail({
    name: assignedUser.name || "there",
    bodyHtml,
    company: null,
    logoUrl: null,
  });

  await sendEmail({ to: [assignedUser.email], subject: TODO_ASSIGNED_EMAIL_SUBJECT, html });
}

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

  await logActivity(prisma, {
    log_name: "todo updated",
    description: `Todo #${Number(todoId)} updated`,
    subject_type: "Todo",
    subject_id: Number(todoId),
    causer_id: req.user?.id || null,
    properties: {
      event_id: Number(eventId),
      action: updateData.action,
      assigned_to: Number(assignedTo),
      deadline: updateData.deadline,
      complete: updateData.complete,
    },
  });

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

  await logActivity(prisma, {
    log_name: updated.complete ? "todo completed" : "todo reopened",
    description: `Todo #${Number(todoId)} marked ${updated.complete ? "complete" : "incomplete"}`,
    subject_type: "Todo",
    subject_id: Number(todoId),
    causer_id: req.user?.id || null,
    properties: { complete: !!updated.complete },
  });

  res.json(serializeForJson({ success: true, data: updated }));
});

const deleteTodo = catchAsync(async (req, res) => {
  const eventId = Number(req.params?.eventId || req.query?.eventId || req.body?.event_id) || null;
  const todoId = Number(req.params?.todoId || req.query?.todoId || req.body?.todoId) || null;
  if (!todoId) return res.status(400).json({ error: 'todo_id_required' });

  // optional: check event match
  let existingForLog = null;
  if (eventId) {
    const existing = await todoSvc.getById(todoId).catch(() => null);
    if (!existing) return res.status(404).json({ error: 'todo_not_found' });
    if (Number(existing.event_id) !== Number(eventId)) return res.status(400).json({ error: 'event_mismatch' });
    existingForLog = existing;
  } else {
    existingForLog = await todoSvc.getById(todoId).catch(() => null);
  }

  // determine force flag (query or body); accept 'true'|'1' string as well
  const forceRaw = (req.validated && (req.validated.query?.force ?? req.validated.body?.force)) ?? req.query?.force ?? req.body?.force;
  const force = forceRaw === true || forceRaw === 'true' || forceRaw === '1';

  const result = await todoSvc.delete(todoId, { force }).catch(() => null);

  await logActivity(prisma, {
    log_name: "todo deleted",
    description: `Todo #${Number(todoId)} deleted`,
    subject_type: "Todo",
    subject_id: Number(todoId),
    causer_id: req.user?.id || null,
    properties: { action: existingForLog?.action || null },
  });

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
