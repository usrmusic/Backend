import jwt from "jsonwebtoken";
import prisma from "../utils/prismaClient.js";
import services from "../services/index.js";
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import genPassword from "../utils/genPassword.js";
import resendClient from "../utils/mail/resendClient.js";
import crypto from "crypto";
import { buildForgotPasswordEmail } from "../utils/mail/templates/forgotPasswordEmail.js";
import * as authService from "../services/authService.js";
import userService from "../services/userService.js";
import service from "../services/index.js";
import { loadPermissionsForUserId } from "../middleware/authorize.js";
import { logActivity } from "../utils/activityLogger.js";

const userSvc = service.get("user");
const roleSvc = service.get("roles");

const JWT_SECRET = process.env.JWT_SECRET;

export const signIn = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};

  const user = await authService.verifyCredentials(email, password);
    
  const { accessToken, accessExpMin, refreshRaw, refreshHash, refreshExpires } =
    await authService.generateTokens(user);

  try {
    await authService.persistRefreshToken(user.id, refreshHash, refreshExpires);
  } catch (e) {
    console.error("Failed to persist refresh token", e);
  }

  authService.setRefreshCookie(res, refreshRaw);

  const safeUser = serializeForJson({
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
  });

  const resp = { accessToken, expiresInMinutes: accessExpMin, user: safeUser };
  if (process.env.DEBUG_AUTH === "true") {
    // expose refreshRaw only in debug mode to help local testing (do not enable in production)
    resp.debug_refresh = refreshRaw;
  }
  res.json(resp);
});

const signUp = catchAsync(async (req, res) => {
  const { name, email, contact_number, role_id, sendEmail, color } = req.body || {};

  const existing = await userService.getUserByEmail(email);
  if (existing) return res.status(409).json({ error: "email_taken" });

  let result;
  try {
    result = await userService.createUser(
      { name, email, contact_number, role_id, color },
      req.file,
      !!sendEmail,
    );
  } catch (err) {
    console.error("userService.createUser error", err);
    return res
      .status(500)
      .json({ error: "user_create_failed", details: err && err.message });
  }

  const { user, plainPassword, verifyToken, emailSent, resendResult } = result;

  await logActivity(prisma, {
    log_name: "user created",
    description: `User ${user.id} created`,
    subject_type: "User",
    subject_id: Number(user.id),
    causer_id: req.user?.id || null,
    properties: {
      email: user.email,
      role_id: typeof user.role_id === "bigint" ? Number(user.role_id) : user.role_id,
    },
  });

  const safeUser = serializeForJson({
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
  });
  const resp = { user: safeUser };
  if (sendEmail) {
    resp.emailSent = !!emailSent;
    if (resendResult) resp.resendResult = resendResult;
    if (!emailSent && resendResult && resendResult.fallback) {
      resp.warning =
        "Resend client not configured; email not sent. Contact administrator.";
    }
    if (!emailSent && resendResult && !resendResult.fallback) {
      resp.warning =
        "Email send attempted but failed; check resendResult for details.";
    }
  } else {
    resp.password = plainPassword;
    resp.verificationToken = verifyToken;
  }

  res.status(201).json(resp);
});

const verifyEmail = catchAsync(async (req, res) => {
  const { token } = req.body || {};
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    // Only accept tokens minted for email verification — not access tokens.
    if (decoded.typ !== "email_verify") {
      return res.status(400).json({ error: "invalid_token" });
    }
    const email = decoded.email;
    if (!email) return res.status(400).json({ error: "invalid_token" });

    const user = await userService.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "user_not_found" });

    try {
      await userSvc.update(user.id, {
        is_email_send: true,
      });
      return res.json({ ok: true });
    } catch (err) {
      if (err && err.name === "PrismaClientValidationError") {
        return res.status(500).json({
          error: "prisma_schema_mismatch",
          details:
            "is_email_send column is not present in Prisma Client. Update your Prisma schema or adjust verification logic.",
        });
      }
      throw err;
    }
  } catch (err) {
    return res
      .status(400)
      .json({ error: "invalid_or_expired_token", details: err.message });
  }
});

