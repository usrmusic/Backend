import prisma from '../utils/prismaClient.js';
import jwt from 'jsonwebtoken';
import { hashToken, generateRandomToken } from '../utils/tokenUtils.js';
import { serializeForJson } from '../utils/serialize.js';

const JWT_SECRET = process.env.JWT_SECRET;

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const result = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      result[key] = decodeURIComponent(val);
    }
  });
  return result;
}

export const refreshToken = async (req, res) => {
  const cookies = parseCookies(req);
  const cookieName = process.env.REFRESH_COOKIE_NAME || 'refreshToken';
  const raw = cookies[cookieName];
  if (!raw) return res.status(401).json({ error: 'no_refresh_token' });

  const hashed = hashToken(raw);
  const rec = await prisma.personal_access_tokens.findFirst({ where: { token: hashed } });
  if (!rec) return res.status(401).json({ error: 'invalid_refresh_token' });
  if (rec.expires_at && new Date(rec.expires_at) < new Date()) {
    await prisma.personal_access_tokens.delete({ where: { id: rec.id } }).catch(()=>{});
    return res.status(401).json({ error: 'refresh_token_expired' });
  }

  // load user
  const userId = Number(rec.tokenable_id);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  // issue new access token
  const payload = serializeForJson({ sub: user.id, email: user.email, role_id: user.role_id });
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: `${process.env.JWT_ACCESS_EXPIRATION_MINUTES || 30}m` });

  // rotate refresh token: create new and delete old
  const refreshRaw = generateRandomToken(48);
  const refreshHash = hashToken(refreshRaw);
  const refreshDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const refreshExpires = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

  await prisma.personal_access_tokens.create({ data: {
    tokenable_type: 'user', tokenable_id: BigInt(user.id), name: 'refresh_token', token: refreshHash, expires_at: refreshExpires
  }});
  await prisma.personal_access_tokens.delete({ where: { id: rec.id } }).catch(()=>{});

  // set cookie
  const cookieSecure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  const cookieSameSite = process.env.COOKIE_SAME_SITE || 'lax';
  const cookiePath = process.env.REFRESH_COOKIE_PATH || '/api';
  res.cookie(cookieName, refreshRaw, { httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite, path: cookiePath, maxAge: refreshDays * 24 * 60 * 60 * 1000 });

  return res.json({ accessToken, expiresInMinutes: parseInt(process.env.JWT_ACCESS_EXPIRATION_MINUTES || '30', 10) });
};

export const signOut = async (req, res) => {
  const cookies = parseCookies(req);
  const cookieName = process.env.REFRESH_COOKIE_NAME || 'refreshToken';
  const raw = cookies[cookieName];
  if (raw) {
    const hashed = hashToken(raw);
    await prisma.personal_access_tokens.deleteMany({ where: { token: hashed } }).catch(()=>{});
  }

  res.clearCookie(cookieName, { path: process.env.REFRESH_COOKIE_PATH || '/api' });
  return res.json({ ok: true });
};

export default { refreshToken, signOut };
