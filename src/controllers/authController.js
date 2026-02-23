import jwt from "jsonwebtoken";
import prisma from "../utils/prismaClient.js";
import services from '../services/index.js';
import catchAsync from "../utils/catchAsync.js";
import bcrypt from "bcrypt";
import { serializeForJson } from "../utils/serialize.js";
import { uploadFile } from "../utils/uploadHelper.js";
import { generateRandomToken, hashToken } from "../utils/tokenUtils.js";
// import * as ResendLib from "resend";
import { Resend } from 'resend';

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_EXP_MIN = parseInt(
  process.env.JWT_ACCESS_EXPIRATION_MINUTES || "30",
  10,
);
const RESEND_API_KEY = process.env.RESEND_API_KEY;

let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

function genPassword(len = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const signIn = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "email_and_password_required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const hashed = user.password || null; // Laravel typically stores bcrypt hash in `password`
  const plain = user.password_text || null;

  let passwordOk = false;
  if (hashed) {
    try {
      passwordOk = await bcrypt.compare(password, hashed);
    } catch (e) {
      passwordOk = false;
    }
  }

  if (!passwordOk && plain) {
    passwordOk = plain === password;
  }

  if (!passwordOk)
    return res.status(401).json({ error: "invalid_credentials" });

  // Use serializer to convert BigInt and Date fields to safe JSON-friendly values
  const payload = serializeForJson({
    sub: user.id,
    email: user.email,
    role_id: user.role_id,
  });
  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${ACCESS_EXP_MIN}m`,
  });

  // Create refresh token and persist its hash in personal_access_tokens
  const refreshRaw = generateRandomToken(48);
  const refreshHash = hashToken(refreshRaw);
  const refreshDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const refreshExpires = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

  try {
    await prisma.personal_access_tokens.create({
      data: {
        tokenable_type: 'user',
        tokenable_id: BigInt(user.id),
        name: 'refresh_token',
        token: refreshHash,
        expires_at: refreshExpires,
      },
    });
  } catch (e) {
    console.error('Failed to persist refresh token', e);
  }

  // Set HttpOnly refresh cookie
  const cookieName = process.env.REFRESH_COOKIE_NAME || 'refreshToken';
  const cookieSecure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  const cookieSameSite = process.env.COOKIE_SAME_SITE || 'lax';
  const cookiePath = process.env.REFRESH_COOKIE_PATH || '/api';
  res.cookie(cookieName, refreshRaw, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: cookiePath,
    maxAge: refreshDays * 24 * 60 * 60 * 1000,
  });

  const safeUser = serializeForJson({
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
  });

  res.json({
    accessToken: token,
    expiresInMinutes: ACCESS_EXP_MIN,
    user: safeUser,
  });
});

export const signUp = catchAsync(async (req, res) => {
  const { name, email, contact_number, role_id, sendEmail } = req.body || {};
  // Debug logs to troubleshoot missing form fields from multipart requests
  console.log('signUp request headers:', {
    authorization: req.headers && req.headers.authorization,
    'content-type': req.headers && req.headers['content-type'],
  });
  console.log('signUp body keys:', Object.keys(req.body || {}));
  console.log('signUp file:', req.file ? { originalname: req.file.originalname, mimetype: req.file.mimetype, path: req.file.path } : null);

  console.log(req.body,'body');
  if (!email) return res.status(400).json({ error: "email_required" });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email_taken" });

  const plainPassword = genPassword();
  const hashed = await bcrypt.hash(plainPassword, 10);

  const roleId = role_id != null ? BigInt(role_id) : BigInt(1);

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
      });
      if (uploadRes && uploadRes.url) profilePhotoUrl = uploadRes.url;
    } catch (err) {
      console.error('uploadFile error', err);
    }
  }

  const data = {
    role_id: roleId,
    name: name || null,
    email,
    password: hashed,
    password_text: plainPassword,
    contact_number: contact_number || "",
    address: null,
    is_email_send: !!sendEmail,
    profile_photo: profilePhotoUrl,
    deleted_at: null,
    created_by: null,
    updated_by: null,
  };

  let user;
  try {
    console.log('Creating user with data keys:', Object.keys(data));
    user = await prisma.user.create({ data });
    console.log('User created id:', user && user.id);
  } catch (err) {
    console.error('prisma.user.create error', err);
    return res.status(500).json({ error: 'user_create_failed', details: err && err.message });
  }

  const tokenPayload = serializeForJson({ sub: user.id, email: user.email });
  const verifyToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "1h" });

  let emailSent = false;
  let resendResult = null;

  if (sendEmail && resend) {
    try {
      const sendResult = await resend.emails.send({
        from: "no-reply@usrmusic.dev",
        to: user.email,
        subject: "Verify your email",
        html: `<p>Hello ${user.name || ""},</p><p>Your verification code (or link) is:</p><pre>${verifyToken}</pre><p>Or click: <a href="/verify?token=${verifyToken}">Verify email</a></p>`,
      });
      console.log("Resend send result:", sendResult);
      emailSent = true;
      resendResult = sendResult;
    } catch (err) {
      console.error("Resend error", err);
      resendResult = err;
    }
  }

  const safeUser = serializeForJson({
    id: user.id,
    name: user.name,
    email: user.email,
    role_id: user.role_id,
  });
  const resp = { user: safeUser };
  if (sendEmail) {
    // include email send diagnostics
    resp.emailSent = !!emailSent;
    if (resendResult) resp.resendResult = resendResult;
    if (!emailSent && !resend) {
      // Resend client not configured - do not return password or token for security
      resp.warning =
        "Resend client not configured; email not sent. Contact administrator.";
    }
    if (!emailSent && resend && resendResult) {
      // Send attempted but failed
      resp.warning =
        "Email send attempted but failed; check resendResult for details.";
    }
  } else {
    resp.password = plainPassword;
    resp.verificationToken = verifyToken;
  }

  res.status(201).json(resp);
});

export const verifyEmail = catchAsync(async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token_required" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;
    if (!email) return res.status(400).json({ error: "invalid_token" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "user_not_found" });

    try {
      await prisma.user.update({
        where: { email },
        data: { is_email_send: true },
      });
      return res.json({ ok: true });
    } catch (err) {
      if (err && err.name === "PrismaClientValidationError") {
        return res
          .status(500)
          .json({
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

export const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email_required' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  if (!resend) {
    return res.status(500).json({ error: 'resend_not_configured' });
  }

  const plainPassword = genPassword();

  try {
    const sendResult = await resend.emails.send({
      from: process.env.RESEND_FROM || 'no-reply@usrmusic.dev',
      to: user.email,
      subject: `Your new password`,
      html: `<p>Hello ${user.name || ''},</p><p>Your password has been reset. Your new temporary password is:</p><pre>${plainPassword}</pre><p>Please sign in and change your password.</p>`,
    });
    console.log('Resend forgotPassword send result:', sendResult);
    if (sendResult && sendResult.statusCode) {
      // Resend returned a validation/error response object
      console.error('Resend reported error', sendResult);
      return res.status(500).json({ error: 'email_send_failed', details: sendResult });
    }
  } catch (err) {
    console.error('Resend error (forgotPassword)', err);
    return res.status(500).json({ error: 'email_send_failed', details: err });
  }

  // If email sent successfully, update DB password
  const hashed = await bcrypt.hash(plainPassword, 10);
  await prisma.user.update({ where: { email }, data: { password: hashed, password_text: null } });

  return res.json({ ok: true });
});

export const updateUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_user_id' });

  const allowed = ['name', 'contact_number', 'role_id', 'email', 'address', 'profile_photo'];
  const data = {};
  for (const k of allowed) {
    if (k in req.body && req.body[k] !== undefined) {
      data[k] = k === 'role_id' ? BigInt(req.body[k]) : req.body[k];
    }
  }

  data.updated_at = new Date();

  const user = await prisma.user.update({ where: { id }, data });
  res.json(serializeForJson(user));
});

export const deleteUser = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_user_id' });

  await prisma.user.update({ where: { id }, data: { deleted_at: new Date() } });
  res.json({ ok: true });
});

export const deleteManyUsers = catchAsync(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids_required' });
  const now = new Date();
  const updates = await prisma.user.updateMany({ where: { id: { in: ids.map((i) => Number(i)) } }, data: { deleted_at: now } });
  res.json({ ok: true, count: updates.count });
});

export const listUsers = catchAsync(async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(serializeForJson(users));
});

export const listRoles = catchAsync(async (req, res) => {
  const roles = await services.roles.list();
  res.json(serializeForJson(roles));
});

export default { signIn, signUp, verifyEmail, forgotPassword, updateUser, deleteUser, deleteManyUsers, listUsers, listRoles };