const requestVerifyEmail = catchAsync(async (req, res) => {
  // Send a verification token/link to the currently authenticated user
  // `verifyAccessToken` middleware must set req.user
  if (!req.user) return res.status(401).json({ error: "missing_token" });

  // try to resolve numeric user id from token subject, falling back to email
  const sub = req.user.sub || req.user.id || req.user.email;
  let userId = null;
  if (typeof sub === "number" || /^[0-9]+$/.test(String(sub))) userId = Number(sub);

  let user;
  if (userId) {
    user = await userSvc.getById(userId);
  } else if (req.user.email) {
    user = await userService.getUserByEmail(String(req.user.email));
  }

  if (!user) return res.status(404).json({ error: "user_not_found" });

  // generate a short-lived JWT token and send via configured email provider
  const tokenPayload = { sub: user.id, email: user.email, typ: "email_verify" };
  const verifyToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "1h" });

  try {
    const sendRes = await resendClient({
      to: user.email,
      subject: "Verify your email",
      html: `<p>Hello ${user.name || ''},</p><p>Your verification token (or link) is:</p><pre>${verifyToken}</pre><p>Or click: <a href="/verify?token=${verifyToken}">Verify email</a></p>`,
    });
    const emailSent = !!(sendRes && sendRes.ok && !sendRes.fallback);
    return res.json({ ok: true, emailSent, verificationToken: emailSent ? undefined : verifyToken });
  } catch (err) {
    console.error("requestVerifyEmail resendClient error", err);
    // Return token in response when email sending fails so client can display it (only in dev or when necessary)
    return res.status(500).json({ error: "email_send_failed", verificationToken: verifyToken });
  }
});

// Per-email rate limit for password resets. A forgot request RESETS the
// account's password, so without this an attacker who knows an admin's address
// could repeatedly reset it and lock them out (each reset invalidates the last).
// In-memory is adequate for the current single-instance deploy; move to a DB/
// Redis window if the app is ever scaled horizontally.
const RESET_MIN_INTERVAL_MS = 10 * 60 * 1000;
const lastResetAt = new Map();

// Matches Laravel's ForgetPasswordController exactly: a token is generated
// and stored in `password_resets` (keyed by email, same table Laravel uses),
// and the user is emailed a link to pick their OWN new password — not an
// auto-generated one mailed directly, which is what this used to do and is
// a materially weaker flow (no user choice, and the password sits in transit
// in the email itself).
const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body || {};
  // Single generic response for every outcome — unknown email, rate-limited,
  // send failure — so this endpoint can't be used to enumerate accounts or to
  // probe whether a reset landed. (Frontend already treats it as "secure mode".)
  const GENERIC = {
    ok: true,
    message: "If an account exists for that email, a password reset link has been sent.",
  };
  const key = String(email || "").trim().toLowerCase();
  if (!key) return res.json(GENERIC);

  // Rate limit BEFORE any DB mutation, keyed on the requested email.
  const prev = lastResetAt.get(key);
  if (prev && Date.now() - prev < RESET_MIN_INTERVAL_MS) {
    return res.json(GENERIC);
  }

  const user = await userService.getUserByEmail(email);
  if (!user) {
    // Do NOT reveal non-existence; still record the attempt so a nonexistent
    // address can't be used to bypass the limiter for a real one later.
    lastResetAt.set(key, Date.now());
    return res.json(GENERIC);
  }

  lastResetAt.set(key, Date.now());
  const token = crypto.randomBytes(32).toString("hex");

  const resetBase = (process.env.PUBLIC_FRONTEND_URL || "https://www.usrmusic.com").replace(/\/$/, "");
  const resetUrl = `${resetBase}/reset-password/${token}?email=${encodeURIComponent(user.email)}`;
  const { subject, html } = await buildForgotPasswordEmail({ name: user.name || "", resetUrl });

  try {
    const sendResult = await resendClient({ to: user.email, subject, html });
    if (sendResult && (sendResult.fallback || sendResult.ok === false)) {
      console.error("forgotPassword email send failed:", sendResult);
      return res.json(GENERIC);
    }
  } catch (err) {
    console.error("resendClient error (forgotPassword)", err);
    return res.json(GENERIC);
  }

  // Upsert on email (the table's primary key), same as Laravel's
  // update-if-exists-else-insert logic.
  await prisma.password_resets.upsert({
    where: { email: user.email },
    update: { token, created_at: new Date() },
    create: { email: user.email, token, created_at: new Date() },
  });

  return res.json(GENERIC);
});

