import jwt from "jsonwebtoken";
import prisma from "../utils/prismaClient.js";
import services from "../services/index.js";
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import genPassword from "../utils/genPassword.js";
import * as authService from "../services/authService.js";
import userService from "../services/userService.js";
import service from "../services/index.js";

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
  const { name, email, contact_number, role_id, sendEmail } = req.body || {};

  const existing = await userService.getUserByEmail(email);
  if (existing) return res.status(409).json({ error: "email_taken" });

  let result;
  try {
    result = await userService.createUser(
      { name, email, contact_number, role_id },
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
    const decoded = jwt.verify(token, JWT_SECRET);
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

const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body || {};

  const user = await userService.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const plainPassword = genPassword();

  try {
    const sendResult = await resendClient({
      to: user.email,
      subject: `Your new password`,
      html: `<p>Hello ${user.name || ""},</p><p>Your password has been reset. Your new temporary password is:</p><pre>${plainPassword}</pre><p>Please sign in and change your password.</p>`,
    });
    console.log("resendClient forgotPassword send result:", sendResult);
    if (sendResult && sendResult.fallback) {
      return res.status(500).json({ error: "resend_not_configured" });
    }
    if (sendResult && sendResult.ok === false) {
      return res
        .status(500)
        .json({ error: "email_send_failed", details: sendResult });
    }
  } catch (err) {
    console.error("resendClient error (forgotPassword)", err);
    return res.status(500).json({ error: "email_send_failed", details: err });
  }

  // If email sent successfully, update DB password via CoreCrudService
  const hashed = await bcrypt.hash(plainPassword, 10);
  // userSvc.update expects (id, data) — we already loaded `user` above
  await userSvc.update(user.id, {
    password: hashed,
    password_text: plainPassword,
  });

  return res.json({ ok: true });
});

const updateUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) data.email = body.email;
  if (body.contact_number !== undefined)
    data.contact_number = body.contact_number;
  if (body.role_id !== undefined) data.role_id = body.role_id;
  if (body.address !== undefined) data.address = body.address;
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
  res.json(serializeForJson(user));
});

const deleteUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const result = await userSvc.delete(id);
  // If no result was returned, the user was not found
  if (!result) return res.status(404).json({ error: "user_not_found" });
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
  console.log("hello")
  let ids = [];
  if (req.params && req.params.ids) {
    if (Array.isArray(req.params.ids)) {
      ids = req.params.ids.map((v) => Number(v));
    } else {
      const raw = String(req.params.ids).trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) ids = parsed.map((v) => Number(v));
        else ids = [Number(parsed)];
      } catch (e) {
        ids = raw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));
      }
    }
  }

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "ids_required" });

  // Support `force` option from params (e.g., route may include a `force` param)
  const force = !!(
    req.params &&
    (req.params.force === true ||
      req.params.force === "true" ||
      req.params.force === "1")
  );

  // Delegate deletion to the CoreCrudService (userSvc)
  const result = await userSvc.deleteMany(ids, { force });

  // Normalize response
  const count =
    result && typeof result.count === "number" ? result.count : undefined;
  res.json({ ok: true, count });
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
    undefined;

  // build base filter (only active users)
  let filter = { deleted_at: null };
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

  const users = await userSvc.list({ filter, perPage, page, sort });
  const total = await prisma.user.count({ where: filter }).catch(() => 0);

  return res.json({
    data: serializeForJson(users),
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

const listUserDropdown = catchAsync(async (req, res) => {
  const users = await userSvc.list({
    filter: { deleted_at: null, NOT:{ role_id: BigInt(4)} },
    select: { id: true, name: true, email: true, package_users:{select: { id: true, package_name: true }} },
  });
  res.json(serializeForJson(users));
});
export default {
  signIn,
  signUp,
  verifyEmail,
  forgotPassword,
  updateUser,
  deleteUser,
  deleteManyUsers,
  listUsers,
  listRoles,
  getUser,
  listUserDropdown,
};
