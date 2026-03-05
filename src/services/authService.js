import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import services from './index.js';
import { serializeForJson } from '../utils/serialize.js';
import { generateRandomToken, hashToken } from '../utils/tokenUtils.js';
import userService from './userService.js';
import AppError from '../utils/AppError.js';

const userSvc = services.get('user');
// Prisma schema defines `personal_access_tokens` for stored tokens; use that service key
const accessTokenSvc = services.get('personal_access_tokens');

const JWT_SECRET = process.env.JWT_SECRET;

export async function verifyCredentials(email, password) {
  const user = await userService.getUserByEmail(email);
  if (!user) throw new AppError('invalid_credentials', 401);

  const hashed = user.password || null;
  const plain = user.password_text || null;

  let ok = false;
  if (hashed) {
    try {
      ok = await bcrypt.compare(password, hashed);
    } catch (e) {
      ok = false;
    }
  }
  if (!ok && plain) ok = plain === password;
  if (!ok) throw new AppError('invalid_credentials', 401);
  return user;
}

export async function generateTokens(user) {
  const payload = serializeForJson({ sub: user.id, email: user.email, role_id: user.role_id });
  const accessExpMin = parseInt(process.env.JWT_ACCESS_EXPIRATION_MINUTES || '30', 10);
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: `${accessExpMin}m` });

  const refreshRaw = generateRandomToken(48);
  const refreshHash = hashToken(refreshRaw);
  const refreshDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const refreshExpires = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

  return { accessToken, accessExpMin, refreshRaw, refreshHash, refreshExpires };
}

export async function persistRefreshToken(userId, refreshHash, refreshExpires) {
  const data = {
    tokenable_type: 'user',
    tokenable_id: BigInt(userId),
    name: 'refresh_token',
    token: refreshHash,
    expires_at: refreshExpires,
  };
  const res = await accessTokenSvc.create(data);
  try {
    if (process.env.DEBUG_AUTH === 'true') {
      console.debug('persistRefreshToken: stored hash=', refreshHash, 'recId=', res && res.id);
    }
  } catch (e) {
    // ignore logging errors
  }
  return res;
}

export function setRefreshCookie(res, refreshRaw) {
  const refreshDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const cookieName = process.env.REFRESH_COOKIE_NAME || 'refreshToken';
  const cookieSecure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
  const cookieSameSite = process.env.COOKIE_SAME_SITE || 'lax';
  const cookiePath = process.env.REFRESH_COOKIE_PATH || '/api';
  res.cookie(cookieName, refreshRaw, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: cookiePath,
    maxAge: refreshDays * 24 * 60 * 60 * 1000,
  });
}

export default {
  verifyCredentials,
  generateTokens,
  persistRefreshToken,
  setRefreshCookie,
};