// Public — consumes the emailed token and lets the user set their own new
// password. No auth required (the token itself is the credential), matching
// Laravel's submitResetPasswordForm.
const resetPasswordWithToken = catchAsync(async (req, res) => {
  const { email, token, password } = req.body || {};
  const GENERIC_ERROR = { ok: false, error: "invalid_or_expired_token" };

  const record = await prisma.password_resets.findUnique({
    where: { email: String(email || "").trim().toLowerCase() },
  });
  if (!record || record.token !== token) {
    return res.status(400).json(GENERIC_ERROR);
  }

  const expirationMinutes = Number(process.env.JWT_RESET_PASSWORD_EXPIRATION_MINUTES) || 10;
  const ageMs = Date.now() - new Date(record.created_at).getTime();
  if (ageMs > expirationMinutes * 60 * 1000) {
    await prisma.password_resets.delete({ where: { email: record.email } }).catch(() => {});
    return res.status(400).json(GENERIC_ERROR);
  }

  const user = await userService.getUserByEmail(record.email);
  if (!user) return res.status(400).json(GENERIC_ERROR);

  const hashed = await bcrypt.hash(password, 10);
  await userSvc.update(user.id, { password: hashed, password_text: password });
  await prisma.password_resets.delete({ where: { email: record.email } }).catch(() => {});

  await logActivity(prisma, {
    log_name: "password reset via token",
    description: `Password reset via token for user ${user.id}`,
    subject_type: "User",
    subject_id: Number(user.id),
    causer_id: Number(user.id),
    properties: {},
  });

  return res.json({ ok: true });
});

const updateUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  // load existing user to enforce email-change rules
  const existing = await userSvc.getById(id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: "user_not_found" });

  // If user has already verified email, disallow changing the email address
  if (body.email !== undefined && existing.is_email_send) {
    const incoming = String(body.email || "").trim();
    const current = String(existing.email || "").trim();
    if (incoming.toLowerCase() !== current.toLowerCase()) {
      return res.status(400).json({ error: "email_verified_cannot_update" });
    }
  }

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) data.email = body.email;
  if (body.contact_number !== undefined)
    data.contact_number = body.contact_number;
  // role_id is a privilege control, so it may only be changed by a caller who
  // passed the `user` permission check — never by a user editing their own
  // record via the ownership path. Without this, any Client could self-escalate
  // with `PUT /user/<own id> {role_id:1}`. Dropped silently rather than
  // rejected so a normal self-profile save that echoes back an unchanged
  // role_id still succeeds.
  if (body.role_id !== undefined && !req.authorizedViaOwnership) {
    data.role_id = body.role_id;
  }
  if (body.address !== undefined) data.address = body.address;
  // An empty string clears the colour back to the grey fallback; Prisma needs
  // a real null for that, not "".
  if (body.color !== undefined) data.color = body.color || null;
  if (body.sendEmail !== undefined) data.is_email_send = !!body.sendEmail;
  else if (body.email_send !== undefined)
    data.is_email_send = !!body.email_send;

  if (req.file) {
    try {
      const uploadRes = await uploadFile(req.file, { folder: "profile" });
      if (uploadRes && uploadRes.url) data.profile_photo = uploadRes.url;
    } catch (e) {
      console.error("updateUser upload error", e);
    }
  }

  data.updated_at = new Date();
  const user = await userSvc.update(id, data);

  await logActivity(prisma, {
    log_name: "user updated",
    description: `User ${id} updated`,
    subject_type: "User",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: {
      old: {
        name: existing.name,
        email: existing.email,
        role_id: typeof existing.role_id === "bigint" ? Number(existing.role_id) : existing.role_id,
      },
      new: {
        name: user.name,
        email: user.email,
        role_id: typeof user.role_id === "bigint" ? Number(user.role_id) : user.role_id,
      },
    },
  });

  res.json(serializeForJson(user));
});

// Matches Laravel's UserController::SoftDeleteUser guard: a user cannot be
// soft-deleted while still assigned as DJ on an open/confirmed/cancelled
// event (event_status_id in [1,2,4]) or while owning a DJ package
// (package_users row). Returns a reason string when blocked, or null when
// the user is safe to delete.
async function getUserDeleteBlockReason(id) {
  const [hasEvents, hasPackage] = await Promise.all([
    prisma.event.findFirst({
      where: { dj_id: id, event_status_id: { in: [1, 2, 4] } },
      select: { id: true },
    }),
    prisma.package_users.findFirst({
      where: { user_id: id },
      select: { id: true },
    }),
  ]);

  if (hasEvents) return "Cannot delete user. User has associated event.";
  if (hasPackage) return "Cannot delete user. User has associated DJ package.";
  return null;
}

const deleteUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const existingUser = await userSvc.getById(id);

  const blockReason = await getUserDeleteBlockReason(id);
  if (blockReason) {
    return res
      .status(400)
      .json({ error: "user_has_active_events", message: blockReason });
  }

  const result = await userSvc.delete(id);
  // If no result was returned, the user was not found
  if (!result) return res.status(404).json({ error: "user_not_found" });

  await logActivity(prisma, {
    log_name: "user deleted",
    description: `User ${id} deleted`,
    subject_type: "User",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: { email: existingUser?.email || null },
  });
  // If a soft-delete was performed, the result should include `deleted_at`.
  if (result.deleted_at) {
    return res.json({
      ok: true,
      softDeleted: true,
      deletedAt: result.deleted_at,
    });
  }
  // Otherwise assume a permanent deletion occurred (result is the deleted record)
  return res.json({ ok: true, softDeleted: false });
});

const deleteManyUsers = catchAsync(async (req, res) => {
  let idsParam = req.body?.ids;
  if (idsParam == null) return res.status(400).json({ error: "ids_required" });

  let idsArray = [];
  if (Array.isArray(idsParam)) {
    idsArray = idsParam;
  } else if (typeof idsParam === "string") {
    const raw = idsParam.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) idsArray = parsed;
        else idsArray = [parsed];
      } catch (e) {
        idsArray = raw.replace(/^\[|\]$/g, "").split(",");
      }
    } else {
      idsArray = raw.length ? raw.split(",") : [];
    }
  } else if (typeof idsParam === "number") {
    idsArray = [idsParam];
  } else if (typeof idsParam === "object" && idsParam !== null) {
    if (Array.isArray(idsParam.ids)) idsArray = idsParam.ids;
    else idsArray = [idsParam];
  }

  const ids = idsArray
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "ids_required" });

  // Support `force` option from body
  const force = !!(
    req.body &&
    (req.body.force === true || req.body.force === "true" || req.body.force === "1")
  );

  // Same guard as the single-delete path: check each id for active events
  // (dj_id on an open/confirmed/cancelled event) or an owned DJ package, and
  // skip those rather than failing the whole batch.
  const blockReasons = await Promise.all(ids.map((id) => getUserDeleteBlockReason(id)));
  const blocked = [];
  const deletable = [];
  ids.forEach((id, i) => {
    if (blockReasons[i]) blocked.push({ id, reason: blockReasons[i] });
    else deletable.push(id);
  });

  // Delegate deletion to the CoreCrudService (userSvc)
  const result = deletable.length
    ? await userSvc.deleteMany(deletable, { force })
    : { count: 0 };

  // Normalize response
  const count = result && typeof result.count === "number" ? result.count : undefined;

  await logActivity(prisma, {
    log_name: "users bulk deleted",
    description: `${deletable.length} users bulk deleted${blocked.length ? `, ${blocked.length} blocked` : ""}`,
    subject_type: "User",
    subject_id: null,
    causer_id: req.user?.id || null,
    properties: { ids: deletable, blocked, count },
  });

  res.json({ ok: true, count, deleted: deletable, blocked });
});

// Matches Laravel's UserController::recoverUser: restores one or more
// soft-deleted users (clears deleted_at). Accepts the same `ids` shapes as
// deleteManyUsers/deleteMany (array, single number, JSON/CSV string).
const restoreUsers = catchAsync(async (req, res) => {
  let idsParam = req.body?.ids;
  if (idsParam == null) return res.status(400).json({ error: "ids_required" });

  let idsArray = [];
  if (Array.isArray(idsParam)) {
    idsArray = idsParam;
  } else if (typeof idsParam === "string") {
    const raw = idsParam.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) idsArray = parsed;
        else idsArray = [parsed];
      } catch (e) {
        idsArray = raw.replace(/^\[|\]$/g, "").split(",");
      }
    } else {
      idsArray = raw.length ? raw.split(",") : [];
    }
  } else if (typeof idsParam === "number") {
    idsArray = [idsParam];
  } else if (typeof idsParam === "object" && idsParam !== null) {
    if (Array.isArray(idsParam.ids)) idsArray = idsParam.ids;
    else idsArray = [idsParam];
  }

  const ids = idsArray.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (!ids.length) return res.status(400).json({ error: "ids_required" });

  const result = await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { deleted_at: null },
  });

  const restoredUsers = await prisma.user.findMany({ where: { id: { in: ids } } });

  await logActivity(prisma, {
    log_name: "user restored",
    description: `${ids.length} user(s) restored`,
    subject_type: "User",
    subject_id: ids.length === 1 ? ids[0] : null,
    causer_id: req.user?.id || null,
    properties: { ids, count: result?.count },
  });

  res.json({ ok: true, count: result?.count, data: serializeForJson(restoredUsers) });
});

const listUsers = catchAsync(async (req, res) => {
  // Pagination, sorting and search support
  const perPage = Number(req.query.perPage || req.query.limit || req.params.perPage || req.params.limit || 25);
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

  // build base filter (only active users; exclude Client role — clients live
  // under /api/client. This matches Laravel's User::scopeStaffs which filters
  // role_id != Client.)
  let filter = { deleted_at: null, NOT: { role_id: BigInt(4) } };
  if (req.query.filter || req.params.filter) {
    try {
      const parsed =
        (typeof req.query.filter === "string" || typeof req.params.filter === "string")
          ? JSON.parse(req.query.filter || req.params.filter)
          : req.query.filter || req.params.filter;
      filter = { ...filter, ...parsed };
    } catch (e) {
      // ignore invalid JSON filter
    }
  }

  // search across name, email and contact_number
  const q = req.query.search || req.query.q || req.params.search || req.params.q;
  if (q) {
    const s = String(q).trim();
    if (s.length) {
      filter.OR = [
        { name: { contains: s } },
        { email: { contains: s } },
        { contact_number: { contains: s } },
      ];
    }
  }

  const users = await userSvc.list({
    filter,
    perPage,
    page,
    sort,
    include: { roles: { select: { id: true, name: true } } },
  });
  const total = await prisma.user.count({ where: filter }).catch(() => 0);

  // Flatten the role relation so the frontend can render `record.role` directly.
  const shaped = (users || []).map((u) => {
    const role = u?.roles?.name || null;
    return { ...u, role };
  });

  return res.json({
    data: serializeForJson(shaped),
    meta: { total, page, perPage },
  });
});

const listRoles = catchAsync(async (req, res) => {
  const roles = await roleSvc.list();
  res.json(serializeForJson(roles));
});

const getUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const user = await userSvc.getById(id);
  if (!user || user.deleted_at)
    return res.status(404).json({ error: "user_not_found" });
  res.json(serializeForJson(user));
});

// Admin-triggered password reset by user id. Generates a new password, emails
// it to the target user and stores the new hash. Used from the Users and
// Clients management screens.
const resetPassword = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "id_required" });

  const user = await userService.getUserById
    ? await userService.getUserById(id)
    : await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const plainPassword = genPassword();

  try {
    const sendResult = await resendClient({
      to: user.email,
      subject: "Your password has been reset",
      html: `<p>Hello ${user.name || ""},</p>
             <p>An administrator has reset your password. Your new temporary password is:</p>
             <pre>${plainPassword}</pre>
             <p>Please sign in and change your password.</p>`,
    });
    if (sendResult && sendResult.fallback) {
      return res.status(500).json({ error: "resend_not_configured" });
    }
    if (sendResult && sendResult.ok === false) {
      return res
        .status(500)
        .json({ error: "email_send_failed", details: sendResult });
    }
  } catch (err) {
    console.error("resendClient error (resetPassword)", err);
    return res.status(500).json({ error: "email_send_failed" });
  }

  const hashed = await bcrypt.hash(plainPassword, 10);
  await userSvc.update(user.id, {
    password: hashed,
    password_text: plainPassword,
  });

  await logActivity(prisma, {
    log_name: "user password reset",
    description: `Password reset for user ${user.id}`,
    subject_type: "User",
    subject_id: Number(user.id),
    causer_id: req.user?.id || null,
    properties: {},
  });

  return res.json({ ok: true, email: user.email });
});

const listUserDropdown = catchAsync(async (req, res) => {
  const users = await userSvc.list({
    filter: { deleted_at: null, NOT:{ role_id: BigInt(4)} },
    select: { id: true, name: true, email: true, package_users:{select: { id: true, package_name: true }} },
    sort: "name:asc",
  });
  res.json(serializeForJson(users));
});

/* Roster for the DJ Colours settings panel.

   "Who is a DJ" is fuzzier than it looks: role 3 is the intended set, but
   `events.dj_id` is a plain FK to `users` with nothing stopping an admin being
   assigned to an event. Filtering on role alone would hide a DJ who is already
   colouring real bookings on the calendar, so the roster is role 3 OR anyone
   who has ever been set as `dj_id` on an event. */
const listDjColors = catchAsync(async (req, res) => {
  const djs = await prisma.user.findMany({
    where: {
      deleted_at: null,
      OR: [
        { role_id: BigInt(3) },
        { events_events_dj_idTousers: { some: {} } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      profile_photo: true,
      color: true,
      role_id: true,
      _count: { select: { events_events_dj_idTousers: true } },
    },
    orderBy: { name: "asc" },
  });

  res.json(
    serializeForJson({
      data: djs.map((d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        profile_photo: d.profile_photo,
        color: d.color,
        role_id: d.role_id,
        event_count: d._count?.events_events_dj_idTousers ?? 0,
      })),
    }),
  );
});

const currentUser = catchAsync(async (req, res) => {
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

  const user = await userSvc.getById(userId);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const perms = await loadPermissionsForUserId(userId);
  const out = {
    id: user.id,
    name: user.name,
    email: user.email,
    profile_photo: user.profile_photo || null,
    role_id: user.role_id ? String(user.role_id) : undefined,
    permissions: Array.from(perms || []),
  };
  res.json(out);
});
export default {
  signIn,
  signUp,
  verifyEmail,
  requestVerifyEmail,
  forgotPassword,
  resetPasswordWithToken,
  resetPassword,
  updateUser,
  deleteUser,
  deleteManyUsers,
  restoreUsers,
  listUsers,
  listRoles,
  getUser,
  currentUser,
  listUserDropdown,
  listDjColors,
};
